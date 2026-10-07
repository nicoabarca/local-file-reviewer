// Where running reviewer channels announce themselves. Each Claude Code
// session started with the channel writes one file here with its local port
// and a secret token; the app's server reads them to list sessions and to call
// them. Files are private to the user (0600 in a 0700 folder).

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const REGISTRY_DIR = join(homedir(), '.local-file-reviewer', 'channels');

const fileOf = (id) => join(REGISTRY_DIR, `${id}.json`);

export function register(entry) {
  mkdirSync(REGISTRY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(fileOf(entry.id), JSON.stringify(entry), { mode: 0o600 });
}

export function unregister(id) {
  rmSync(fileOf(id), { force: true });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Entries of channels whose process is still running; stale files are removed. */
export function liveChannels() {
  let names;
  try {
    names = readdirSync(REGISTRY_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const entry = JSON.parse(readFileSync(join(REGISTRY_DIR, name), 'utf8'));
      if (alive(entry.pid)) out.push(entry);
      else unregister(entry.id);
    } catch {
      // half-written or foreign file: ignore
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}
