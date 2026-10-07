import { useState } from 'react';
import StartScreen from './components/StartScreen.jsx';
import ReviewScreen from './components/ReviewScreen.jsx';
import { isHtml, snapshot } from './lib/files.js';
import { saveHandle } from './lib/handles.js';
import { loadPdf } from './lib/pdf.js';
import { loadReview } from './lib/storage.js';

function newReview(preview, kind) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    kind,
    preview: { name: preview.name, size: preview.size, sha256: preview.sha256 },
    comments: [],
    nextId: 1,
    warnings: [],
    createdAt: now,
    updatedAt: now,
    lastExport: null,
  };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /**
   * @param {{file: File, handle?: FileSystemFileHandle}} pick a PDF or HTML file
   * @param {{fresh?: boolean, expectSha?: string}} options
   *   fresh: ignore any autosaved review of this file
   *   expectSha: the review the user meant to resume; warn if the file no longer matches it
   */
  const start = async (pick, { fresh = false, expectSha = null } = {}) => {
    const kind = isHtml(pick.file) ? 'html' : 'pdf';
    setBusy(true);
    setError(null);
    try {
      const preview = await snapshot(pick.file, pick.handle);
      let doc = null;
      let html = null;
      const pageSizes = [];
      if (kind === 'html') {
        html = new TextDecoder().decode(preview.bytes);
      } else {
        doc = await loadPdf(preview.bytes);
        for (let i = 1; i <= doc.numPages; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
          pageSizes.push({ width: vp.width, height: vp.height });
        }
      }
      await saveHandle(preview.sha256, preview.handle);
      const saved = fresh ? null : loadReview(preview.sha256);
      // Reviews saved before HTML support have no kind: they are PDF reviews.
      const review = saved ? { ...saved, kind: saved.kind ?? 'pdf' } : newReview(preview, kind);
      const notice =
        expectSha && expectSha !== preview.sha256
          ? `${preview.name} has changed since that review was saved, so this is a new, empty review. The old review is still listed on the start screen.`
          : null;
      session?.doc?.destroy();
      setSession({ key: crypto.randomUUID(), kind, preview, doc, html, pageSizes, review, restored: saved, notice });
    } catch (err) {
      console.error(err);
      setError(`Could not open the ${kind === 'html' ? 'HTML file' : 'PDF'}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const close = (message = null) => {
    session?.doc?.destroy();
    setSession(null);
    setError(message);
    document.title = 'Local File Reviewer';
  };

  if (!session) return <StartScreen onStart={start} busy={busy} error={error} />;
  return <ReviewScreen key={session.key} session={session} onClose={close} onReopen={start} />;
}
