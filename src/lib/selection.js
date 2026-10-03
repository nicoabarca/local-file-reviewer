import { mergeIntoLines, normalizeRect } from './geometry.js';
import { visualLinesFor } from './pageModel.js';

const CONTEXT_CHARS = 40;
const flatten = (s) => s.replace(/\s*\n\s*/g, ' ');

/**
 * Turn the current DOM selection into a text-comment location.
 *
 * Returns one of:
 *   { ok: true, location }  location = { type, page, rects, selectedText, prefix, suffix, visualLines }
 *   { ok: false, reason: 'empty' | 'outside' | 'multi-page', pages? }
 *
 * @param {Range} range
 * @param {HTMLElement} root element containing all pages
 * @param {(page: number) => object | undefined} getModel page text model lookup
 */
export function locationFromRange(range, root, getModel) {
  if (range.collapsed) return { ok: false, reason: 'empty' };

  // Text spans that actually contribute characters, grouped by page.
  const byPage = new Map();
  for (const span of root.querySelectorAll('.textLayer span[data-idx]')) {
    if (!range.intersectsNode(span)) continue;
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    const from = range.startContainer === textNode ? range.startOffset : 0;
    const to = range.endContainer === textNode ? range.endOffset : textNode.length;
    if (to <= from || !textNode.data.slice(from, to).trim()) continue;
    const page = Number(span.closest('[data-page-number]').dataset.pageNumber);
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push({ span, textNode, from, to, idx: Number(span.dataset.idx) });
  }

  if (byPage.size === 0) return { ok: false, reason: 'outside' };
  if (byPage.size > 1) {
    return { ok: false, reason: 'multi-page', pages: [...byPage.keys()].sort((a, b) => a - b) };
  }

  const [[page, parts]] = byPage;
  const model = getModel(page);
  const pageEl = root.querySelector(`[data-page-number="${page}"] .pageSurface`);
  if (!model || !pageEl) return { ok: false, reason: 'outside' };
  const pageBox = pageEl.getBoundingClientRect();

  const fragments = [];
  for (const p of parts) {
    const sub = document.createRange();
    sub.setStart(p.textNode, p.from);
    sub.setEnd(p.textNode, p.to);
    fragments.push(normalizeRect(sub.getBoundingClientRect(), pageBox));
  }

  // Character offsets in the page text model.
  const first = parts[0];
  const last = parts[parts.length - 1];
  let from = model.start[first.idx] + first.from;
  let to = model.start[last.idx] + last.to;
  while (from < to && /\s/.test(model.text[from])) from++;
  while (to > from && /\s/.test(model.text[to - 1])) to--;

  return {
    ok: true,
    location: {
      type: 'text',
      page,
      rects: mergeIntoLines(fragments),
      selectedText: flatten(model.text.slice(from, to)),
      prefix: flatten(model.text.slice(Math.max(0, from - CONTEXT_CHARS), from)) || null,
      suffix: flatten(model.text.slice(to, to + CONTEXT_CHARS)) || null,
      visualLines: visualLinesFor(model, from, to),
    },
  };
}
