(function installPandoLabWorkerRpc(scope) {
  'use strict';

  const PROTOCOL = 'pandolab-worker-rpc';
  const PROTOCOL_VERSION = 1;
  const TYPES = Object.freeze({ REQUEST: 'request', RESULT: 'result', CANCEL: 'cancel', EVENT: 'event' });
  const ERROR_CATEGORIES = Object.freeze({
    WORKER: 'WORKER', OPERATION: 'OPERATION', CANCELLED: 'CANCELLED', TIMEOUT: 'TIMEOUT', STALE_RESULT: 'STALE_RESULT', PROTOCOL: 'PROTOCOL',
  });
  const now = () => scope.performance?.now?.() ?? Date.now();
  const text = value => String(value ?? '').trim();
  const revision = value => Number.isFinite(Number(value)) ? Number(value) : 0;

  function transferResult(result, transferables = []) {
    return Object.freeze({ __pandolabWorkerRpcTransfer: true, result, transferables: [...(transferables || [])].filter(Boolean) });
  }

  function serializeError(error, operation, requestId, projectRevision) {
    return {
      category: text(error?.category) || (error?.cancelled === true || error?.name === 'AbortError' ? ERROR_CATEGORIES.CANCELLED : ERROR_CATEGORIES.OPERATION),
      code: text(error?.code) || 'PL-WORKER-RPC-OPERATION',
      message: text(error?.message || error) || 'Worker 작업에 실패했습니다.',
      stack: text(error?.stack),
      retryable: error?.retryable === true,
      operation: text(operation),
      requestId: Number(requestId || 0),
      projectRevision: revision(projectRevision),
    };
  }

  function createCancellationError() {
    const error = new Error('Worker 작업을 취소했습니다.');
    error.name = 'AbortError';
    error.cancelled = true;
    error.category = ERROR_CATEGORIES.CANCELLED;
    error.code = 'PL-WORKER-RPC-CANCELLED';
    return error;
  }

  function install({ handlers = {}, onEvent = null } = {}) {
    const cancelled = new Set();
    const handlerMap = new Map(Object.entries(handlers || {}));

    function emitEvent(operation, payload = null, { projectRevision = 0, timing = null, transfer = [] } = {}) {
      const message = {
        rpc: PROTOCOL,
        protocolVersion: PROTOCOL_VERSION,
        type: TYPES.EVENT,
        operation: text(operation),
        projectRevision: revision(projectRevision),
        payload,
        timing,
      };
      const transferables = [...(transfer || [])].filter(Boolean);
      if (transferables.length) scope.postMessage(message, transferables);
      else scope.postMessage(message);
    }

    function register(operation, handler) {
      if (!text(operation) || typeof handler !== 'function') throw new TypeError('Worker RPC handler requires an operation and function.');
      handlerMap.set(text(operation), handler);
    }

    async function handleRequest(message) {
      const requestId = Number(message.requestId || 0);
      const operation = text(message.operation);
      const projectRevision = revision(message.projectRevision);
      const startedAt = now();
      const context = Object.freeze({
        requestId,
        operation,
        projectRevision,
        priority: Number(message.priority || 0),
        metadata: message.metadata || null,
        isCancelled: () => cancelled.has(requestId),
        throwIfCancelled() { if (cancelled.has(requestId)) throw createCancellationError(); },
        emitEvent,
      });
      let response;
      let transferables = [];
      try {
        context.throwIfCancelled();
        const handler = handlerMap.get(operation);
        if (typeof handler !== 'function') {
          const error = new Error(`알 수 없는 Worker RPC 작업입니다: ${operation || '(empty)'}`);
          error.category = ERROR_CATEGORIES.PROTOCOL;
          error.code = 'PL-WORKER-RPC-UNKNOWN-OPERATION';
          throw error;
        }
        const raw = await handler(message.payload, context);
        context.throwIfCancelled();
        const wrapped = raw?.__pandolabWorkerRpcTransfer === true;
        const result = wrapped ? raw.result : raw;
        transferables = wrapped ? raw.transferables : [];
        response = {
          rpc: PROTOCOL,
          protocolVersion: PROTOCOL_VERSION,
          type: TYPES.RESULT,
          requestId,
          operation,
          projectRevision,
          ok: true,
          result,
          timing: { durationMs: Math.max(0, now() - startedAt) },
        };
      } catch (error) {
        response = {
          rpc: PROTOCOL,
          protocolVersion: PROTOCOL_VERSION,
          type: TYPES.RESULT,
          requestId,
          operation,
          projectRevision,
          ok: false,
          error: serializeError(error, operation, requestId, projectRevision),
          timing: { durationMs: Math.max(0, now() - startedAt) },
        };
      } finally {
        cancelled.delete(requestId);
      }
      if (transferables.length) scope.postMessage(response, transferables);
      else scope.postMessage(response);
    }

    scope.onmessage = event => {
      const message = event?.data || {};
      if (message.rpc !== PROTOCOL || Number(message.protocolVersion) !== PROTOCOL_VERSION) return;
      if (message.type === TYPES.CANCEL) {
        cancelled.add(Number(message.requestId || 0));
        return;
      }
      if (message.type === TYPES.EVENT) {
        if (typeof onEvent === 'function') Promise.resolve(onEvent(message.operation, message.payload, {
          projectRevision: revision(message.projectRevision),
          priority: Number(message.priority || 0),
          metadata: message.metadata || null,
          emitEvent,
        })).catch(error => emitEvent('worker-rpc.event-error', {
          operation: text(message.operation),
          error: serializeError(error, message.operation, 0, message.projectRevision),
        }, { projectRevision: message.projectRevision }));
        return;
      }
      if (message.type === TYPES.REQUEST) void handleRequest(message);
    };

    return Object.freeze({ register, emitEvent, isCancelled: requestId => cancelled.has(Number(requestId || 0)) });
  }

  scope.PandoLabWorkerRpc = Object.freeze({
    PROTOCOL,
    PROTOCOL_VERSION,
    TYPES,
    ERROR_CATEGORIES,
    install,
    transferResult,
  });
})(self);
