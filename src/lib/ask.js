// Client for "Ask Claude" through Claude Code channels (server/channels.js).
// Questions go to a Claude Code session the user started in a terminal with
// the `channels-claude` shell function (see README). The bridge exists only
// under `npm run dev` and `npm start`; a static deploy has no /api/channels,
// and the feature stays hidden.

import { sectionLabel } from './htmlModel.js';

/** Running sessions with the reviewer channel, newest first; null when the bridge is absent. */
export async function listSessions() {
  try {
    const res = await fetch('/api/channels');
    if (!res.ok) return null;
    return (await res.json()).sessions;
  } catch {
    return null;
  }
}

/** Ask one question; resolves with the whole answer once Claude replies. */
export async function ask(sessionId, { prompt, document }) {
  const res = await fetch('/api/channels/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, prompt, document }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.answer;
}

/** The message sent for one question: the document, where the passage is, the passage, the question. */
export function buildQuestion(c, question, documentName) {
  const out = [`Document: ${documentName}`];
  if (c.headingPath) out.push(`Section: ${sectionLabel(c.headingPath)}`);
  else if (c.page) out.push(`Page: ${c.page}`);
  out.push('Selected passage:', `"${c.selectedText}"`);
  if (c.prefix || c.suffix) out.push(`In context: "…${c.prefix ?? ''}⟦${c.selectedText}⟧${c.suffix ?? ''}…"`);
  out.push('', `Question: ${question}`);
  return out.join('\n');
}

/** "proj · started 09:32" */
export function sessionLabel(s) {
  return `${s.project} · started ${new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
