// Local file access. Uses the File System Access API where the browser has it
// (Chromium), which allows watching files for changes. Elsewhere falls back to
// <input type=file>.

export const canPickFiles = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

export async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Read a picked file into an immutable snapshot. */
export async function snapshot(file, handle = null) {
  const bytes = await file.arrayBuffer();
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    sha256: await sha256(bytes),
    bytes,
    file,
    handle,
  };
}

const DOC_TYPES = [
  { description: 'PDF or HTML document', accept: { 'application/pdf': ['.pdf'], 'text/html': ['.html', '.htm'] } },
];

export const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
export const isHtml = (file) => /\.html?$/i.test(file.name) || file.type === 'text/html';

function pickWithInput(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] ? { file: input.files[0] } : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Ask the user for a PDF or HTML file. Returns { file, handle? } or null when cancelled. */
export async function pickFile() {
  if (canPickFiles) {
    try {
      const [handle] = await window.showOpenFilePicker({ id: 'review-pdf', types: DOC_TYPES });
      return { file: await handle.getFile(), handle };
    } catch (err) {
      if (err.name === 'AbortError') return null;
      throw err;
    }
  }
  return pickWithInput('application/pdf,.pdf,text/html,.html,.htm');
}

/** Files from a drop event, with handles when the browser provides them. */
export async function filesFromDrop(dataTransfer) {
  const out = [];
  for (const item of dataTransfer.items ?? []) {
    if (item.kind !== 'file') continue;
    const handle = item.getAsFileSystemHandle ? await item.getAsFileSystemHandle() : null;
    const file = item.getAsFile();
    if (file) out.push({ file, handle: handle?.kind === 'file' ? handle : null });
  }
  return out;
}

/**
 * Poll a snapshot's file on disk. Calls onChange once when the content no
 * longer matches the snapshot. Returns a stop function.
 */
export function watchSnapshot(snap, onChange, intervalMs = 2000) {
  let stopped = false;
  let seen = { lastModified: snap.lastModified, size: snap.size };
  const tick = async () => {
    try {
      if (snap.handle) {
        const f = await snap.handle.getFile();
        if (f.lastModified === seen.lastModified && f.size === seen.size) return;
        seen = { lastModified: f.lastModified, size: f.size };
        if ((await sha256(await f.arrayBuffer())) !== snap.sha256) finish('modified');
      } else {
        // Without a handle, Chromium/Firefox refuse to read a File whose
        // underlying file changed after it was picked.
        await snap.file.slice(0, 1).arrayBuffer();
      }
    } catch {
      finish('unreadable');
    }
  };
  const finish = (reason) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    onChange(reason);
  };
  const timer = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Save text to a file the user chooses. Uses a native save dialog where
 * available, otherwise a download. Returns false when the user cancelled.
 */
export async function saveTextFile(name, text, { description = 'JSON file', mime = 'application/json' } = {}) {
  if ('showSaveFilePicker' in window) {
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const handle = await window.showSaveFilePicker({
        id: 'review-file',
        suggestedName: name,
        types: [{ description, accept: { [mime]: [ext] } }],
      });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      throw err;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Ask the user for a JSON file and return its text, or null when cancelled. */
export async function pickJsonFile() {
  const picked = await pickWithInput('application/json,.json');
  return picked ? picked.file.text() : null;
}
