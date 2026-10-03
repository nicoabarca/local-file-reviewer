import { describe, expect, it } from 'vitest';
import { buildPageModel, visualLinesFor } from './pageModel.js';

// Viewport at scale 1 for a 612x792 page: flips y so the origin is top-left.
const viewport = { transform: [1, 0, 0, -1, 0, 792] };
const multiply = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const item = (str, x, y, { size = 11, hasEOL = false, angle = 0 } = {}) => ({
  str,
  hasEOL,
  transform: [size * Math.cos(angle), size * Math.sin(angle), -size * Math.sin(angle), size * Math.cos(angle), x, y],
});

describe('buildPageModel', () => {
  it('numbers visual lines from the top and shares numbers across columns', () => {
    const model = buildPageModel(
      [
        item('Title', 72, 720, { size: 20, hasEOL: true }),
        item('left one', 72, 684),
        item('right one', 330, 684, { hasEOL: true }),
        { type: 'beginMarkedContent' },
        item('left two', 72, 668, { hasEOL: true }),
        { type: 'endMarkedContent' },
      ],
      viewport,
      multiply,
    );
    expect(model.linesReliable).toBe(true);
    expect(model.line).toEqual([1, 2, 2, 3]);
    expect(model.text).toBe('Title\nleft oneright one\nleft two\n');
  });

  it('computes the line range of a character span', () => {
    const model = buildPageModel(
      [item('first line', 72, 700, { hasEOL: true }), item('second line', 72, 684, { hasEOL: true }), item('third', 72, 668)],
      viewport,
      multiply,
    );
    const from = model.text.indexOf('line');
    const to = model.text.indexOf('third');
    expect(visualLinesFor(model, from, to)).toEqual({ start: 1, end: 2 });
  });

  it('reports lines as unreliable when much of the page is rotated', () => {
    const model = buildPageModel(
      [item('a', 72, 700), item('b', 72, 680, { angle: Math.PI / 2 })],
      viewport,
      multiply,
    );
    expect(model.linesReliable).toBe(false);
    expect(visualLinesFor(model, 0, 1)).toBeNull();
  });
});
