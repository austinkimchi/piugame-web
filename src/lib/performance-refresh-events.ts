export type PerformanceRefreshState = "idle" | "syncing";

export type PerformanceRefreshRun<T> =
  | { started: true; value: T }
  | { started: false };

const LOCK_NAME = "mypiu-performance-refresh";
const STORAGE_KEY = "mypiu:performance-refresh";
const LEASE_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const COORDINATION_DB = "mypiu-coordination";
const COORDINATION_STORE = "locks";

let performanceRefreshState: PerformanceRefreshState = "idle";
let localRefreshes = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let storageListenerReady = false;
let ownerId: string | null = null;
let coordinationDatabasePromise: Promise<IDBDatabase> | null = null;
const listeners = new Set<() => void>();

export async function runPerformanceRefresh<T>(
  operation: () => Promise<T>,
  options: { wait?: boolean } = {},
): Promise<PerformanceRefreshRun<T>> {
  if (hasWebLocks()) {
    if (options.wait) {
      return navigator.locks.request(LOCK_NAME, async () => executeAfterStoredLease(operation, true));
    }
    return navigator.locks.request(
      LOCK_NAME,
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => lock ? executeAfterStoredLease(operation, false) : { started: false },
    );
  }

  if (typeof window !== "undefined") {
    if (!("indexedDB" in window)) return { started: false };
    return runWithIndexedDbLock(operation, options.wait === true);
  }

  if (getPerformanceRefreshState() === "syncing") return { started: false };
  return executeRefresh(operation);
}

export function getPerformanceRefreshState(): PerformanceRefreshState {
  ensureStorageListener();
  const stored = readStoredRefresh();
  scheduleExpiry(stored?.expiresAt ?? null);
  performanceRefreshState = localRefreshes > 0 || Boolean(stored) ? "syncing" : "idle";
  return performanceRefreshState;
}

export function getPerformanceRefreshServerState(): PerformanceRefreshState {
  return "idle";
}

export function subscribePerformanceRefreshState(listener: () => void): () => void {
  ensureStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function executeRefresh<T>(operation: () => Promise<T>): Promise<PerformanceRefreshRun<T>> {
  beginRefresh();
  try {
    return { started: true, value: await operation() };
  } finally {
    endRefresh();
  }
}

async function executeAfterStoredLease<T>(operation: () => Promise<T>, wait: boolean): Promise<PerformanceRefreshRun<T>> {
  if (getPerformanceRefreshState() === "syncing") {
    if (!wait) return { started: false };
    await waitForIdle();
  }
  return executeRefresh(operation);
}

function beginRefresh() {
  localRefreshes += 1;
  if (localRefreshes === 1) {
    publishRefreshLease();
    heartbeat = setInterval(publishRefreshLease, HEARTBEAT_MS);
  }
  refreshStateAndNotify();
}

function endRefresh() {
  localRefreshes = Math.max(0, localRefreshes - 1);
  if (localRefreshes === 0) {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    clearOwnedRefreshLease();
  }
  refreshStateAndNotify();
}

function waitForIdle(): Promise<void> {
  if (getPerformanceRefreshState() === "idle") return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = subscribePerformanceRefreshState(() => {
      if (getPerformanceRefreshState() === "idle") {
        unsubscribe();
        resolve();
      }
    });
  });
}

function publishRefreshLease() {
  if (typeof window === "undefined") return;
  try {
    ownerId ??= window.crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ownerId, expiresAt: Date.now() + LEASE_MS }));
  } catch {
    // Web Locks still serialize supported browsers when storage is unavailable.
  }
}

function clearOwnedRefreshLease() {
  if (typeof window === "undefined" || !ownerId) return;
  try {
    const stored = readStoredRefresh();
    if (stored?.ownerId === ownerId) window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory state is still released for this document.
  }
}

