#!/usr/bin/env node
/**
 * publish-public.mjs: allowlist-based publisher from a private repo into a public repo checkout.
 *
 * Safety model:
 *   - Candidate files = `git ls-files` + untracked-not-ignored files (never gitignored files).
 *   - A file is published only if it matches `include`, does not match `exclude`, and does not
 *     match the hard `neverInclude` floor.
 *   - Every published file (path + content, after optional transforms) is scanned against
 *     `denyPatterns`, names derived from the private project registry, and literal values from
 *     the local env file. Any hit blocks `--apply`.
 *   - `--apply` writes only into the target working tree, records what it wrote in
 *     `<target>/.publish-manifest.json`, and only deletes files it previously published (and only
 *     if they are unchanged since). It never touches `.git` and never runs git commands in the target.
 *
 * Usage:
 *   node scripts/publish-public.mjs [--dry-run] [--apply] [--target <path>] [--report <file.md>]
 *                                   [--config <file>] [--include <glob>]... [--adopt] [--quiet]
 *
 *   --dry-run   (default) list publishable/skipped files and all deny-pattern hits; exit 1 on any hit.
 *   --apply     copy files into target; refuses on any hit or on unmanaged pre-existing target files.
 *   --target    target checkout (default: config.defaultTarget relative to this repo root).
 *   --report    write a markdown report.
 *   --include   override the config include list (repeatable); useful for small test publishes.
 *   --adopt     allow overwriting pre-existing target files that are not in the manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_NAME = '.publish-manifest.json';

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const a = { mode: 'dry-run', include: [], adopt: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') a.mode = 'dry-run';
    else if (k === '--apply') a.mode = 'apply';
    else if (k === '--target') a.target = argv[++i];
    else if (k === '--report') a.report = argv[++i];
    else if (k === '--config') a.config = argv[++i];
    else if (k === '--include') a.include.push(argv[++i]);
    else if (k === '--adopt') a.adopt = true;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '-h' || k === '--help') { a.help = true; }
    else { console.error(`Unknown argument: ${k}`); process.exit(2); }
  }
  return a;
}

// ---------------------------------------------------------------- glob
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += '(?:' + glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
function makeMatcher(globs) {
  const pos = [], neg = [];
  for (const g of globs || []) (g.startsWith('!') ? neg : pos).push(globToRegExp(g.slice(g.startsWith('!') ? 1 : 0)));
  return (p) => pos.some((r) => r.test(p)) && !neg.some((r) => r.test(p));
}

// ---------------------------------------------------------------- helpers
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

function gitList(args) {
  const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function safeRel(rel) {
  if (path.isAbsolute(rel) || rel.split('/').some((s) => s === '..' || s === '.git')) {
    throw new Error(`Unsafe path refused: ${rel}`);
  }
  return rel;
}

function mask(text, secret) {
  if (!secret) return text.length > 80 ? text.slice(0, 77) + '...' : text;
  return text.slice(0, 4) + '*'.repeat(Math.min(12, Math.max(4, text.length - 4))) + `(len ${text.length})`;
}

// Parse the private project registry without a YAML dependency: project keys + folder path segments.
function deriveNames(cfg) {
  const d = cfg.deriveFromProjectsYaml;
  if (!d) return [];
  const file = path.join(ROOT, d.file);
  if (!fs.existsSync(file)) return [];
  const ignore = new Set((d.ignoreWords || []).map((w) => w.toLowerCase()));
  const names = new Set();
  let inProjects = false;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '');
    if (/^\S/.test(line)) inProjects = /^projects:/.test(line);
    const key = line.match(/^ {2}([A-Za-z0-9._'-]+):\s*$/);
    if (inProjects && key && d.useProjectKeys) names.add(key[1]);
    const folder = line.match(/^\s+-\s+(\/\S+)/);
    if (folder && d.useFolderSegments) {
      const segs = folder[1].split('/').filter(Boolean);
      // drop "Users/<name>" or "home/<name>" prefix; the username is covered by its own rule
      if (['Users', 'home'].includes(segs[0])) segs.splice(0, 2);
      segs.forEach((s) => names.add(s));
    }
  }
  return [...names].filter((n) => n.length >= 3 && !ignore.has(n.toLowerCase()));
}

function buildRules(cfg) {
  const rules = (cfg.denyPatterns || []).map((r) => ({ ...r, re: new RegExp(r.pattern, r.flags || 'g') }));
  const short = cfg.deriveFromProjectsYaml?.shortNameMaxLen ?? 4;
  for (const n of deriveNames(cfg)) {
    const body = escapeRe(n);
    const re = n.length <= short ? new RegExp(`(?<![A-Za-z0-9])${body}`, 'gi') : new RegExp(body, 'gi');
    rules.push({ id: `derived-name:${n}`, re, secret: false, fix: 'Private name from the project registry; generalize or exclude.' });
  }
  // Literal values from the local env file (values are never printed, only masked).
  const e = cfg.envLiteralCheck;
  if (e && fs.existsSync(path.join(ROOT, e.file))) {
    const parse = (f) => {
      const m = new Map();
      if (!fs.existsSync(f)) return m;
      for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
        const mm = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (mm) m.set(mm[1], mm[2].trim().replace(/^["']|["']$/g, ''));
      }
      return m;
    };
    const env = parse(path.join(ROOT, e.file));
    const example = e.ignoreValuesAlsoIn ? parse(path.join(ROOT, e.ignoreValuesAlsoIn)) : new Map();
    const exampleVals = new Set(example.values());
    const keyRe = e.allKeysMatching ? new RegExp(e.allKeysMatching) : null;
    for (const [k, v] of env) {
      if (!(e.keys || []).includes(k) && !(keyRe && keyRe.test(k))) continue;
      if (!v || v.length < (e.minLength || 6) || exampleVals.has(v)) continue;
      rules.push({ id: `env-literal:${k}`, re: new RegExp(escapeRe(v), 'g'), secret: true, fix: `Literal value of ${k} from the local env file. Remove and rotate.` });
    }
  }
  return rules;
}

function isAllowed(cfg, rel, ruleId, text) {
  for (const [glob, entries] of Object.entries(cfg.allowPatternsPerFile || {})) {
    if (!globToRegExp(glob).test(rel)) continue;
    for (const en of entries) {
      if ((en.rule === '*' || en.rule === ruleId) && new RegExp(en.match).test(text)) return true;
    }
  }
  return false;
}

function scanText(cfg, rules, rel, text) {
  const hits = [];
  // scan the path itself
  for (const r of rules) {
    r.re.lastIndex = 0;
    const m = r.re.exec(rel);
    if (m && !isAllowed(cfg, rel, r.id, m[0])) hits.push({ file: rel, line: 0, rule: r.id, secret: r.secret, fix: r.fix, snippet: `[path] ${mask(m[0], r.secret)}` });
  }
  if (text == null) return hits;
  const lines = text.split('\n');
  lines.forEach((ln, idx) => {
    const lineHits = [];
    for (const r of rules) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(ln))) {
        if (m[0].length === 0) { r.re.lastIndex++; continue; }
        if (!isAllowed(cfg, rel, r.id, m[0])) lineHits.push({ r, start: m.index, end: m.index + m[0].length, text: m[0] });
        if (!r.re.global) break;
      }
    }
    // Merge overlapping matches from different rules into one hit (secret rules win for masking).
    lineHits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const merged = [];
    for (const h of lineHits) {
      const last = merged[merged.length - 1];
      if (last && h.start < last.end) {
        if (!last.rules.includes(h.r.id)) last.rules.push(h.r.id);
        last.secret = last.secret || !!h.r.secret;
        if (h.r.fix && !last.fixes.includes(h.r.fix)) last.fixes.push(h.r.fix);
        if (h.end > last.end) { last.end = h.end; last.text = ln.slice(last.start, last.end); }
      } else merged.push({ start: h.start, end: h.end, text: h.text, rules: [h.r.id], secret: !!h.r.secret, fixes: h.r.fix ? [h.r.fix] : [] });
    }
    for (const h of merged) {
      const s = Math.max(0, h.start - 30), eIdx = Math.min(ln.length, h.end + 30);
      const ctx = (s > 0 ? '...' : '') + ln.slice(s, h.start) + '<<' + mask(h.text, h.secret) + '>>' + ln.slice(h.end, eIdx) + (eIdx < ln.length ? '...' : '');
      hits.push({ file: rel, line: idx + 1, rule: h.rules.join('+'), secret: h.secret, fix: h.fixes[0], snippet: ctx.replace(/\s+/g, ' ').trim() });
    }
  });
  return hits;
}

function applyTransforms(cfg, rel, buf, published) {
  let text = buf.toString('utf8');
  const notes = [];
  const jt = cfg.jsonTransforms?.[rel];
  if (jt) {
    const obj = JSON.parse(text);
    Object.assign(obj, jt.set || {});
    if (jt.dropScriptsReferencingUnpublishedFiles && obj.scripts) {
      for (const [name, cmd] of Object.entries(obj.scripts)) {
        const refs = [...cmd.matchAll(/\b((?:scripts|infra|packages)\/[A-Za-z0-9._/-]+)/g)].map((m) => m[1]);
        const missing = refs.filter((r) => !published.has(r) && ![...published].some((p) => p.startsWith(r + '/')));
        if (missing.length) { delete obj.scripts[name]; notes.push(`dropped script "${name}" (refs ${missing.join(', ')})`); }
      }
    }
    for (const k of jt.deleteKeys || []) { delete obj[k]; notes.push(`deleted key ${k}`); }
    text = JSON.stringify(obj, null, 2) + '\n';
    notes.push('json transform');
  }
  for (const t of cfg.textTransforms || []) {
    if (!globToRegExp(t.file).test(rel)) continue;
    const re = new RegExp(t.find, t.flags || 'g');
    if (re.test(text)) { re.lastIndex = 0; text = text.replace(re, t.replace); notes.push(`text transform: ${t.reason || t.find}`); }
  }
  return { content: Buffer.from(text, 'utf8'), notes };
}

// ---------------------------------------------------------------- plan
function plan(cfg, args) {
  const tracked = gitList(['ls-files', '-z']);
  const untracked = gitList(['ls-files', '-z', '--others', '--exclude-standard']);
  const candidates = [...new Set([...tracked, ...untracked])].sort();

  const inc = makeMatcher(args.include.length ? args.include : cfg.include);
  const exc = makeMatcher(cfg.exclude);
  const never = makeMatcher(cfg.neverInclude);
  const allowBin = makeMatcher(cfg.allowBinary);

  const publish = [], skipped = [];
  for (const rel of candidates) {
    const abs = path.join(ROOT, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { skipped.push({ rel, why: 'missing on disk' }); continue; }
    if (!inc(rel)) { skipped.push({ rel, why: 'not in include' }); continue; }
    if (never(rel)) { skipped.push({ rel, why: 'neverInclude' }); continue; }
    if (exc(rel)) { skipped.push({ rel, why: 'exclude' }); continue; }
    if (st.isSymbolicLink() || !st.isFile()) { skipped.push({ rel, why: 'not a regular file' }); continue; }
    publish.push(rel);
  }

  // Overlays: `<overlayDir>/<rel>` is published AS `<rel>`, replacing the private file (or adding a new one).
  // Lets private docs/data stay intact while a generic public version ships. neverInclude still applies.
  const overlayDir = cfg.overlayDir || 'public-overlay';
  const sourceOf = new Map(publish.map((rel) => [rel, rel]));
  for (const ovRel of candidates.filter((c) => c.startsWith(overlayDir + '/'))) {
    const rel = ovRel.slice(overlayDir.length + 1);
    if (never(rel) || exc(rel)) { skipped.push({ rel: ovRel, why: 'overlay target blocked by neverInclude/exclude' }); continue; }
    if (!sourceOf.has(rel)) publish.push(rel);
    sourceOf.set(rel, ovRel);
  }
  publish.sort();

  const rules = buildRules(cfg);
  const pubSet = new Set(publish);
  const files = [];
  const hits = [];
  for (const rel of publish) {
    safeRel(rel);
    const src = sourceOf.get(rel) || rel;
    const raw = fs.readFileSync(path.join(ROOT, src));
    if (isBinary(raw)) {
      if (!allowBin(rel)) hits.push({ file: rel, line: 0, rule: 'binary-not-allowlisted', secret: false, fix: 'Add to allowBinary after manual review, or exclude.', snippet: `[binary ${raw.length} bytes]` });
      hits.push(...scanText(cfg, rules, rel, null));
      files.push({ rel, content: raw, notes: ['binary'] });
      continue;
    }
    const { content, notes } = applyTransforms(cfg, rel, raw, pubSet);
    if (src !== rel) notes.push(`overlay: ${src}`);
    hits.push(...scanText(cfg, rules, rel, content.toString('utf8')));
    files.push({ rel, content, notes });
  }
  return { files, skipped, hits, ruleCount: rules.length };
}

// ---------------------------------------------------------------- apply
function apply(target, files, adopt) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(`Target does not exist: ${target}`);
  if (path.resolve(target) === ROOT) throw new Error('Target must not be the source repo.');
  const manifestPath = path.join(target, MANIFEST_NAME);
  const prev = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { files: {} };
  const prevFiles = prev.files || {};

  // 1. Conflict check: pre-existing target files we never published.
  const conflicts = [];
  for (const f of files) {
    const dst = path.join(target, f.rel);
    if (fs.existsSync(dst) && !(f.rel in prevFiles)) {
      if (sha256(fs.readFileSync(dst)) !== sha256(f.content)) conflicts.push(f.rel);
      else conflicts.push(f.rel + ' (identical)');
    }
  }
  if (conflicts.length && !adopt) {
    return { refused: true, conflicts };
  }

  const written = [], unchanged = [], deleted = [], keptModified = [];
  const next = {};
  for (const f of files) {
    const dst = path.join(target, safeRel(f.rel));
    const h = sha256(f.content);
    if (fs.existsSync(dst) && sha256(fs.readFileSync(dst)) === h) unchanged.push(f.rel);
    else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, f.content);
      written.push(f.rel);
    }
    next[f.rel] = h;
  }
  // 2. Delete files we previously published that are no longer in the set (only if untouched since).
  for (const [rel, h] of Object.entries(prevFiles)) {
    if (rel in next) continue;
    const dst = path.join(target, safeRel(rel));
    if (!fs.existsSync(dst)) continue;
    if (sha256(fs.readFileSync(dst)) !== h) { keptModified.push(rel); continue; }
    fs.unlinkSync(dst);
    deleted.push(rel);
    // prune now-empty parent dirs, never above target, never .git
    let dir = path.dirname(dst);
    while (dir.startsWith(path.resolve(target) + path.sep) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }
  const manifest = {
    tool: 'scripts/publish-public.mjs',
    note: 'Files listed here are managed by the publisher. Files not listed are never modified or deleted.',
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(next).sort()),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { refused: false, written, unchanged, deleted, keptModified, adopted: conflicts };
}

// ---------------------------------------------------------------- report
function renderReport({ files, skipped, hits, ruleCount }, extra = '') {
  const byFile = new Map();
  for (const h of hits) { if (!byFile.has(h.file)) byFile.set(h.file, []); byFile.get(h.file).push(h); }
  const out = [];
  out.push('# Public publish dry-run report', '');
  out.push(`- Generated: ${new Date().toISOString()}`);
  out.push(`- Rules active: ${ruleCount}`);
  out.push(`- Files publishable: ${files.length}`);
  out.push(`- Files with hits: ${byFile.size}`);
  out.push(`- Total hits: ${hits.length}`);
  out.push(`- Files clean: ${files.length - byFile.size}`);
  out.push(`- Candidates skipped: ${skipped.length}`, '');
  if (extra) out.push(extra, '');
  out.push('## Hits by file', '');
  const sorted = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [file, hs] of sorted) {
    const rulesHere = {};
    hs.forEach((h) => { rulesHere[h.rule] = (rulesHere[h.rule] || 0) + 1; });
    out.push(`### ${file} (${hs.length} hits)`, '');
    out.push('- Rules: ' + Object.entries(rulesHere).map(([r, c]) => `${r} x${c}`).join(', '));
    const fixes = [...new Set(hs.map((h) => h.fix).filter(Boolean))];
    fixes.forEach((f) => out.push(`- Rule fix hint: ${f}`));
    out.push('');
    for (const h of hs.slice(0, 40)) out.push(`- \`${file}:${h.line}\` [${h.rule}] ${h.snippet.replace(/`/g, "'")}`);
    if (hs.length > 40) out.push(`- ... ${hs.length - 40} more`);
    out.push('');
  }
  out.push('## Clean publishable files', '');
  const hitFiles = new Set(byFile.keys());
  files.filter((f) => !hitFiles.has(f.rel)).forEach((f) => out.push(`- ${f.rel}${f.notes.length ? ` (${f.notes.join('; ')})` : ''}`));
  out.push('', '## Skipped candidates (excluding "not in include")', '');
  skipped.filter((s) => s.why !== 'not in include').forEach((s) => out.push(`- ${s.rel}: ${s.why}`));
  out.push(`- (${skipped.filter((s) => s.why === 'not in include').length} other files not in include)`);
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- main
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); return; }
  const cfgPath = path.resolve(ROOT, args.config || 'public-sync.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const target = path.resolve(ROOT, args.target || cfg.defaultTarget || '../warden');

  const result = plan(cfg, args);
  const { files, skipped, hits } = result;
  const hitFiles = new Set(hits.map((h) => h.file));

  if (!args.quiet) {
    console.log(`Publishable files (${files.length}):`);
    files.forEach((f) => console.log(`  ${hitFiles.has(f.rel) ? 'HIT ' : 'ok  '} ${f.rel}${f.notes.length ? '  [' + f.notes.join('; ') + ']' : ''}`));
    const notable = skipped.filter((s) => s.why !== 'not in include');
    console.log(`\nSkipped (${skipped.length}; ${notable.length} matched include but were filtered):`);
    notable.forEach((s) => console.log(`  - ${s.rel}: ${s.why}`));
    if (hits.length) {
      console.log(`\nDeny-pattern hits (${hits.length}):`);
      hits.forEach((h) => console.log(`  ${h.file}:${h.line} [${h.rule}] ${h.snippet}`));
    }
  }
  console.log(`\nSummary: ${files.length} publishable, ${hitFiles.size} with hits, ${hits.length} total hits, mode=${args.mode}`);

  let applyNote = '';
  if (args.mode === 'apply') {
    if (hits.length) {
      console.error('REFUSING --apply: deny-pattern hits present. Fix source, narrow include, or add a reasoned allowPatternsPerFile entry.');
    } else {
      const r = apply(target, files, args.adopt);
      if (r.refused) {
        console.error(`REFUSING --apply: ${r.conflicts.length} target file(s) exist but are not managed by the manifest (use --adopt after review):`);
        r.conflicts.forEach((c) => console.error(`  - ${c}`));
        process.exitCode = 3;
      } else {
        applyNote = `Applied to target: written ${r.written.length}, unchanged ${r.unchanged.length}, deleted ${r.deleted.length}, kept-modified ${r.keptModified.length}, adopted ${r.adopted.length}`;
        console.log(applyNote);
        r.deleted.forEach((d) => console.log(`  deleted (previously published): ${d}`));
        r.keptModified.forEach((d) => console.log(`  NOT deleted (modified in target since publish): ${d}`));
      }
    }
  }
  if (args.report) {
    fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    fs.writeFileSync(path.resolve(args.report), renderReport(result, applyNote));
    console.log(`Report written: ${args.report}`);
  }
  if (hits.length) process.exitCode = 1;
}

main();
