#!/usr/bin/env node
// Claude Code channel for Local File Reviewer.
//
// Claude Code starts this as an MCP server (over stdio) when a session is
// launched with the `channels-claude` shell function (see README). It
// listens on a random localhost port and announces itself in the registry
// (channel/registry.js). The app's server forwards each question from the
// browser here; this pushes it into the running session as a channel event,
// waits for Claude to call the `reply` tool with the answer, and returns the
// answer to the app.

import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { register, unregister } from './registry.js';

const ANSWER_TIMEOUT_MS = 15 * 60_000;
const MAX_BODY = 1024 * 1024;

const INSTRUCTIONS = [
  'Local File Reviewer is a browser app where the person reads documents, often ones made in this session, and asks about passages they select.',
  'Their questions arrive as <channel source="reviewer" question_id="..." document="...">. Answer each one by calling the reply tool with its question_id: the reader sees only what you send through reply, not your terminal output.',
  'Answer like a colleague who knows the document and this session: briefly, a few sentences unless the question needs more. You may read files to answer.',
  'Questions are read-only: do not edit files or run commands that change anything because of one. If a question asks for a change, reply with what you would change; the person decides in the terminal.',
  'Format: plain text. **bold**, `code` and lines starting with "- " are fine; no headings or tables.',
].join('\n');

const id = randomUUID();
const token = randomBytes(24).toString('hex');
/** question_id -> resolve(answer) for questions the app is waiting on */
const waiting = new Map();

const mcp = new Server(
  { name: 'reviewer', version: '0.1.0' },
  { capabilities: { experimental: { 'claude/channel': {} }, tools: {} }, instructions: INSTRUCTIONS },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send the answer to a Local File Reviewer question back to the reader',
      inputSchema: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'The question_id from the <channel> tag' },
          text: { type: 'string', description: 'The answer' },
        },
        required: ['question_id', 'text'],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'reply') throw new Error(`unknown tool: ${req.params.name}`);
  const { question_id, text } = req.params.arguments ?? {};
  const resolve = waiting.get(question_id);
  if (!resolve) return { content: [{ type: 'text', text: 'Not delivered: the reader is no longer waiting for this answer.' }] };
  waiting.delete(question_id);
  resolve(String(text ?? ''));
  return { content: [{ type: 'text', text: 'sent' }] };
});

// ---- HTTP: the app's server posts questions here -----------------------

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
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const http = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) return sendJson(res, 403, { error: 'Forbidden.' });
  if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/ask') return sendJson(res, 404, { error: 'Not found.' });

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  if (typeof body.prompt !== 'string' || !body.prompt) return sendJson(res, 400, { error: 'Missing question.' });

  const questionId = randomBytes(4).toString('hex');
  const answer = new Promise((resolve) => waiting.set(questionId, resolve));
  const timeout = setTimeout(() => waiting.get(questionId)?.(null), ANSWER_TIMEOUT_MS);
  // The app gave up (page closed or reloaded): stop waiting.
  res.on('close', () => waiting.get(questionId)?.(null));

  await mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: body.prompt,
      // Attribute values must be plain strings; keys letters, digits and underscores.
      meta: { question_id: questionId, document: String(body.document ?? '').slice(0, 200) },
    },
  });

  const text = await answer;
  clearTimeout(timeout);
  waiting.delete(questionId);
  if (res.writableEnded || res.destroyed) return;
  if (text == null) sendJson(res, 504, { error: 'Claude did not answer within 15 minutes.' });
  else sendJson(res, 200, { answer: text });
});

// ---- lifecycle ----------------------------------------------------------

function shutdown() {
  unregister(id);
  process.exit(0);
}

await mcp.connect(new StdioServerTransport());
// Claude Code closes stdin when the session ends.
process.stdin.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('exit', () => unregister(id));

http.listen(0, '127.0.0.1', () => {
  register({
    id,
    pid: process.pid,
    port: http.address().port,
    token,
    cwd: process.cwd(),
    project: basename(process.cwd()),
    startedAt: Date.now(),
  });
});
