import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export function waitError(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, ...detail });
}

export function waitOptions(options = {}) {
  const timeout = options.timeout ?? 10000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300000) {
    throw new TypeError('timeout must be between 1 and 300000 milliseconds');
  }
  return { timeout, signal: options.signal };
}

// Correlation is mandatory for the new wait protocol. Never accept another
// invocation's acknowledgement, including a legacy uncorrelated response.
export function request(connection, message, options = {}) {
  const { timeout, signal } = waitOptions(options);
  if (signal?.aborted) return Promise.reject(waitError('THREADIFY_WAIT_CANCELLED', 'Wait cancelled'));
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const deadline = performance.now() + timeout;
    let timer;
    let sent = false;
    const cancelRemote = () => {
      if (!sent || !(message.await || message.waitFor) || connection.ws.readyState !== 1) return;
      try { connection._send({ action: 'cancelWait', targetRequestId: requestId }); } catch { /* Transport already rejected its requests. */ }
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const i = connection._pendingResponseHandlers.indexOf(handler);
      if (i >= 0) connection._pendingResponseHandlers.splice(i, 1);
    };
    const fail = error => { cleanup(); error.requestId ??= requestId; reject(error); };
    const abort = () => { cancelRemote(); fail(waitError('THREADIFY_WAIT_CANCELLED', 'Wait cancelled')); };
    const handler = response => {
      if (response.requestId !== requestId) return false;
      // The dispatcher removes a consumed handler. Avoid changing its array here.
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // I/O can be delivered before an overdue timer after an event-loop stall.
      if (performance.now() >= deadline) {
        cancelRemote();
        reject(waitError('THREADIFY_WAIT_TIMEOUT', 'Timed out waiting for Engine response', { requestId }));
        return true;
      }
      if (response.status !== 'success') reject(waitError('THREADIFY_REQUEST_FAILED', response.message || 'Request failed', { response, isDuplicate: response.isDuplicate }));
      else resolve(response);
      return true;
    };
    timer = setTimeout(() => { cancelRemote(); fail(waitError('THREADIFY_WAIT_TIMEOUT', 'Timed out waiting for Engine response')); }, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    connection._onceResponse(handler, fail);
    try { sent = true; connection._send({ ...message, requestId }); } catch (error) { fail(error); }
  });
}

// One request and one final response. Older Engines that return a pending
// snapshot are rejected instead of silently reverting to SDK polling.
async function waitForDecision(thread, query, options = {}) {
  const { timeout, signal } = waitOptions(options);
  let result;
  try { result = await request(thread.connection, {
    action: 'waitFor', threadId: thread.threadId, ...query, await: true, timeoutMs: Math.ceil(timeout)
  }, { timeout, signal }); }
  catch (error) { error.stepId ??= query.stepId; error.invocationId ??= query.invocationId; throw error; }
  checkWaitResult(result);
  if (query.stepId && result.stepId !== query.stepId || result.decision === 'allowed' && result.invocationId !== query.invocationId) {
    throw waitError('THREADIFY_INVALID_WAIT_RESPONSE', 'Engine returned a different invocation');
  }
  return result;
}

export function checkWaitResult(result) {
  if (!result || !result.decision || result.decision === 'pending') {
    throw waitError('THREADIFY_SYNC_WAIT_UNSUPPORTED', 'Engine did not return a final synchronous wait result');
  }
  if (result.decision === 'timed_out' || result.decision === 'cancelled') {
    throw waitError(result.decision === 'timed_out' ? 'THREADIFY_WAIT_TIMEOUT' : 'THREADIFY_WAIT_CANCELLED', result.message || 'Wait ended', { stepId: result.stepId, invocationId: result.invocationId });
  }
  return result;
}

export function checkedValidation(result, stepId) {
  checkWaitResult(result);
  if (result.stepId !== stepId) throw waitError('THREADIFY_INVALID_WAIT_RESPONSE', 'Engine returned a different event validation', { stepId });
  if (result.decision !== 'passed') {
    throw waitError(result.decision === 'violated' ? 'THREADIFY_VALIDATION_VIOLATED' : 'THREADIFY_VALIDATION_UNAVAILABLE', result.message || 'Validation unavailable', { validation: result, stepId });
  }
  return result;
}

export function invocationID() { return randomUUID(); }

export { waitForDecision };
