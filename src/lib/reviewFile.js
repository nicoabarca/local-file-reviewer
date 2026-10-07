// Review files: a portable JSON copy of one review that the user keeps on
// disk. It survives clearing browser data, a change of domain, and moving to
// another computer. Opened files are untrusted input, so parsing rebuilds the
// review from validated fields only.

export const REVIEW_FILE_KIND = 'local-file-reviewer.review';
export const REVIEW_FILE_VERSION = 2; // 2 added HTML documents; version 1 files are PDF reviews

const MAX_COMMENTS = 10_000;
const MAX_RECTS = 500;
const MAX_TEXT = 100_000;
const MAX_PIXELS = 10_000_000;
const MAX_HEADINGS = 20;
const MAX_HEADING = 1000;

export function reviewFileName(review) {
  const base = review.preview.name.replace(/\.(pdf|html?)$/i, '') || 'review';
  return `${base}.review.json`;
}

export function serializeReview(review, savedAt = new Date()) {
  const { lastExport, ...rest } = review;
  return (
    JSON.stringify(
      { kind: REVIEW_FILE_KIND, version: REVIEW_FILE_VERSION, savedAt: savedAt.toISOString(), review: rest },
      null,
      2,
    ) + '\n'
  );
}

class ReviewFileError extends Error {}

function check(condition, message) {
  if (!condition) throw new ReviewFileError(message);
}

const isText = (v, max = MAX_TEXT) => typeof v === 'string' && v.length <= max;
const optionalText = (v, what) => {
  if (v == null) return null;
  check(isText(v), `${what} is not valid text`);
  return v;
};
const isUnit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isPixel = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PIXELS;
const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** A question asked to Claude about a passage, with its answer, if any. */
const questionFields = (c, where) =>
  c.question === true ? { question: true, answer: optionalText(c.answer, `${where} answer`) } : {};

function parseComment(c, i, kind) {
  const where = `Comment ${i + 1}`;
  check(c && typeof c === 'object', `${where} is not an object`);
  check(isText(c.id, 32) && /^c\d+$/.test(c.id), `${where} has an invalid id`);
  check(c.type === 'text' || c.type === 'region', `${where} has an unknown type`);
  check(kind === 'html' ? c.page === 1 : isPositiveInt(c.page), `${where} has an invalid page`);
  // PDF rectangles are page fractions, HTML rectangles document pixels.
  const isCoord = kind === 'html' ? isPixel : isUnit;
  check(
    Array.isArray(c.rects) &&
      c.rects.length >= 1 &&
      c.rects.length <= MAX_RECTS &&
      c.rects.every((r) => Array.isArray(r) && r.length === 4 && r.every(isCoord) && r[0] <= r[2] && r[1] <= r[3]),
    `${where} has invalid rectangles`,
  );
  check(isText(c.comment) && c.comment.trim(), `${where} has no comment text`);
  if (kind === 'html') {
    check(
      Array.isArray(c.headingPath) &&
        c.headingPath.length <= MAX_HEADINGS &&
        c.headingPath.every((h) => isText(h, MAX_HEADING)),
      `${where} has an invalid section`,
    );
    const text = c.type === 'text';
    return {
      id: c.id,
      type: c.type,
      page: 1,
      rects: c.rects.map((r) => [...r]),
      selectedText: text ? optionalText(c.selectedText, `${where} quote`) : null,
      prefix: text ? optionalText(c.prefix, `${where} prefix`) : null,
      suffix: text ? optionalText(c.suffix, `${where} suffix`) : null,
      visualLines: null,
      headingPath: [...c.headingPath],
      elementId: optionalText(c.elementId, `${where} element id`),
      continuesInto: text ? optionalText(c.continuesInto, `${where} section`) : null,
      comment: c.comment,
      ...questionFields(c, where),
      createdAt: isTime(c.createdAt) ? c.createdAt : 0,
    };
  }
  let visualLines = null;
  if (c.visualLines != null) {
    const { start, end } = c.visualLines;
    check(isPositiveInt(start) && isPositiveInt(end) && start <= end, `${where} has invalid visual lines`);
    visualLines = { start, end };
  }
  return {
    id: c.id,
    type: c.type,
    page: c.page,
    rects: c.rects.map((r) => [...r]),
    selectedText: c.type === 'text' ? optionalText(c.selectedText, `${where} quote`) : null,
    prefix: c.type === 'text' ? optionalText(c.prefix, `${where} prefix`) : null,
    suffix: c.type === 'text' ? optionalText(c.suffix, `${where} suffix`) : null,
    visualLines: c.type === 'text' ? visualLines : null,
    comment: c.comment,
    ...questionFields(c, where),
    createdAt: isTime(c.createdAt) ? c.createdAt : 0,
  };
}

/**
 * Parse and validate a review file. Returns a review ready for storage, or
 * throws an Error whose message can be shown to the user.
 */
export function parseReviewFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ReviewFileError('This file is not valid JSON.');
  }
  check(data?.kind === REVIEW_FILE_KIND, 'This is not a review file from Local File Reviewer.');
  check(data.version === 1 || data.version === REVIEW_FILE_VERSION, `Unsupported review file version: ${data.version}.`);
  const r = data.review;
  check(r && typeof r === 'object', 'The review file is empty.');
  const kind = data.version === 1 || r.kind == null ? 'pdf' : r.kind;
  check(kind === 'pdf' || kind === 'html', `Unsupported document type: ${kind}.`);

  const p = r.preview;
  check(p && isText(p.name, 1000) && p.name, 'The review file does not name its document.');
  check(isText(p.sha256, 64) && /^[0-9a-f]{64}$/.test(p.sha256), 'The review file has an invalid document hash.');
  check(Number.isInteger(p.size) && p.size >= 0, 'The review file has an invalid document size.');

  check(Array.isArray(r.comments) && r.comments.length <= MAX_COMMENTS, 'The review file has an invalid comment list.');
  const comments = r.comments.map((c, i) => parseComment(c, i, kind));
  check(new Set(comments.map((c) => c.id)).size === comments.length, 'The review file has duplicate comment ids.');

  const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w) => isText(w, 2000)) : [];
  const highestId = Math.max(0, ...comments.map((c) => Number(c.id.slice(1))));
  const now = Date.now();

  return {
    id: isText(r.id, 100) && r.id ? r.id : crypto.randomUUID(),
    kind,
    preview: { name: p.name, size: p.size, sha256: p.sha256 },
    comments,
    nextId: highestId + 1,
    warnings,
    createdAt: isTime(r.createdAt) ? r.createdAt : now,
    updatedAt: isTime(r.updatedAt) ? r.updatedAt : now,
    lastExport: null,
  };
}
