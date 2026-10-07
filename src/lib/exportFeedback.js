import { formatRect } from './geometry.js';
import { HTML_WIDTH, sectionLabel } from './htmlModel.js';

export const SCHEMA_VERSION = 1;

export const COORDINATE_SYSTEM =
  'page-relative [left, top, right, bottom], values 0-1, origin at the top-left of the page as displayed (PDF /Rotate applied)';

/** Document order: page, then top edge, then left edge. */
export function sortComments(comments) {
  return [...comments].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    const [ra, rb] = [a.rects[0], b.rects[0]];
    return ra[1] - rb[1] || ra[0] - rb[0] || a.createdAt - b.createdAt;
  });
}

export const HTML_COORDINATE_SYSTEM = `CSS pixels [left, top, right, bottom] in the document rendered at a ${HTML_WIDTH}px viewport width, origin at the top-left of the document`;

const fileIdentity = (f) => ({ file: f.name, sha256: f.sha256, size: f.size });

/**
 * @param {object} review
 * @param {{pageCount?: number|null, missing?: Set<string>, createdAt?: Date}} options
 *   missing: ids of HTML text comments whose quote was not found in the document
 */
export function buildJson(review, { pageCount = null, missing = new Set(), createdAt = new Date() } = {}) {
  if (review.kind === 'html') {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'html',
      createdAt: createdAt.toISOString(),
      reviewId: review.id,
      preview: fileIdentity(review.preview),
      coordinateSystem: HTML_COORDINATE_SYSTEM,
      warnings: review.warnings ?? [],
      comments: sortComments(review.comments).map((c) => ({
        id: c.id,
        type: c.type,
        section: c.headingPath ?? [],
        elementId: c.elementId ?? null,
        continuesInto: c.continuesInto ?? null,
        selectedText: c.selectedText ?? null,
        prefix: c.prefix ?? null,
        suffix: c.suffix ?? null,
        rectangles: c.rects,
        foundInDocument: !missing.has(c.id),
        comment: c.comment,
      })),
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: createdAt.toISOString(),
    reviewId: review.id,
    preview: { ...fileIdentity(review.preview), pages: pageCount },
    coordinateSystem: COORDINATE_SYSTEM,
    warnings: review.warnings ?? [],
    comments: sortComments(review.comments).map((c) => ({
      id: c.id,
      type: c.type,
      page: c.page,
      visualLines: c.visualLines ?? null,
      selectedText: c.selectedText ?? null,
      prefix: c.prefix ?? null,
      suffix: c.suffix ?? null,
      rectangles: c.rects,
      comment: c.comment,
    })),
  };
}

export function lineLabel(visualLines) {
  if (!visualLines) return null;
  const { start, end } = visualLines;
  return start === end ? `visual line ${start}` : `visual lines ${start}–${end}`;
}

export function heading(c, n) {
  if (c.headingPath) return `Comment ${n} — ${sectionLabel(c.headingPath)}${c.type === 'region' ? ', region' : ''}`;
  const where = c.type === 'region' ? 'region' : lineLabel(c.visualLines);
  return `Comment ${n} — page ${c.page}${where ? `, ${where}` : ''}`;
}

/** Vertical position in words, to help the agent orient on the rendered page. */
function verticalHint([, top, , bottom]) {
  const mid = (top + bottom) / 2;
  if (mid < 0.33) return 'upper third of the page';
  if (mid < 0.66) return 'middle of the page';
  return 'lower third of the page';
}

const quoteBlock = (text) =>
  text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

const fileLine = (label, f, extra = '') =>
  `- ${label}: \`${f.name}\`${extra} — sha256 \`${f.sha256}\`, ${f.size.toLocaleString('en-US')} bytes`;

const formatPixels = (r) => `[${r.map((v) => Math.round(v)).join(', ')}] px`;


function locateSection(kind) {
  if (kind === 'html') {
    return [
      '- **Section** is the heading path of the place in the rendered document, outermost heading first (`Architecture › Storage › Retention`). Find that heading in the source and look below it.',
      '- **Quote** is the exact text the reviewer selected, as rendered in a browser. Search the source for it. ' +
        'The rendered text can differ from the source: whitespace and line breaks are collapsed, markup and entities are resolved, text added by CSS is absent, and text produced by scripts may not exist in the source at all. Search for a distinctive part of the quote if the full quote does not match.',
      '- **Before / after** is the text immediately around the quote. When the quote occurs more than once, use it to pick the right occurrence.',
      '- **Element id** is the `id` of the nearest element enclosing the comment, when it has one. Search the source for it.',
      `- **Location** rectangles are ${HTML_COORDINATE_SYSTEM}. They are a hint: they change whenever the layout does. Text selections have one rectangle per displayed line.`,
      `- **Region** comments mark an area the reviewer drew, usually a diagram, chart, table or layout problem, and carry no quote. Identify the element from the section and the rectangle; if you need to see it, open the file in a headless browser with a ${HTML_WIDTH}px wide viewport, take a full-page screenshot and look at that area.`,
      '- **Not found** marks a text comment whose quote could not be found in the document when this prompt was built, usually because a script changed the text. Rely on its section and quote.',
    ];
  }
  return [
    '- **Page** is the 1-based page number in the reviewed PDF.',
    '- **Quote** is the exact text the reviewer selected, as extracted from the PDF. Search the source for it. ' +
      'The extraction can differ from the source: whitespace and line breaks are collapsed, words may be hyphenated across lines, ligatures and smart quotes may differ, and source markup (Markdown, LaTeX, Word formatting) is not present. Search for a distinctive part of the quote if the full quote does not match.',
    '- **Before / after** is the text immediately around the quote. When the quote occurs more than once, use it to pick the right occurrence.',
    '- **Visual lines** count the lines displayed on that PDF page from the top, including titles and headers. They are computed by the review tool, not taken from the source, so they are a hint, not a source line number. Side-by-side columns can share a line number. They are omitted when they could not be computed reliably.',
    `- **Location** rectangles are ${COORDINATE_SYSTEM}. A top value of 0.62 means 62% of the way down the page. Text selections have one rectangle per displayed line.`,
    '- **Region** comments mark an area the reviewer drew, usually a figure, diagram, table or scanned content, and carry no quote. Identify the element on that page from the rectangle; if you need to see it, render the page (for example `pdftoppm -f <page> -l <page> -png`) and look at that area.',
  ];
}

