import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    // Same-origin in production (desktop serves the build from the server);
    // in dev Vite proxies API calls so the client always uses relative URLs.
    proxy: {
      '/api': 'http://localhost:3500',
    },
  },
});
