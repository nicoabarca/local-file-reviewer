import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import RegionLayer from './RegionLayer.jsx';
import {
  HTML_WIDTH,
  elementIdOf,
  findQuote,
  headingPathOf,
  modelFromDocument,
  outlineOf,
  quoteAt,
  rectsForSpan,
  sectionIndexAt,
  spanForRange,
} from '../lib/htmlModel.js';

const FRAME_URL = `${import.meta.env.BASE_URL}frame.html`;
const INITIAL_HEIGHT = 800;
const MEASURE_DELAY = 150;
// A document sized in viewport units grows each time the frame does. After
// this many identical growth steps the frame stops following it.
const MAX_FEEDBACK_STEPS = 3;

const px = ([l, t, r, b]) => ({ left: l, top: t, width: r - l, height: b - t });

function isTypingIn(target) {
  return target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

/**
 * Scrollable HTML document surface. The file is written into a same-origin
 * frame served with its own permissive CSP, so its scripts and remote
 * resources run, at a fixed width of HTML_WIDTH. The frame grows to the full
 * document height and the viewer scrolls it; zoom scales the frame.
 *
 * Imperative API through `ref`, matching Viewer where it can:
 *   captureSelection(), clearSelection(), scrollToComment(c), scrollToSection(i),
 *   viewportWidth(), focus(), getAnchor(), restoreAnchor(a)
 */
export default function HtmlViewer({
  ref,
  html,
  scale,
  mode,
  numbered,
  draft,
  activeId,
  onSelection,
  onActivate,
  onRegion,
  onOutline,
  onCurrentSection,
  onMissing,
}) {
  const scrollRef = useRef(null);
  const pageRef = useRef(null);
  const frameRef = useRef(null);
  const frame = useRef(null); // { doc, win, model, outline }
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const heightRef = useRef(INITIAL_HEIGHT);
  const growth = useRef({ step: 0, count: 0 });
  const [live, setLive] = useState(() => new Map()); // text comment id -> rects found in the document
  const liveRef = useRef(live);
  liveRef.current = live;
  const outlineKey = useRef('');

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const commentsRef = useRef(numbered);
  commentsRef.current = numbered;
  const callbacks = useRef(null);
  callbacks.current = { onSelection, onOutline, onCurrentSection, onMissing };

  // ---- coordinates ------------------------------------------------------
  /** Scroll offset of the document's top edge inside the viewer. */
  const surfaceTop = () => pageRef.current?.offsetTop ?? 0;

  const scrollToDocY = useCallback((y, behavior = 'smooth') => {
    const el = scrollRef.current;
    const top = surfaceTop() + y * scaleRef.current - el.clientHeight / 3;
    el.scrollTo({ top: Math.max(0, top), behavior });
  }, []);

  /** Frame client coordinates to window coordinates. */
  const toWindow = (x, y) => {
    const box = frameRef.current.getBoundingClientRect();
    return { x: box.left + x * scaleRef.current, y: box.top + y * scaleRef.current };
  };

  /** Report the section nearest the top third of the viewport. */
  const reportSection = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = (el.scrollTop + el.clientHeight / 3 - surfaceTop()) / scaleRef.current;
    callbacks.current.onCurrentSection(sectionIndexAt(frame.current?.outline ?? [], y));
  }, []);

  // ---- document model ---------------------------------------------------
  const reanchor = useCallback(() => {
    const f = frame.current;
    if (!f) return;
    f.model = modelFromDocument(f.doc);
    f.outline = outlineOf(f.doc);

    const outline = f.outline.map(({ level, text, top }) => ({ level, text, top }));
    const key = JSON.stringify(outline);
    if (key !== outlineKey.current) {
      outlineKey.current = key;
      callbacks.current.onOutline(outline);
      reportSection();
    }

    const found = new Map();
    const missing = new Set();
    for (const { comment: c } of commentsRef.current) {
      if (c.type !== 'text') continue;
      const span = findQuote(f.model.text, c);
      const rects = span ? rectsForSpan(f.model, span.from, span.to) : [];
      if (rects.length) found.set(c.id, rects);
      else missing.add(c.id);
    }
    setLive(found);
    callbacks.current.onMissing(missing);
  }, [reportSection]);

  const measure = useCallback(() => {
    const f = frame.current;
    if (!f) return;
    const root = f.doc.documentElement;
    const body = f.doc.body;
    let next = root.getBoundingClientRect().height;
    if (body) {
      const margin = parseFloat(f.win.getComputedStyle(body).marginBottom) || 0;
      next = Math.max(next, body.getBoundingClientRect().bottom + f.win.scrollY + margin, body.scrollHeight);
    }
    next = Math.max(1, Math.ceil(next));
    const current = heightRef.current;
    if (next > current) {
      const step = next - current;
      const g = growth.current;
      g.count = step === g.step ? g.count + 1 : 1;
      g.step = step;
      if (g.count > MAX_FEEDBACK_STEPS) next = current;
    }
    if (next !== current) {
      heightRef.current = next;
      setHeight(next);
    }
    reanchor();
  }, [reanchor]);

  const timer = useRef(0);
  const scheduleMeasure = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(measure, MEASURE_DELAY);
  }, [measure]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Re-find text comments when the list changes (a comment was added or removed).
  useEffect(() => {
    if (frame.current) reanchor();
  }, [numbered, reanchor]);

  // ---- selection --------------------------------------------------------
  const captureSelection = useCallback(() => {
    const f = frame.current;
    if (!f) return { ok: false, reason: 'empty' };
    const sel = f.win.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { ok: false, reason: 'empty' };
    const range = sel.getRangeAt(0);

    let span = f.model && spanForRange(f.model, range);
    if (!span) {
      // Scripts may have replaced text since the model was built.
      f.model = modelFromDocument(f.doc);
      f.outline = outlineOf(f.doc);
      span = spanForRange(f.model, range);
    }
    if (!span) return { ok: false, reason: 'outside' };
    const rects = rectsForSpan(f.model, span.from, span.to);
    if (!rects.length) return { ok: false, reason: 'outside' };

    const { model, outline } = f;
    const startNode = model.nodes[model.charChunk[span.from]];
    const endNode = model.nodes[model.charChunk[span.to - 1]];
    const headingPath = headingPathOf(outline, startNode);
    const endPath = headingPathOf(outline, endNode);
    const continuesInto =
      endPath.length && endPath.join('\n') !== headingPath.join('\n') ? endPath[endPath.length - 1] : null;

    const clientRects = range.getClientRects();
    const last = clientRects[clientRects.length - 1] ?? range.getBoundingClientRect();
    return {
      ok: true,
      location: {
        type: 'text',
        page: 1,
        rects,
        ...quoteAt(model.text, span.from, span.to),
        visualLines: null,
        headingPath,
        elementId: elementIdOf(startNode),
        continuesInto,
      },
      anchor: toWindow(last.right, last.bottom),
    };
  }, []);

  // ---- frame setup ------------------------------------------------------
  const written = useRef(false);
  const observers = useRef([]);

  useEffect(
    () => () => {
      for (const o of observers.current) o.disconnect();
    },
    [],
  );

  const onFrameLoad = () => {
    // Writing the document fires load again; write only once.
    if (written.current) return;
    written.current = true;
    const win = frameRef.current.contentWindow;
    const doc = win.document;
    doc.open();
    doc.write(html);
    doc.close();
    frame.current = { doc, win, model: null, outline: [] };

    const selectionDone = () => {
      if (modeRef.current !== 'text') return;
      // Let the browser finish updating the selection first.
      setTimeout(() => callbacks.current.onSelection(captureSelection()), 0);
    };
    doc.addEventListener('mouseup', selectionDone);
    doc.addEventListener('keyup', (e) => e.shiftKey && selectionDone());

    // Shortcuts typed while the document has focus reach the review screen.
    doc.addEventListener('keydown', (e) => {
      if (isTypingIn(e.target)) return;
      const copy = new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        bubbles: true,
        cancelable: true,
      });
      if (!window.dispatchEvent(copy)) e.preventDefault();
    });

    // In-document links scroll the viewer; other links open in a new tab.
    doc.addEventListener(
      'click',
      (e) => {
        const a = e.target.closest?.('a[href]');
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href.startsWith('#')) {
          const id = decodeURIComponent(href.slice(1));
          const target = id ? (doc.getElementById(id) ?? doc.getElementsByName(id)[0]) : null;
          scrollToDocY(target ? target.getBoundingClientRect().top + win.scrollY : 0);
          return;
        }
        let url;
        try {
          url = new URL(href, doc.baseURI);
        } catch {
          return;
        }
        if (['http:', 'https:', 'mailto:'].includes(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer');
      },
      true,
    );

    const ro = new win.ResizeObserver(scheduleMeasure);
    ro.observe(doc.documentElement);
    if (doc.body) ro.observe(doc.body);
    observers.current.push(ro);
    win.addEventListener('load', scheduleMeasure);
    doc.fonts?.ready.then(scheduleMeasure);
    measure();
  };

  // ---- navigation -------------------------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      captureSelection,
      clearSelection: () => frame.current?.win.getSelection()?.removeAllRanges(),
      scrollToComment(c) {
        const rect = liveRef.current.get(c.id)?.[0] ?? c.rects[0];
        scrollToDocY(rect[1]);
      },
      scrollToSection(i) {
        const h = frame.current?.outline[i];
        if (h) scrollToDocY(h.top);
      },
      viewportWidth: () => scrollRef.current.clientWidth,
      focus: () => scrollRef.current.focus({ preventScroll: true }),
      /** Document y at the top of the viewport, in unscaled pixels. */
      getAnchor: () => ({ y: (scrollRef.current.scrollTop - surfaceTop()) / scaleRef.current }),
      restoreAnchor({ y }) {
        scrollRef.current.scrollTop = surfaceTop() + y * scaleRef.current;
      },
    }),
    [captureSelection, scrollToDocY],
  );

  // Track the section nearest the top third of the viewport.
  useEffect(() => {
    const el = scrollRef.current;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reportSection);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [reportSection]);

  // ---- region tool ------------------------------------------------------
  const regionDone = useCallback(
    ({ rects: [[l, t, r, b]] }) => {
      const H = heightRef.current;
      const rect = [l * HTML_WIDTH, t * H, r * HTML_WIDTH, b * H].map(Math.round);
      const f = frame.current;
      const cx = (rect[0] + rect[2]) / 2 - (f?.win.scrollX ?? 0);
      const cy = (rect[1] + rect[3]) / 2 - (f?.win.scrollY ?? 0);
      const el = f?.doc.elementFromPoint(cx, cy) ?? null;
      onRegion({
        type: 'region',
        page: 1,
        rects: [rect],
        headingPath: el ? headingPathOf(f.outline, el) : [],
        elementId: elementIdOf(el),
      });
    },
    [onRegion],
  );

  const initialRegion = () => {
    const H = heightRef.current;
    const el = scrollRef.current;
    const top = Math.max(0, (el.scrollTop - surfaceTop()) / scale + el.clientHeight / scale / 3);
    return [0.3, Math.min(top, H - 200) / H, 0.7, Math.min(top + 200, H) / H];
  };

  // ---- render -----------------------------------------------------------
  const markers = [];
  for (const m of numbered) {
    const rects = m.comment.type === 'text' ? live.get(m.comment.id) : m.comment.rects;
    if (rects) markers.push({ ...m, rects });
  }

  return (
    <div
      ref={scrollRef}
      className="viewer"
      tabIndex={0}
      aria-label="Document. Scroll with arrow keys and Page Up/Down."
    >
      <div className="pages single">
        <section
          ref={pageRef}
          className="page"
          aria-label="HTML document"
          style={{ width: HTML_WIDTH * scale, height: height * scale }}
        >
          <div
            className={`pageSurface htmlSurface mode-${mode}`}
            style={{ width: HTML_WIDTH, height, transform: `scale(${scale})` }}
          >
            <iframe
              ref={frameRef}
              className="htmlFrame"
              title="Reviewed HTML document"
              src={FRAME_URL}
              sandbox="allow-scripts allow-same-origin allow-modals allow-downloads"
              style={{ width: HTML_WIDTH, height }}
              onLoad={onFrameLoad}
            />
            <div className="markerLayer">
              {markers.map((m) => (
                <Marker key={m.comment.id} marker={m} active={m.comment.id === activeId} onActivate={onActivate} />
              ))}
              {draft &&
                draft.rects.map((r, i) => <div key={i} className={`mark draft ${draft.type}`} style={px(r)} />)}
            </div>
            {mode === 'region' && (
              <RegionLayer
                pageNumber={1}
                label="Document"
                onRegion={regionDone}
                minSize={[8 / HTML_WIDTH, 8 / height]}
                step={[16 / HTML_WIDTH, 16 / height]}
                initialBox={initialRegion}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Marker({ marker, active, onActivate }) {
  const { comment, number, rects } = marker;
  const [first] = rects;
  return (
    <>
      {rects.map((r, i) => (
        <div key={i} className={`mark ${comment.type}${active ? ' active' : ''}`} style={px(r)} />
      ))}
      <button
        type="button"
        className={`markTag${active ? ' active' : ''}`}
        style={{ left: first[0], top: first[1] }}
        onClick={() => onActivate(comment.id, { scrollList: true })}
        aria-label={`Comment ${number}`}
        tabIndex={-1}
      >
        {number}
      </button>
    </>
  );
}
