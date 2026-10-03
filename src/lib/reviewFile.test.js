import { describe, expect, it } from 'vitest';
import { parseReviewFile, reviewFileName, serializeReview } from './reviewFile.js';

const sha = 'a'.repeat(64);
const review = {
  id: 'r1',
  preview: { name: 'architecture-v2.pdf', size: 7084, sha256: sha },
  comments: [
    {
      id: 'c3',
      type: 'text',
      page: 4,
      rects: [[0.1, 0.2, 0.5, 0.25]],
      selectedText: 'Each service writes to the shared database.',
      prefix: 'before ',
      suffix: ' after',
      visualLines: { start: 7, end: 7 },
      comment: 'Explain why.',
      createdAt: 5,
    },
    { id: 'c1', type: 'region', page: 6, rects: [[0.4, 0.2, 0.6, 0.38]], comment: 'Label the arrow.', createdAt: 1 },
  ],
  nextId: 4,
  warnings: [],
  createdAt: 1,
  updatedAt: 9,
  lastExport: { at: 1, destination: 'clipboard', signature: 'x' },
};

describe('review files', () => {
  it('round-trips a review and drops the prompt-copied state', () => {
    const back = parseReviewFile(serializeReview(review));
    expect(back.preview).toEqual(review.preview);
    expect(back.comments[0]).toEqual(review.comments[0]);
    expect(back.comments[1]).toMatchObject({ type: 'region', selectedText: null, visualLines: null });
    expect(back.lastExport).toBeNull();
    expect(back.nextId).toBe(4);
  });

  it('names the file after the PDF', () => {
    expect(reviewFileName(review)).toBe('architecture-v2.review.json');
  });

  it('rejects files that are not review files', () => {
    expect(() => parseReviewFile('not json')).toThrow('not valid JSON');
    expect(() => parseReviewFile('{"kind":"other"}')).toThrow('not a review file');
  });

  it('rejects invalid locations and hashes', () => {
    const bad = (patch) => serializeReview({ ...review, ...patch });
    expect(() => parseReviewFile(bad({ preview: { ...review.preview, sha256: 'nope' } }))).toThrow('PDF hash');
    expect(() =>
      parseReviewFile(bad({ comments: [{ ...review.comments[0], rects: [[0.5, 0.2, 2, 0.3]] }] })),
    ).toThrow('invalid rectangles');
    expect(() => parseReviewFile(bad({ comments: [review.comments[0], review.comments[0]] }))).toThrow('duplicate');
  });

  it('keeps only known fields', () => {
    const file = JSON.parse(serializeReview(review));
    file.review.comments[0].html = '<img src=x onerror=alert(1)>';
    file.review.extra = 'x';
    const back = parseReviewFile(JSON.stringify(file));
    expect(back.comments[0]).not.toHaveProperty('html');
    expect(back).not.toHaveProperty('extra');
  });
});
