// Page-relative rectangles: [left, top, right, bottom], each 0..1, origin at
// the top-left corner of the page as displayed (with the PDF's own /Rotate
// applied). Independent of zoom.

const round = (v) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

export function normalizeRect(clientRect, pageBox) {
  return [
    round((clientRect.left - pageBox.left) / pageBox.width),
    round((clientRect.top - pageBox.top) / pageBox.height),
    round((clientRect.right - pageBox.left) / pageBox.width),
    round((clientRect.bottom - pageBox.top) / pageBox.height),
  ];
}

/**
 * Merge per-fragment rectangles into one rectangle per visual line. Fragments
 * on the same line but far apart horizontally (e.g. two columns) stay separate.
 */
export function mergeIntoLines(rects, maxGap = 0.03) {
  const sorted = rects
    .filter(([l, t, r, b]) => r - l > 0.0005 && b - t > 0.0005)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const rect of sorted) {
    const mid = (rect[1] + rect[3]) / 2;
    const hit = out.find(
      (o) =>
        mid > o[1] &&
        mid < o[3] &&
        rect[0] <= o[2] + maxGap &&
        rect[2] >= o[0] - maxGap,
    );
    if (hit) {
      hit[0] = Math.min(hit[0], rect[0]);
      hit[1] = Math.min(hit[1], rect[1]);
      hit[2] = Math.max(hit[2], rect[2]);
      hit[3] = Math.max(hit[3], rect[3]);
    } else {
      out.push([...rect]);
    }
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function boundingRect(rects) {
  return [
    Math.min(...rects.map((r) => r[0])),
    Math.min(...rects.map((r) => r[1])),
    Math.max(...rects.map((r) => r[2])),
    Math.max(...rects.map((r) => r[3])),
  ];
}

export const formatRect = (r) => `[${r.map((v) => v.toFixed(2)).join(', ')}]`;
