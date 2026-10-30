export const RELIABILITY_ERROR_CATEGORIES = Object.freeze({
  NETWORK: 'NETWORK',
  PARSE: 'PARSE',
  SCHEMA: 'SCHEMA',
  GEOMETRY: 'GEOMETRY',
  RELATION: 'RELATION',
  TRANSACTION: 'TRANSACTION',
  RENDERER: 'RENDERER',
  CACHE: 'CACHE',
  WORKER: 'WORKER',
  STORAGE: 'STORAGE',
  CANCELLED: 'CANCELLED',
  STALE_RESULT: 'STALE_RESULT',
});

export const RELIABILITY_SEVERITIES = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  FATAL: 'fatal',
});

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.cancelled === true;
}

export function createCancellationError(message = '작업을 취소했습니다.') {
  const error = new Error(String(message || '작업을 취소했습니다.'));
  error.name = 'AbortError';
  error.cancelled = true;
  return error;
}

export function createOperationalError({
  code = 'PL-INTERNAL-001',
  category = RELIABILITY_ERROR_CATEGORIES.TRANSACTION,
  severity = RELIABILITY_SEVERITIES.ERROR,
  retryable = false,
  userMessage = '',
  technicalMessage = '',
  objectIds = [],
  operationType = '',
  revision = 0,
  cause = null,
} = {}) {
  const error = new Error(technicalMessage || userMessage || code, cause ? { cause } : undefined);
  error.code = code;
  error.category = category;
  error.severity = severity;
  error.retryable = retryable === true;
  error.userMessage = String(userMessage || '');
  error.objectIds = [...new Set((objectIds || []).map(String).filter(Boolean))];
  error.operationType = String(operationType || '');
  error.revision = Number(revision || 0);
  if (cause && !error.cause) error.cause = cause;
  return error;
}

export function isRetryableHttpStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

export function retryDelay(attempt, {
  baseDelay = 400,
  maxDelay = 4000,
  jitter = 0.18,
  random = Math.random,
} = {}) {
  const exponential = Math.min(maxDelay, baseDelay * (2 ** Math.max(0, Number(attempt || 1) - 1)));
  const spread = exponential * Math.max(0, Number(jitter || 0));
  return Math.max(0, Math.round(exponential - spread + random() * spread * 2));
}

async function delayWithSignal(ms, signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onResolve = finish(resolve);
    const onReject = finish(reject);
    const timer = setTimeout(onResolve, Math.max(0, Number(ms || 0)));
    const onAbort = () => {
      clearTimeout(timer);
      onReject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withRetry(operation, {
  maxAttempts = 3,
  baseDelay = 400,
  maxDelay = 4000,
  jitter = 0.18,
  shouldRetry = () => true,
  signal = null,
  onRetry = () => {},
} = {}) {
  let lastError = null;
  const attempts = Math.max(1, Number(maxAttempts || 1));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    try {
      return await operation({ attempt, signal });
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || attempt >= attempts || !shouldRetry(error, attempt)) throw error;
      const delay = retryDelay(attempt, { baseDelay, maxDelay, jitter });
      onRetry({ attempt, delay, error });
      await delayWithSignal(delay, signal);
    }
  }
  throw lastError;
}

export function isRecoverableLoadError(error) {
  return error?.retryable === true && !isAbortError(error) && !error.restoreError && !error.cleanupError
    && (error.category === RELIABILITY_ERROR_CATEGORIES.NETWORK || String(error.code || '').startsWith('PL-NETWORK-'));
}

// Do not spend download attempts while the browser cannot make useful progress.
// Workers have no document, but can still observe their online/offline state.
export async function waitForRequestAvailability(signal = null, environment = globalThis) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  const target = environment.window || environment, document = environment.document;
  const available = () => document?.visibilityState !== 'hidden' && environment.navigator?.onLine !== false;
  if (available() || typeof target.addEventListener !== 'function') return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      for (const type of ['online', 'focus', 'pageshow']) target.removeEventListener(type, check);
      document?.removeEventListener('visibilitychange', check);
      signal?.removeEventListener('abort', abort);
    };
    const check = () => { if (available()) { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    for (const type of ['online', 'focus', 'pageshow']) target.addEventListener(type, check);
    document?.addEventListener('visibilitychange', check);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else check();
  });
}

// A fresh foreground grace period is safer than charging frozen time to an I/O
// deadline. Progress renews the same deadline; old callbacks lose ownership.
export function createForegroundDeadline(callback, milliseconds, environment = globalThis) {
  const target = environment.window || environment, document = environment.document;
  let timer = null, version = 0, disposed = false;
  const clear = () => { version++; if (timer !== null) environment.clearTimeout(timer); timer = null; };
  const renew = () => {
    clear();
    if (disposed || document?.visibilityState === 'hidden') return;
    const current = version;
    timer = environment.setTimeout(() => {
      if (disposed || current !== version || document?.visibilityState === 'hidden') return;
      timer = null;
      callback();
    }, milliseconds);
  };
  document?.addEventListener('visibilitychange', renew);
  document?.addEventListener('resume', renew);
  target.addEventListener?.('pageshow', renew);
  renew();
  return Object.freeze({ renew, dispose() {
    disposed = true; clear();
    document?.removeEventListener('visibilitychange', renew);
    document?.removeEventListener('resume', renew);
    target.removeEventListener?.('pageshow', renew);
  } });
}

