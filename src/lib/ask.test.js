import { describe, expect, it } from 'vitest';
import { buildQuestion } from './ask.js';

describe('buildQuestion', () => {
  it('gives the document, section, passage in context and question', () => {
    const text = buildQuestion(
      { headingPath: ['Architecture', 'Storage'], selectedText: 'WAL', prefix: 'writes go to the ', suffix: ' first' },
      'What is WAL?',
      'architecture-v2.html',
    );
    expect(text).toBe(
      [
        'Document: architecture-v2.html',
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
    expect(buildQuestion({ page: 3, selectedText: 'SLA' }, 'Meaning?', 'a.pdf')).toBe(
      'Document: a.pdf\nPage: 3\nSelected passage:\n"SLA"\n\nQuestion: Meaning?',
    );
  });
});
