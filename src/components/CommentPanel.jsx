import { useEffect, useRef, useState } from 'react';
import { lineLabel } from '../lib/exportFeedback.js';
import { formatRect } from '../lib/geometry.js';

function locationText(c) {
  const parts = [`p. ${c.page}`];
  if (c.type === 'region') parts.push('region');
  else parts.push(lineLabel(c.visualLines) ?? 'lines n/a');
  return parts.join(' · ');
}

function Quote({ location }) {
  if (location.type === 'region') {
    return <div className="quote regionQuote">{formatRect(location.rects[0])}</div>;
  }
  return (
    <blockquote className="quote">
      {location.prefix && <span className="ctx">…{location.prefix.slice(-24)}</span>}
      <mark>{location.selectedText}</mark>
      {location.suffix && <span className="ctx">{location.suffix.slice(0, 24)}…</span>}
    </blockquote>
  );
}

function CommentEditor({ initial = '', submitLabel, onSubmit, onCancel }) {
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
        placeholder="What should the agent change?"
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

function CommentCard({ item, active, onActivate, onUpdate, onDelete }) {
  const { comment: c, number } = item;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <li ref={ref} className={`card${active ? ' active' : ''}`} data-comment-id={c.id}>
      <button
        type="button"
        className="cardHead"
        onClick={() => onActivate(c.id, { scrollDoc: true })}
        aria-label={`Comment ${number}, ${locationText(c)}. Show in document.`}
      >
        <span className="num">{String(number).padStart(2, '0')}</span>
        <span className="loc">{locationText(c)}</span>
        <span className="cid">{c.id}</span>
      </button>
      <Quote location={c} />
      {editing ? (
        <CommentEditor
          initial={c.comment}
          submitLabel="Save"
          onSubmit={(text) => {
            onUpdate(c.id, text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="body">{c.comment}</p>
      )}
      {!editing && (
        <div className="cardActions">
          {confirming ? (
            <>
              <span className="hint">Delete this comment?</span>
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

export default function CommentPanel({ numbered, draft, activeId, onSaveDraft, onCancelDraft, onActivate, onUpdate, onDelete }) {
  return (
    <aside className="panel" aria-label="Comments">
      {draft && (
        <section className="composer" aria-label="New comment">
          <div className="panelLabel">
            New comment <span className="muted">· {locationText(draft)}</span>
          </div>
          <Quote location={draft} />
          <CommentEditor submitLabel="Add comment" onSubmit={onSaveDraft} onCancel={onCancelDraft} />
        </section>
      )}
      <div className="panelLabel sticky">
        Comments <span className="count">{numbered.length}</span>
      </div>
      {numbered.length === 0 && !draft ? (
        <div className="empty">
          <p>No comments yet.</p>
          <p className="muted">
            Select text and press <kbd>C</kbd>, or switch to <kbd>R</kbd> region mode and drag a box over a figure or
            scanned page.
          </p>
        </div>
      ) : (
        <ol className="cards">
          {numbered.map((item) => (
            <CommentCard
              key={item.comment.id}
              item={item}
              active={item.comment.id === activeId}
              onActivate={onActivate}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ol>
      )}
    </aside>
  );
}
