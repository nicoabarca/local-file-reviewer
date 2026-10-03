// Remembers the File System Access handle of each reviewed PDF, keyed by the
// PDF's SHA-256, so a saved review can reopen its file with one click. Handles
// are references to files on this computer, not file contents. Chromium only;
// elsewhere every call is a no-op and reopening falls back to a file picker.

const DB = 'local-file-reviewer';
const STORE = 'pdf-handles';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveHandle(sha, handle) {
  if (!handle) return;
  try {
    await run('readwrite', (s) => s.put(handle, sha));
  } catch {
    // best effort: reopening falls back to the file picker
  }
}

export async function getHandle(sha) {
  try {
    return (await run('readonly', (s) => s.get(sha))) ?? null;
  } catch {
    return null;
  }
}

export async function deleteHandle(sha) {
  try {
    await run('readwrite', (s) => s.delete(sha));
  } catch {
    // ignore
  }
}

/** Read the file behind a stored handle, asking for read permission if needed. */
export async function fileFromHandle(handle) {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) !== 'granted') {
    if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') return null;
  }
  return handle.getFile();
}
