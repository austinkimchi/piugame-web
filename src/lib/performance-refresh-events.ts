export type PerformanceRefreshState = "idle" | "syncing";

let performanceRefreshState: PerformanceRefreshState = "idle";
const listeners = new Set<() => void>();

export function emitPerformanceRefreshState(state: PerformanceRefreshState) {
  if (performanceRefreshState === state) {
    return;
  }

  performanceRefreshState = state;
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
