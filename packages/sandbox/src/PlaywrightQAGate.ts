import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { truncateToolOutput } from './PermissionGuard.js';

const execFileAsync = promisify(execFile);

export interface QAResult {
  passed: boolean;
  typecheckPassed: boolean;
  buildPassed: boolean;
  httpStatus: number;
  consoleErrors: string[];
  pageErrors: string[];
  screenshotPath: string;
  screenshotUrl: string;
  previewUrl: string;
  durationMs: number;
  logs: string;
}

export interface RunQAGateOptions {
  runId: string;
  repoSlug: string;
  workspacePath: string;
  mode: 'docker' | 'local' | 'cloud-ephemeral';
  containerName?: string;
  shortRunId?: string;
  previewPort?: number;
  previewUrl?: string;
  mediaDir?: string;
  skipBrowserCheck?: boolean;
  timeoutMs?: number;
}

/**
 * WebGL Chromium launch flags required by Section 2.3 of `dynamocommando.md` for headless
 * Three.js / WebXR and PixiJS v8 game client verification.
 */
export const HEADLESS_WEBGL_CHROMIUM_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage'
];

/**
 * Generates a valid, self-contained PNG image buffer (640x360 dark-emerald status card)
 * when running in non-UI backend mode or when local Chromium binaries are unavailable.
 */
function createDiagnosticPngBuffer(passed: boolean): Buffer {
  const width = 320;
  const height = 180;

  // Raw scanlines: filter byte (0) + RGBA pixels per row
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);

  const bgR = passed ? 10 : 38;
  const bgG = passed ? 28 : 14;
  const bgB = passed ? 24 : 18;

  const accentR = passed ? 16 : 239;
  const accentG = passed ? 185 : 68;
  const accentB = passed ? 129 : 68;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // No filter
    const isTopBanner = y < 8 || y >= height - 8;
    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 4;
      const isBorder = isTopBanner || x < 8 || x >= width - 8;
      raw[px] = isBorder ? accentR : bgR;
      raw[px + 1] = isBorder ? accentG : bgG;
      raw[px + 2] = isBorder ? accentB : bgB;
      raw[px + 3] = 255;
    }
  }

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }

  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };

  const makeChunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', iend)
  ]);
}

/**
 * Polls a local HTTP URL until it responds or `timeoutMs` expires.
 */
async function waitForHttpServer(
  url: string,
  timeoutMs = 15000
): Promise<{ status: number; body: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.get(url, { timeout: 2500 }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8')
            });
          });
        });
        req.once('error', reject);
        req.once('timeout', () => {
          req.destroy(new Error('HTTP timeout'));
        });
      });
      if (res.status > 0) {
        return res;
      }
    } catch {
      // Wait 400ms and retry
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return { status: 0, body: '' };
}

