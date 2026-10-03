// Generates sample documents in fixtures/ for trying the reviewer by hand:
//   architecture-v2.pdf  6 pages: body text, a repeated sentence on page 4,
//                        two columns on page 5, a text-free diagram on page 6
//   architecture-v2.md   matching editable source
//   architecture-v3.pdf  a "revised" version (different bytes)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
mkdirSync(out, { recursive: true });

const LOREM =
  'The gateway validates requests before they reach any worker. Each request carries a tenant identifier and a deadline. Workers pull jobs from a queue and report progress through a status channel. Retries use exponential backoff with jitter so that bursts do not synchronize.';
const REPEATED = 'Each service writes to the shared database.';

function wrap(text, font, size, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

async function build(version) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Architecture ${version}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 72;

  const textPage = (n, title, paragraphs) => {
    const page = pdf.addPage([W, H]);
    let y = H - M;
    page.drawText(title, { x: M, y, size: 20, font: bold });
    y -= 36;
    for (const p of paragraphs) {
      for (const line of wrap(p, font, 11, W - 2 * M)) {
        page.drawText(line, { x: M, y, size: 11, font });
        y -= 16;
      }
      y -= 10;
    }
    page.drawText(`${n}`, { x: W / 2, y: 40, size: 9, font });
    return page;
  };

  textPage(1, `Architecture ${version}`, [LOREM, LOREM]);
  textPage(2, '1. Gateway', [LOREM, `${LOREM} ${LOREM}`]);
  textPage(3, '2. Workers', [LOREM, LOREM, LOREM]);
  textPage(4, '3. Storage', [
    `The gateway validates requests. ${REPEATED} Changes are logged centrally.`,
    LOREM,
    `Batch jobs are different. ${REPEATED} They hold a lease while writing.`,
  ]);

  // Page 5: two columns with aligned baselines.
  const p5 = pdf.addPage([W, H]);
  p5.drawText('4. Comparison', { x: M, y: H - M, size: 20, font: bold });
  const colW = (W - 2 * M - 24) / 2;
  const left = wrap(`Option A. ${LOREM}`, font, 11, colW);
  const right = wrap(`Option B. ${LOREM} ${REPEATED}`, font, 11, colW);
  left.forEach((l, i) => p5.drawText(l, { x: M, y: H - M - 36 - i * 16, size: 11, font }));
  right.forEach((l, i) => p5.drawText(l, { x: M + colW + 24, y: H - M - 36 - i * 16, size: 11, font }));
  p5.drawText('5', { x: W / 2, y: 40, size: 9, font });

  // Page 6: a diagram drawn with vector shapes only (no text layer).
  const p6 = pdf.addPage([W, H]);
  const box = (x, y, w, h) => p6.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  box(90, 520, 150, 90);
  box(370, 520, 150, 90);
  box(230, 300, 150, 90);
  p6.drawLine({ start: { x: 240, y: 565 }, end: { x: 370, y: 565 }, thickness: 2 });
  p6.drawLine({ start: { x: 165, y: 520 }, end: { x: 280, y: 390 }, thickness: 2 });
  p6.drawLine({ start: { x: 445, y: 520 }, end: { x: 330, y: 390 }, thickness: 2 });
  if (version === 'v3') p6.drawCircle({ x: 305, y: 200, size: 30, borderColor: rgb(0, 0, 0), borderWidth: 2 });

  return pdf.save({ useObjectStreams: false });
}

writeFileSync(join(out, 'architecture-v2.pdf'), await build('v2'));
writeFileSync(join(out, 'architecture-v3.pdf'), await build('v3'));
writeFileSync(
  join(out, 'architecture-v2.md'),
  `# Architecture v2\n\n## 3. Storage\n\nThe gateway validates requests. ${REPEATED} Changes are logged centrally.\n`,
);
console.log(`Wrote fixtures to ${out}`);