export async function fetchWithRetry(input, init = {}, {
  maxAttempts = 3,
  baseDelay = 400,
  maxDelay = 4000,
  jitter = 0.18,
  timeoutMs = 15000,
  signal = init.signal || null,
  retryStatuses = isRetryableHttpStatus,
  onRetry = () => {},
  fetchFn = globalThis.fetch,
  consume = null,
  environment = globalThis,
} = {}) {
  return withRetry(async ({ signal: retrySignal }) => {
    await waitForRequestAvailability(retrySignal, environment);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(retrySignal?.reason);
    retrySignal?.addEventListener('abort', abort, { once: true });
    if (retrySignal?.aborted) abort();
    const deadline = createForegroundDeadline(() => {
      timedOut = true;
      controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, Math.max(1000, Number(timeoutMs || 15000)), environment);
    let rejectAborted;
    const aborted = new Promise((_resolve, reject) => {
      rejectAborted = () => reject(controller.signal.reason || new DOMException('Aborted', 'AbortError'));
      controller.signal.addEventListener('abort', rejectAborted, { once: true });
      if (controller.signal.aborted) rejectAborted();
    });
    try {
      return await Promise.race([aborted, (async () => {
        controller.signal.throwIfAborted();
        const response = await fetchFn(input, { ...init, signal: controller.signal });
        if (!response.ok && retryStatuses(response.status)) {
          throw Object.assign(createOperationalError({ code: 'PL-NETWORK-HTTP',
            category: RELIABILITY_ERROR_CATEGORIES.NETWORK, retryable: true,
            technicalMessage: `HTTP ${response.status}` }), { httpStatus: response.status });
        }
        // Callers opting into consumption keep cancellation and the deadline
        // alive through the last body byte, not merely until headers arrive.
        const value = consume ? await consume(response, { touch: deadline.renew, signal: controller.signal }) : response;
        controller.signal.throwIfAborted();
        return value;
      })()]);
    } catch (error) {
      controller.abort(error);
      if (retrySignal?.aborted) throw retrySignal.reason || new DOMException('Aborted', 'AbortError');
      if (timedOut) {
        throw Object.assign(createOperationalError({ code: 'PL-NETWORK-TIMEOUT',
          category: RELIABILITY_ERROR_CATEGORIES.NETWORK, retryable: true,
          technicalMessage: 'Request timed out', cause: error }), { name: 'TimeoutError' });
      }
      if (error instanceof TypeError) throw createOperationalError({ code: 'PL-NETWORK-001',
        category: RELIABILITY_ERROR_CATEGORIES.NETWORK, retryable: true,
        technicalMessage: error.message, cause: error });
      throw error;
    } finally {
      deadline.dispose();
      controller.signal.removeEventListener('abort', rejectAborted);
      retrySignal?.removeEventListener('abort', abort);
    }
  }, {
    maxAttempts, baseDelay, maxDelay, jitter, signal, onRetry,
    shouldRetry: error => isRecoverableLoadError(error),
  });
}

export function createAssetState(initial = {}) {
  const state = {
    manifest: 'idle',
    worker: 'idle',
    view: 'idle',
    cache: 'idle',
    lastError: null,
    ...initial,
  };
  return {
    state,
    set(part, value, error = null) {
      if (!Object.prototype.hasOwnProperty.call(state, part)) throw new Error(`Unknown asset state part: ${part}`);
      state[part] = value;
      if (error) state.lastError = error;
      return { ...state };
    },
    snapshot() { return Object.freeze({ ...state }); },
  };
}

export function createDiagnosticLog({ limit = 200, now = () => typeof performance !== 'undefined' ? performance.now() : Date.now() } = {}) {
  const events = [];
  function push(event = {}) {
    events.push(Object.freeze({
      timestamp: now(),
      category: String(event.category || 'internal'),
      operation: String(event.operation || ''),
      revision: Number(event.revision || 0),
      objectIds: [...new Set((event.objectIds || []).map(String).filter(Boolean))],
      duration: Number(event.duration || 0),
      result: String(event.result || ''),
      errorCode: String(event.errorCode || ''),
      technicalMessage: String(event.technicalMessage || ''),
      stack: String(event.stack || ''),
      rollback: String(event.rollback || ''),
    }));
    while (events.length > Math.max(1, Number(limit || 200))) events.shift();
    return events[events.length - 1];
  }
  return Object.freeze({
    push,
    snapshot: () => events.slice(),
    clear: () => { events.length = 0; },
  });
}