/**
 * One self-contained prompt for a coding agent: task, file identities, how to
 * locate each comment, the comments in document order, and the same data as
 * JSON for scripted use.
 */
export function buildPrompt(review, { pageCount = null, missing = new Set(), createdAt = new Date() } = {}) {
  const { preview } = review;
  const kind = review.kind === 'html' ? 'html' : 'pdf';
  const doc = kind === 'html' ? 'HTML' : 'PDF';
  const comments = sortComments(review.comments);
  const n = comments.length;
  const out = [];

  out.push(`# Review feedback for \`${preview.name}\``, '');
  out.push(
    `A human reviewed the ${doc} \`${preview.name}\` and left ${n} comment${n === 1 ? '' : 's'} attached to exact locations in it. ` +
      (kind === 'html'
        ? 'Revise the editable source this HTML was generated from (for example a .md file, a template or a script) so that every comment is addressed, then regenerate the HTML from the revised source. '
        : 'Revise the editable source this PDF was generated from (for example a .docx, .md or .tex file) so that every comment is addressed, then regenerate the PDF from the revised source. ') +
      `If you cannot find a source, say so before editing the ${doc} itself.`,
  );

  out.push('', '## Files', '');
  out.push(fileLine(`Reviewed ${doc}`, preview, kind === 'pdf' && pageCount ? `, ${pageCount} pages` : ''));
  out.push(
    '',
    'Only the file name is known to the reviewer, not its folder; look for it in your working directory. ' +
      `Check it is the reviewed version, e.g. \`shasum -a 256 "${preview.name}"\`. ` +
      'If the hash differs, the comments may refer to older content: say so and ask before changing anything.',
  );

  out.push('', '## How to locate each comment', '');
  out.push(...locateSection(kind));

  if (review.warnings?.length) {
    out.push('', '## Warnings', '');
    for (const w of review.warnings) out.push(`- ${w}`);
  }

  out.push('', `## Comments (${n}, in document order)`);
  if (n === 0) out.push('', '_No comments._');
  comments.forEach((c, i) => {
    out.push('', `### ${heading(c, i + 1)} \`[${c.id}]\``, '');
    if (kind === 'html') {
      out.push(`- Section: ${sectionLabel(c.headingPath)}`);
      if (c.continuesInto) out.push(`- Continues into: ${c.continuesInto}`);
      if (c.elementId) out.push(`- Element id: \`${c.elementId}\``);
      out.push(`- Location: ${c.rects.map(formatPixels).join(', ')}`);
      if (missing.has(c.id)) out.push('- **Not found** in the document when this prompt was built');
    } else {
      out.push(`- Location: ${c.rects.map(formatRect).join(', ')} — ${verticalHint(c.rects[0])}`);
    }
    if (c.type === 'region') out.push('- Type: region (no selected text)');
    if (c.selectedText) {
      out.push('- Quote:', '', quoteBlock(c.selectedText), '');
      if (c.prefix || c.suffix) {
        out.push(`- Before / after: “…${c.prefix ?? ''}⟦quote⟧${c.suffix ?? ''}…”`);
      }
    }
    out.push('- Reviewer comment:', '', quoteBlock(c.comment.trim()));
  });

  out.push('', '## When you are done', '');
  out.push(
    '- Address every comment. If one cannot or should not be done, explain why instead of skipping it silently.',
    '- Change only what the comments ask for, plus anything they directly imply.',
    `- Save the revision as a new version and regenerate the ${doc} from it, so the reviewer can open it as a fresh review.`,
    '- Reply with one line per comment id saying what you changed.',
  );

  out.push('', '## Machine-readable copy', '', '```json');
  out.push(JSON.stringify(buildJson(review, { pageCount, missing, createdAt }), null, 2));
  out.push('```');
  return out.join('\n') + '\n';
}

/** Signature of the exportable content, used to detect changes since the last copy. */
export function contentSignature(review) {
  return JSON.stringify([
    review.warnings ?? [],
    sortComments(review.comments).map((c) => [c.id, c.comment, c.rects]),
  ]);
}
