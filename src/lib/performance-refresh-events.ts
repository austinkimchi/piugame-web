export type PerformanceRefreshState = "idle" | "syncing";

let performanceRefreshState: PerformanceRefreshState = "idle";
let activePerformanceRefreshes = 0;
const listeners = new Set<() => void>();

export function emitPerformanceRefreshState(state: PerformanceRefreshState) {
  const previousState = performanceRefreshState;
  activePerformanceRefreshes = state === "syncing"
    ? activePerformanceRefreshes + 1
    : Math.max(0, activePerformanceRefreshes - 1);
  performanceRefreshState = activePerformanceRefreshes > 0 ? "syncing" : "idle";
  if (performanceRefreshState === previousState) {
    return;
  }
  for (const listener of listeners) {
    listener();
  }
}

export function getPerformanceRefreshState(): PerformanceRefreshState {
  return performanceRefreshState;
}

export function subscribePerformanceRefreshState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
