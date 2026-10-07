import { describe, expect, it } from 'vitest';
import { buildTextModel, findQuote, headingPath, quoteAt, sectionIndexAt, trimSpan } from './htmlModel.js';

const P1 = {};
const P2 = {};

describe('buildTextModel', () => {
  it('collapses whitespace and separates blocks', () => {
    const m = buildTextModel([
      { text: '  Storage\n  layer ', block: P1 },
      { text: 'is shared.', block: P1 },
      { text: 'Next', block: P2 },
    ]);
    expect(m.text).toBe('Storage layer is shared. Next');
  });

  it('joins inline chunks of one block without inventing spaces', () => {
    const m = buildTextModel([
      { text: 'data', block: P1 },
      { text: 'base', block: P1 },
    ]);
    expect(m.text).toBe('database');
  });

  it('maps model characters back to source chunks and offsets', () => {
    const m = buildTextModel([
      { text: 'ab  ', block: P1 },
      { text: ' cd', block: P2 },
    ]);
    expect(m.text).toBe('ab cd');
    const c = m.text.indexOf('c');
    expect([m.charChunk[c], m.charOffset[c]]).toEqual([1, 1]);
    // Raw offsets map into the model text, whitespace to the next character.
    expect(m.maps[0][1]).toBe(1);
    expect(m.maps[1][3]).toBe(5);
  });
});

describe('quotes', () => {
  const text = 'The gateway validates requests. Each service writes. Later, each service writes again.';

  it('captures context around a span', () => {
    const from = text.indexOf('Each');
    const q = quoteAt(text, from, from + 'Each service writes.'.length);
    expect(q.selectedText).toBe('Each service writes.');
    expect(q.prefix).toBe('The gateway validates requests. ');
    expect(q.suffix?.startsWith(' Later')).toBe(true);
  });

  it('picks the occurrence whose context matches', () => {
    const second = text.lastIndexOf('service writes');
    const q = quoteAt(text, second, second + 'service writes'.length);
    expect(findQuote(text, q)).toEqual({ from: second, to: second + 'service writes'.length });
  });

  it('returns null when the quote is gone', () => {
    expect(findQuote(text, { selectedText: 'not here', prefix: null, suffix: null })).toBeNull();
  });

  it('trims spaces off a span', () => {
    expect(trimSpan(' ab ', 0, 4)).toEqual({ from: 1, to: 3 });
  });
});

describe('headingPath', () => {
  it('keeps the open headings, outermost first', () => {
    const h = (level, text) => ({ level, text });
    expect(headingPath([h(1, 'Doc'), h(2, 'Intro'), h(2, 'Storage'), h(3, 'Retention')])).toEqual([
      'Doc',
      'Storage',
      'Retention',
    ]);
    expect(headingPath([h(1, 'Doc'), h(3, 'Deep'), h(2, 'Back')])).toEqual(['Doc', 'Back']);
    expect(headingPath([])).toEqual([]);
  });
});

describe('sectionIndexAt', () => {
  const outline = [{ top: 0 }, { top: 400 }, { top: 900 }];
  it('finds the section a vertical position falls in', () => {
    expect(sectionIndexAt(outline, 10)).toBe(0);
    expect(sectionIndexAt(outline, 400)).toBe(1);
    expect(sectionIndexAt(outline, 5000)).toBe(2);
    expect(sectionIndexAt([{ top: 100 }], 50)).toBe(-1);
  });
});
