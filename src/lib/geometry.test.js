import { describe, expect, it } from 'vitest';
import { mergeIntoLines, normalizeRect } from './geometry.js';

describe('normalizeRect', () => {
  it('is independent of zoom', () => {
    const at1 = normalizeRect({ left: 110, top: 220, right: 310, bottom: 240 }, { left: 10, top: 20, width: 600, height: 800 });
    const at2 = normalizeRect({ left: 210, top: 420, right: 610, bottom: 460 }, { left: 10, top: 20, width: 1200, height: 1600 });
    expect(at1).toEqual(at2);
    expect(at1).toEqual([0.1667, 0.25, 0.5, 0.275]);
  });

  it('clamps to the page', () => {
    expect(normalizeRect({ left: -5, top: 0, right: 700, bottom: 10 }, { left: 0, top: 0, width: 100, height: 100 })).toEqual([0, 0, 1, 0.1]);
  });
});

describe('mergeIntoLines', () => {
  it('merges fragments on one line and keeps lines and columns apart', () => {
    const rects = mergeIntoLines([
      [0.1, 0.1, 0.2, 0.12],
      [0.2, 0.1, 0.4, 0.12],
      [0.1, 0.13, 0.3, 0.15],
      [0.6, 0.1, 0.8, 0.12],
    ]);
    expect(rects).toEqual([
      [0.1, 0.1, 0.4, 0.12],
      [0.6, 0.1, 0.8, 0.12],
      [0.1, 0.13, 0.3, 0.15],
    ]);
  });
});
