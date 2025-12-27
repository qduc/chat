export function createAbortError(message = 'Request aborted') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export function isAbortError(error) {
  return Boolean(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'));
}