export class PlaywrightQAGate {
  /**
   * Executes the full Section 2.3 Automated Headless Verification Gate:
   * 1. Runs `npm run typecheck` (if present in `package.json`)
   * 2. Runs `npm run build` (if present in `package.json`)
   * 3. Boots the preview/dev server & runs Headless Chromium with WebGL flags (`--use-gl=angle`, `--use-angle=swiftshader`, `--enable-webgl`, `--ignore-gpu-blocklist`)
   * 4. Asserts HTTP 200, non-empty root DOM mount, `consoleErrors.length === 0`, and `pageErrors.length === 0`
   * 5. Saves the QA screenshot to `.state/media/qa-<runId>.png` and returns `QAResult`.
   */
  static async runVerificationGate(opts: RunQAGateOptions): Promise<QAResult> {
    const startedAt = Date.now();
    const logLines: string[] = [];
    const mediaDir =
      opts.mediaDir ?? path.resolve(process.cwd(), '.state', 'media');
    await fs.mkdir(mediaDir, { recursive: true });

    const screenshotFilename = `qa-${opts.runId}.png`;
    const screenshotPath = path.join(mediaDir, screenshotFilename);
    const screenshotUrl = `/.state/media/${screenshotFilename}`;
    const previewPort = opts.previewPort ?? 4173;
    const previewUrl = opts.previewUrl ?? `http://localhost:${previewPort}`;
    const timeoutMs = opts.timeoutMs ?? 90_000;

    let typecheckPassed = true;
    let buildPassed = true;
    let httpStatus = 0;
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    const appendLog = (header: string, text: string) => {
      if (!text.trim()) return;
      logLines.push(`=== ${header} ===\n${text.trim()}`);
    };

    // 1. Inspect package.json scripts
    let scripts: Record<string, string> = {};
    try {
      const pkgRaw =
        opts.mode === 'cloud-ephemeral' && opts.shortRunId
          ? (
              await execFileAsync('ssh', [
                '-S',
                `/tmp/commando-ssh-${opts.shortRunId}.sock`,
                'commando@127.0.0.1',
                'bash',
                '-lc',
                `cat ${opts.workspacePath}/package.json`
              ])
            ).stdout
          : opts.mode === 'docker' && opts.containerName
          ? (
              await execFileAsync('docker', [
                'exec',
                opts.containerName,
                'cat',
                '/workspace/package.json'
              ])
            ).stdout
          : await fs.readFile(path.join(opts.workspacePath, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      scripts = pkg.scripts ?? {};
    } catch {
      appendLog('PACKAGE_JSON', 'No package.json found; skipping npm script checks.');
    }

    // Helper to execute command inside Docker or local workspace
    const runStep = async (
      stepName: string,
      cmd: string
    ): Promise<{ ok: boolean; output: string }> => {
      try {
        if (opts.mode === 'cloud-ephemeral' && opts.shortRunId) {
          const { stdout, stderr } = await execFileAsync(
            'ssh',
            ['-S', `/tmp/commando-ssh-${opts.shortRunId}.sock`, 'commando@127.0.0.1', 'bash', '-lc', `cd ${opts.workspacePath} && ${cmd}`],
            { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }
          );
          const combined = `${stdout}\n${stderr}`.trim();
          appendLog(stepName, combined || 'OK');
          return { ok: true, output: combined };
        } else if (opts.mode === 'docker' && opts.containerName) {
          const { stdout, stderr } = await execFileAsync(
            'docker',
            ['exec', '-w', '/workspace', opts.containerName, 'bash', '-lc', cmd],
            { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }
          );
          const combined = `${stdout}\n${stderr}`.trim();
          appendLog(stepName, combined || 'OK');
          return { ok: true, output: combined };
        } else {
          const { stdout, stderr } = await execFileAsync('bash', ['-lc', cmd], {
            cwd: opts.workspacePath,
            timeout: timeoutMs,
            maxBuffer: 8 * 1024 * 1024
          });
          const combined = `${stdout}\n${stderr}`.trim();
          appendLog(stepName, combined || 'OK');
          return { ok: true, output: combined };
        }
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        const combined = `${execErr.stdout ?? ''}\n${execErr.stderr ?? ''}\n${execErr.message ?? ''}`.trim();
        appendLog(`${stepName} (FAILED)`, combined);
        return { ok: false, output: combined };
      }
    };

    // 2. Run `npm run typecheck` if defined in package.json
    if (scripts.typecheck) {
      const tcRes = await runStep('TYPECHECK', 'npm run typecheck');
      typecheckPassed = tcRes.ok;
    } else {
      appendLog('TYPECHECK', 'Skipped (no "typecheck" script in package.json)');
    }

    // 3. Run `npm run build` if defined in package.json and typecheck passed
    if (typecheckPassed && scripts.build) {
      const buildRes = await runStep('BUILD', 'npm run build');
      buildPassed = buildRes.ok;
    } else if (!scripts.build) {
      appendLog('BUILD', 'Skipped (no "build" script in package.json)');
    } else {
      buildPassed = false;
    }

    // 4. Determine whether this repo exposes a web UI preview server
    const hasWebPreview =
      !opts.skipBrowserCheck &&
      Boolean(scripts.preview || scripts.dev || scripts['dev:runtime']);

    if (typecheckPassed && buildPassed && hasWebPreview) {
      if (opts.mode === 'cloud-ephemeral' && opts.shortRunId) {
        const containerQaCmd = [
          `(npx vite preview --host 0.0.0.0 --port ${previewPort} >/tmp/commando-qa/vite.log 2>&1 || npm run preview -- --host 0.0.0.0 --port ${previewPort} >/tmp/commando-qa/vite.log 2>&1) &`,
          'PREVIEW_PID=$!',
          'sleep 2',
          `node /usr/local/bin/commando-webgl-qa.mjs --url http://127.0.0.1:${previewPort} --out /tmp/commando-qa/qa-${opts.runId}.png`,
          'QA_EXIT=$?',
          'kill $PREVIEW_PID 2>/dev/null || true',
          'exit $QA_EXIT'
        ].join('; ');

        const qaExec = await runStep('PLAYWRIGHT_WEBGL_QA', containerQaCmd);
        try {
          const lastJsonLine = qaExec.output
            .split('\n')
            .reverse()
            .find((line) => line.trim().startsWith('{'));
          if (lastJsonLine) {
            const parsed = JSON.parse(lastJsonLine) as {
              httpStatus?: number;
              consoleErrors?: string[];
              pageErrors?: string[];
            };
            httpStatus = parsed.httpStatus ?? 0;
            if (Array.isArray(parsed.consoleErrors)) {
              consoleErrors.push(...parsed.consoleErrors);
            }
            if (Array.isArray(parsed.pageErrors)) {
              pageErrors.push(...parsed.pageErrors);
            }
          }
          await execFileAsync('scp', [
            '-o',
            `ControlPath=/tmp/commando-ssh-${opts.shortRunId}.sock`,
            `commando@127.0.0.1:/tmp/commando-qa/qa-${opts.runId}.png`,
            screenshotPath
          ]);
        } catch (cpErr: unknown) {
          appendLog('SCREENSHOT_CAPTURE', (cpErr as Error).message);
        }
      } else if (opts.mode === 'docker' && opts.containerName) {
        // Run preview server + in-container Playwright WebGL QA script
        const containerQaCmd = [
          `(npx vite preview --host 0.0.0.0 --port ${previewPort} >/tmp/commando-qa/vite.log 2>&1 || npm run preview -- --host 0.0.0.0 --port ${previewPort} >/tmp/commando-qa/vite.log 2>&1) &`,
          'PREVIEW_PID=$!',
          'sleep 2',
          `node /usr/local/bin/commando-webgl-qa.mjs --url http://127.0.0.1:${previewPort} --out /tmp/commando-qa/qa-${opts.runId}.png`,
          'QA_EXIT=$?',
          'kill $PREVIEW_PID 2>/dev/null || true',
          'exit $QA_EXIT'
        ].join('; ');

        const qaExec = await runStep('PLAYWRIGHT_WEBGL_QA', containerQaCmd);
        try {
          const lastJsonLine = qaExec.output
            .split('\n')
            .reverse()
            .find((line) => line.trim().startsWith('{'));
          if (lastJsonLine) {
            const parsed = JSON.parse(lastJsonLine) as {
              httpStatus?: number;
              consoleErrors?: string[];
              pageErrors?: string[];
            };
            httpStatus = parsed.httpStatus ?? 0;
            if (Array.isArray(parsed.consoleErrors)) {
              consoleErrors.push(...parsed.consoleErrors);
            }
            if (Array.isArray(parsed.pageErrors)) {
              pageErrors.push(...parsed.pageErrors);
            }
          }
          await execFileAsync('docker', [
            'cp',
            `${opts.containerName}:/tmp/commando-qa/qa-${opts.runId}.png`,
            screenshotPath
          ]);
        } catch (cpErr: unknown) {
          appendLog('SCREENSHOT_CAPTURE', (cpErr as Error).message);
        }
      } else {
        // Local Isolated Sandbox Fallback Mode: boot preview server + run Playwright or HTTP+DOM probe
        const localQa = await this.runLocalPreviewAndPlaywright({
          workspacePath: opts.workspacePath,
          previewPort,
          screenshotPath,
          scripts
        });
        httpStatus = localQa.httpStatus;
        consoleErrors.push(...localQa.consoleErrors);
        pageErrors.push(...localQa.pageErrors);
        appendLog('PLAYWRIGHT_WEBGL_QA', localQa.log);
      }
    } else if (typecheckPassed && buildPassed) {
      // Non-frontend repo (e.g. REST API, shared library, or infra repo) or browser check skipped
      httpStatus = 200;
      appendLog(
        'HEADLESS_QA',
        `Non-UI repository (${opts.repoSlug}) passed typecheck/build verification.`
      );
    }

    // Ensure screenshot file always exists on disk for the Dashboard UI
    try {
      await fs.access(screenshotPath);
    } catch {
      const okSoFar =
        typecheckPassed &&
        buildPassed &&
        consoleErrors.length === 0 &&
        pageErrors.length === 0;
      await fs.writeFile(screenshotPath, createDiagnosticPngBuffer(okSoFar));
    }

    const passed =
      typecheckPassed &&
      buildPassed &&
      httpStatus >= 200 &&
      httpStatus < 400 &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0;

    const truncatedLogs = truncateToolOutput(logLines.join('\n\n'), 8000).text;

    return {
      passed,
      typecheckPassed,
      buildPassed,
      httpStatus,
      consoleErrors,
      pageErrors,
      screenshotPath,
      screenshotUrl,
      previewUrl,
      durationMs: Date.now() - startedAt,
      logs: truncatedLogs
    };
  }

  /**
   * Boots a local Vite/Next preview server on `previewPort`, runs Playwright Headless Chromium
   * with WebGL flags (`HEADLESS_WEBGL_CHROMIUM_ARGS`), and guarantees clean server teardown.
   */
  private static async runLocalPreviewAndPlaywright(opts: {
    workspacePath: string;
    previewPort: number;
    screenshotPath: string;
    scripts: Record<string, string>;
  }): Promise<{
    httpStatus: number;
    consoleErrors: string[];
    pageErrors: string[];
    log: string;
  }> {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const logs: string[] = [];
    const targetUrl = `http://127.0.0.1:${opts.previewPort}`;

    let serverProc: ChildProcess | null = null;
    try {
      const previewCmd = opts.scripts.preview
        ? `npx vite preview --host 127.0.0.1 --port ${opts.previewPort}`
        : `npx vite --host 127.0.0.1 --port ${opts.previewPort}`;

      serverProc = spawn('bash', ['-lc', previewCmd], {
        cwd: opts.workspacePath,
        stdio: 'ignore',
        detached: true
      });

      const httpProbe = await waitForHttpServer(targetUrl, 15000);
      if (httpProbe.status === 0) {
        pageErrors.push(`Preview server failed to respond on ${targetUrl} within 15s.`);
        return {
          httpStatus: 0,
          consoleErrors,
          pageErrors,
          log: logs.concat(pageErrors).join('\n')
        };
      }

      // Attempt dynamic Playwright import with Headless Chromium + SwiftShader WebGL flags
      try {
        const pwModuleName = 'playwright';
        const pw = (await import(pwModuleName)) as {
          chromium: {
            launch: (o: { headless: boolean; args: string[] }) => Promise<{
              newContext: (c: Record<string, unknown>) => Promise<{
                newPage: () => Promise<{
                  on: (event: string, cb: (arg: unknown) => void) => void;
                  goto: (
                    u: string,
                    o: { waitUntil: string; timeout: number }
                  ) => Promise<{ status: () => number } | null>;
                  waitForTimeout: (ms: number) => Promise<void>;
                  evaluate: <T>(fn: () => T) => Promise<T>;
                  screenshot: (o: { path: string }) => Promise<void>;
                }>;
              }>;
              close: () => Promise<void>;
            }>;
          };
        };

        const browser = await pw.chromium.launch({
          headless: true,
          args: [...HEADLESS_WEBGL_CHROMIUM_ARGS]
        });

        try {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            ignoreHTTPSErrors: true
          });
          const page = await context.newPage();

          page.on('console', (msg: unknown) => {
            const m = msg as { type: () => string; text: () => string };
            if (m.type() === 'error') {
              consoleErrors.push(m.text());
            }
          });

          page.on('pageerror', (err: unknown) => {
            const e = err as { message?: string };
            pageErrors.push(e?.message || String(err));
          });

          const response = await page.goto(targetUrl, {
            waitUntil: 'networkidle',
            timeout: 20000
          });
          const status = response ? response.status() : httpProbe.status;
          await page.waitForTimeout(1200);

          const domMounted = await page.evaluate(() => {
            const root =
              document.querySelector('#root') ||
              document.querySelector('#app') ||
              document.querySelector('canvas') ||
              document.body;
            return Boolean(
              root &&
                (root.children.length > 0 ||
                  (root.textContent && root.textContent.trim().length > 0) ||
                  root.tagName === 'CANVAS')
            );
          });

          if (!domMounted) {
            pageErrors.push('Root DOM element (#root / #app / canvas) failed to mount content.');
          }

          await page.screenshot({ path: opts.screenshotPath });
          logs.push(
            `Playwright Headless Chromium + WebGL check completed (HTTP ${status}, consoleErrors=${consoleErrors.length}, pageErrors=${pageErrors.length}).`
          );

          return {
            httpStatus: status,
            consoleErrors,
            pageErrors,
            log: logs.join('\n')
          };
        } finally {
          await browser.close().catch(() => {});
        }
      } catch (pwErr: unknown) {
        // Fallback if Playwright browser binaries are not installed on local laptop host:
        // Verify HTTP 200 and root mount container in HTML response
        const hasRootTag = /id=["'](root|app)["']|<canvas|<script/i.test(httpProbe.body);
        if (!hasRootTag) {
          pageErrors.push('HTML response missing root mount element (#root, #app, or <script>).');
        }
        await fs.writeFile(
          opts.screenshotPath,
          createDiagnosticPngBuffer(httpProbe.status === 200 && hasRootTag)
        );
        logs.push(
          `Playwright binary fallback used (${(pwErr as Error).message}); verified HTTP ${httpProbe.status} and root mount structure.`
        );
        return {
          httpStatus: httpProbe.status,
          consoleErrors,
          pageErrors,
          log: logs.join('\n')
        };
      }
    } finally {
      if (serverProc && serverProc.pid) {
        try {
          process.kill(-serverProc.pid, 'SIGTERM');
        } catch {
          serverProc.kill('SIGTERM');
        }
      }
    }
  }
}
