import { MessageEvent } from './types';

/**
 * Utility to accumulate and normalize message events during a live stream.
 *
 * Objectives:
 * 1. Maintain a clean sequence of events (seq).
 * 2. Merge adjacent events of the same type to keep the array compact.
 * 3. Handle data that might arrive out of order (though rare in SSE, good for robustness).
 */

export interface EventAccumulatorOptions {
  initialEvents?: MessageEvent[];
}

export class MessageEventAccumulator {
  private events: MessageEvent[] = [];
  private currentSeq: number = 0;

  constructor(options: EventAccumulatorOptions = {}) {
    if (options.initialEvents) {
      this.events = [...options.initialEvents].sort((a, b) => a.seq - b.seq);
      this.currentSeq = this.events.length > 0 ? Math.max(...this.events.map((e) => e.seq)) : 0;
    }
  }

  /**
   * Adds a new event or delta to the sequence.
   * If the event matches the type of the last event, it merges the payload.
   */
  addEvent(type: MessageEvent['type'], payload: MessageEvent['payload']): MessageEvent[] {
    const lastEvent = this.events[this.events.length - 1];

    // Merge logic: only merge if same type and same metadata (like tool_call_id)
    if (lastEvent && lastEvent.type === type && this.isMergeable(lastEvent, type, payload)) {
      if (payload?.text) {
        lastEvent.payload = {
          ...lastEvent.payload,
          text: (lastEvent.payload?.text || '') + payload.text,
        };
      }
      // Note: we don't return a copy here for performance during high-frequency streaming,
      // but the caller should treat the returned array as updated state.
    } else {
      this.currentSeq++;
      this.events.push({
        seq: this.currentSeq,
        type,
        payload: { ...payload },
      });
    }

    return [...this.events];
  }

  private isMergeable(
    lastEvent: MessageEvent,
    nextType: MessageEvent['type'],
    nextPayload: MessageEvent['payload']
  ): boolean {
    if (nextType === 'content' || nextType === 'reasoning') {
      return true;
    }

    if (nextType === 'tool_call') {
      // Don't merge tool calls unless they have the same ID (unlikely for deltas, usually tool calls are discrete or partial)
      // If the backend sends tool call deltas, we'd need more complex logic here.
      // For now, treat tool calls as distinct events.
      return (
        lastEvent.payload?.tool_call_id === nextPayload?.tool_call_id && !!nextPayload?.tool_call_id
      );
    }

    return false;
  }

  getEvents(): MessageEvent[] {
    return [...this.events];
  }

  /**
   * Returns a flattened string representation of the events,
   * emulating the legacy 'content' field with <thinking> tags.
   * This is used for backward compatibility during the transition.
   */
  toLegacyContent(): string {
    return this.events
      .map((event) => {
        const text = event.payload?.text || '';
        if (event.type === 'reasoning') {
          return `<thinking>\n${text}\n</thinking>\n`;
        }
        return text;
      })
      .join('');
  }
}
