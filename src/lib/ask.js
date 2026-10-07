// Client for the local "Ask Claude" bridge (server/askClaude.js). The bridge
// exists only under `npm run dev` and `npm start`; a static deploy has no
// /api/ask, and the feature stays hidden.

import { sectionLabel } from './htmlModel.js';

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function askAvailable() {
  try {
    const res = await fetch('/api/ask');
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}

/**
 * Start (or keep) the Claude process for this document, with its text.
 * owner: a token for this page's use of the session; only it can close it.
 */
export async function openAskSession(docId, owner, name, text) {
  const res = await fetch('/api/ask/open', json({ docId, owner, name, text }));
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
}

export function closeAskSession(docId, owner) {
  fetch('/api/ask/close', { ...json({ docId, owner }), keepalive: true }).catch(() => {});
}

/**
 * Ask one question and stream the answer.
 * @param {{onThinking?: () => void, onText: (text: string) => void, reopen: () => Promise<void>}} handlers
 *   reopen: called once when the server lost the session (e.g. it restarted)
 */
export async function ask(docId, prompt, { onThinking, onText, reopen }) {
  let res = await fetch('/api/ask', json({ docId, prompt }));
  if (res.status === 409) {
    await reopen();
    res = await fetch('/api/ask', json({ docId, prompt }));
  }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === 'thinking') onThinking?.();
      else if (event.type === 'text') onText(event.text);
      else if (event.type === 'error') throw new Error(event.message);
      else if (event.type === 'done') return;
    }
  }
  throw new Error('The answer was cut off.');
}

/** The message sent for one question: where the passage is, the passage, the question. */
export function buildQuestion(c, question) {
  const out = [];
  if (c.headingPath) out.push(`Section: ${sectionLabel(c.headingPath)}`);
  else if (c.page) out.push(`Page: ${c.page}`);
  out.push('Selected passage:', `"${c.selectedText}"`);
  if (c.prefix || c.suffix) out.push(`In context: "…${c.prefix ?? ''}⟦${c.selectedText}⟧${c.suffix ?? ''}…"`);
  out.push('', `Question: ${question}`);
  return out.join('\n');
}

const BLOCKS =
  'address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tr,ul,br';

/** Readable text of an HTML document, one line per block element. */
export function htmlText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,template').forEach((el) => el.remove());
  doc.querySelectorAll(BLOCKS).forEach((el) => el.append('\n'));
  return collapseLines(doc.body?.textContent ?? '');
}

/** Text of every PDF page, marked with page numbers. */
export async function pdfText(doc) {
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    const text = items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('');
    pages.push(`[Page ${n}]\n${collapseLines(text)}`);
  }
  return pages.join('\n\n');
}

export function collapseLines(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
