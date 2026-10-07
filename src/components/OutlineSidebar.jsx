import { useEffect, useRef } from 'react';

/** Headings of an HTML document, with comment counts per section. */
export default function OutlineSidebar({ outline, current, commentCounts, onGoTo }) {
  const itemRefs = useRef([]);
  const minLevel = Math.min(...outline.map((h) => h.level));

  // Keep the current section in view as the document scrolls.
  useEffect(() => {
    itemRefs.current[current]?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <nav id="page-sidebar" className="sidebar outline" aria-label="Outline">
      <div className="panelLabel sticky">
        Outline <span className="count">{outline.length}</span>
      </div>
      {outline.length === 0 ? (
        <p className="muted">No headings in this document.</p>
      ) : (
        <ol className="outlineList">
          {outline.map((h, i) => {
            const count = commentCounts.get(i) ?? 0;
            return (
              <li key={i} ref={(el) => (itemRefs.current[i] = el)} style={{ '--depth': h.level - minLevel }}>
                <button
                  type="button"
                  className={`outlineItem${i === current ? ' current' : ''}`}
                  aria-current={i === current ? 'location' : undefined}
                  aria-label={`${h.text}${count ? `, ${count} comment${count === 1 ? '' : 's'}` : ''}`}
                  onClick={() => onGoTo(i)}
                >
                  <span className="outlineText">{h.text}</span>
                  {count > 0 && <span className="thumbCount">{count}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