function readStoredRefresh(): { ownerId: string; expiresAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ownerId?: unknown; expiresAt?: unknown };
    if (typeof parsed.ownerId !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) {
      return null;
    }
    return { ownerId: parsed.ownerId, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function ensureStorageListener() {
  if (typeof window === "undefined" || storageListenerReady) return;
  storageListenerReady = true;
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) refreshStateAndNotify();
  });
}

function scheduleExpiry(expiresAt: number | null) {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (!expiresAt || localRefreshes > 0) return;
  expiryTimer = setTimeout(refreshStateAndNotify, Math.max(0, expiresAt - Date.now()) + 10);
}

function refreshStateAndNotify() {
  const previous = performanceRefreshState;
  const next = getPerformanceRefreshState();
  if (next === previous) return;
  for (const listener of listeners) listener();
}

function hasWebLocks(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
}

async function runWithIndexedDbLock<T>(operation: () => Promise<T>, wait: boolean): Promise<PerformanceRefreshRun<T>> {
  const lockOwner = window.crypto.randomUUID();
  while (!(await claimIndexedDbLock(lockOwner))) {
    if (!wait) return { started: false };
    await waitForLockRetry();
  }

  const lockHeartbeat = setInterval(() => {
    void renewIndexedDbLock(lockOwner).catch(() => undefined);
  }, HEARTBEAT_MS);
  try {
    return await executeRefresh(operation);
  } finally {
    clearInterval(lockHeartbeat);
    await releaseIndexedDbLock(lockOwner).catch(() => undefined);
  }
}

function waitForLockRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

async function claimIndexedDbLock(lockOwner: string): Promise<boolean> {
  const db = await coordinationDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(COORDINATION_STORE, "readwrite");
    const store = transaction.objectStore(COORDINATION_STORE);
    const request = store.get(LOCK_NAME);
    let acquired = false;
    request.onsuccess = () => {
      const current = request.result as RefreshLockRecord | undefined;
      if (current && current.expiresAt > Date.now() && current.ownerId !== lockOwner) return;
      store.put({ name: LOCK_NAME, ownerId: lockOwner, expiresAt: Date.now() + LEASE_MS } satisfies RefreshLockRecord);
      acquired = true;
    };
    transaction.oncomplete = () => resolve(acquired);
    transaction.onerror = () => reject(transaction.error ?? new Error("Performance refresh lock failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Performance refresh lock was aborted."));
  });
}

async function renewIndexedDbLock(lockOwner: string): Promise<void> {
  const db = await coordinationDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(COORDINATION_STORE, "readwrite");
    const store = transaction.objectStore(COORDINATION_STORE);
    const request = store.get(LOCK_NAME);
    request.onsuccess = () => {
      const current = request.result as RefreshLockRecord | undefined;
      if (current?.ownerId === lockOwner) {
        store.put({ ...current, expiresAt: Date.now() + LEASE_MS });
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Performance refresh lock renewal failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Performance refresh lock renewal was aborted."));
  });
}

async function releaseIndexedDbLock(lockOwner: string): Promise<void> {
  const db = await coordinationDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(COORDINATION_STORE, "readwrite");
    const store = transaction.objectStore(COORDINATION_STORE);
    const request = store.get(LOCK_NAME);
    request.onsuccess = () => {
      const current = request.result as RefreshLockRecord | undefined;
      if (current?.ownerId === lockOwner) store.delete(LOCK_NAME);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Performance refresh lock release failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Performance refresh lock release was aborted."));
  });
}

function coordinationDatabase(): Promise<IDBDatabase> {
  coordinationDatabasePromise ??= new Promise((resolve, reject) => {
    const request = window.indexedDB.open(COORDINATION_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(COORDINATION_STORE)) {
        request.result.createObjectStore(COORDINATION_STORE, { keyPath: "name" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Performance refresh coordination is unavailable."));
  });
  return coordinationDatabasePromise;
}

interface RefreshLockRecord {
  name: string;
  ownerId: string;
  expiresAt: number;
}
