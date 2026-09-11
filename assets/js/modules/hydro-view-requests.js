export function createHydroViewRequests({ schedule = setTimeout, cancel = clearTimeout, retry, notify, onSuppressed = () => {} }) {
  const records = new Map();
  let generation = 0;
  let currentKey = null;
  function clearTimer(record) {
    if (record?.timer) cancel(record.timer);
    if (record) record.timer = null;
  }
  function enter(key) {
    if (key !== currentKey) {
      const previous = records.get(currentKey);
      clearTimer(previous);
      if (previous?.phase === 'ready') records.delete(currentKey);
      if (previous?.phase === 'loading') previous.phase = 'idle';
      currentKey = key;
    }
    let record = records.get(key);
    if (!record) {
      record = { phase: 'idle', attempts: 0, notified: false, timer: null, revision: null, due: 0 };
      records.set(key, record);
    }
    if (record.phase === 'retry-wait' && !record.timer) arm(key, record);
    return record;
  }
  function arm(key, record) {
    const epoch = generation;
    record.timer = schedule(() => {
      record.timer = null;
      if (generation !== epoch || currentKey !== key || record.phase !== 'retry-wait') return;
      record.phase = 'idle';
      retry();
    }, Math.max(0, record.due - Date.now()));
  }
  return {
    start(key, revision) {
      const record = enter(key);
      if (record.phase !== 'idle') {
        if (record.phase === 'exhausted') onSuppressed();
        return false;
      }
      record.phase = 'loading';
      record.revision = revision;
      return true;
    },
    ready(revision) {
      const record = records.get(currentKey);
      if (!record || record.phase !== 'loading' || record.revision !== revision) return false;
      record.phase = 'ready';
      return true;
    },
    fail(revision, message) {
      const record = records.get(currentKey);
      if (!record || record.phase !== 'loading' || record.revision !== revision) return false;
      record.attempts += 1;
      if (message.retryable !== false && record.attempts <= 3) {
        record.phase = 'retry-wait';
        record.due = Date.now() + 400 * (2 ** (record.attempts - 1));
        arm(currentKey, record);
      } else {
        record.phase = 'exhausted';
        if (!record.notified) { record.notified = true; notify(message); }
      }
      return record.phase;
    },
    retryCurrent() {
      if (records.get(currentKey)?.phase === 'loading') return false;
      clearTimer(records.get(currentKey));
      records.delete(currentKey);
      return true;
    },
    reset() {
      generation += 1;
      for (const record of records.values()) clearTimer(record);
      records.clear();
      currentKey = null;
    },
  };
}
