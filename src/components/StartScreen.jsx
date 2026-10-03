import { useEffect, useState } from 'react';
import { filesFromDrop, pickFile, pickJsonFile } from '../lib/files.js';
import { deleteHandle, fileFromHandle, getHandle } from '../lib/handles.js';
import { parseReviewFile } from '../lib/reviewFile.js';
import {
  STORAGE_LOCATION,
  deleteReview,
  listReviews,
  loadReview,
  persistenceStatus,
  saveReview,
} from '../lib/storage.js';

const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
const isJson = (file) => /\.json$/i.test(file.name) || file.type === 'application/json';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function StartScreen({ onStart, busy, error }) {
  const [reviews, setReviews] = useState(listReviews);
  const [localError, setLocalError] = useState(null);
  const [over, setOver] = useState(false);
  const [persistence, setPersistence] = useState('unknown');
  const [imported, setImported] = useState(null);

  useEffect(() => {
    persistenceStatus().then(setPersistence);
  }, []);

  const open = (picked, options) => {
    if (!picked) return;
    if (!isPdf(picked.file)) {
      setLocalError(`${picked.file.name} is not a PDF. Export a PDF preview of the document first.`);
      return;
    }
    setLocalError(null);
    onStart(picked, options);
  };

  /** Reopen the PDF of a saved review: its remembered file if possible, otherwise ask for it. */
  const resume = async (r) => {
    setLocalError(null);
    try {
      const handle = await getHandle(r.sha256);
      const file = handle ? await fileFromHandle(handle) : null;
      if (file) {
        open({ file, handle }, { expectSha: r.sha256 });
        return;
      }
      open(await pickFile(), { expectSha: r.sha256 });
    } catch (err) {
      // The remembered file was moved, renamed or deleted.
      if (err.name === 'NotFoundError') {
        setLocalError(`${r.name} is no longer where it was. Choose it again to resume.`);
        open(await pickFile(), { expectSha: r.sha256 });
      } else setLocalError(`Could not reopen ${r.name}: ${err.message}`);
    }
  };

  /**
   * Import a review file into this browser. Opening its PDF stays a separate
   * click: browsers only show file pickers in direct response to one.
   */
  const importReviewFile = async (text) => {
    if (text == null) return;
    setLocalError(null);
    setImported(null);
    let review;
    try {
      review = parseReviewFile(text);
    } catch (err) {
      setLocalError(`Could not open the review file: ${err.message}`);
      return;
    }
    const existing = loadReview(review.preview.sha256);
    if (existing && existing.comments.length > 0 && existing.updatedAt !== review.updatedAt) {
      const replace = confirm(
        `This browser already has a review of ${review.preview.name} (${plural(existing.comments.length, 'comment')}, ` +
          `last changed ${new Date(existing.updatedAt).toLocaleString()}).\n\n` +
          `Replace it with the review from the file (${plural(review.comments.length, 'comment')}, ` +
          `last changed ${new Date(review.updatedAt).toLocaleString()})?`,
      );
      if (!replace) return;
    }
    try {
      saveReview(review);
    } catch (err) {
      setLocalError(`Could not store the review in this browser: ${err.message}`);
      return;
    }
    setReviews(listReviews());
    setImported(review.preview.sha256);
  };

  return (
    <main className="start">
      <section
        className={`openCard shadowed${over ? ' over' : ''}`}
        aria-label="Open a document"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setOver(false);
          const [first] = await filesFromDrop(e.dataTransfer);
          if (first && isJson(first.file)) importReviewFile(await first.file.text());
          else open(first);
        }}
      >
        <div className="slot">
          <div className="slotLabel">PDF preview</div>
          <p className="muted">
            The rendered document you will read and comment on. Choose it or drop it here — or drop a saved review
            file to continue a review.
          </p>
          <button type="button" className="btn solid big" disabled={busy} onClick={async () => open(await pickFile())}>
            {busy ? 'Opening…' : 'Open PDF…'}
          </button>
          {(localError || error) && (
            <p className="warn" role="alert">
              {localError || error}
            </p>
          )}
        </div>
      </section>

      <section className="recent" aria-label="Saved reviews">
        <div className="recentHead">
          <div className="panelLabel">Saved reviews in this browser</div>
          <button type="button" className="btn ghost" disabled={busy} onClick={async () => importReviewFile(await pickJsonFile())}>
            Open review file…
          </button>
        </div>
        <p className="muted storageNote">
          Reviews autosave to {STORAGE_LOCATION}.{' '}
          {persistence === 'persistent'
            ? 'This browser has agreed to keep them.'
            : 'The browser may clear them if it runs short of space or the site goes unused (Safari: after 7 days).'}{' '}
          Use <strong>Save to file</strong> in a review to keep a copy you can reopen anywhere.
        </p>
        {imported && (
          <p className="importNote" role="status">
            Review file loaded. Click <strong>{reviews.find((r) => r.sha256 === imported)?.name}</strong> below to open
            its PDF.
          </p>
        )}
        {reviews.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <>
            <p className="muted">
              Click a file to resume its review. A revised PDF (different content) always starts an empty review.
            </p>
            <ul className="recentList">
              {reviews.map((r) => (
                <li key={r.sha256} className={r.sha256 === imported ? 'justImported' : undefined}>
                  <button
                    type="button"
                    className="recentOpen"
                    disabled={busy}
                    onClick={() => resume(r)}
                    title={`Resume the review of ${r.name}`}
                  >
                    <span className="fileName">{r.name}</span>
                    <span className="muted">
                      {' '}
                      · {r.comments} comment{r.comments === 1 ? '' : 's'} · {new Date(r.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      if (!confirm(`Delete the saved review of ${r.name}? Prompts you already copied are not affected.`)) return;
                      deleteReview(r.sha256);
                      deleteHandle(r.sha256);
                      setReviews(listReviews());
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
