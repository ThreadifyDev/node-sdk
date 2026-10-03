import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ThreadInstance } from '../src/Thread.js';

test('CommonJS package exposes decision methods after the package build', () => {
  const require = createRequire(import.meta.url);
  const { ThreadInstance: CjsThreadInstance } = require('../dist/index.cjs');
  assert.equal(typeof CjsThreadInstance.prototype.can, 'function');
  assert.equal(typeof CjsThreadInstance.prototype.should, 'function');
  assert.equal(typeof CjsThreadInstance.prototype.next, 'function');
});

test('thread decision methods send the current thread and keep waitFor separate', async () => {
  const calls = [];
  const decisions = {
    can: { threadId: 'thread-1', stepName: 'issue_refund', allowed: true, status: 'allowed' },
    should: { threadId: 'thread-1', stepName: 'issue_refund', eligible: true, recommendation: 'uncertain' },
    next: { threadId: 'thread-1', paths: [{ actions: ['issue_refund'], status: 'allowed', reason: 'eligible' }] }
  };
  const connection = {
    _getDataRetriever: () => ({ graphqlClient: { query: async (query, variables) => {
      calls.push({ query, variables });
      return query.includes('query Can') ? { can: decisions.can } :
        query.includes('query Should') ? { should: decisions.should } : { next: decisions.next };
    } } })
  };
  const thread = new ThreadInstance(connection, 'thread-1');
  assert.equal((await thread.can({ goal: 'I want to process a refund', context: { amount: 12 } })).stepName, 'issue_refund');
  assert.equal((await thread.should({ action: 'issue_refund' })).recommendation, 'uncertain');
  assert.deepEqual((await thread.next()).paths[0].actions, ['issue_refund']);
  assert.deepEqual(calls.map(call => call.variables.threadId), ['thread-1', 'thread-1', 'thread-1']);
  assert.equal(calls[0].variables.goal, 'I want to process a refund');
  assert.deepEqual(calls[0].variables.context, { amount: 12 });
  assert.equal(calls[1].variables.action, 'issue_refund');
  assert.deepEqual(calls[2].variables, { threadId: 'thread-1' });
  await assert.rejects(thread.can({ action: 'issue_refund', goal: 'refund' }), /exactly one/);
});
