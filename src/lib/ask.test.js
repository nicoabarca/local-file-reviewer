import { describe, expect, it } from 'vitest';
import { buildQuestion, collapseLines } from './ask.js';

describe('buildQuestion', () => {
  it('gives the section, the passage in context and the question', () => {
    const text = buildQuestion(
      { headingPath: ['Architecture', 'Storage'], selectedText: 'WAL', prefix: 'writes go to the ', suffix: ' first' },
      'What is WAL?',
    );
    expect(text).toBe(
      [
        'Section: Architecture › Storage',
        'Selected passage:',
        '"WAL"',
        'In context: "…writes go to the ⟦WAL⟧ first…"',
        '',
        'Question: What is WAL?',
      ].join('\n'),
    );
  });

  it('names the page for PDF passages', () => {
    expect(buildQuestion({ page: 3, selectedText: 'SLA' }, 'Meaning?')).toBe(
      'Page: 3\nSelected passage:\n"SLA"\n\nQuestion: Meaning?',
    );
  });
});

describe('collapseLines', () => {
  it('collapses whitespace and drops empty lines', () => {
    expect(collapseLines('  a   b \n\n\t\n c ')).toBe('a b\nc');
  });
});
