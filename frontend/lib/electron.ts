/**
 * Electron environment detection and utilities
 */

/**
 * Detect if the app is running in Electron environment
 * Checks for Electron-specific APIs exposed by preload script
 */
export function isElectron(): boolean {
  if (typeof window === 'undefined') return false;

  // Check for Electron APIs exposed via contextBridge
  return !!(window as any).electronAPI || !!(window as any).__API_BASE_URL_PROMISE__;
}

/**
 * Get Electron API if available
 * Returns the electronAPI object or null if not in Electron
 */
export function getElectronAPI(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).electronAPI || null;
}
