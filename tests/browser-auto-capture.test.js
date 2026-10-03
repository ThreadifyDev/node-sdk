import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserAutoCapture } from '@threadify/sdk/browser';

class Element {
  constructor(tagName, parentElement = null, attrs = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.parentElement = parentElement;
    this.attrs = attrs;
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
    this.id = attrs.id || '';
    this.listeners = new Map();
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  contains(other) { for (let node = other; node; node = node.parentElement) if (node === this) return true; return false; }
  matches(selector) { return selector.split(',').some(part => {
    part = part.trim();
    if (part.startsWith('#')) return this.id === part.slice(1);
    if (part === '[data-threadify-action]' || part === '[data-threadify-step]') return this.getAttribute(part.slice(1, -1)) !== null;
    if (part === '[role="button"]') return this.getAttribute('role') === 'button';
    if (part === 'a[href]') return this.tagName === 'A' && this.getAttribute('href') !== null;
    return this.tagName.toLowerCase() === part;
  }); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name) { this.listeners.delete(name); }
  click(target) { this.listeners.get('click')?.({ type: 'click', target, composedPath: () => [target] }); }
}

test('auto capture records mapped clicks as steps on the same thread and respects component includes', async () => {
  const calls = [];
  const thread = {
    captureAction: async (name, context, options) => { calls.push({ kind: 'action', name, context, options }); return { classification: 'substep' }; },
    step: name => ({ addContext: context => ({ success: async () => { calls.push({ kind: 'step', name, context }); return { stepId: 'one' }; } }) })
  };
  const root = new Element('main');
  const component = new Element('section', root);
  const mapped = new Element('button', component, { id: 'mapped', 'data-threadify-context-order-id': '42' });
  const mappedTile = new Element('div', component, { id: 'mapped-tile' });
  const excluded = new Element('button', component, { id: 'excluded' });
  const outside = new Element('button', root, { id: 'outside' });
  const recorded = [];
  const capture = new BrowserAutoCapture({ thread, root, onRecorded: event => recorded.push(event) });
  const remove = capture.scope(component, { include: ['#mapped', '#mapped-tile'], steps: { '#mapped': 'checkout', '#mapped-tile': 'tile_opened' } });

  root.click(excluded);
  root.click(mapped);
  root.click(mappedTile);
  root.click(outside);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [
    { kind: 'step', name: 'checkout', context: { order_id: '42' } },
    { kind: 'step', name: 'tile_opened', context: {} },
    { kind: 'action', name: 'click:outside', context: {}, options: { eventType: 'click', path: '' } }
  ]);
  assert.equal(recorded[0].step, 'checkout');
  assert.equal(recorded[1].step, 'tile_opened');
  assert.equal(recorded[2].step, null);

  remove();
  root.click(excluded);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1).name, 'click:excluded');
  capture.stop();
  root.click(mapped);
  assert.equal(calls.length, 4);
});

test('manual action capture sends supplied context without completing a step', async () => {
  const calls = [];
  const thread = { captureAction: async (...args) => { calls.push(args); return { classification: 'free_form' }; } };
  const capture = new BrowserAutoCapture({ thread, root: new Element('main') });
  assert.deepEqual(await capture.capture('quoted', { quoteId: 'q1' }), { classification: 'free_form' });
  assert.deepEqual(calls, [['quoted', { quoteId: 'q1' }, {}]]);
  capture.stop();
});
