/** Component-local GET coordination. Never caches data or retries mutations. */
export function createLatestRequest() {
  let generation = 0;
  let pending: Promise<void> | null = null;
  let controller: AbortController | null = null;

  function cancel() {
    generation += 1;
    controller?.abort();
    controller = null;
    pending = null;
  }

  function run<T>(options: {
    load: (signal: AbortSignal) => Promise<T>;
    commit: (value: T) => void;
    replace?: boolean;
    start?: () => void;
    finish?: () => void;
    fail?: (error: unknown) => void;
  }): Promise<void> {
    if (pending && !options.replace) return pending;
    cancel();
    const current = generation;
    controller = new AbortController();
    const signal = controller.signal;
    options.start?.();
    const request = Promise.resolve()
      .then(() => options.load(signal))
      .then((value) => {
        if (current === generation) options.commit(value);
      })
      .catch((error: unknown) => {
        if (current !== generation) return;
        if (options.fail) options.fail(error);
        else throw error;
      })
      .finally(() => {
        if (current !== generation) return;
        pending = null;
        controller = null;
        options.finish?.();
      });
    pending = request;
    return request;
  }

  return { run, cancel };
}
