// Text model and locators for HTML documents.
//
// The model is the document's text as a reader sees it: text nodes in
// document order, every run of whitespace collapsed to one space, and a space
// between text from different block elements. Quotes, their context and the
// re-anchoring search all use this same text, so a quote captured once is
// found again on every load of the same file.
//
// Coordinates are CSS pixels [left, top, right, bottom] in the document
// rendered at HTML_WIDTH, origin at the top-left of the document.

import { mergeIntoLines } from './geometry.js';

export const HTML_WIDTH = 1024;
export const CONTEXT_CHARS = 40;

const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'HEAD', 'TITLE']);
const BLOCKS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'CAPTION', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT',
  'TH', 'THEAD', 'TR', 'UL',
]);
const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const MAX_HEADING = 200;

const isSpace = (ch) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f' || ch === ' ';
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Build the model from text chunks in document order.
 *
 * @param {Array<{text: string, block: unknown}>} chunks `block` identifies the
 *   enclosing block element; a change of block separates words.
 * @returns {{text: string, charChunk: number[], charOffset: number[], maps: Int32Array[]}}
 *   charChunk/charOffset give the source position of every model character;
 *   maps[i][j] is the model position of raw offset j in chunk i.
 */
export function buildTextModel(chunks) {
  let text = '';
  const charChunk = [];
  const charOffset = [];
  const maps = [];
  let pendingSpace = false;
  let prevBlock;
  chunks.forEach((chunk, ci) => {
    const raw = chunk.text;
    const map = new Int32Array(raw.length + 1);
    if (ci > 0 && chunk.block !== prevBlock) pendingSpace = true;
    for (let i = 0; i < raw.length; i++) {
      if (isSpace(raw[i])) {
        pendingSpace = true;
        map[i] = text.length;
        continue;
      }
      if (pendingSpace && text.length > 0) {
        // The separator points at the character after it.
        text += ' ';
        charChunk.push(ci);
        charOffset.push(i);
      }
      pendingSpace = false;
      map[i] = text.length;
      text += raw[i];
      charChunk.push(ci);
      charOffset.push(i);
    }
    map[raw.length] = text.length;
    prevBlock = chunk.block;
    maps.push(map);
  });
  return { text, charChunk, charOffset, maps };
}

/** Shrink [from, to) of the model text so it neither starts nor ends with a space. */
export function trimSpan(text, from, to) {
  while (from < to && text[from] === ' ') from++;
  while (to > from && text[to - 1] === ' ') to--;
  return { from, to };
}

/** Quote and context for the span [from, to) of the model text. */
export function quoteAt(text, from, to) {
  return {
    selectedText: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT_CHARS), from) || null,
    suffix: text.slice(to, to + CONTEXT_CHARS) || null,
  };
}

function commonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function commonSuffix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/**
 * Find a captured quote in the model text. When it occurs more than once, the
 * occurrence whose surroundings best match the stored context wins.
 * Returns {from, to} or null.
 */
export function findQuote(text, { selectedText, prefix, suffix }) {
  if (!selectedText) return null;
  const before = prefix ?? '';
  const after = suffix ?? '';
  let best = null;
  let bestScore = -1;
  for (let i = text.indexOf(selectedText); i !== -1; i = text.indexOf(selectedText, i + 1)) {
    const end = i + selectedText.length;
    const score =
      commonSuffix(text.slice(Math.max(0, i - before.length), i), before) +
      commonPrefix(text.slice(end, end + after.length), after);
    if (score > bestScore) {
      best = { from: i, to: end };
      bestScore = score;
    }
  }
  return best;
}

/**
 * Heading path for a position, from the headings that precede it in document
 * order: each heading closes every open heading of the same or a deeper level.
 *
 * @param {Array<{level: number, text: string}>} headings
 * @returns {string[]} outermost first
 */
export function headingPath(headings) {
  const stack = [];
  for (const h of headings) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
  }
  return stack.map((h) => h.text);
}

/** Index of the last outline entry starting at or above `top`, or -1. */
export function sectionIndexAt(outline, top) {
  let index = -1;
  for (let i = 0; i < outline.length; i++) {
    if (outline[i].top <= top + 1) index = i;
    else break;
  }
  return index;
}

export const sectionLabel = (path) => (path?.length ? path.join(' › ') : 'Top of document');

// ---- DOM side ------------------------------------------------------------

function blockOf(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (BLOCKS.has(el.tagName)) return el;
  }
  return null;
}

/** Text model of a live document, with the text node behind every chunk. */
export function modelFromDocument(doc) {
  const nodes = [];
  const chunks = [];
  if (doc.body) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let el = node.parentElement; el; el = el.parentElement) {
          if (SKIPPED.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        }
        return node.data.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push(node);
      chunks.push({ text: node.data, block: blockOf(node) });
    }
  }
  return { ...buildTextModel(chunks), nodes };
}

/**
 * One rectangle per displayed line for the span [from, to) of the model text,
 * in document pixels. Only text is measured, never element boxes.
 */
export function rectsForSpan(model, from, to) {
  if (from >= to) return [];
  const first = model.charChunk[from];
  const last = model.charChunk[to - 1];
  const doc = model.nodes[first].ownerDocument;
  const { scrollX, scrollY } = doc.defaultView;
  const fragments = [];
  for (let ci = first; ci <= last; ci++) {
    const node = model.nodes[ci];
    const start = ci === first ? model.charOffset[from] : 0;
    const end = ci === last ? model.charOffset[to - 1] + 1 : node.length;
    if (end <= start || !node.isConnected) continue;
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    // mergeIntoLines works in fractions; dividing both axes by the width keeps
    // its gap and size thresholds in proportion to the page width.
    for (const b of range.getClientRects()) {
      fragments.push([b.left + scrollX, b.top + scrollY, b.right + scrollX, b.bottom + scrollY].map((v) => v / HTML_WIDTH));
    }
  }
  return mergeIntoLines(fragments).map((r) => r.map((v) => Math.max(0, Math.round(v * HTML_WIDTH))));
}

/** Model span covered by a DOM range, or null when it holds no model text. */
export function spanForRange(model, range) {
  let first = null;
  let last = null;
  model.nodes.forEach((node, i) => {
    if (!range.intersectsNode(node)) return;
    const from = range.startContainer === node ? range.startOffset : 0;
    const to = range.endContainer === node ? range.endOffset : node.length;
    if (to <= from || !node.data.slice(from, to).trim()) return;
    if (!first) first = { i, from };
    last = { i, to };
  });
  if (!first) return null;
  const span = trimSpan(model.text, model.maps[first.i][first.from], model.maps[last.i][last.to]);
  return span.from < span.to ? span : null;
}

/** Headings of the document in order, with their top edge in document pixels. */
export function outlineOf(doc) {
  const win = doc.defaultView;
  return [...doc.querySelectorAll(HEADINGS)]
    .map((el) => ({
      el,
      level: Number(el.tagName[1]),
      text: collapse(el.textContent).slice(0, MAX_HEADING),
      top: Math.round(el.getBoundingClientRect().top + win.scrollY),
    }))
    .filter((h) => h.text);
}

/** Heading path of a node: headings before it, and the heading it is in. */
export function headingPathOf(outline, node) {
  const before = outline.filter(
    (h) => h.el === node || h.el.contains(node) || h.el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return headingPath(before);
}

/** id of the nearest element around a node that has one, or null. */
export function elementIdOf(node) {
  for (let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement; el; el = el.parentElement) {
    if (el.tagName === 'BODY' || el.tagName === 'HTML') break;
    if (el.id) return el.id.slice(0, MAX_HEADING);
  }
  return null;
}
