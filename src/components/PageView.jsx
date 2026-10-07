import { memo, useEffect, useRef, useState } from 'react';
import { TextLayer, Util } from '../lib/pdf.js';
import { buildPageModel } from '../lib/pageModel.js';
import RegionLayer from './RegionLayer.jsx';

const pct = (v) => `${v * 100}%`;

function rectStyle([l, t, r, b]) {
  return { left: pct(l), top: pct(t), width: pct(r - l), height: pct(b - t) };
}

/** One PDF page: canvas, selectable text layer, comment markers, region tool. */
function PageView({
  doc,
  pageNumber,
  size,
  scale,
  mode,
  markers,
  draft,
  activeId,
  onModel,
  onActivate,
  onRegion,
  registerElement,
}) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [hasText, setHasText] = useState(null);
  const textContentRef = useRef(null);

  useEffect(() => {
    registerElement(pageNumber, rootRef.current);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      rootMargin: '800px 0px',
    });
    io.observe(rootRef.current);
    return () => {
      io.disconnect();
      registerElement(pageNumber, null);
    };
  }, [pageNumber, registerElement]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask = null;
    let textLayer = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      renderTask = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        annotationMode: 0, // draw page content only; no links, forms or scripts
      });

      if (!textContentRef.current) {
        textContentRef.current = await page.getTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        });
        if (cancelled) return;
        const model = buildPageModel(
          textContentRef.current.items,
          page.getViewport({ scale: 1 }),
          Util.transform,
        );
        setHasText(model.items.some((s) => s.trim()));
        onModel(pageNumber, model);
      }

      const container = textRef.current;
      container.replaceChildren();
      textLayer = new TextLayer({ textContentSource: textContentRef.current, container, viewport });
      await textLayer.render();
      if (cancelled) return;
      textLayer.textDivs.forEach((div, i) => {
        div.dataset.idx = String(i);
      });
      const end = document.createElement('div');
      end.className = 'endOfContent';
      container.append(end);

      await renderTask.promise.catch((err) => {
        if (err?.name !== 'RenderingCancelledException') throw err;
      });
    })().catch((err) => console.error(`Page ${pageNumber} failed to render`, err));

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [doc, pageNumber, scale, visible, onModel]);

  const w = size.width * scale;
  const h = size.height * scale;

  return (
    <section
      ref={rootRef}
      className="page"
      data-page-number={pageNumber}
      aria-label={`Page ${pageNumber}`}
      style={{ width: w, height: h }}
    >
      <div
        className={`pageSurface mode-${mode}`}
        style={{
          '--scale-factor': scale,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        }}
      >
        <canvas ref={canvasRef} className="pageCanvas" aria-hidden="true" />
        <div
          ref={textRef}
          className="textLayer"
          onMouseDown={(e) => e.currentTarget.classList.add('selecting')}
          onMouseUp={(e) => e.currentTarget.classList.remove('selecting')}
        />
        <div className="markerLayer">
          {markers.map((m) => (
            <Marker key={m.comment.id} marker={m} active={m.comment.id === activeId} onActivate={onActivate} />
          ))}
          {draft && draft.page === pageNumber &&
            draft.rects.map((r, i) => (
              <div key={i} className={`mark draft ${draft.type}`} style={rectStyle(r)} />
            ))}
        </div>
        {mode === 'region' && <RegionLayer pageNumber={pageNumber} onRegion={onRegion} />}
      </div>
      <div className="pageLabel" aria-hidden="true">
        {String(pageNumber).padStart(2, '0')}
        {hasText === false && <span className="noText"> · no selectable text — use region (R)</span>}
      </div>
    </section>
  );
}

function Marker({ marker, active, onActivate }) {
  const { comment, number } = marker;
  const [first] = comment.rects;
  return (
    <>
      {comment.rects.map((r, i) => (
        <div
          key={i}
          className={`mark ${comment.type}${comment.question ? ' question' : ''}${active ? ' active' : ''}`}
          style={rectStyle(r)}
        />
      ))}
      <button
        type="button"
        className={`markTag${comment.question ? ' question' : ''}${active ? ' active' : ''}`}
        style={{ left: pct(first[0]), top: pct(first[1]) }}
        onClick={() => onActivate(comment.id, { scrollList: true })}
        aria-label={`Comment ${number} on page ${comment.page}`}
        tabIndex={-1}
      >
        {number}
      </button>
    </>
  );
}

export default memo(PageView);
