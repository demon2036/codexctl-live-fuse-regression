export function createCoalescedScheduler(task, onError = () => {}) {
  let pending = false;
  let running = false;
  let drain = Promise.resolve();

  function schedule() {
    pending = true;
    if (running) return drain;
    running = true;
    drain = (async () => {
      try {
        while (pending) {
          pending = false;
          try {
            await task();
          } catch (error) {
            await onError(error);
          }
        }
      } finally {
        running = false;
      }
    })();
    return drain;
  }

  return {
    schedule,
    idle: () => drain,
  };
}
