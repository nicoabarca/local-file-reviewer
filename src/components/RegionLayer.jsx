import { useRef, useState } from 'react';

const clamp = (v) => Math.min(1, Math.max(0, v));
const round = (v) => Math.round(v * 10000) / 10000;

function normalize([x1, y1, x2, y2]) {
  return [
    round(clamp(Math.min(x1, x2))),
    round(clamp(Math.min(y1, y2))),
    round(clamp(Math.max(x1, x2))),
    round(clamp(Math.max(y1, y2))),
  ];
}

const DEFAULT_MIN = [0.01, 0.01];
const DEFAULT_STEP = [0.02, 0.02];
const DEFAULT_BOX = () => [0.3, 0.4, 0.7, 0.6];

/**
 * Region tool for one page. Drag with a pointer, or focus the page and press
 * Enter to place a box: arrows move it, Shift+arrows resize, Enter confirms.
 * Sizes are fractions of the layer: minSize and step as [x, y], initialBox()
 * returns the box placed by Enter.
 */
export default function RegionLayer({
  pageNumber,
  onRegion,
  label = `Page ${pageNumber}`,
  minSize = DEFAULT_MIN,
  step: stepSize = DEFAULT_STEP,
  initialBox = DEFAULT_BOX,
}) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  const [keyboardBox, setKeyboardBox] = useState(false);
  const drag = useRef(null);

  const toPage = (e) => {
    const b = ref.current.getBoundingClientRect();
    return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height];
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    ref.current.setPointerCapture(e.pointerId);
    const [x, y] = toPage(e);
    drag.current = [x, y];
    setKeyboardBox(false);
    setBox([x, y, x, y]);
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const [x, y] = toPage(e);
    setBox([drag.current[0], drag.current[1], x, y]);
  };

  const finish = (raw) => {
    const rect = normalize(raw);
    setBox(null);
    setKeyboardBox(false);
    if (rect[2] - rect[0] >= minSize[0] && rect[3] - rect[1] >= minSize[1]) {
      onRegion({ type: 'region', page: pageNumber, rects: [rect] });
    }
  };

  const onPointerUp = (e) => {
    if (!drag.current) return;
    const [x, y] = toPage(e);
    const raw = [drag.current[0], drag.current[1], x, y];
    drag.current = null;
    finish(raw);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (keyboardBox && box) finish(box);
      else {
        setBox(initialBox());
        setKeyboardBox(true);
      }
      return;
    }
    if (e.key === 'Escape' && box) {
      e.stopPropagation();
      setBox(null);
      setKeyboardBox(false);
      return;
    }
    if (!keyboardBox || !box) return;
    const [sx, sy] = stepSize.map((v) => (e.altKey ? v / 10 : v));
    const d = { ArrowLeft: [-sx, 0], ArrowRight: [sx, 0], ArrowUp: [0, -sy], ArrowDown: [0, sy] }[e.key];
    if (!d) return;
    e.preventDefault();
    const [l, t, r, b] = normalize(box);
    if (e.shiftKey) {
      setBox(normalize([l, t, Math.max(l + minSize[0], r + d[0]), Math.max(t + minSize[1], b + d[1])]));
    } else {
      const dx = Math.min(1 - r, Math.max(-l, d[0]));
      const dy = Math.min(1 - b, Math.max(-t, d[1]));
      setBox([l + dx, t + dy, r + dx, b + dy]);
    }
  };

  const shown = box && normalize(box);

  return (
    <div
      ref={ref}
      className="regionLayer"
      tabIndex={0}
      role="application"
      aria-label={`${label} region tool. Drag to draw a region, or press Enter to place one with the keyboard.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setBox(null);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (keyboardBox) {
          setBox(null);
          setKeyboardBox(false);
        }
      }}
    >
      {shown && (
        <div
          className="mark region drawing"
          style={{
            left: `${shown[0] * 100}%`,
            top: `${shown[1] * 100}%`,
            width: `${(shown[2] - shown[0]) * 100}%`,
            height: `${(shown[3] - shown[1]) * 100}%`,
          }}
        />
      )}
      {keyboardBox && (
        <div className="regionHint" role="status">
          Arrows move · Shift+arrows resize · Alt for fine steps · Enter to comment · Esc to cancel
        </div>
      )}
    </div>
  );
}
