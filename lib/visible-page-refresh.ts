// Event-only refresh: no polling, and coalesce focus/pageshow/visibility events.
export function subscribeVisiblePageRefresh(
  refresh: () => void,
  lastRequestAt: () => number,
  refreshOnSubscribe = false,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (document.visibilityState !== "visible" || timer !== null) return;
    const delay = Math.max(200, 5000 - (Date.now() - lastRequestAt()));
    timer = setTimeout(() => {
      timer = null;
      if (document.visibilityState === "visible") refresh();
    }, delay);
  };
  const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) schedule(); };
  window.addEventListener("focus", schedule);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", schedule);
  if (refreshOnSubscribe) schedule();
  return () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("focus", schedule);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", schedule);
  };
}
