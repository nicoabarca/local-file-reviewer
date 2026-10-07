import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { askClaude } from './server/askClaude.js';

// vercel.json is the single source of the Content-Security-Policy. Hosted, it
// is sent as an HTTP header; the build also embeds it as a <meta> tag so
// `npm start` and other static hosts get the same policy. Meta tags cannot
// carry frame-ancestors, so that directive is dropped here. (Not applied in
// dev, where Vite injects inline HMR scripts.)
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
const CSP = vercel.headers
  .flatMap((rule) => rule.headers)
  .find((h) => h.key === 'Content-Security-Policy')
  .value.split(';')
  .map((d) => d.trim())
  .filter((d) => d && !d.startsWith('frame-ancestors'))
  .join('; ');

const csp = {
  name: 'local-only-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
};

// Local servers bind to the loopback interface only: never reachable from
// other machines on the network.
export default defineConfig({
  plugins: [react(), csp, askClaude()],
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 5174 },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});
