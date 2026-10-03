import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPrompt } from '../lib/exportFeedback.js';

const short = (sha) => `${sha.slice(0, 12)}…`;

export default function ExportDialog({ open, review, pageCount, blocked, onClose, onExported }) {
  const ref = useRef(null);
  const textRef = useRef(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) {
      setCopied(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const prompt = useMemo(() => (open ? buildPrompt(review, { pageCount }) : ''), [open, review, pageCount]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('ok');
      onExported();
    } catch {
      // Clipboard permission denied: select the text so the user can copy it by hand.
      textRef.current.focus();
      textRef.current.select();
      setCopied('manual');
    }
  };

  const lines = prompt.split('\n').length;

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="export-title">
      <div className="dialogBody">
        <header className="dialogHead">
          <h2 id="export-title">Prompt for your agent</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close export dialog">
            Esc
          </button>
        </header>

        <dl className="identity">
          <dt>Reviewed PDF</dt>
          <dd>
            {review.preview.name} <code>{short(review.preview.sha256)}</code>
          </dd>
          <dt>Comments</dt>
          <dd>{review.comments.length}, in page order</dd>
        </dl>

        {blocked ? (
          <p className="warn">A reviewed file changed on disk. Choose how to continue in the banner before copying.</p>
        ) : (
          <div className="exportActions">
            <button type="button" className="btn solid big" onClick={copy} autoFocus>
              {copied === 'ok' ? '✓ Copied' : 'Copy prompt'}
            </button>
            <span className="muted" role="status">
              {copied === 'ok'
                ? 'Paste it into your agent. Nothing was written to disk.'
                : copied === 'manual'
                  ? 'Clipboard access was blocked. The prompt is selected: press ⌘/Ctrl+C.'
                  : `${lines} lines · includes file hashes, how to locate comments, and a JSON copy`}
            </span>
          </div>
        )}

        <textarea
          ref={textRef}
          className="promptText"
          value={prompt}
          readOnly
          spellCheck={false}
          aria-label="Prompt text"
          rows={18}
        />
      </div>
    </dialog>
  );
}
