// Review sessions are autosaved to this browser profile's localStorage for the
// app's origin (e.g. https://your-app.vercel.app or http://127.0.0.1:5174),
// keyed by the PDF's SHA-256. A different origin (another domain, a preview
// deployment, another port) has its own, separate storage. Only
// metadata and comments are stored, never document contents. Reopening the
// same PDF bytes restores its review; a revised PDF has a new hash and starts
// empty.

const PREFIX = 'local-file-reviewer:review:';

export const STORAGE_LOCATION = 'this browser only, on this computer (not uploaded, not synced)';

export function loadReview(pdfSha) {
  try {
    const raw = localStorage.getItem(PREFIX + pdfSha);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveReview(review) {
  localStorage.setItem(PREFIX + review.preview.sha256, JSON.stringify(review));
}

export function deleteReview(pdfSha) {
  localStorage.removeItem(PREFIX + pdfSha);
}

export function listReviews() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const r = JSON.parse(localStorage.getItem(key));
      out.push({
        sha256: r.preview.sha256,
        name: r.preview.name,
        comments: r.comments.length,
        updatedAt: r.updatedAt,
      });
    } catch {
      // ignore corrupt entries
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Ask the browser not to evict this site's storage under disk pressure or
 * Safari's 7-day rule. Chromium decides silently from engagement; Firefox may
 * ask the user. Returns true when storage is (now) persistent.
 */
export async function requestPersistence() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** 'persistent' | 'best-effort' | 'unknown' */
export async function persistenceStatus() {
  try {
    if (!navigator.storage?.persisted) return 'unknown';
    return (await navigator.storage.persisted()) ? 'persistent' : 'best-effort';
  } catch {
    return 'unknown';
  }
}
