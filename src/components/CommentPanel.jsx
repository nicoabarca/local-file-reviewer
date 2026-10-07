import { useEffect, useRef, useState } from 'react';
import { lineLabel } from '../lib/exportFeedback.js';
import { formatRect } from '../lib/geometry.js';
import { sectionLabel } from '../lib/htmlModel.js';

function locationText(c, kind) {
  if (kind === 'html') {
    const parts = [sectionLabel(c.headingPath)];
    if (c.type === 'region') parts.push('region');
    if (c.question) parts.push('question');
    return parts.join(' · ');
  }
  const parts = [`p. ${c.page}`];
  if (c.type === 'region') parts.push('region');
  else parts.push(lineLabel(c.visualLines) ?? 'lines n/a');
  if (c.question) parts.push('question');
  return parts.join(' · ');
}

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

function Answer({ comment, live, onRetry }) {
  const status = live?.status ?? (comment.answer != null ? 'done' : 'interrupted');
  const text = live?.text ?? comment.answer ?? '';
  return (
    <div className="answer" aria-live="polite" aria-busy={status === 'thinking' || status === 'streaming'}>
      <div className="answerLabel">
        Claude
        {status === 'thinking' && <span className="muted"> · thinking…</span>}
        {status === 'streaming' && <span className="muted"> · answering…</span>}
      </div>
      {text && <AnswerText text={text} />}
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

const formatPixels = (r) => `[${r.map((v) => Math.round(v)).join(', ')}] px`;

function Quote({ location, kind }) {
  if (location.type === 'region') {
    const rect = location.rects[0];
    return <div className="quote regionQuote">{kind === 'html' ? formatPixels(rect) : formatRect(rect)}</div>;
  }
  return (
    <blockquote className="quote">
      {location.prefix && <span className="ctx">…{location.prefix.slice(-24)}</span>}
      <mark>{location.selectedText}</mark>
      {location.suffix && <span className="ctx">{location.suffix.slice(0, 24)}…</span>}
    </blockquote>
  );
}

function CommentEditor({ initial = '', submitLabel, placeholder = 'What should the agent change?', onSubmit, onCancel }) {
  const [text, setText] = useState(initial);
  const ref = useRef(null);
  useEffect(() => {
    ref.current.focus();
    ref.current.setSelectionRange(initial.length, initial.length);
  }, [initial]);
  const submit = () => text.trim() && onSubmit(text.trim());
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        value={text}
        rows={4}
        aria-label="Comment"
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="editorActions">
        <span className="hint">⌘/Ctrl+Enter to save · Esc to cancel</span>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn solid" disabled={!text.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function CommentCard({ item, kind, notFound, active, live, onActivate, onUpdate, onDelete, onRetry }) {
  const { comment: c, number } = item;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <li ref={ref} className={`card${c.question ? ' question' : ''}${active ? ' active' : ''}`} data-comment-id={c.id}>
      <button
        type="button"
        className="cardHead"
        onClick={() => onActivate(c.id, { scrollDoc: true })}
        aria-label={`Comment ${number}, ${locationText(c, kind)}${notFound ? ', not found in document' : ''}. Show in document.`}
      >
        <span className="num">{String(number).padStart(2, '0')}</span>
        <span className="loc">{locationText(c, kind)}</span>
        <span className="cid">{c.id}</span>
      </button>
      {notFound && (
        <p className="hint notFound" title="The quote is not in the document as currently rendered, usually because a script changed the text. It is still included in the prompt.">
          Not found in document
        </p>
      )}
      <Quote location={c} kind={kind} />
      {editing ? (
        <CommentEditor
          initial={c.comment}
          submitLabel={c.question ? 'Ask again' : 'Save'}
          onSubmit={(text) => {
            onUpdate(c.id, text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="body">{c.comment}</p>
      )}
      {c.question && !editing && <Answer comment={c} live={live} onRetry={onRetry} />}
      {!editing && (
        <div className="cardActions">
          {confirming ? (
            <>
              <span className="hint">Delete this {c.question ? 'question' : 'comment'}?</span>
              <button type="button" className="btn ghost" onClick={() => setConfirming(false)} autoFocus>
                Keep
              </button>
              <button type="button" className="btn danger" onClick={() => onDelete(c.id)}>
                Delete
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function CommentPanel({
  kind,
  missing,
  numbered,
  draft,
  activeId,
  onSaveDraft,
  onCancelDraft,
  onActivate,
  onUpdate,
  onDelete,
  answering,
  onRetry,
}) {
  return (
    <aside className="panel" aria-label="Comments">
      {draft && (
        <section className="composer" aria-label="New comment">
          <div className="panelLabel">
            {draft.question ? 'Ask Claude' : 'New comment'} <span className="muted">· {locationText(draft, kind)}</span>
          </div>
          <Quote location={draft} kind={kind} />
          <CommentEditor
            submitLabel={draft.question ? 'Ask' : 'Add comment'}
            placeholder={draft.question ? 'What do you want to know about this passage?' : undefined}
            onSubmit={onSaveDraft}
            onCancel={onCancelDraft}
          />
        </section>
      )}
      <div className="panelLabel sticky">
        Comments <span className="count">{numbered.length}</span>
      </div>
      {numbered.length === 0 && !draft ? (
        <div className="empty">
          <p>No comments yet.</p>
          <p className="muted">
            Select text and press <kbd>C</kbd>, or switch to <kbd>R</kbd> region mode and drag a box over a figure
            {kind === 'html' ? ' or diagram.' : ' or scanned page.'}
          </p>
        </div>
      ) : (
        <ol className="cards">
          {numbered.map((item) => (
            <CommentCard
              key={item.comment.id}
              item={item}
              kind={kind}
              notFound={missing.has(item.comment.id)}
              active={item.comment.id === activeId}
              live={answering[item.comment.id]}
              onActivate={onActivate}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onRetry={onRetry}
            />
          ))}
        </ol>
      )}
    </aside>
  );
}
