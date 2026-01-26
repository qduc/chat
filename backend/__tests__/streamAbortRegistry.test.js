import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import {
  registerStreamAbort,
  unregisterStreamAbort,
  abortStream,
  getStreamAbortEntry
} from '../src/lib/streamAbortRegistry.js';

describe('streamAbortRegistry', () => {
  let mockController;
  let mockCancelState;

  beforeEach(() => {
    // Clear the registry between tests by unregistering all known test IDs
    ['req-1', 'req-2', 'req-3', 'req-4', 'req-5', 'req-user-1', 'req-user-2'].forEach(id => {
      unregisterStreamAbort(id);
    });

    // Create fresh mocks for each test
    mockController = {
      abort: jest.fn()
    };
    mockCancelState = {
      cancelled: false
    };
  });

  describe('registerStreamAbort', () => {
    test('should register stream with all parameters', () => {
      const requestId = 'req-1';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      const entry = getStreamAbortEntry(requestId);
      expect(entry).toBeDefined();
      expect(entry.controller).toBe(mockController);
      expect(entry.cancelState).toBe(mockCancelState);
      expect(entry.userId).toBe('user-123');
    });

    test('should register stream without optional cancelState (creates default)', () => {
      const requestId = 'req-2';
      registerStreamAbort(requestId, {
        controller: mockController,
        userId: 'user-456'
      });

      const entry = getStreamAbortEntry(requestId);
      expect(entry).toBeDefined();
      expect(entry.controller).toBe(mockController);
      expect(entry.cancelState).toEqual({ cancelled: false });
      expect(entry.userId).toBe('user-456');
    });

    test('should register stream without optional userId (sets to null)', () => {
      const requestId = 'req-3';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState
      });

      const entry = getStreamAbortEntry(requestId);
      expect(entry).toBeDefined();
      expect(entry.controller).toBe(mockController);
      expect(entry.cancelState).toBe(mockCancelState);
      expect(entry.userId).toBeNull();
    });

    test('should not register when requestId is missing', () => {
      registerStreamAbort(null, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      expect(getStreamAbortEntry(null)).toBeNull();
    });

    test('should not register when requestId is undefined', () => {
      registerStreamAbort(undefined, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      expect(getStreamAbortEntry(undefined)).toBeNull();
    });

    test('should not register when requestId is empty string', () => {
      registerStreamAbort('', {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      expect(getStreamAbortEntry('')).toBeNull();
    });

    test('should not register when controller is missing', () => {
      const requestId = 'req-4';
      registerStreamAbort(requestId, {
        controller: null,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      expect(getStreamAbortEntry(requestId)).toBeNull();
    });

    test('should not register when controller is undefined', () => {
      const requestId = 'req-5';
      registerStreamAbort(requestId, {
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      expect(getStreamAbortEntry(requestId)).toBeNull();
    });

    test('should overwrite existing registration', () => {
      const requestId = 'req-overwrite';
      const firstController = { abort: jest.fn() };
      const secondController = { abort: jest.fn() };

      registerStreamAbort(requestId, {
        controller: firstController,
        userId: 'user-old'
      });

      registerStreamAbort(requestId, {
        controller: secondController,
        userId: 'user-new'
      });

      const entry = getStreamAbortEntry(requestId);
      expect(entry.controller).toBe(secondController);
      expect(entry.userId).toBe('user-new');

      // Cleanup
      unregisterStreamAbort(requestId);
    });

    test('should handle registration with empty options object', () => {
      const requestId = 'req-empty-opts';
      registerStreamAbort(requestId, {});

      expect(getStreamAbortEntry(requestId)).toBeNull();

      // Cleanup
      unregisterStreamAbort(requestId);
    });
  });

  describe('unregisterStreamAbort', () => {
    test('should unregister existing stream', () => {
      const requestId = 'req-unregister-1';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      expect(getStreamAbortEntry(requestId)).toBeDefined();

      unregisterStreamAbort(requestId);

      expect(getStreamAbortEntry(requestId)).toBeNull();
    });

    test('should handle unregistering non-existent stream', () => {
      const requestId = 'req-non-existent';

      // Should not throw
      expect(() => {
        unregisterStreamAbort(requestId);
      }).not.toThrow();

      expect(getStreamAbortEntry(requestId)).toBeNull();
    });

    test('should handle unregistering with null requestId', () => {
      expect(() => {
        unregisterStreamAbort(null);
      }).not.toThrow();
    });

    test('should handle unregistering with undefined requestId', () => {
      expect(() => {
        unregisterStreamAbort(undefined);
      }).not.toThrow();
    });

    test('should handle unregistering with empty string requestId', () => {
      expect(() => {
        unregisterStreamAbort('');
      }).not.toThrow();
    });

    test('should allow re-registering after unregistering', () => {
      const requestId = 'req-re-register';

      registerStreamAbort(requestId, {
        controller: mockController,
        userId: 'user-123'
      });
      expect(getStreamAbortEntry(requestId)).toBeDefined();

      unregisterStreamAbort(requestId);
      expect(getStreamAbortEntry(requestId)).toBeNull();

      const newController = { abort: jest.fn() };
      registerStreamAbort(requestId, {
        controller: newController,
        userId: 'user-456'
      });

      const entry = getStreamAbortEntry(requestId);
      expect(entry).toBeDefined();
      expect(entry.userId).toBe('user-456');

      // Cleanup
      unregisterStreamAbort(requestId);
    });
  });

  describe('abortStream', () => {
    test('should abort stream successfully and return true', () => {
      const requestId = 'req-abort-1';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      const result = abortStream(requestId, 'user-123');

      expect(result).toBe(true);
      expect(mockCancelState.cancelled).toBe(true);
      expect(mockController.abort).toHaveBeenCalledWith('client_stop');
      expect(mockController.abort).toHaveBeenCalledTimes(1);
    });

    test('should abort stream when no userId is registered (public stream)', () => {
      const requestId = 'req-abort-public';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: null
      });

      const result = abortStream(requestId, 'any-user');

      expect(result).toBe(true);
      expect(mockCancelState.cancelled).toBe(true);
      expect(mockController.abort).toHaveBeenCalledWith('client_stop');
    });

    test('should abort stream when no userId is provided in abort call', () => {
      const requestId = 'req-abort-no-user';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      const result = abortStream(requestId, null);

      expect(result).toBe(true);
      expect(mockCancelState.cancelled).toBe(true);
      expect(mockController.abort).toHaveBeenCalledWith('client_stop');
    });

    test('should abort stream when both userIds are null', () => {
      const requestId = 'req-abort-both-null';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: null
      });

      const result = abortStream(requestId, null);

      expect(result).toBe(true);
      expect(mockCancelState.cancelled).toBe(true);
      expect(mockController.abort).toHaveBeenCalledWith('client_stop');
    });

    test('should return false when userId does not match', () => {
      const requestId = 'req-user-1';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      const result = abortStream(requestId, 'user-456');

      expect(result).toBe(false);
      expect(mockCancelState.cancelled).toBe(false);
      expect(mockController.abort).not.toHaveBeenCalled();
    });

    test('should return false when stream does not exist', () => {
      const result = abortStream('req-non-existent', 'user-123');

      expect(result).toBe(false);
      expect(mockController.abort).not.toHaveBeenCalled();
    });

    test('should return false when requestId is null', () => {
      const result = abortStream(null, 'user-123');

      expect(result).toBe(false);
    });

    test('should return false when requestId is undefined', () => {
      const result = abortStream(undefined, 'user-123');

      expect(result).toBe(false);
    });

    test('should return false when requestId is empty string', () => {
      const result = abortStream('', 'user-123');

      expect(result).toBe(false);
    });

    test('should handle abort errors gracefully', () => {
      const requestId = 'req-abort-error';
      const errorController = {
        abort: jest.fn(() => {
          throw new Error('Abort failed');
        })
      };

      registerStreamAbort(requestId, {
        controller: errorController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      // Should not throw despite controller.abort() throwing
      expect(() => {
        const result = abortStream(requestId, 'user-123');
        expect(result).toBe(true);
      }).not.toThrow();

      expect(mockCancelState.cancelled).toBe(true);
      expect(errorController.abort).toHaveBeenCalledWith('client_stop');
    });

    test('should set cancelled state even if abort throws', () => {
      const requestId = 'req-abort-state-error';
      const errorController = {
        abort: jest.fn(() => {
          throw new Error('Network error');
        })
      };
      const cancelState = { cancelled: false };

      registerStreamAbort(requestId, {
        controller: errorController,
        cancelState: cancelState,
        userId: 'user-123'
      });

      const result = abortStream(requestId, 'user-123');

      expect(result).toBe(true);
      expect(cancelState.cancelled).toBe(true);
    });

    test('should work with matching userIds', () => {
      const requestId = 'req-user-2';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-match'
      });

      const result = abortStream(requestId, 'user-match');

      expect(result).toBe(true);
      expect(mockCancelState.cancelled).toBe(true);
      expect(mockController.abort).toHaveBeenCalledWith('client_stop');
    });

    test('should not abort already aborted stream (idempotent)', () => {
      const requestId = 'req-abort-twice';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      const result1 = abortStream(requestId, 'user-123');
      expect(result1).toBe(true);
      expect(mockController.abort).toHaveBeenCalledTimes(1);

      mockController.abort.mockClear();

      // Abort again - should still succeed
      const result2 = abortStream(requestId, 'user-123');
      expect(result2).toBe(true);
      expect(mockController.abort).toHaveBeenCalledTimes(1);
      expect(mockCancelState.cancelled).toBe(true);

      // Cleanup
      unregisterStreamAbort(requestId);
    });
  });

  describe('getStreamAbortEntry', () => {
    test('should return entry for existing requestId', () => {
      const requestId = 'req-get-1';
      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: mockCancelState,
        userId: 'user-123'
      });

      const entry = getStreamAbortEntry(requestId);

      expect(entry).toBeDefined();
      expect(entry).not.toBeNull();
      expect(entry.controller).toBe(mockController);
      expect(entry.cancelState).toBe(mockCancelState);
      expect(entry.userId).toBe('user-123');
    });

    test('should return null for non-existent requestId', () => {
      const entry = getStreamAbortEntry('req-non-existent');

      expect(entry).toBeNull();
    });

    test('should return null for null requestId', () => {
      const entry = getStreamAbortEntry(null);

      expect(entry).toBeNull();
    });

    test('should return null for undefined requestId', () => {
      const entry = getStreamAbortEntry(undefined);

      expect(entry).toBeNull();
    });

    test('should return null for empty string requestId', () => {
      const entry = getStreamAbortEntry('');

      expect(entry).toBeNull();
    });

    test('should return the correct entry when multiple streams are registered', () => {
      const controller1 = { abort: jest.fn() };
      const controller2 = { abort: jest.fn() };
      const controller3 = { abort: jest.fn() };

      registerStreamAbort('req-multi-1', {
        controller: controller1,
        userId: 'user-1'
      });

      registerStreamAbort('req-multi-2', {
        controller: controller2,
        userId: 'user-2'
      });

      registerStreamAbort('req-multi-3', {
        controller: controller3,
        userId: 'user-3'
      });

      const entry2 = getStreamAbortEntry('req-multi-2');
      expect(entry2).toBeDefined();
      expect(entry2.controller).toBe(controller2);
      expect(entry2.userId).toBe('user-2');

      const entry1 = getStreamAbortEntry('req-multi-1');
      expect(entry1.userId).toBe('user-1');

      const entry3 = getStreamAbortEntry('req-multi-3');
      expect(entry3.userId).toBe('user-3');

      // Cleanup
      unregisterStreamAbort('req-multi-1');
      unregisterStreamAbort('req-multi-2');
      unregisterStreamAbort('req-multi-3');
    });

    test('should return null after stream is unregistered', () => {
      const requestId = 'req-get-unregister';
      registerStreamAbort(requestId, {
        controller: mockController,
        userId: 'user-123'
      });

      expect(getStreamAbortEntry(requestId)).toBeDefined();

      unregisterStreamAbort(requestId);

      expect(getStreamAbortEntry(requestId)).toBeNull();
    });

    test('should return entry with updated state after abort', () => {
      const requestId = 'req-get-after-abort';
      const cancelState = { cancelled: false };

      registerStreamAbort(requestId, {
        controller: mockController,
        cancelState: cancelState,
        userId: 'user-123'
      });

      abortStream(requestId, 'user-123');

      const entry = getStreamAbortEntry(requestId);
      expect(entry).toBeDefined();
      expect(entry.cancelState.cancelled).toBe(true);

      // Cleanup
      unregisterStreamAbort(requestId);
    });
  });

  describe('integration scenarios', () => {
    test('should handle complete lifecycle: register -> abort -> unregister', () => {
      const requestId = 'req-lifecycle';
      const controller = { abort: jest.fn() };
      const cancelState = { cancelled: false };

      // Register
      registerStreamAbort(requestId, {
        controller: controller,
        cancelState: cancelState,
        userId: 'user-123'
      });
      expect(getStreamAbortEntry(requestId)).toBeDefined();

      // Abort
      const abortResult = abortStream(requestId, 'user-123');
      expect(abortResult).toBe(true);
      expect(cancelState.cancelled).toBe(true);
      expect(controller.abort).toHaveBeenCalledWith('client_stop');

      // Unregister
      unregisterStreamAbort(requestId);
      expect(getStreamAbortEntry(requestId)).toBeNull();
    });

    test('should handle unauthorized abort attempt', () => {
      const requestId = 'req-unauthorized';
      const controller = { abort: jest.fn() };
      const cancelState = { cancelled: false };

      registerStreamAbort(requestId, {
        controller: controller,
        cancelState: cancelState,
        userId: 'user-owner'
      });

      // Wrong user tries to abort
      const result = abortStream(requestId, 'user-attacker');
      expect(result).toBe(false);
      expect(cancelState.cancelled).toBe(false);
      expect(controller.abort).not.toHaveBeenCalled();

      // Stream should still be registered and functional
      expect(getStreamAbortEntry(requestId)).toBeDefined();

      // Correct user can abort
      const correctResult = abortStream(requestId, 'user-owner');
      expect(correctResult).toBe(true);
      expect(cancelState.cancelled).toBe(true);

      // Cleanup
      unregisterStreamAbort(requestId);
    });

    test('should handle multiple concurrent streams', () => {
      const streams = [];
      const numStreams = 5;

      // Register multiple streams
      for (let i = 0; i < numStreams; i++) {
        const controller = { abort: jest.fn() };
        const cancelState = { cancelled: false };
        const requestId = `req-concurrent-${i}`;

        streams.push({ requestId, controller, cancelState, userId: `user-${i}` });

        registerStreamAbort(requestId, {
          controller,
          cancelState,
          userId: `user-${i}`
        });
      }

      // Verify all registered
      streams.forEach(stream => {
        expect(getStreamAbortEntry(stream.requestId)).toBeDefined();
      });

      // Abort specific ones
      abortStream(streams[1].requestId, 'user-1');
      abortStream(streams[3].requestId, 'user-3');

      // Verify abort states
      expect(streams[0].cancelState.cancelled).toBe(false);
      expect(streams[1].cancelState.cancelled).toBe(true);
      expect(streams[2].cancelState.cancelled).toBe(false);
      expect(streams[3].cancelState.cancelled).toBe(true);
      expect(streams[4].cancelState.cancelled).toBe(false);

      // Cleanup
      streams.forEach(stream => unregisterStreamAbort(stream.requestId));
    });

    test('should handle rapid register/unregister cycles', () => {
      const requestId = 'req-rapid';

      for (let i = 0; i < 10; i++) {
        const controller = { abort: jest.fn() };

        registerStreamAbort(requestId, {
          controller,
          userId: `user-${i}`
        });

        expect(getStreamAbortEntry(requestId)).toBeDefined();

        unregisterStreamAbort(requestId);

        expect(getStreamAbortEntry(requestId)).toBeNull();
      }
    });
  });
});
