// Copies PDF.js fonts, character maps, color profiles and wasm decoders into public/ so the app never
// fetches them from a CDN. Runs automatically after `npm install`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.warn('pdfjs-dist not installed yet; skipping asset copy');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log('Copied PDF.js data files to public/pdfjs');
