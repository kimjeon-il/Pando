// Each test controls its own wall clock; production time remains untouched.
export function createVirtualClock(initialDate) {
  let current = new Date(initialDate);
  if (!Number.isFinite(current.getTime())) throw new TypeError('Invalid virtual time');
  return {
    now: () => new Date(current.getTime()),
    set(date) {
      const next = new Date(date);
      if (!Number.isFinite(next.getTime())) throw new TypeError('Invalid virtual time');
      current = next;
    },
  };
}
