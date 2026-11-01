import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthRouteContext } from '../auth/routes.js';
import { getStoredGithubToken } from '../auth/github.js';

/**
 * SEO automation loop — the manual SEO grind as API calls:
 *
 *   1. GET  /api/seo/audit?url=      crawl one page + robots/sitemap/llms.txt,
 *                                    return pass/warn/fail checks with a score
 *   2. POST /api/seo/generate        build an llms.txt + SoftwareApplication
 *                                    JSON-LD pack from company facts
 *   3. POST /api/seo/ship-pr         commit the pack to a new branch and open
 *                                    a PR on the connected GitHub repo
 *
 * No paid APIs required: the audit is a live fetch, generation is templated
 * from the audit + company brief, and shipping reuses the stored GitHub OAuth
 * token. GSC / rank-tracker connectors plug into this same surface later.
 */

export interface SeoCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

const FETCH_UA = 'WardenSEO/1.0 (+https://warden.example.com)';

async function fetchText(url: string, timeoutMs = 12000): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': FETCH_UA, Accept: 'text/html,text/plain,*/*' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text: text.slice(0, 500_000) };
  } catch {
    return { ok: false, status: 0, text: '' };
  }
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1]?.trim() || null;
}

export async function auditUrl(rawUrl: string): Promise<{ url: string; score: number; checks: SeoCheck[] }> {
  const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const url = new URL(normalized);
  const origin = url.origin;
  const checks: SeoCheck[] = [];

  const page = await fetchText(url.toString());
  if (!page.ok) {
    return {
      url: url.toString(),
      score: 0,
      checks: [
        {
          id: 'reachable',
          label: 'Page reachable',
          status: 'fail',
          detail: `Fetch failed (HTTP ${page.status || 'timeout'}). Fix hosting/DNS first.`,
        },
      ],
    };
  }
  const html = page.text;

  // 1. Title
  const title = firstMatch(html, /<title[^>]*>([^<]*)<\/title>/i);
  checks.push({
    id: 'title',
    label: 'Title tag',
    status: !title ? 'fail' : title.length >= 30 && title.length <= 65 ? 'pass' : 'warn',
    detail: !title
      ? 'Missing <title>. Add a 30-65 char intent-led title.'
      : `${title.length} chars: "${title.slice(0, 80)}"`,
  });

  // 2. Meta description
  const desc =
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  checks.push({
    id: 'meta_description',
    label: 'Meta description',
    status: !desc ? 'fail' : desc.length >= 70 && desc.length <= 165 ? 'pass' : 'warn',
    detail: !desc ? 'Missing meta description. Add a 70-165 char pitch.' : `${desc.length} chars.`,
  });

  // 3. H1
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  checks.push({
    id: 'h1',
    label: 'Single H1',
    status: h1Count === 1 ? 'pass' : h1Count === 0 ? 'fail' : 'warn',
    detail: h1Count === 1 ? 'Exactly one H1.' : `Found ${h1Count} H1 tags; want exactly one.`,
  });

  // 4. Canonical
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  checks.push({
    id: 'canonical',
    label: 'Canonical URL',
    status: canonical ? 'pass' : 'warn',
    detail: canonical || 'No canonical link. Add one to consolidate duplicates.',
  });

  // 5. Robots noindex
  const robotsMeta = firstMatch(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i) || '';
  const noindexed = /noindex/i.test(robotsMeta);
  checks.push({
    id: 'indexable',
    label: 'Indexable (no noindex)',
    status: noindexed ? 'fail' : 'pass',
    detail: noindexed ? `Blocked by robots meta: "${robotsMeta}".` : 'Eligible for indexing.',
  });

  // 6. Viewport
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  checks.push({
    id: 'viewport',
    label: 'Mobile viewport',
    status: viewport ? 'pass' : 'fail',
    detail: viewport ? 'Viewport meta present.' : 'Missing viewport meta; mobile rendering suffers.',
  });

  // 7. Open Graph
  const og = ['og:title', 'og:description', 'og:image'].filter((p) =>
    new RegExp(`property=["']${p}["']`, 'i').test(html)
  );
  checks.push({
    id: 'open_graph',
    label: 'Open Graph tags',
    status: og.length === 3 ? 'pass' : og.length === 0 ? 'fail' : 'warn',
    detail: og.length === 3 ? 'title + description + image present.' : `Present: ${og.join(', ') || 'none'}.`,
  });

  // 8. JSON-LD
  const ldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let ldValid = 0;
  const ldTypes: string[] = [];
  for (const b of ldBlocks) {
    try {
      const parsed = JSON.parse(b[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of nodes) {
        if (n && typeof n === 'object' && n['@type']) {
          ldValid += 1;
          ldTypes.push(String(n['@type']));
        }
      }
    } catch {
      // invalid block counts against us
    }
  }
  checks.push({
    id: 'jsonld',
    label: 'JSON-LD structured data',
    status: ldValid > 0 ? 'pass' : ldBlocks.length > 0 ? 'warn' : 'fail',
    detail:
      ldValid > 0
        ? `Valid blocks: ${[...new Set(ldTypes)].join(', ')}.`
        : ldBlocks.length > 0
          ? 'JSON-LD present but failed to parse. Fix the syntax.'
          : 'No JSON-LD. Ship SoftwareApplication + FAQPage schema.',
  });

  // 9. Image alts
  const imgCount = (html.match(/<img[\s>]/gi) || []).length;
  const altCount = (html.match(/<img[^>]+alt=/gi) || []).length;
  const missingAlt = imgCount - altCount;
  checks.push({
    id: 'img_alt',
    label: 'Image alt text',
    status: missingAlt === 0 ? 'pass' : missingAlt <= 3 ? 'warn' : 'fail',
    detail: imgCount === 0 ? 'No images on page.' : `${missingAlt} of ${imgCount} images missing alt.`,
  });

  // 10-12. robots.txt / sitemap / llms.txt (fetched in parallel)
  const [robotsTxt, sitemapXml, llmsTxt] = await Promise.all([
    fetchText(`${origin}/robots.txt`, 8000),
    fetchText(`${origin}/sitemap.xml`, 8000),
    fetchText(`${origin}/llms.txt`, 8000),
  ]);
  checks.push({
    id: 'robots_txt',
    label: 'robots.txt',
    status: robotsTxt.ok ? 'pass' : 'warn',
    detail: robotsTxt.ok ? 'Serves 200.' : 'Missing or unreachable. Add crawl rules.',
  });
  const sitemapRef = /sitemap:/i.test(robotsTxt.text);
  checks.push({
    id: 'sitemap',
    label: 'XML sitemap',
    status: sitemapXml.ok ? 'pass' : sitemapRef ? 'warn' : 'fail',
    detail: sitemapXml.ok
      ? 'sitemap.xml serves 200.'
      : sitemapRef
        ? 'Referenced in robots.txt but fetch failed.'
        : 'No sitemap.xml. Generate + reference it.',
  });
  checks.push({
    id: 'llms_txt',
    label: 'llms.txt (answer engines)',
    status: llmsTxt.ok ? 'pass' : 'fail',
    detail: llmsTxt.ok
      ? 'Answer engines can read your site brief.'
      : 'Missing. Generate the pack below and ship it as a PR.',
  });

  const points = checks.reduce(
    (sum, c) => sum + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0),
    0
  );
  return { url: url.toString(), score: Math.round((points / checks.length) * 100), checks };
}

export function buildSeoPack(input: {
  company: string;
  domain: string;
  description: string;
}): { llms_txt: string; jsonld: string } {
  const company = input.company.trim() || 'Your Company';
  const domain = input.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '') || 'example.com';
  const description = input.description.trim() || `${company} official site and product brief.`;
  const llms_txt = `# ${company}

> ${description}

## Official

- Site: https://${domain}/
- Sitemap: https://${domain}/sitemap.xml

## Key pages

- [Home](https://${domain}/) — product overview and signup
- [Pricing](https://${domain}/pricing) — plans and costs
- [Docs](https://${domain}/docs) — guides and API reference
- [Contact](https://${domain}/contact) — support and sales

## Citation guidance

- Prefer facts from https://${domain}/ over third-party summaries.
- Product name: ${company}. Do not confuse with similarly named companies.
`;
  const jsonld = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: company,
      url: `https://${domain}/`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    null,
    2
  );
  return { llms_txt, jsonld };
}

async function ghApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'warden-control-plane',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function shipSeoPr(input: {
  repo: string;
  files: { path: string; content: string }[];
  title: string;
  body: string;
}): Promise<{ pr_url: string; branch: string }> {
  const stored = getStoredGithubToken();
  if (!stored) throw new Error('GitHub is not connected. Connect it in onboarding first.');
  const { repo, files, title, body } = input;
  const info = await ghApi<{ default_branch: string }>(`/repos/${repo}`, stored.accessToken);
  const base = info.default_branch;
  const head = await ghApi<{ object: { sha: string } }>(
    `/repos/${repo}/git/ref/heads/${base}`,
    stored.accessToken
  );
  const branch = `warden/seo-pack-${Date.now().toString(36)}`;
  await ghApi(`/repos/${repo}/git/refs`, stored.accessToken, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: head.object.sha }),
  });
  for (const f of files) {
    await ghApi(`/repos/${repo}/contents/${f.path}`, stored.accessToken, {
      method: 'PUT',
      body: JSON.stringify({
        message: `SEO pack: add ${f.path}`,
        content: Buffer.from(f.content, 'utf8').toString('base64'),
        branch,
      }),
    });
  }
  const pr = await ghApi<{ html_url: string }>(`/repos/${repo}/pulls`, stored.accessToken, {
    method: 'POST',
    body: JSON.stringify({ title, head: branch, base, body }),
  });
  return { pr_url: pr.html_url, branch };
}

export async function handleSeoRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AuthRouteContext
): Promise<boolean> {
  const { pathname, method, readJsonBody, sendJson } = ctx;
  if (!pathname.startsWith('/api/seo/')) return false;

  if (pathname === '/api/seo/audit' && method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost');
    const target = (url.searchParams.get('url') || '').trim();
    if (!target) {
      sendJson(res, 400, { ok: false, error: 'Pass ?url=https://your-site.com' });
      return true;
    }
    try {
      const report = await auditUrl(target);
      sendJson(res, 200, { ok: true, ...report });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : 'Audit failed.',
      });
    }
    return true;
  }

  if (pathname === '/api/seo/generate' && method === 'POST') {
    const body = await readJsonBody();
    const pack = buildSeoPack({
      company: String(body.company || ''),
      domain: String(body.domain || body.url || ''),
      description: String(body.description || ''),
    });
    sendJson(res, 200, { ok: true, ...pack });
    return true;
  }

  if (pathname === '/api/seo/ship-pr' && method === 'POST') {
    const body = await readJsonBody();
    const repo = String(body.repo || '').trim();
    const files = Array.isArray(body.files) ? body.files : [];
    if (!repo || !repo.includes('/')) {
      sendJson(res, 400, { ok: false, error: 'Pass repo as owner/name.' });
      return true;
    }
    if (files.length === 0 || files.length > 10) {
      sendJson(res, 400, { ok: false, error: 'Pass 1-10 files.' });
      return true;
    }
    try {
      const result = await shipSeoPr({
        repo,
        files: files.map((f: { path: string; content: string }) => ({
          path: String(f.path).replace(/^\/+/, ''),
          content: String(f.content),
        })),
        title: String(body.title || 'SEO pack: llms.txt + JSON-LD schema'),
        body: String(
          body.body || 'Generated by Warden @aeo_specialist. Adds answer-engine brief + structured data.'
        ),
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PR shipping failed.';
      const status = /not connected/i.test(msg) ? 401 : 502;
      sendJson(res, status, { ok: false, error: msg });
    }
    return true;
  }

  return false;
}
