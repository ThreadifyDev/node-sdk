import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const origin = `http://127.0.0.1:${port}`;
const engineURL = process.env.THREADIFY_ENGINE_URL || 'http://127.0.0.1:18123';
const keyFile = process.env.THREADIFY_API_KEY_FILE;
if (!keyFile) throw new Error('THREADIFY_API_KEY_FILE must point to a server-only service key file');
const apiKey = (await readFile(keyFile, 'utf8')).trim();
const sessions = new Map();
const contractName = `browser_live_decisions_${randomBytes(5).toString('hex')}`;
let contractPromise;

function engineHeaders(type = 'application/json') {
  return { 'Content-Type': type, 'X-API-Key': apiKey };
}

async function ensureContract() {
  contractPromise ||= (async () => {
    const source = (await readFile(join(here, 'decision-contract.feature'), 'utf8'))
      .replace('__CONTRACT_NAME__', contractName);
    const response = await fetch(`${engineURL}/v1/contracts`, {
      method: 'POST', headers: engineHeaders('text/plain'), body: source
    });
    if (!response.ok) throw new Error(`Contract creation failed: HTTP ${response.status} ${await response.text()}`);
  })();
  return contractPromise;
}

async function graphQL(query, variables) {
  const response = await fetch(`${engineURL}/graphql`, {
    method: 'POST', headers: engineHeaders(), body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
  return result.data;
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function sessionFrom(req) {
  const sid = /(?:^|;\s*)browser_live_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  return sid ? sessions.get(sid) : undefined;
}

createServer(async (req, res) => {
  try {
    console.log(`${req.method} ${req.url}`);
    if (req.method === 'GET' && ['/', '/checkout', '/review', '/summary'].includes(req.url)) {
      await ensureContract();
      let session = sessionFrom(req);
      if (!session) {
        const sid = randomBytes(24).toString('hex');
        session = { threadKey: `browser-live:${sid.slice(0, 16)}`, marker: randomBytes(16).toString('hex') };
        sessions.set(sid, session);
        res.setHeader('Set-Cookie', `browser_live_session=${sid}; HttpOnly; SameSite=Strict; Path=/`);
      }
      const html = (await readFile(join(here, 'index.html'), 'utf8'))
        .replaceAll('__THREAD_KEY__', JSON.stringify(session.threadKey))
        .replaceAll('__ENGINE_URL__', JSON.stringify(engineURL))
        .replaceAll('__CONTRACT_NAME__', JSON.stringify(contractName))
        .replaceAll('__SESSION_MARKER__', JSON.stringify(session.marker))
        .replaceAll('__KNOWN_THREAD_ID__', JSON.stringify(session.threadId || null));
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && req.url === '/sdk.js') {
      return send(res, 200, await readFile(join(here, 'public/sdk.js')), 'text/javascript; charset=utf-8');
    }
    if (req.method === 'POST' && req.url === '/api/browser-token') {
      const session = sessionFrom(req);
      if (!session || req.headers.origin !== origin || req.headers['x-threadify-demo'] !== '1') {
        return send(res, 403, 'Sample session denied');
      }
      const response = await fetch(`${engineURL}/v1/browser-tokens`, {
        method: 'POST',
        headers: engineHeaders(),
        body: JSON.stringify({
          origin,
          actions: ['startThread', 'recordThreadEvent', 'recordBrowserAction', 'waitFor'],
          thread_keys: [session.threadKey],
          thread_ids: [],
          ttl_seconds: 300
        })
      });
      return send(res, response.status, await response.text(), 'application/json; charset=utf-8');
    }
    if (req.method === 'POST' && req.url === '/api/decisions') {
      const session = sessionFrom(req);
      if (!session || req.headers.origin !== origin || req.headers['x-threadify-demo'] !== '1') {
        return send(res, 403, 'Sample session denied');
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) return send(res, 413, 'Request too large');
      }
      let threadId;
      try { ({ threadId } = JSON.parse(body)); } catch { return send(res, 400, 'Invalid JSON'); }
      if (typeof threadId !== 'string' || !/^[a-f0-9-]{36}$/.test(threadId)) return send(res, 400, 'Invalid thread ID');
      const thread = await graphQL('query($id: ID!) { thread(id: $id) { id contractName refs } }', { id: threadId });
      const refs = typeof thread.thread?.refs === 'string' ? JSON.parse(thread.thread.refs) : thread.thread?.refs;
      if (thread.thread?.contractName !== contractName || refs?.browser_demo_session !== session.marker || refs?.['threadify.thread_key'] !== session.threadKey) {
        return send(res, 403, 'Thread does not belong to this sample session');
      }
      session.threadId = threadId;
      const decisions = await graphQL(`query($id: ID!, $context: JSON) {
        canCheckout: can(threadId: $id, action: "browser_checkout", context: $context) { allowed status matchedBy requiredSteps satisfiedSteps missingSteps reason }
        shouldCheckout: should(threadId: $id, action: "browser_checkout") { eligible recommendation reason }
        canComplete: can(threadId: $id, action: "browser_complete") { allowed status matchedBy requiredSteps satisfiedSteps missingSteps reason }
        shouldComplete: should(threadId: $id, action: "browser_complete") { eligible recommendation reason }
        next(threadId: $id) { paths { actions status reason } }
      }`, { id: threadId, context: { source: 'browser-live-sample' } });
      return send(res, 200, JSON.stringify(decisions), 'application/json; charset=utf-8');
    }
    send(res, 404, 'Not found');
  } catch (error) {
    console.error('Sample request failed:', error);
    send(res, 500, 'Sample request failed');
  }
}).listen(port, '127.0.0.1', () => console.log(`Browser sample: ${origin}`));
