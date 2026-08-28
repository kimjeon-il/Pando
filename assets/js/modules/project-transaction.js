import {
  RELIABILITY_ERROR_CATEGORIES,
  RELIABILITY_SEVERITIES,
  createOperationalError,
  isAbortError,
} from './reliability-core.js';

function validationError(operationType, issues) {
  const detail = Array.isArray(issues) ? issues : [issues].filter(Boolean);
  const error = createOperationalError({
    code: 'PL-TX-VALIDATION-001',
    category: RELIABILITY_ERROR_CATEGORIES.TRANSACTION,
    severity: RELIABILITY_SEVERITIES.ERROR,
    retryable: false,
    operationType,
    technicalMessage: `Transaction validation failed: ${detail.map(item => item?.message || item).join(' / ')}`,
  });
  error.issues = detail;
  return error;
}

function assertValidationResult(result, operationType) {
  if (result == null || result === true) return;
  if (result === false) throw validationError(operationType, ['validation returned false']);
  if (typeof result === 'object' && result.ok === false) {
    throw validationError(operationType, result.issues || result.errors || []);
  }
}

function elapsed(startedAt) {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
}

async function runNonCriticalSideEffect({
  stage,
  action,
  diagnostic,
  operationType,
  onSideEffectError,
}) {
  try {
    await action();
    return null;
  } catch (error) {
    diagnostic?.push?.({
      category: stage === 'autosave' ? 'storage' : 'transaction',
      operation: operationType,
      result: `${stage}-failed`,
      errorCode: String(error?.code || (stage === 'autosave' ? 'PL-STORAGE-AUTOSAVE-001' : 'PL-TX-SIDE-EFFECT-001')),
    });
    try { await onSideEffectError(error, { stage, operationType }); }
    catch (callbackError) { console.error('[PL-TX-SIDE-EFFECT-002]', callbackError); }
    return error;
  }
}

export async function runProjectTransaction({
  operationType = 'project-edit',
  snapshot,
  prepare = async () => undefined,
  normalize = value => value,
  validatePrepared = () => true,
  applyCanonical = async value => value,
  validateCanonical = () => true,
  commitExternal = async () => {},
  commitHistory = () => {},
  queueAutosave = () => {},
  restore = async () => {},
  onSuccess = () => {},
  onError = () => {},
  onSideEffectError = () => {},
  diagnostic = null,
} = {}) {
  let stage = 'prepare';
  let externalCommitted = false;
  let historyCommitted = false;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  try {
    const prepared = await prepare();

    stage = 'normalize';
    const normalized = await normalize(prepared);

    stage = 'validate-prepared';
    assertValidationResult(await validatePrepared(normalized), operationType);

    stage = 'apply-canonical';
    const applyOutput = await applyCanonical(normalized);
    const applied = applyOutput === undefined ? normalized : applyOutput;

    stage = 'validate-canonical';
    assertValidationResult(await validateCanonical(applied, normalized), operationType);

    stage = 'commit-external';
    await commitExternal(applied, normalized);
    externalCommitted = true;

    stage = 'history';
    await commitHistory(snapshot, applied, normalized);
    historyCommitted = true;

    // Autosave and success-notification hooks are intentionally non-critical.
    // Once canonical state + history are committed, a storage/UI side effect must
    // never roll the data model back to an older snapshot.
    stage = 'autosave';
    const autosaveError = await runNonCriticalSideEffect({
      stage,
      action: () => queueAutosave(applied, normalized),
      diagnostic,
      operationType,
      onSideEffectError,
    });

    stage = 'success';
    const successHookError = await runNonCriticalSideEffect({
      stage: 'success-hook',
      action: () => onSuccess(applied, normalized),
      diagnostic,
      operationType,
      onSideEffectError,
    });

    diagnostic?.push?.({
      category: 'transaction',
      operation: operationType,
      result: autosaveError || successHookError ? 'success-with-warning' : 'success',
      duration: elapsed(startedAt),
      errorCode: autosaveError?.code || successHookError?.code || '',
    });

    return {
      ok: true,
      result: applied,
      prepared: normalized,
      externalCommitted,
      historyCommitted,
      autosaveError,
      successHookError,
    };
  } catch (error) {
    const cancelled = isAbortError(error);
    try {
      await restore(snapshot, {
        stage,
        externalCommitted,
        historyCommitted,
        operationType,
        error,
      });
    } catch (restoreError) {
      diagnostic?.push?.({
        category: 'transaction',
        operation: operationType,
        result: 'restore-failed',
        errorCode: 'PL-TX-RESTORE-001',
      });
      if (!cancelled) console.error('[PL-TX-RESTORE-001]', restoreError);
    }

    if (!cancelled) await onError(error, { stage, externalCommitted, historyCommitted, operationType });
    diagnostic?.push?.({
      category: 'transaction',
      operation: operationType,
      result: cancelled ? 'cancelled' : 'failed',
      errorCode: String(error?.code || 'PL-TX-001'),
      duration: elapsed(startedAt),
    });
    return { ok: false, cancelled, error, stage, externalCommitted, historyCommitted };
  }
}
