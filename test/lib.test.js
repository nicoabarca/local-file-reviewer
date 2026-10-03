import { describe, expect, it } from 'vitest';
import { buildPageModel, visualLinesFor } from '../src/lib/pageModel.js';
import { mergeIntoLines } from '../src/lib/geometry.js';
import { buildJson, buildMarkdown, buildInstruction, contentSignature } from '../src/lib/exportFeedback.js';

// Multiply like pdfjs Util.transform.
const multiply = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const H = 792;
const viewport = { transform: [1, 0, 0, -1, 0, H] }; // flip y: top-left origin
const item = (str, x, y, size = 11, extra = {}) => ({ str, transform: [size, 0, 0, size, x, y], hasEOL: false, ...extra });

describe('buildPageModel', () => {
  it('numbers lines top to bottom and joins text', () => {
    const m = buildPageModel(
      [item('Title', 72, 720, 20, { hasEOL: true }), item('first line', 72, 680, 11, { hasEOL: true }), item('second', 72, 664)],
      viewport,
      multiply,
    );
    expect(m.text).toBe('Title\nfirst line\nsecond');
    expect(m.line).toEqual([1, 2, 3]);
    expect(visualLinesFor(m, m.start[1], m.end[2])).toEqual({ start: 2, end: 3 });
  });

  it('gives side-by-side columns the same line number', () => {
    const m = buildPageModel([item('left', 72, 700), item('right', 320, 700)], viewport, multiply);
    expect(m.line).toEqual([1, 1]);
  });

  it('keeps superscripts on their line', () => {
    const m = buildPageModel([item('E = mc', 72, 700, 11), item('2', 110, 704, 7), item('next', 72, 684, 11)], viewport, multiply);
    expect(m.line).toEqual([1, 1, 2]);
  });

  it('ignores marked-content entries like the text layer does', () => {
    const m = buildPageModel([{ type: 'beginMarkedContent' }, item('a', 72, 700), { type: 'endMarkedContent' }], viewport, multiply);
    expect(m.items).toEqual(['a']);
  });

  it('reports unreliable lines for mostly rotated text', () => {
    const rotated = { str: 'vertical', transform: [0, 11, -11, 0, 300, 300], hasEOL: false };
    const m = buildPageModel([rotated, { ...rotated }], viewport, multiply);
    expect(m.linesReliable).toBe(false);
    expect(visualLinesFor(m, 0, 5)).toBeNull();
  });

  it('returns null when no text exists', () => {
    const m = buildPageModel([], viewport, multiply);
    expect(m.linesReliable).toBe(false);
  });
});

describe('mergeIntoLines', () => {
  it('merges fragments on one line and keeps separate lines', () => {
    const out = mergeIntoLines([
      [0.1, 0.1, 0.3, 0.12],
      [0.3, 0.1, 0.5, 0.12],
      [0.1, 0.13, 0.4, 0.15],
    ]);
    expect(out).toEqual([
      [0.1, 0.1, 0.5, 0.12],
      [0.1, 0.13, 0.4, 0.15],
    ]);
  });
  it('keeps distant columns apart', () => {
    expect(mergeIntoLines([[0.1, 0.1, 0.4, 0.12], [0.6, 0.1, 0.9, 0.12]])).toHaveLength(2);
  });
});

const review = {
  id: 'r1',
  preview: { name: 'architecture-v2.pdf', sha256: 'aa', size: 1 },
  source: { name: 'architecture-v2.docx', sha256: 'bb', size: 2 },
  warnings: [],
  comments: [
    { id: 'c2', type: 'region', page: 7, rects: [[0.44, 0.27, 0.78, 0.49]], comment: 'Label the arrow between the gateway and worker.', createdAt: 2 },
    {
      id: 'c1', type: 'text', page: 4, rects: [[0.12, 0.62, 0.84, 0.65], [0.12, 0.65, 0.5, 0.68]],
      selectedText: 'Each service writes to the shared database.', prefix: 'The gateway validates requests. ', suffix: ' Changes are logged centrally.',
      visualLines: { start: 18, end: 19 }, comment: 'Explain why the services need shared write access.', createdAt: 1,
    },
    { id: 'c3', type: 'text', page: 4, rects: [[0.1, 0.1, 0.2, 0.12]], selectedText: 'x', visualLines: null, comment: 'Why?', createdAt: 3 },
  ],
};

describe('export', () => {
  it('orders comments by page then position', () => {
    expect(buildJson(review).comments.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
  });

  it('includes identities, schema and nulls for regions', () => {
    const j = buildJson(review);
    expect(j.schemaVersion).toBe(1);
    expect(j.preview).toEqual({ file: 'architecture-v2.pdf', sha256: 'aa', size: 1 });
    expect(j.editableSource.file).toBe('architecture-v2.docx');
    expect(j.fileToRevise).toBe('architecture-v2.docx');
    const region = j.comments.find((c) => c.id === 'c2');
    expect(region).toMatchObject({ type: 'region', selectedText: null, visualLines: null, rectangles: [[0.44, 0.27, 0.78, 0.49]] });
  });

  it('writes readable markdown without inventing line numbers', () => {
    const md = buildMarkdown(review);
    expect(md).toContain('Reviewed preview: architecture-v2.pdf');
    expect(md).toContain('Editable source: architecture-v2.docx');
    expect(md).toContain('## Comment 1 — page 4\n');
    expect(md).toContain('## Comment 2 — page 4, visual lines 18–19');
    expect(md).toContain('Selected text: “Each service writes to the shared database.”');
    expect(md).toContain('## Comment 3 — page 7, region');
    expect(md).toContain('Location: [0.44, 0.27, 0.78, 0.49] (page-relative)');
  });

  it('points the instruction at the PDF when no source is attached', () => {
    expect(buildInstruction(review)).toContain('`architecture-v2.docx`');
    const noSource = buildInstruction({ ...review, source: null });
    expect(noSource).toContain('`architecture-v2.pdf`');
    expect(noSource).not.toContain('docx');
  });

  it('signature changes when a comment is edited', () => {
    const edited = { ...review, comments: review.comments.map((c) => (c.id === 'c1' ? { ...c, comment: 'new' } : c)) };
    expect(contentSignature(edited)).not.toBe(contentSignature(review));
  });
});
