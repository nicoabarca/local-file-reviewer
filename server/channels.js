// "Ask Claude" through Claude Code channels: lists the Claude Code sessions
// that run the reviewer channel (started with the `channels-claude` shell
// function, see README) and forwards questions from the browser to the one
// the user picked. Runs inside the Vite dev and preview servers only; a
// static deploy has no /api/channels.
//
// The browser never talks to a channel directly: channels listen on other
// ports and need the secret token from the registry, which only this server
// can read.

import { request } from 'node:http';
import { liveChannels } from '../channel/registry.js';

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
    const channel = liveChannels().find((c) => c.id === body.sessionId);
    if (!channel) return sendJson(res, 404, { error: 'That Claude session is no longer running.' });

    // Closing the page cancels the wait in the channel too.
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const { status, body: answer } = await postToChannel(
        channel,
        { prompt: body.prompt, document: body.document },
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
