// One dependency contract for loaders, CPU preparation, device resources and
// presentation. Owners keep their resources; this module owns no mutable state.
const fields = ['source', 'content', 'preparation', 'context', 'presentation'];
function validate(value) {
  if (!value || fields.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !fields.includes(key))
    || fields.filter(key => key !== 'context').some(key => typeof value[key] !== 'string' || !value[key]))
    throw new TypeError('Resource dependency keys are required');
  const context = value.context;
  if (context !== null && (!Array.isArray(context) || context.length !== 2 || !context[0]
    || !['object', 'function'].includes(typeof context[0])
    || !['string', 'number'].includes(typeof context[1]))) throw new TypeError('Invalid resource context dependency');
}

export function resourceUpdate(previous, next) {
  validate(next);
  if (previous !== null) validate(previous);
  const input = previous === null || previous.source !== next.source || previous.content !== next.content;
  const prepare = input || previous.preparation !== next.preparation;
  const contextChanged = previous === null || previous.context === null || next.context === null
    ? previous?.context !== next.context
    : previous.context[0] !== next.context[0] || previous.context[1] !== next.context[1];
  const upload = (next.context !== null || previous?.context != null) && (prepare || contextChanged);
  return Object.freeze({ input, prepare, upload,
    present: prepare || contextChanged || previous.presentation !== next.presentation });
}

// Only small dependency metadata belongs here. Coordinates use their existing
// immutable source/version identity, never whole-project serialization per frame.
export function resourceKey(value) {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
      || typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Invalid resource dependency value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(resourceKey).join(',')}]`;
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Resource keys require plain metadata');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${resourceKey(value[key])}`).join(',')}}`;
}
