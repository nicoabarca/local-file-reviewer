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
    expect(() => parseReviewFile(bad({ preview: { ...review.preview, sha256: 'nope' } }))).toThrow('document hash');
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

  it('loads version 1 files as PDF reviews', () => {
    const file = JSON.parse(serializeReview(review));
    file.version = 1;
    expect(parseReviewFile(JSON.stringify(file))).toMatchObject({ kind: 'pdf', comments: [{ page: 4 }, { page: 6 }] });
  });

  const html = {
    ...review,
    kind: 'html',
    preview: { name: 'architecture.html', size: 900, sha256: sha },
    comments: [
      {
        id: 'c1',
        type: 'text',
        page: 1,
        rects: [[40, 812, 610, 834]],
        selectedText: 'Each service writes to the shared database.',
        prefix: 'before ',
        suffix: ' after',
        visualLines: null,
        headingPath: ['Architecture', 'Storage'],
        elementId: 'storage',
        continuesInto: 'Retention',
        comment: 'Explain why.',
        createdAt: 5,
      },
      {
        id: 'c2',
        type: 'region',
        page: 1,
        rects: [[100, 1500, 700, 1900]],
        headingPath: [],
        elementId: null,
        comment: 'Label the arrow.',
        createdAt: 6,
      },
    ],
  };

  it('round-trips an HTML review with pixel rectangles and sections', () => {
    const back = parseReviewFile(serializeReview(html));
    expect(back.kind).toBe('html');
    expect(back.comments[0]).toEqual(html.comments[0]);
    expect(back.comments[1]).toMatchObject({ type: 'region', selectedText: null, headingPath: [], continuesInto: null });
    expect(reviewFileName(html)).toBe('architecture.review.json');
  });

  it('rejects HTML comments without a valid section or page', () => {
    const bad = (patch) => serializeReview({ ...html, comments: [{ ...html.comments[0], ...patch }] });
    expect(() => parseReviewFile(bad({ headingPath: 'Storage' }))).toThrow('invalid section');
    expect(() => parseReviewFile(bad({ page: 2 }))).toThrow('invalid page');
    expect(() => parseReviewFile(bad({ rects: [[10, 20, 5, 30]] }))).toThrow('invalid rectangles');
  });
});

describe('questions to Claude', () => {
  it('keep their question flag and answer through a save and load', () => {
    const asked = {
      ...review,
      comments: [{ ...review.comments[0], question: true, answer: 'It means X.' }],
    };
    const [c] = parseReviewFile(serializeReview(asked)).comments;
    expect(c).toMatchObject({ question: true, answer: 'It means X.' });
  });
});
