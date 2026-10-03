import { useState } from 'react';
import StartScreen from './components/StartScreen.jsx';
import ReviewScreen from './components/ReviewScreen.jsx';
import { snapshot } from './lib/files.js';
import { saveHandle } from './lib/handles.js';
import { loadPdf } from './lib/pdf.js';
import { loadReview } from './lib/storage.js';

function newReview(preview) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
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
   * @param {{file: File, handle?: FileSystemFileHandle}} pdfPick
   * @param {{fresh?: boolean, expectSha?: string}} options
   *   fresh: ignore any autosaved review of this PDF
   *   expectSha: the review the user meant to resume; warn if the file no longer matches it
   */
  const start = async (pdfPick, { fresh = false, expectSha = null } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const preview = await snapshot(pdfPick.file, pdfPick.handle);
      const doc = await loadPdf(preview.bytes);
      const pageSizes = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
        pageSizes.push({ width: vp.width, height: vp.height });
      }
      await saveHandle(preview.sha256, preview.handle);
      const saved = fresh ? null : loadReview(preview.sha256);
      const review = saved ?? newReview(preview);
      const notice =
        expectSha && expectSha !== preview.sha256
          ? `${preview.name} has changed since that review was saved, so this is a new, empty review. The old review is still listed on the start screen.`
          : null;
      session?.doc.destroy();
      setSession({ key: crypto.randomUUID(), preview, doc, pageSizes, review, restored: saved, notice });
    } catch (err) {
      console.error(err);
      setError(`Could not open the PDF: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const close = (message = null) => {
    session?.doc.destroy();
    setSession(null);
    setError(message);
    document.title = 'Local File Reviewer';
  };

  if (!session) return <StartScreen onStart={start} busy={busy} error={error} />;
  return <ReviewScreen key={session.key} session={session} onClose={close} onReopen={start} />;
}
