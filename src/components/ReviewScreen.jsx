import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Viewer from './Viewer.jsx';
import HtmlViewer from './HtmlViewer.jsx';
import PageSidebar from './PageSidebar.jsx';
import OutlineSidebar from './OutlineSidebar.jsx';
import CommentPanel from './CommentPanel.jsx';
import ExportDialog from './ExportDialog.jsx';
import { agentComments, contentSignature, sortComments } from '../lib/exportFeedback.js';
import { ask, askAvailable, buildQuestion, closeAskSession, htmlText, openAskSession, pdfText } from '../lib/ask.js';
import { saveTextFile, watchSnapshot } from '../lib/files.js';
import { HTML_WIDTH, sectionIndexAt } from '../lib/htmlModel.js';
import { reviewFileName, serializeReview } from '../lib/reviewFile.js';
import { STORAGE_LOCATION, requestPersistence, saveReview } from '../lib/storage.js';

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
const PAGE_GUTTER = 64;

const SIDEBAR_KEY = 'local-file-reviewer:sidebar';
const LAYOUT_KEY = 'local-file-reviewer:layout';
const SPREAD_GAP = 24; // keep in sync with .spreadRow gap

// Per-browser view preferences; storage may be unavailable.
function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // convenience only
  }
}

const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100));

const SELECTION_MESSAGES = {
  'multi-page': (r) =>
    `The selection spans pages ${r.pages.join('–')}. Comments attach to one page — select the part on each page and comment separately.`,
  outside: () => 'Select text inside the document to comment on it.',
  empty: () => 'Select text first, or press R to draw a region.',
};

function isTyping(target) {
  return target.closest?.('input, textarea, select, [contenteditable="true"], dialog');
}

const pickOf = (snap) => ({ file: snap.file, handle: snap.handle });

