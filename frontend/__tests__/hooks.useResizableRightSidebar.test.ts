/**
 * Unit tests for useResizableRightSidebar.
 *
 * These verify resize behavior, localStorage persistence, and clamping
 * extracted from ChatV2.
 */

import { renderHook, act } from '@testing-library/react';
import { useResizableRightSidebar } from '../hooks/useResizableRightSidebar';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------
const storageMap = new Map<string, string>();
beforeEach(() => {
  storageMap.clear();
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => storageMap.get(key) ?? null);
  jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation((key, value) => storageMap.set(key, String(value)));
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

describe('default state', () => {
  test('returns default width 320 and not resizing', () => {
    const { result } = renderHook(() => useResizableRightSidebar({ collapsed: false }));
    expect(result.current.width).toBe(320);
    expect(result.current.isResizing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// localStorage restore
// ---------------------------------------------------------------------------

describe('localStorage persistence', () => {
  test('restores width from localStorage on mount', () => {
    storageMap.set('rightSidebarWidth', '400');
    const { result } = renderHook(() => useResizableRightSidebar({ collapsed: false }));
    expect(result.current.width).toBe(400);
  });

  test('clamps restored width to min/max bounds', () => {
    storageMap.set('rightSidebarWidth', '100'); // below min 260
    const { result } = renderHook(() => useResizableRightSidebar({ collapsed: false }));
    expect(result.current.width).toBe(260);
  });

  test('persists width to localStorage when not collapsed', () => {
    renderHook(() => useResizableRightSidebar({ collapsed: false }));
    expect(storageMap.get('rightSidebarWidth')).toBe('320');
  });

  test('does not persist when collapsed', () => {
    storageMap.clear();
    renderHook(() => useResizableRightSidebar({ collapsed: true }));
    expect(storageMap.has('rightSidebarWidth')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Double click resets to default
// ---------------------------------------------------------------------------

describe('handleResizeDoubleClick', () => {
  test('resets width to default', () => {
    storageMap.set('rightSidebarWidth', '450');
    const { result } = renderHook(() => useResizableRightSidebar({ collapsed: false }));
    expect(result.current.width).toBe(450);

    act(() => {
      result.current.handleResizeDoubleClick();
    });
    expect(result.current.width).toBe(320);
  });

  test('does nothing when collapsed', () => {
    storageMap.set('rightSidebarWidth', '450');
    const { result } = renderHook(() => useResizableRightSidebar({ collapsed: true }));
    // Width is restored from localStorage regardless
    expect(result.current.width).toBe(450);

    act(() => {
      result.current.handleResizeDoubleClick();
    });
    // Width should not change
    expect(result.current.width).toBe(450);
  });
});

// ---------------------------------------------------------------------------
// handleResizeStart
// ---------------------------------------------------------------------------

describe('handleResizeStart', () => {
  test('does nothing when collapsed', () => {
    const { result } = renderHook(() => useResizableRightSidebar({ collapsed: true }));

    act(() => {
      result.current.handleResizeStart({
        clientX: 500,
      } as any);
    });
    expect(result.current.isResizing).toBe(false);
  });

  test('starts resizing when not collapsed', () => {
    const { result } = renderHook(() => useResizableRightSidebar({ collapsed: false }));

    act(() => {
      result.current.handleResizeStart({
        clientX: 500,
      } as any);
    });
    expect(result.current.isResizing).toBe(true);
  });
});
