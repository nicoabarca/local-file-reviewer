import { useId, useLayoutEffect, useRef, useState } from 'react';

/** Inline **bold** and `code`, the only markup answers are asked to use. */
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Paragraphs and "- " lists, rendered as elements (never as HTML). */
function AnswerText({ text }) {
  // Group consecutive lines into paragraphs and lists; blank lines end a group.
  const groups = [];
  for (const line of text.trim().split('\n')) {
    const item = line.match(/^\s*[-*] (.*)/);
    const kind = !line.trim() ? null : item ? 'ul' : 'p';
    const last = groups.at(-1);
    if (!kind) groups.push({ kind: null });
    else if (last?.kind === kind) last.lines.push(item ? item[1] : line);
    else groups.push({ kind, lines: [item ? item[1] : line] });
  }
  return groups
    .filter((g) => g.kind)
    .map((g, i) =>
      g.kind === 'ul' ? (
        <ul key={i}>
          {g.lines.map((l, j) => (
            <li key={j}>{inline(l)}</li>
          ))}
        </ul>
      ) : (
        <p key={i}>{inline(g.lines.join('\n'))}</p>
      ),
    );
}

/**
 * The answer text, clipped to a few lines with a toggle when it is longer.
 * Whether it overflows is measured, not guessed from the length, so the
 * toggle appears only when something is actually hidden.
 */
function CollapsibleText({ text }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);
  const id = useId();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    // The panel can be resized, which changes where the text wraps.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  const clipped = !expanded;
  return (
    <>
      <div id={id} ref={ref} className={`answerText${clipped && overflows ? ' clipped' : ''}${clipped ? ' collapsed' : ''}`}>
        <AnswerText text={text} />
      </div>
      {(overflows || expanded) && (
        <button type="button" className="answerToggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : 'Show full answer'}
        </button>
      )}
    </>
  );
}

export default function Answer({ comment, live, onRetry }) {
  const status = live?.status ?? (comment.answer != null ? 'done' : 'interrupted');
  const text = comment.answer ?? '';
  return (
    <div className="answer" aria-live="polite" aria-busy={status === 'waiting'}>
      <div className="answerLabel">
        Claude
        {status === 'waiting' && <span className="muted"> · waiting for {live.session}…</span>}
      </div>
      {text && <CollapsibleText text={text} />}
      {status === 'waiting' && <p className="hint answerError">The question is in your terminal session; the answer appears here when Claude replies.</p>}
      {status === 'error' && <p className="hint answerError">Could not answer: {live.error}</p>}
      {status === 'interrupted' && <p className="hint answerError">No answer: the page was closed while Claude was answering.</p>}
      {(status === 'error' || status === 'interrupted') && (
        <button type="button" className="btn ghost" onClick={() => onRetry(comment.id)}>
          Ask again
        </button>
      )}
    </div>
  );
}
