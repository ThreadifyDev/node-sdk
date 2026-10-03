const DEFAULT_EVENTS = ['click', 'submit', 'change'];

function elementFrom(event) {
  const path = event.composedPath?.() || [event.target];
  return path.find(node => node?.nodeType === 1) || null;
}

function actionElement(target, type) {
  if (type === 'submit') return target.closest?.('form') || null;
  if (type === 'change') return target.closest?.('input, select, textarea') || null;
  if (type !== 'click') return null;
  const element = target.closest?.('button, input[type="button"], input[type="submit"], a[href], [role="button"], [data-threadify-action], [data-threadify-step]');
  if (element?.matches?.('button[type="submit"], input[type="submit"]') && element.closest?.('form')) return null;
  return element || null;
}

function mappedClickElement(target, rules, boundary) {
  for (const rule of rules) {
    try {
      const match = target.closest?.(rule);
      if (match && (match === boundary || boundary.contains?.(match))) return match;
    } catch { /* Action names do not have to be CSS selectors. */ }
  }
  return null;
}

function actionName(element, type) {
  const explicit = element.getAttribute?.('data-threadify-action');
  if (explicit?.trim()) return explicit.trim();
  const tag = element.tagName?.toLowerCase() || 'element';
  const identity = element.id || element.getAttribute?.('name') || element.getAttribute?.('role') || tag;
  return `${type}:${String(identity).slice(0, 96)}`;
}

function contextFrom(element, boundary, type) {
  const context = {};
  for (let node = element; node?.nodeType === 1; node = node.parentElement) {
    for (const attribute of node.attributes || []) {
      if (!attribute.name.startsWith('data-threadify-context-')) continue;
      const key = attribute.name.slice('data-threadify-context-'.length).replaceAll('-', '_');
      if (key && context[key] === undefined && Object.keys(context).length < 32) context[key] = attribute.value.slice(0, 512);
    }
    if (node === boundary) break;
  }
  const inputs = type === 'submit' ? element.querySelectorAll?.('[data-threadify-context]') || [] : [element];
  for (const input of inputs) {
    const key = input.getAttribute?.('data-threadify-context');
    if (!key || !/^[a-zA-Z][\w.-]{0,127}$/.test(key) || ['password', 'file'].includes(input.type) || Object.keys(context).length >= 32) continue;
    context[key] = String(input.value ?? '').slice(0, 512);
  }
  return context;
}

function included(include, name, element, boundary) {
  if (include === undefined) return true;
  return include.some(rule => {
    if (rule === name) return true;
    try {
      const match = element.closest?.(rule);
      return !!match && (match === boundary || boundary.contains?.(match));
    } catch { return false; }
  });
}

function mappedStep(steps, name, element, boundary) {
  const explicit = element.getAttribute?.('data-threadify-step');
  if (explicit?.trim()) return explicit.trim();
  for (const [rule, stepName] of Object.entries(steps || {})) {
    if (included([rule], name, element, boundary)) return stepName;
  }
  return null;
}

/** Opt-in, component-scoped browser action evidence capture. */
export class BrowserAutoCapture {
  constructor({ thread, root = globalThis.document, events = DEFAULT_EVENTS, steps = {}, onError, onRecorded } = {}) {
    if (!thread || typeof thread.captureAction !== 'function') throw new TypeError('A Threadify thread is required');
    if (!root || typeof root.addEventListener !== 'function') throw new TypeError('A DOM root is required');
    if (!Array.isArray(events) || events.some(event => !DEFAULT_EVENTS.includes(event))) throw new TypeError('Unsupported browser event');
    if (!steps || typeof steps !== 'object' || Array.isArray(steps) || Object.entries(steps).some(([rule, step]) => !rule.trim() || typeof step !== 'string' || !step.trim())) {
      throw new TypeError('steps must map action names or CSS selectors to step names');
    }
    this.thread = thread;
    this.root = root;
    this.onError = onError;
    this.onRecorded = onRecorded;
    this.steps = steps;
    this.scopes = [];
    this.events = [...new Set(events)];
    this.listener = event => this._captureEvent(event);
    for (const event of this.events) root.addEventListener(event, this.listener);
  }

  /** Register an include list owned by one component. Nearest scope wins. */
  scope(root, { include, thread, steps = {} } = {}) {
    if (!root || !this.root.contains?.(root)) throw new TypeError('Component root must be inside the capture root');
    if (include !== undefined && (!Array.isArray(include) || include.some(rule => typeof rule !== 'string' || !rule.trim()))) {
      throw new TypeError('include must be an array of action names or CSS selectors');
    }
    if (thread !== undefined && typeof thread.captureAction !== 'function') throw new TypeError('Invalid component thread');
    if (!steps || typeof steps !== 'object' || Array.isArray(steps) || Object.entries(steps).some(([rule, step]) => !rule.trim() || typeof step !== 'string' || !step.trim())) {
      throw new TypeError('steps must map action names or CSS selectors to step names');
    }
    const scope = { root, include, thread: thread || this.thread, steps };
    this.scopes.push(scope);
    return () => { const i = this.scopes.indexOf(scope); if (i >= 0) this.scopes.splice(i, 1); };
  }

  /** Manually capture action evidence with context. */
  capture(name, context = {}, options = {}) {
    return this.thread.captureAction(name, context, options);
  }

  _captureEvent(event) {
    const target = elementFrom(event);
    if (!target || !this.root.contains?.(target)) return;
    let scope = null;
    for (let node = target; node && node !== this.root; node = node.parentElement) {
      scope = this.scopes.find(item => item.root === node);
      if (scope) break;
    }
    const boundary = scope?.root || this.root;
    const rules = [...(scope?.include || []), ...Object.keys(scope?.steps || this.steps)];
    const element = actionElement(target, event.type) ||
      (event.type === 'click' ? mappedClickElement(target, rules, boundary) : null);
    if (!element || !this.root.contains?.(element)) return;
    const name = actionName(element, event.type);
    if (!included(scope?.include, name, element, boundary)) return;
    const context = contextFrom(element, boundary, event.type);
    const path = globalThis.location?.pathname || '';
    const activeThread = scope?.thread || this.thread;
    const step = mappedStep(scope?.steps || this.steps, name, element, boundary);
    Promise.resolve()
      .then(() => step
        ? activeThread.step(step).addContext(context).success()
        : activeThread.captureAction(name, context, { eventType: event.type, path }))
      .then(result => this.onRecorded?.({ name, step, context, eventType: event.type, path, result }))
      .catch(error => this.onError?.(error));
  }

  stop() {
    for (const event of this.events) this.root.removeEventListener(event, this.listener);
    this.scopes.length = 0;
  }
}