export default function ReviewScreen({ session, onClose, onReopen }) {
  const { kind, preview, doc, html, pageSizes } = session;
  const isHtml = kind === 'html';
  const viewerRef = useRef(null);
  const zoomAnchor = useRef(null);

  const [review, setReview] = useState(session.review);
  const [mode, setMode] = useState('text');
  const [sidebarOpen, setSidebarOpen] = useState(() => readPref(SIDEBAR_KEY, 'open') !== 'closed');
  // HTML documents are one continuous page.
  const [layout, setLayout] = useState(() =>
    !isHtml && readPref(LAYOUT_KEY, 'single') === 'spread' ? 'spread' : 'single',
  );
  const [scale, setScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [draft, setDraft] = useState(null);
  const [pendingSelection, setPendingSelection] = useState(null);
  const [notice, setNotice] = useState(session.notice ?? null);
  const [activeId, setActiveId] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [restored, setRestored] = useState(session.restored ? session.review.comments.length : 0);
  const touched = useRef(Boolean(session.restored));
  const persistenceAsked = useRef(false);
  const [fileSavedAt, setFileSavedAt] = useState(null);
  // HTML only: headings, the section in view, text comments not found in the document.
  const [outline, setOutline] = useState([]);
  const [currentSection, setCurrentSection] = useState(-1);
  const [missing, setMissing] = useState(() => new Set());
  // Ask Claude: the local bridge is running, and answers being streamed, by comment id.
  const [askReady, setAskReady] = useState(false);
  const [answering, setAnswering] = useState({});
  const openAsk = useRef(null);

  const numbered = useMemo(
    () => sortComments(review.comments).map((comment, i) => ({ comment, number: i + 1 })),
    [review.comments],
  );

  /** Comments per page, or per outline section for HTML. */
  const commentCounts = useMemo(() => {
    const counts = new Map();
    for (const c of review.comments) {
      const key = isHtml ? sectionIndexAt(outline, c.rects[0][1]) : c.page;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [review.comments, isHtml, outline]);

  useEffect(() => writePref(SIDEBAR_KEY, sidebarOpen ? 'open' : 'closed'), [sidebarOpen]);
  useEffect(() => {
    if (!isHtml) writePref(LAYOUT_KEY, layout);
  }, [layout, isHtml]);

  const exported = review.lastExport?.signature === contentSignature(review);
  const hasUnexported = !exported && (agentComments(review.comments).length > 0 || review.lastExport != null);

  // ---- autosave ---------------------------------------------------------
  const update = useCallback((fn) => {
    touched.current = true;
    setReview((r) => ({ ...fn(r), updatedAt: Date.now() }));
  }, []);

  useEffect(() => {
    if (!touched.current) return;
    try {
      saveReview(review);
      setSaveError(null);
    } catch (err) {
      setSaveError(err.message || 'storage unavailable');
    }
  }, [review]);

  useEffect(() => {
    document.title = `${hasUnexported ? '● ' : ''}${preview.name} — Local File Reviewer`;
  }, [hasUnexported, preview.name]);

  useEffect(() => {
    if (!saveError) return;
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveError]);

  // ---- ask Claude ---------------------------------------------------------
  // Start this document's Claude session as soon as it opens, so the first
  // question does not wait for the process to start.
  useEffect(() => {
    let cancelled = false;
    let text = null;
    const owner = crypto.randomUUID();
    openAsk.current = async () => {
      text ??= isHtml ? htmlText(html) : await pdfText(doc);
      await openAskSession(preview.sha256, owner, preview.name, text);
    };
    (async () => {
      if (!(await askAvailable()) || cancelled) return;
      try {
        await openAsk.current();
        if (!cancelled) setAskReady(true);
      } catch (err) {
        console.error('Ask Claude unavailable:', err);
      }
    })();
    return () => {
      cancelled = true;
      closeAskSession(preview.sha256, owner);
    };
  }, [preview, isHtml, html, doc]);

  const setAnswer = (id, value) =>
    setAnswering((a) => {
      const { [id]: _, ...rest } = a;
      return value ? { ...rest, [id]: value } : rest;
    });

  /** Send a question comment to Claude and stream the answer into its card. */
  const runQuestion = async (c) => {
    let text = '';
    setAnswer(c.id, { status: 'thinking', text });
    try {
      await ask(preview.sha256, buildQuestion(c, c.comment), {
        reopen: () => openAsk.current(),
        onText: (chunk) => {
          text += chunk;
          setAnswer(c.id, { status: 'streaming', text });
        },
      });
      update((r) => ({ ...r, comments: r.comments.map((x) => (x.id === c.id ? { ...x, answer: text } : x)) }));
      setAnswer(c.id, null);
    } catch (err) {
      setAnswer(c.id, { status: 'error', text, error: err.message });
    }
  };

  // ---- file identity watch ---------------------------------------------
  useEffect(() => watchSnapshot(preview, () => setChanged(true)), [preview]);

  const continueWithSnapshot = () => {
    const at = new Date().toISOString();
    update((r) => ({
      ...r,
      warnings: [
        ...(r.warnings ?? []),
        `${preview.name} changed on disk during the review (noticed ${at}). Comments refer to the originally loaded version, sha256 ${preview.sha256}.`,
      ],
    }));
    setChanged(false);
  };

  const startOverWithChangedFile = async () => {
    if (!preview.handle) {
      onClose(`${preview.name} changed on disk. Open the new version to start a new review.`);
      return;
    }
    try {
      await onReopen({ file: await preview.handle.getFile(), handle: preview.handle }, { fresh: true });
    } catch (err) {
      onClose(`Could not reopen the changed file: ${err.message}`);
    }
  };

  // ---- zoom -------------------------------------------------------------
  const fitScale = useCallback(() => {
    const width = viewerRef.current?.viewportWidth() ?? 900;
    if (isHtml) return clampScale((width - PAGE_GUTTER) / HTML_WIDTH);
    let widest = 0;
    if (layout === 'spread') {
      for (let i = 0; i < pageSizes.length; i += 2) {
        widest = Math.max(widest, pageSizes[i].width + (pageSizes[i + 1] ? pageSizes[i + 1].width + SPREAD_GAP : 0));
      }
    } else widest = Math.max(...pageSizes.map((p) => p.width));
    return clampScale((width - PAGE_GUTTER) / widest);
  }, [pageSizes, layout, isHtml]);

  const zoomTo = useCallback((next) => {
    zoomAnchor.current = viewerRef.current?.getAnchor() ?? null;
    setPendingSelection(null);
    setScale(clampScale(next));
  }, []);

  useLayoutEffect(() => {
    setScale(Math.min(fitScale(), isHtml ? 1 : 1.25));
  }, [fitScale, isHtml]);

  useLayoutEffect(() => {
    if (!zoomAnchor.current) return;
    viewerRef.current?.restoreAnchor(zoomAnchor.current);
    // A layout change also refits the zoom in a follow-up render before paint;
    // keep the anchor until then.
    const frame = requestAnimationFrame(() => (zoomAnchor.current = null));
    return () => cancelAnimationFrame(frame);
  }, [scale, layout]);

  /** Switch between one page per row and two pages side by side, refitting the width. */
  const changeLayout = (next) => {
    if (isHtml || next === layout) return;
    zoomAnchor.current = viewerRef.current?.getAnchor() ?? null;
    setPendingSelection(null);
    setLayout(next);
  };

  // ---- page navigation --------------------------------------------------
  const onCurrentPage = useCallback((n) => {
    setCurrentPage(n);
    setPageInput(String(n));
  }, []);

  const pageStep = layout === 'spread' ? 2 : 1;

  const goToPage = (n) => {
    const page = Math.min(pageSizes.length, Math.max(1, n));
    viewerRef.current?.scrollToPage(page);
    onCurrentPage(page);
  };

  const goToSection = (i) => {
    if (outline.length === 0) return;
    const index = Math.min(outline.length - 1, Math.max(0, i));
    viewerRef.current?.scrollToSection(index);
    setCurrentSection(index);
  };

  /** Next or previous page, or section for HTML. */
  const stepPlace = (delta) => (isHtml ? goToSection(currentSection + delta) : goToPage(currentPage + delta * pageStep));

  // ---- comments ---------------------------------------------------------
  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    viewerRef.current?.clearSelection?.();
    setPendingSelection(null);
  };

  const onSelection = useCallback((result) => {
    if (result.ok) {
      setNotice(null);
      setPendingSelection(result);
    } else {
      setPendingSelection(null);
      if (result.reason === 'multi-page') setNotice(SELECTION_MESSAGES['multi-page'](result));
    }
  }, []);

  const commentOnSelection = ({ question = false } = {}) => {
    const result = pendingSelection ?? viewerRef.current?.captureSelection();
    if (!result?.ok) {
      setNotice(SELECTION_MESSAGES[result?.reason ?? 'empty'](result));
      return;
    }
    setNotice(null);
    setDraft(question ? { ...result.location, question: true } : result.location);
    clearSelection();
  };

  const askOnSelection = () => commentOnSelection({ question: true });

  const onRegion = useCallback((location) => {
    setNotice(null);
    setPendingSelection(null);
    setDraft({ ...location, selectedText: null, prefix: null, suffix: null, visualLines: null });
  }, []);

  const saveDraft = (text) => {
    const id = `c${review.nextId}`;
    const comment = { ...draft, id, comment: text, createdAt: Date.now() };
    if (draft.question) comment.answer = null;
    update((r) => ({ ...r, nextId: r.nextId + 1, comments: [...r.comments, comment] }));
    if (draft.question) runQuestion(comment);
    setDraft(null);
    setActiveId(id);
    viewerRef.current?.focus();
    // Once there is something worth keeping, ask the browser not to evict it.
    if (!persistenceAsked.current) {
      persistenceAsked.current = true;
      requestPersistence();
    }
  };

  const saveReviewFile = async () => {
    try {
      const name = reviewFileName(review);
      if (await saveTextFile(name, serializeReview(review), { description: 'Review file' })) {
        setFileSavedAt({ at: Date.now(), name, signature: contentSignature(review) });
      }
    } catch (err) {
      setNotice(`Could not save the review file: ${err.message}`);
    }
  };

  const cancelDraft = () => {
    setDraft(null);
    viewerRef.current?.focus();
  };

  const updateComment = (id, text) => {
    const c = review.comments.find((x) => x.id === id);
    // An edited question gets a new answer.
    const next = c.question ? { ...c, comment: text, answer: null } : { ...c, comment: text };
    update((r) => ({ ...r, comments: r.comments.map((x) => (x.id === id ? next : x)) }));
    if (c.question) runQuestion(next);
  };

  const retryQuestion = (id) => {
    const c = review.comments.find((x) => x.id === id);
    if (c) runQuestion(c);
  };

  const deleteComment = (id) => {
    update((r) => ({ ...r, comments: r.comments.filter((c) => c.id !== id) }));
    if (activeId === id) setActiveId(null);
    setAnswer(id, null);
  };

  const activate = useCallback(
    (id, { scrollDoc = false } = {}) => {
      setActiveId(id);
      if (!scrollDoc) return;
      const c = review.comments.find((x) => x.id === id);
      if (c) viewerRef.current?.scrollToComment(c);
    },
    [review.comments],
  );

  const step = (delta) => {
    if (numbered.length === 0) return;
    const i = numbered.findIndex((n) => n.comment.id === activeId);
    const next = i === -1 ? (delta > 0 ? 0 : numbered.length - 1) : (i + delta + numbered.length) % numbered.length;
    activate(numbered[next].comment.id, { scrollDoc: true });
  };

  const onExported = () =>
    update((r) => ({
      ...r,
      lastExport: { at: Date.now(), destination: 'clipboard', signature: contentSignature(r) },
    }));

  // ---- keyboard ---------------------------------------------------------
  const keys = useRef(null);
  keys.current = (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveReviewFile();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || exportOpen) return;
    if (e.key === 'Escape') {
      if (draft) cancelDraft();
      else if (pendingSelection) clearSelection();
      else if (mode === 'region') setMode('text');
      setNotice(null);
      return;
    }
    if (isTyping(e.target)) return;
    const actions = {
      c: () => commentOnSelection(),
      q: () => askReady && askOnSelection(),
      r: () => {
        clearSelection();
        setMode((m) => (m === 'region' ? 'text' : 'region'));
      },
      t: () => setMode('text'),
      s: () => setSidebarOpen((o) => !o),
      v: () => changeLayout(layout === 'spread' ? 'single' : 'spread'),
      '+': () => zoomTo(scale * ZOOM_STEP),
      '=': () => zoomTo(scale * ZOOM_STEP),
      '-': () => zoomTo(scale / ZOOM_STEP),
      0: () => zoomTo(fitScale()),
      j: () => step(1),
      k: () => step(-1),
      ']': () => stepPlace(1),
      '[': () => stepPlace(-1),
      e: () => setExportOpen(true),
    };
    const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  useEffect(() => {
    const handler = (e) => keys.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- render -----------------------------------------------------------
  let status;
  if (saveError) status = <span className="status bad">Autosave failed — export now ({saveError})</span>;
  else if (agentComments(review.comments).length === 0 && !review.lastExport) status = <span className="status">No comments yet</span>;
  else if (exported)
    status = (
      <span className="status ok" title="The agent prompt was copied after the last change">
        Saved · prompt copied {new Date(review.lastExport.at).toLocaleTimeString()}
      </span>
    );
  else
    status = (
      <span className="status warnText" title={`Autosaved to ${STORAGE_LOCATION}`}>
        Saved locally · <strong>prompt not copied</strong>
      </span>
    );

  return (
    <div className="review">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => onClose()} title="Close review and open another file">
          ■ <span>reviewer</span>
        </button>
        <button
          type="button"
          className={`btn seg sidebarToggle${sidebarOpen ? ' on' : ''}`}
          aria-pressed={sidebarOpen}
          aria-controls="page-sidebar"
          onClick={() => setSidebarOpen((o) => !o)}
          title={`Toggle ${isHtml ? 'outline' : 'page sidebar'} ( S )`}
        >
          {isHtml ? 'Outline' : 'Pages'} <kbd>S</kbd>
        </button>
        <div className="identityBar" aria-label="Files in this review">
          <span className="tag">{kind}</span>
          <span className="fileName" title={`sha256 ${preview.sha256}`}>{preview.name}</span>
        </div>

        <div className="tools" role="toolbar" aria-label="Document tools">
          {isHtml ? (
            <div className="group" role="group" aria-label="Section navigation">
              <button type="button" className="btn ghost sq" onClick={() => stepPlace(-1)} aria-label="Previous section" title="Previous section ( [ )">
                ‹
              </button>
              <span className="muted sectionName" title={outline[currentSection]?.text}>
                {outline[currentSection]?.text ?? (outline.length ? 'Top of document' : 'No headings')}
              </span>
              <button type="button" className="btn ghost sq" onClick={() => stepPlace(1)} aria-label="Next section" title="Next section ( ] )">
                ›
              </button>
            </div>
          ) : (
            <div className="group" role="group" aria-label="Page navigation">
              <button type="button" className="btn ghost sq" onClick={() => goToPage(currentPage - pageStep)} aria-label="Previous page" title="Previous page ( [ )">
                ‹
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  goToPage(Number(pageInput) || 1);
                  // Hand focus back to the document so single-key shortcuts work again.
                  viewerRef.current?.focus();
                }}
              >
                <input
                  className="pageInput"
                  value={pageInput}
                  inputMode="numeric"
                  aria-label="Page number"
                  onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
                  onBlur={() => setPageInput(String(currentPage))}
                />
              </form>
              <span className="muted">/ {pageSizes.length}</span>
              <button type="button" className="btn ghost sq" onClick={() => goToPage(currentPage + pageStep)} aria-label="Next page" title="Next page ( ] )">
                ›
              </button>
            </div>
          )}

          <div className="group" role="group" aria-label="Zoom">
            <button type="button" className="btn ghost sq" onClick={() => zoomTo(scale / ZOOM_STEP)} aria-label="Zoom out" title="Zoom out ( - )">
              −
            </button>
            <button type="button" className="btn ghost zoomLabel" onClick={() => zoomTo(fitScale())} title="Fit width ( 0 )">
              {Math.round(scale * 100)}%
            </button>
            <button type="button" className="btn ghost sq" onClick={() => zoomTo(scale * ZOOM_STEP)} aria-label="Zoom in" title="Zoom in ( + )">
              +
            </button>
          </div>

          {!isHtml && (
            <div className="group segmented" role="radiogroup" aria-label="Page layout">
              <button
                type="button"
                role="radio"
                aria-checked={layout === 'single'}
                aria-label="One page per row"
                className={`btn seg${layout === 'single' ? ' on' : ''}`}
                onClick={() => changeLayout('single')}
                title="One page per row ( V )"
              >
                <span className="layoutIcon" aria-hidden="true">
                  <i />
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={layout === 'spread'}
                aria-label="Two pages side by side"
                className={`btn seg${layout === 'spread' ? ' on' : ''}`}
                onClick={() => changeLayout('spread')}
                title="Two pages side by side ( V )"
              >
                <span className="layoutIcon" aria-hidden="true">
                  <i />
                  <i />
                </span>
              </button>
            </div>
          )}

          <div className="group segmented" role="radiogroup" aria-label="Comment tool">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'text'}
              className={`btn seg${mode === 'text' ? ' on' : ''}`}
              onClick={() => setMode('text')}
              title="Select text ( T )"
            >
              Text <kbd>T</kbd>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'region'}
              className={`btn seg${mode === 'region' ? ' on' : ''}`}
              onClick={() => {
                clearSelection();
                setMode('region');
              }}
              title="Draw a region ( R )"
            >
              Region <kbd>R</kbd>
            </button>
          </div>
        </div>

        <div className="exportArea">
          {status}
          <button
            type="button"
            className="btn ghost"
            onClick={saveReviewFile}
            title={
              fileSavedAt
                ? `Last saved as ${fileSavedAt.name} at ${new Date(fileSavedAt.at).toLocaleTimeString()}`
                : 'Save a copy of this review to a file you keep ( ⌘/Ctrl+S )'
            }
          >
            {fileSavedAt?.signature === contentSignature(review) ? '✓ Saved to file' : 'Save to file'}
          </button>
          <button type="button" className="btn solid" onClick={() => setExportOpen(true)} title="Build the prompt for your agent ( E )">
            Agent prompt <kbd>E</kbd>
          </button>
        </div>
      </header>

      {changed && (
        <div className="banner danger" role="alert">
          <p>
            <strong>{preview.name} changed on disk.</strong> Comments are not moved to the
            new content. Start a new review of the changed file, or keep reviewing the version loaded earlier.
          </p>
          <div className="bannerActions">
            <button type="button" className="btn solid" onClick={startOverWithChangedFile}>
              Start new review
            </button>
            <button type="button" className="btn ghost" onClick={continueWithSnapshot}>
              Keep reviewing loaded snapshot
            </button>
          </div>
        </div>
      )}
      {restored > 0 && (
        <div className="banner" role="status">
          <p>
            Restored {restored} autosaved comment{restored === 1 ? '' : 's'} for this exact {isHtml ? 'file' : 'PDF'}.
          </p>
          <div className="bannerActions">
            <button type="button" className="btn ghost" onClick={() => setRestored(0)}>
              OK
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (confirm(`Discard the autosaved comments and start an empty review of this ${isHtml ? 'file' : 'PDF'}?`))
                  onReopen(pickOf(preview), { fresh: true });
              }}
            >
              Start empty instead
            </button>
          </div>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          <p>{notice}</p>
          <div className="bannerActions">
            <button type="button" className="btn ghost" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div
        className="workspace"
        onScrollCapture={() => {
          // Keep the floating "Add comment" button next to the selection.
          if (!pendingSelection) return;
          const result = viewerRef.current?.captureSelection();
          setPendingSelection(result?.ok ? result : null);
        }}
      >
        {sidebarOpen &&
          (isHtml ? (
            <OutlineSidebar
              outline={outline}
              current={currentSection}
              commentCounts={commentCounts}
              onGoTo={goToSection}
            />
          ) : (
            <PageSidebar
              doc={doc}
              pageSizes={pageSizes}
              currentPage={currentPage}
              commentCounts={commentCounts}
              onGoTo={goToPage}
            />
          ))}
        {isHtml ? (
          <HtmlViewer
            ref={viewerRef}
            html={html}
            scale={scale}
            mode={mode}
            numbered={numbered}
            draft={draft}
            activeId={activeId}
            onSelection={onSelection}
            onActivate={activate}
            onRegion={onRegion}
            onOutline={setOutline}
            onCurrentSection={setCurrentSection}
            onMissing={setMissing}
          />
        ) : (
          <Viewer
            ref={viewerRef}
            doc={doc}
            pageSizes={pageSizes}
            scale={scale}
            layout={layout}
            mode={mode}
            numbered={numbered}
            draft={draft}
            activeId={activeId}
            onCurrentPage={onCurrentPage}
            onSelection={onSelection}
            onActivate={activate}
            onRegion={onRegion}
          />
        )}
        <CommentPanel
          kind={kind}
          missing={missing}
          numbered={numbered}
          draft={draft}
          activeId={activeId}
          onSaveDraft={saveDraft}
          onCancelDraft={cancelDraft}
          onActivate={activate}
          onUpdate={updateComment}
          onDelete={deleteComment}
          answering={answering}
          onRetry={retryQuestion}
        />
      </div>

      <footer className="keys" aria-label="Keyboard shortcuts">
        <span><kbd>C</kbd> comment on selection</span>
        {askReady && <span><kbd>Q</kbd> ask Claude</span>}
        <span><kbd>R</kbd> region mode</span>
        <span><kbd>S</kbd> {isHtml ? 'outline' : 'page sidebar'}</span>
        {!isHtml && <span><kbd>V</kbd> 1 or 2 pages</span>}
        <span><kbd>J</kbd>/<kbd>K</kbd> next/prev comment</span>
        <span><kbd>[</kbd>/<kbd>]</kbd> {isHtml ? 'section' : 'page'}</span>
        <span><kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> zoom</span>
        <span><kbd>E</kbd> agent prompt</span>
        <span><kbd>⌘S</kbd> save to file</span>
        <span className="muted right">Autosave: {STORAGE_LOCATION}</span>
      </footer>

      {pendingSelection && !draft && (
        <div
          className="selectionActions"
          style={{
            left: Math.min(pendingSelection.anchor.x, window.innerWidth - (askReady ? 340 : 180)),
            top: Math.min(pendingSelection.anchor.y + 8, window.innerHeight - 48),
          }}
          // Keep the text selection alive while clicking.
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" className="selectionAction" onClick={() => commentOnSelection()}>
            + Add comment <kbd>C</kbd>
          </button>
          {askReady && (
            <button type="button" className="selectionAction" onClick={askOnSelection}>
              ? Ask Claude <kbd>Q</kbd>
            </button>
          )}
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        review={review}
        pageCount={isHtml ? null : pageSizes.length}
        missing={missing}
        blocked={changed}
        onClose={() => setExportOpen(false)}
        onExported={onExported}
      />
    </div>
  );
}
