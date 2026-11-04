import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadStep } from '../src/ThreadStep.js';

test('addContext ignores the deprecated private flag and warns once', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const step = new ThreadStep('payment', { threadId: 'thread-1' });
    step.addContext({ cardLast4: '4242' }, true);
    step.addContext({ amount: 10 }, true);
    assert.deepEqual(step.getContext(), { cardLast4: '4242', amount: '10' });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /deprecated/);
  } finally {
    console.warn = original;
  }
});
