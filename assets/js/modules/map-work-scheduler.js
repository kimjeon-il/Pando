export function createMapWorkScheduler() {
  let interactionActive = false;
  const jobs = new Map();
  function cancel(key) {
    const job = jobs.get(key);
    if (!job) return;
    clearTimeout(job.timer);
    if (job.idleId && typeof cancelIdleCallback === 'function') cancelIdleCallback(job.idleId);
    jobs.delete(key);
  }
  function scheduleIdle(key, task, delay = 0) {
    cancel(key);
    const job = { task, delay, timer: 0, idleId: 0 };
    const queue = () => {
      if (interactionActive) {
        job.timer = setTimeout(queue, 180);
        return;
      }
      const run = () => {
        if (jobs.get(key) !== job || interactionActive) return queue();
        jobs.delete(key);
        task();
      };
      if (typeof requestIdleCallback === 'function') job.idleId = requestIdleCallback(run, { timeout: 1800 });
      else job.timer = setTimeout(run, 0);
    };
    job.timer = setTimeout(queue, delay);
    jobs.set(key, job);
  }
  function setInteractionActive(active) {
    interactionActive = !!active;
  }
  return { scheduleIdle, cancel, setInteractionActive, isInteractionActive: () => interactionActive };
}
