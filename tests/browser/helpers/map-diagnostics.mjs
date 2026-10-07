// Test-log summaries only. Never pass model geometry, DOM trees or render buffers.
export function boundedDiagnostic(value) {
  const seen = new WeakSet();
  const visit = (item, depth) => {
    if (typeof item === 'string') return item.length > 240 ? `${item.slice(0, 240)}… (${item.length} chars)` : item;
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return '[circular]';
    if (depth >= 8) return '[depth limit]';
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      const items = item.slice(0, 8).map(value => visit(value, depth + 1));
      result = item.length > 8 ? { count: item.length, items } : items;
    } else if (item instanceof Error) {
      result = { name: item.name, message: visit(item.message, depth + 1) };
    } else {
      const entries = Object.entries(item);
      result = Object.fromEntries(entries.slice(0, 40).map(([key, value]) => [key, visit(value, depth + 1)]));
      if (entries.length > 40) result.omittedKeys = entries.length - 40;
    }
    seen.delete(item);
    return result;
  };
  return visit(value, 0);
}

// A stalled page must not hold the original assertion/error hostage. Promise.race
// observes late reader rejection; clear the timer on every settled/deadline path.
export async function withDiagnosticDeadline(read, timeoutMs = 1000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Diagnostic read exceeded ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function logMapDiagnostic(boundary, phase, read, write = console.log) {
  let data;
  try { data = boundedDiagnostic(await withDiagnosticDeadline(read)); }
  catch (error) { data = { diagnosticError: boundedDiagnostic(error) }; }
  try {
    let json = JSON.stringify({ boundary, phase, data });
    if (json.length > 23000) json = JSON.stringify({ boundary, phase, truncated: true, preview: json.slice(0, 3000) });
    write(`[map-diagnostic] ${json}`);
  } catch (_) {
    // Diagnostic output must never replace the workflow's original result/error.
  }
}

export async function withMapDiagnostics(boundary, read, action, write = console.log) {
  await logMapDiagnostic(boundary, 'before', read, write);
  try {
    const result = await action();
    await logMapDiagnostic(boundary, 'after', read, write);
    return result;
  } catch (error) {
    await logMapDiagnostic(boundary, 'failed', read, write);
    throw error;
  }
}
