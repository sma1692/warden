import { defineConfig, mergeConfig, type Plugin } from 'vite';
import baseConfig from './vite.config';

// `npm run dev:ui`: same app code, served on its own port with gallery.html as the index.
const serveGalleryAtRoot: Plugin = {
  name: 'serve-gallery-at-root',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/' || req.url === '/index.html') req.url = '/gallery.html';
      next();
    });
  },
};

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [serveGalleryAtRoot],
    server: { port: 5174, strictPort: true },
  })
);
