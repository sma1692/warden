import net from 'node:net';
import http from 'node:http';

export interface PreviewRoute {
  runId: string;
  shortRunId: string;
  agentSlug: string;
  repoSlug: string;
  hostPort: number;
  containerPort: number;
  /** Production cloud wildcard HTTPS preview URL (`https://preview-<shortRunId>.<PREVIEW_BASE_DOMAIN>`) */
  previewUrl: string;
  /** Direct local HTTP preview URL (`http://localhost:<hostPort>`) */
  localPreviewUrl: string;
  /** Local Caddy wildcard preview URL (`http://preview-<shortRunId>.localhost`) */
  localWildcardUrl: string;
  allocatedAt: string;
}

export interface PreviewRouterOptions {
  minPort?: number;
  maxPort?: number;
  previewDomain?: string;
}

const DEFAULT_MIN_PORT = 15000;
const DEFAULT_MAX_PORT = 15999;
const DEFAULT_PREVIEW_DOMAIN = process.env.COMMANDO_PREVIEW_DOMAIN || process.env.PREVIEW_BASE_DOMAIN || 'preview.localhost';

/**
 * Checks whether a TCP port is available on `127.0.0.1`.
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Normalizes a `runId` (UUID or custom string) into a URL-safe short slug (8-12 chars).
 */
export function toShortRunId(runId: string): string {
  const cleaned = runId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
  return cleaned || 'run00000';
}

export class PreviewRouter {
  private readonly minPort: number;
  private readonly maxPort: number;
  private readonly previewDomain: string;
  private readonly routesByRunId = new Map<string, PreviewRoute>();
  private readonly routesByShortId = new Map<string, PreviewRoute>();
  private readonly allocatedPorts = new Set<number>();
  private nextCandidatePort: number;
  private gatewayServer: http.Server | null = null;

  constructor(opts: PreviewRouterOptions = {}) {
    this.minPort = opts.minPort ?? DEFAULT_MIN_PORT;
    this.maxPort = opts.maxPort ?? DEFAULT_MAX_PORT;
    this.previewDomain = opts.previewDomain ?? DEFAULT_PREVIEW_DOMAIN;
    this.nextCandidatePort = this.minPort;
  }

  /**
   * Allocates an available host preview port in the `15000-15999` range for `runId`
   * and returns the structured `PreviewRoute` with both cloud HTTPS and local URLs.
   */
  async allocateRoute(opts: {
    runId: string;
    agentSlug: string;
    repoSlug: string;
    containerPort?: number;
  }): Promise<PreviewRoute> {
    const existing = this.routesByRunId.get(opts.runId);
    if (existing) {
      return existing;
    }

    const hostPort = await this.findFreePort();
    const containerPort = opts.containerPort ?? 4173;
    const shortRunId = toShortRunId(opts.runId);

    const route: PreviewRoute = {
      runId: opts.runId,
      shortRunId,
      agentSlug: opts.agentSlug,
      repoSlug: opts.repoSlug,
      hostPort,
      containerPort,
      previewUrl: `https://preview-${shortRunId}.${this.previewDomain}`,
      localPreviewUrl: `http://localhost:${hostPort}`,
      localWildcardUrl: `http://preview-${shortRunId}.localhost`,
      allocatedAt: new Date().toISOString()
    };

    this.allocatedPorts.add(hostPort);
    this.routesByRunId.set(opts.runId, route);
    this.routesByShortId.set(shortRunId, route);

    return route;
  }

  /**
   * Releases the preview port and route associated with `runId`.
   */
  releaseRoute(runId: string): boolean {
    const route = this.routesByRunId.get(runId);
    if (!route) {
      return false;
    }
    this.allocatedPorts.delete(route.hostPort);
    this.routesByRunId.delete(runId);
    this.routesByShortId.delete(route.shortRunId);
    return true;
  }

  /**
   * Looks up an active preview route by full `runId` or `shortRunId`.
   */
  getRoute(runIdOrShortId: string): PreviewRoute | undefined {
    return (
      this.routesByRunId.get(runIdOrShortId) ??
      this.routesByShortId.get(toShortRunId(runIdOrShortId))
    );
  }

  /**
   * Lists all active container preview routes.
   */
  listActiveRoutes(): PreviewRoute[] {
    return Array.from(this.routesByRunId.values());
  }

  /**
   * Finds the next free TCP port in `15000-15999`.
   */
  private async findFreePort(): Promise<number> {
    const totalPorts = this.maxPort - this.minPort + 1;

    for (let i = 0; i < totalPorts; i++) {
      const candidate =
        this.minPort + ((this.nextCandidatePort - this.minPort + i) % totalPorts);

      if (this.allocatedPorts.has(candidate)) {
        continue;
      }

      const free = await isPortAvailable(candidate);
      if (free) {
        this.nextCandidatePort =
          this.minPort + ((candidate - this.minPort + 1) % totalPorts);
        return candidate;
      }
    }

    throw new Error(
      `PreviewRouter exhausted all ports in range ${this.minPort}-${this.maxPort}.`
    );
  }

  /**
   * Optional HTTP gateway server (defaults to port `4100` matching `infra/docker/Caddyfile`)
   * that routes incoming Caddy wildcard requests (`X-Commando-Preview-Run-Id`) to `127.0.0.1:<hostPort>`.
   */
  async startGatewayServer(gatewayPort = 4100): Promise<http.Server> {
    if (this.gatewayServer) {
      return this.gatewayServer;
    }

    const server = http.createServer((req, res) => {
      const headerRunId = req.headers['x-commando-preview-run-id'];
      const hostHeader = req.headers.host || '';
      let targetKey = typeof headerRunId === 'string' ? headerRunId : '';

      if (!targetKey) {
        const match = hostHeader.match(/^preview-([a-zA-Z0-9-]+)\./);
        if (match) {
          targetKey = match[1];
        }
      }

      const route = targetKey ? this.getRoute(targetKey) : undefined;
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Preview container not found or already destroyed',
            runId: targetKey || null,
            activePreviews: this.listActiveRoutes().map((r) => ({
              shortRunId: r.shortRunId,
              repoSlug: r.repoSlug,
              previewUrl: r.previewUrl,
              localPreviewUrl: r.localPreviewUrl
            }))
          })
        );
        return;
      }

      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: route.hostPort,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${route.hostPort}`
          }
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        }
      );

      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Preview server inside sandbox is not responding on allocated port',
            runId: route.runId,
            hostPort: route.hostPort,
            details: err.message
          })
        );
      });

      req.pipe(proxyReq, { end: true });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(gatewayPort, '127.0.0.1', () => resolve());
    });

    this.gatewayServer = server;
    return server;
  }

  async stopGatewayServer(): Promise<void> {
    if (!this.gatewayServer) return;
    const server = this.gatewayServer;
    this.gatewayServer = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export const defaultPreviewRouter = new PreviewRouter();
