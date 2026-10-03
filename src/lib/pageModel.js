// Builds a per-page text model from PDF.js text content:
//  - `text`: the page text, items joined in content order, "\n" after items
//    that PDF.js marks as ending a line (hasEOL)
//  - offsets of every text item inside `text`
//  - a visual line number for every item, or null when it cannot be computed
//
// Visual lines are an application-generated locator: text items are grouped by
// vertical position on the displayed page and numbered from the top (1-based).
// Text in side-by-side columns or table cells can share a line number.

const MIN_OVERLAP = 0.5; // fraction of the smaller glyph height
const MAX_ROTATED_SHARE = 0.2; // above this, line numbers for the page are unreliable

/**
 * @param {Array} rawItems textContent.items (may include marked-content entries)
 * @param {{transform: number[]}} viewport viewport at scale 1, rotation applied
 * @param {(m1: number[], m2: number[]) => number[]} multiply matrix multiply (pdfjs Util.transform)
 */
export function buildPageModel(rawItems, viewport, multiply) {
  // Same order and filtering as TextLayer.textDivs / textContentItemsStr.
  const items = rawItems.filter((it) => it.str !== undefined);

  let text = '';
  const start = [];
  const end = [];
  for (const it of items) {
    start.push(text.length);
    text += it.str;
    end.push(text.length);
    if (it.hasEOL) text += '\n';
  }

  const geometry = [];
  let rotated = 0;
  let measured = 0;
  items.forEach((it, i) => {
    if (!it.str.trim()) return;
    const tx = multiply(viewport.transform, it.transform);
    const height = Math.hypot(tx[2], tx[3]);
    const angle = Math.atan2(tx[1], tx[0]);
    measured += 1;
    if (Math.abs(angle) > 0.01 || !(height > 0)) {
      rotated += 1;
      return;
    }
    // Approximate the glyph box from the baseline: ascent ~0.8, descent ~0.2.
    const baseline = tx[5];
    geometry.push({ i, top: baseline - height * 0.8, bottom: baseline + height * 0.2, height });
  });

  const line = new Array(items.length).fill(null);
  const reliable = measured > 0 && rotated / measured <= MAX_ROTATED_SHARE;
  if (reliable) {
    geometry.sort((a, b) => (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
    let current = null;
    let lineNo = 0;
    for (const g of geometry) {
      if (current) {
        const overlap = Math.min(g.bottom, current.bottom) - Math.max(g.top, current.top);
        if (overlap >= MIN_OVERLAP * Math.min(g.height, current.height)) {
          line[g.i] = lineNo;
          // The tallest glyph on the line anchors it, so superscripts that start
          // a line do not split it.
          if (g.height > current.height) current = g;
          continue;
        }
      }
      lineNo += 1;
      current = g;
      line[g.i] = lineNo;
    }
  }

  return { text, start, end, line, items: items.map((it) => it.str), linesReliable: reliable };
}

/**
 * Visual line range covered by the character span [from, to) of the page text,
 * or null when any covered item has no reliable line number.
 */
export function visualLinesFor(model, from, to) {
  if (!model.linesReliable) return null;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < model.items.length; i++) {
    if (model.end[i] <= from || model.start[i] >= to) continue;
    const covered = model.items[i].slice(
      Math.max(0, from - model.start[i]),
      Math.max(0, to - model.start[i]),
    );
    if (!covered.trim()) continue;
    const n = model.line[i];
    if (n == null) return null;
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  return Number.isFinite(min) ? { start: min, end: max } : null;
}
