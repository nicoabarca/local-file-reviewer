import { describe, expect, it } from 'vitest';
import { buildJson, buildPrompt, contentSignature } from './exportFeedback.js';

const review = {
  id: 'r1',
  preview: { name: 'architecture-v2.pdf', sha256: 'aa', size: 1 },
  warnings: [],
  comments: [
    { id: 'c2', type: 'region', page: 7, rects: [[0.44, 0.27, 0.78, 0.49]], comment: 'Label the arrow.', createdAt: 2 },
    {
      id: 'c1',
      type: 'text',
      page: 4,
      rects: [[0.12, 0.62, 0.84, 0.68]],
      selectedText: 'Each service writes to the shared database.',
      prefix: 'The gateway validates requests. ',
      suffix: ' Changes are logged centrally.',
      visualLines: { start: 18, end: 19 },
      comment: 'Explain why.',
      createdAt: 1,
    },
  ],
};

describe('buildJson', () => {
  it('orders comments by page and keeps region comments without quotes or lines', () => {
    const json = buildJson(review, { pageCount: 9, createdAt: new Date(0) });
    expect(json.schemaVersion).toBe(1);
    expect(json.preview).toEqual({ file: 'architecture-v2.pdf', sha256: 'aa', size: 1, pages: 9 });
    expect(json.comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(json.comments[1]).toMatchObject({ type: 'region', selectedText: null, visualLines: null });
  });
});

describe('buildPrompt', () => {
  const prompt = buildPrompt(review, { pageCount: 9, createdAt: new Date(0) });

  it('identifies the reviewed PDF and asks for its source to be revised', () => {
    expect(prompt).toContain('# Review feedback for `architecture-v2.pdf`');
    expect(prompt).toContain('Reviewed PDF: `architecture-v2.pdf`, 9 pages — sha256 `aa`');
    expect(prompt).toContain('Revise the editable source this PDF was generated from');
  });

  it('lists comments in document order with locations, quotes and context', () => {
    const first = prompt.indexOf('### Comment 1 — page 4, visual lines 18–19 `[c1]`');
    const second = prompt.indexOf('### Comment 2 — page 7, region `[c2]`');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(prompt).toContain('> Each service writes to the shared database.');
    expect(prompt).toContain('Before / after: “…The gateway validates requests. ⟦quote⟧ Changes are logged centrally.…”');
    expect(prompt).toContain('[0.44, 0.27, 0.78, 0.49] — middle of the page');
  });

  it('explains how to locate comments and embeds valid JSON', () => {
    expect(prompt).toContain('## How to locate each comment');
    const json = prompt.slice(prompt.indexOf('```json\n') + 8, prompt.lastIndexOf('\n```'));
    expect(JSON.parse(json).comments).toHaveLength(2);
  });

});

describe('contentSignature', () => {
  it('changes when a comment is edited', () => {
    const edited = { ...review, comments: review.comments.map((c) => ({ ...c, comment: 'x' })) };
    expect(contentSignature(edited)).not.toBe(contentSignature(review));
  });
});
