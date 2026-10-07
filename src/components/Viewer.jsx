import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import PageView from './PageView.jsx';
import { locationFromRange } from '../lib/selection.js';

/**
 * Scrollable document surface. Exposes imperative navigation through `ref`:
 *   scrollToPage(n), scrollToRect(page, rect), scrollToComment(c), captureSelection(),
 *   clearSelection(), viewportWidth()
 */
export default function Viewer({
  ref,
  doc,
  pageSizes,
  scale,
  layout = 'single',
  mode,
  numbered,
  draft,
  activeId,
  onCurrentPage,
  onSelection,
  onActivate,
  onRegion,
}) {
  const scrollRef = useRef(null);
  const pagesRef = useRef(null);
  const pageEls = useRef(new Map());
  const models = useRef(new Map());

  const registerElement = useCallback((n, el) => {
    if (el) pageEls.current.set(n, el);
    else pageEls.current.delete(n);
  }, []);
  const onModel = useCallback((n, model) => models.current.set(n, model), []);

  // Pages that share a row (two in the spread layout) share an offsetTop; the
  // leftmost one stands for the row.
  const rowLeaders = () => {
    const out = [];
    let lastTop = -Infinity;
    for (const el of pagesRef.current.querySelectorAll('.page')) {
      if (el.offsetTop > lastTop) out.push(el);
      lastTop = el.offsetTop;
    }
    return out;
  };

  const rows = useMemo(() => {
    const perRow = layout === 'spread' ? 2 : 1;
    const out = [];
    for (let i = 0; i < pageSizes.length; i += perRow) {
      out.push(pageSizes.slice(i, i + perRow).map((size, j) => ({ size, pageNumber: i + j + 1 })));
    }
    return out;
  }, [pageSizes, layout]);

  const markersByPage = useMemo(() => {
    const map = new Map();
    for (const m of numbered) {
      if (!map.has(m.comment.page)) map.set(m.comment.page, []);
      map.get(m.comment.page).push(m);
    }
    return map;
  }, [numbered]);

  const captureSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { ok: false, reason: 'empty' };
    const range = sel.getRangeAt(0);
    if (!pagesRef.current.contains(range.commonAncestorContainer)) return { ok: false, reason: 'outside' };
    const result = locationFromRange(range, pagesRef.current, (n) => models.current.get(n));
    if (result.ok) {
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      result.anchor = { x: last.right, y: last.bottom };
    }
    return result;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(n, behavior = 'smooth') {
        const el = pageEls.current.get(n) ?? pagesRef.current.querySelector(`[data-page-number="${n}"]`);
        el?.scrollIntoView({ behavior, block: 'start' });
      },
      scrollToComment(c) {
        this.scrollToRect(c.page, c.rects[0]);
      },
      scrollToRect(page, rect) {
        const el = pagesRef.current.querySelector(`[data-page-number="${page}"]`);
        if (!el) return;
        const box = scrollRef.current.getBoundingClientRect();
        const target =
          el.offsetTop + rect[1] * el.offsetHeight - box.height / 3;
        scrollRef.current.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      },
      captureSelection,
      clearSelection: () => window.getSelection()?.removeAllRanges(),
      viewportWidth: () => scrollRef.current.clientWidth,
      // preventScroll: a plain focus() cancels an in-flight smooth scroll.
      focus: () => scrollRef.current.focus({ preventScroll: true }),
      /** Position of the viewport top as (page, fraction of that page). */
      getAnchor() {
        const top = scrollRef.current.scrollTop;
        let anchor = { page: 1, fraction: 0 };
        for (const el of rowLeaders()) {
          if (el.offsetTop > top) break;
          anchor = { page: Number(el.dataset.pageNumber), fraction: (top - el.offsetTop) / el.offsetHeight };
        }
        return anchor;
      },
      restoreAnchor({ page, fraction }) {
        const el = pagesRef.current.querySelector(`[data-page-number="${page}"]`);
        if (el) scrollRef.current.scrollTop = el.offsetTop + fraction * el.offsetHeight;
      },
    }),
    [captureSelection],
  );

  // Track the page nearest the top third of the viewport.
  useEffect(() => {
    const el = scrollRef.current;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const probe = el.scrollTop + el.clientHeight / 3;
        let current = 1;
        for (const page of rowLeaders()) {
          if (page.offsetTop <= probe) current = Number(page.dataset.pageNumber);
          else break;
        }
        onCurrentPage(current);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [onCurrentPage]);

  const onMouseUp = () => {
    if (mode !== 'text') return;
    // Let the browser finish updating the selection first.
    setTimeout(() => onSelection(captureSelection()), 0);
  };

  return (
    <div
      ref={scrollRef}
      className="viewer"
      tabIndex={0}
      aria-label="Document. Scroll with arrow keys and Page Up/Down."
      onMouseUp={onMouseUp}
      onKeyUp={(e) => e.shiftKey && onMouseUp()}
    >
      <div ref={pagesRef} className={`pages ${layout}`}>
        {scale &&
          rows.map((row) => (
            <div key={row[0].pageNumber} className="spreadRow">
              {row.map(({ size, pageNumber }) => (
                <PageView
                  key={pageNumber}
                  doc={doc}
                  pageNumber={pageNumber}
                  size={size}
                  scale={scale}
                  mode={mode}
                  markers={markersByPage.get(pageNumber) ?? EMPTY}
                  draft={draft?.page === pageNumber ? draft : null}
                  activeId={activeId}
                  onModel={onModel}
                  onActivate={onActivate}
                  onRegion={onRegion}
                  registerElement={registerElement}
                />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

const EMPTY = [];
