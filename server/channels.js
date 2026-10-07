// "Ask Claude" through the Claude Inbox channel: lists the Claude Code
// sessions that run it (started with the `channels-claude` shell function, see
// README) and forwards questions from the browser to the one the user picked.
// Runs inside the Vite dev and preview servers only; a static deploy has no
// /api/channels.
//
// The browser never talks to a channel directly: channels listen on other
// ports and need the secret token from the registry, which only this server
// can read.

import { readFileSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where inbox channels register, one `<id>.json` per running session (registry v1). */
const REGISTRY_DIR = join(homedir(), '.claude', 'channels', 'inbox', 'sessions');

/** How Claude should treat a reviewer question; travels with every question. */
const FRAMING = [
  'Local File Reviewer is a browser app where the person reads documents, often ones made in this session, and asks about passages they select.',
  'Answer like a colleague who knows the document and this session: briefly, a few sentences unless the question needs more. You may read files to answer.',
  'This question is read-only: do not edit files or run commands that change anything because of it. If it asks for a change, reply with what you would change; the person decides in the terminal.',
  'Format: plain text. **bold**, `code` and lines starting with "- " are fine; no headings or tables.',
].join('\n');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Registry entries of running inbox channels, newest first. */
function liveChannels() {
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
      if (entry.v === 1 && alive(entry.pid)) out.push(entry);
    } catch {
      // half-written or foreign file: ignore
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

const MAX_BODY = 1024 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

/**
 * Only this app's own pages may ask: browsers always send Origin on POST, and
 * other sites (including other localhost ports) cannot fake it. Scripts inside
 * an opened HTML document run on this origin and can ask too.
 */
const sameOrigin = (req) => req.headers.origin === `http://${req.headers.host}`;

/**
 * POST to a channel and resolve with its status and JSON body. Uses node:http,
 * not fetch, whose default 5-minute header timeout is shorter than a busy
 * session may take to answer.
 */
function postToChannel(channel, payload, signal) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: channel.port,
        path: '/ask',
        method: 'POST',
        headers: { Authorization: `Bearer ${channel.token}`, 'Content-Type': 'application/json' },
        signal,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch {
            reject(new Error('Invalid answer from the channel.'));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(payload));
  });
}

/** What the browser may see of a channel: never its port or token. */
const describe = (c) => ({ id: c.id, project: c.project, cwd: c.cwd, startedAt: c.startedAt });

async function handle(req, res) {
  const path = req.url.split('?')[0];
  if (req.method === 'GET' && path === '/api/channels') return sendJson(res, 200, { sessions: liveChannels().map(describe) });

  if (req.method === 'POST' && path === '/api/channels/ask') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Forbidden.' });
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    if (typeof body.prompt !== 'string' || !body.prompt) return sendJson(res, 400, { error: 'Missing question.' });
    const channel = liveChannels().find((c) => c.id === body.sessionId);
    if (!channel) return sendJson(res, 404, { error: 'That Claude session is no longer running.' });

    // Closing the page cancels the wait in the channel too.
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const { status, body: answer } = await postToChannel(
        channel,
        {
          text: `${FRAMING}\n\n${body.prompt}`,
          meta: { app: 'local-file-reviewer', document: String(body.document ?? '').slice(0, 200) },
        },
        abort.signal,
      );
      return sendJson(res, status, answer);
    } catch (err) {
      if (abort.signal.aborted) return;
      return sendJson(res, 502, { error: `Could not reach the Claude session: ${err.message}` });
    }
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

/** Vite plugin: serves /api/channels* from `vite` and `vite preview`. */
export function claudeChannels() {
  const install = (server) => {
    server.middlewares.use((req, res, next) => {
      if (!req.url.startsWith('/api/channels')) return next();
      handle(req, res).catch((err) => {
        if (!res.headersSent) sendJson(res, 500, { error: err.message });
        else res.end();
      });
    });
  };
  return { name: 'claude-channels', configureServer: install, configurePreviewServer: install };
}
