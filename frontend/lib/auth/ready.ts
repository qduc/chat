let authReady = true;
let resolver: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

function ensurePromise() {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
  }
}

export function waitForAuthReady(): Promise<void> {
  if (authReady) {
    return Promise.resolve();
  }

  ensurePromise();
  return readyPromise as Promise<void>;
}

export function markAuthReady() {
  authReady = true;
  resolver?.();
  resolver = null;
}

export function resetAuthReady() {
  authReady = false;
  readyPromise = null;
  resolver = null;
  ensurePromise();
}

export function setAuthReady(value: boolean) {
  if (value) {
    markAuthReady();
  } else {
    resetAuthReady();
  }
}

export function isAuthReady() {
  return authReady;
}
