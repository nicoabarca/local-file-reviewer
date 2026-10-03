import { memo, useEffect, useRef, useState } from 'react';

const THUMB_WIDTH = 112;

/** A page thumbnail, rendered only once it scrolls near the sidebar viewport. */
const Thumb = memo(function Thumb({ doc, pageNumber, size, root }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const scale = THUMB_WIDTH / size.width;

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      root: root.current,
      rootMargin: '400px 0px',
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    let task = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = ref.current;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      task = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        annotationMode: 0,
      });
      await task.promise;
    })().catch((err) => {
      if (err?.name !== 'RenderingCancelledException') console.error(`Thumbnail ${pageNumber} failed`, err);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, scale, visible]);

  return (
    <canvas
      ref={ref}
      className="thumbCanvas"
      style={{ width: THUMB_WIDTH, height: size.height * scale }}
      aria-hidden="true"
    />
  );
});

export default function PageSidebar({ doc, pageSizes, currentPage, commentCounts, onGoTo }) {
  const scrollRef = useRef(null);
  const itemRefs = useRef([]);

  // Keep the current page's thumbnail in view as the document scrolls.
  useEffect(() => {
    itemRefs.current[currentPage - 1]?.scrollIntoView({ block: 'nearest' });
  }, [currentPage]);

  return (
    <nav ref={scrollRef} id="page-sidebar" className="sidebar" aria-label="Pages">
      <div className="panelLabel sticky">
        Pages <span className="count">{pageSizes.length}</span>
      </div>
      <ol className="thumbs">
        {pageSizes.map((size, i) => {
          const n = i + 1;
          const count = commentCounts.get(n) ?? 0;
          return (
            <li key={n} ref={(el) => (itemRefs.current[i] = el)}>
              <button
                type="button"
                className={`thumb${n === currentPage ? ' current' : ''}`}
                aria-current={n === currentPage ? 'page' : undefined}
                aria-label={`Page ${n}${count ? `, ${count} comment${count === 1 ? '' : 's'}` : ''}`}
                onClick={() => onGoTo(n)}
              >
                <Thumb doc={doc} pageNumber={n} size={size} root={scrollRef} />
                <span className="thumbLabel">
                  {String(n).padStart(2, '0')}
                  {count > 0 && <span className="thumbCount">{count}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
