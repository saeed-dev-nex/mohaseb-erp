// One in-flight request at most; visibility changes never start a second one.
export function startVisibilityPoll(
  run,
  { document, setTimeout, clearTimeout },
) {
  let active = true;
  let inFlight = false;
  let timer;
  const controller = new AbortController();
  const schedule = () => {
    clearTimeout(timer);
    if (active) timer = setTimeout(poll, document.hidden ? 60000 : 15000);
  };
  const poll = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      await run(controller.signal, () => active);
    } catch {
      /* A later poll retries transient failures. */
    } finally {
      inFlight = false;
      schedule();
    }
  };
  const onVisibility = () => {
    clearTimeout(timer);
    if (document.hidden) schedule();
    else void poll();
  };
  document.addEventListener("visibilitychange", onVisibility);
  void poll();
  return () => {
    active = false;
    clearTimeout(timer);
    controller.abort();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
