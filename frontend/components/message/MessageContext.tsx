/**
 * Context for shared message state and handlers
 * Reduces prop drilling through message component tree
 */

import { createContext, useContext } from 'react';
import type { MessageContextValue } from './types';

const MessageContext = createContext<MessageContextValue | null>(null);

export function useMessageContext(): MessageContextValue {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error('useMessageContext must be used within a MessageProvider');
  }
  return context;
}

export const MessageProvider = MessageContext.Provider;
