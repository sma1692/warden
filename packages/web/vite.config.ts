import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {
  ensureDevCerts,
  getLanIp,
  isHttpsEnabled,
} from '../orchestrator/src/server/devHttps';

const httpsEnabled = isHttpsEnabled();
const lanIp = getLanIp();

// Shared self-signed cert (same files the API server uses) for LAN HTTPS phone testing.
let https: { key: Buffer; cert: Buffer } | undefined;
if (httpsEnabled) {
  const creds = ensureDevCerts(path.dirname(fileURLToPath(import.meta.url)));
  if (creds) {
    https = { key: creds.key, cert: creds.cert };
  } else {
    console.warn(
      '[WARDEN WEB] WARDEN_HTTPS is set but no dev certs are available; serving plain HTTP.'
    );
  }
}

// Auto-detect the LAN IP + HTTPS protocol for the orchestrator backend during `npm run dev`.
const apiPort = Number(process.env.PORT || 4000);
const apiProto = https ? 'https' : 'http';
const wsProto = https ? 'wss' : 'ws';
const apiHost = lanIp || 'localhost';
const apiTarget =
  process.env.WARDEN_API_URL ||
  process.env.VITE_API_URL ||
  `${apiProto}://${apiHost}:${apiPort}`;
const wsTarget =
  process.env.VITE_WS_URL ||
  `${wsProto}://${apiHost}:${apiPort}/ws`;
const apiTargetIsHttps = apiTarget.startsWith('https:');

const printLanUrls: Plugin = {
  name: 'warden-print-lan-urls',
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      const addr = server.httpServer?.address();
      const port =
        typeof addr === 'object' && addr ? addr.port : 5173;
      const proto = https ? 'https' : 'http';
      console.log(`[WARDEN WEB] Local: ${proto}://localhost:${port}`);
      if (lanIp) {
        console.log(
          `[WARDEN WEB] LAN (phone): ${proto}://${lanIp}:${port} (accept the self-signed cert warning once)`
        );
      }
      console.log(`[WARDEN WEB] Backend API: ${apiTarget}`);
    });
  },
};

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), printLanUrls],
  define:
    command === 'serve'
      ? {
          'import.meta.env.VITE_API_URL': JSON.stringify(apiTarget),
          'import.meta.env.VITE_WS_URL': JSON.stringify(wsTarget),
        }
      : undefined,
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    https,
    // Pin HMR to wss + the LAN IP so hot-reload reaches a phone on the same Wi-Fi.
    // clientPort is left to Vite so merged configs on other ports (dev:ui) stay correct.
    hmr: https ? { protocol: 'wss', host: lanIp ?? undefined } : undefined,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: apiTargetIsHttps ? false : undefined,
      },
      '/ws': {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
        secure: apiTargetIsHttps ? false : undefined,
      },
      '/media': {
        target: apiTarget,
        changeOrigin: true,
        secure: apiTargetIsHttps ? false : undefined,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    https,
  },
}));
