import { createContext, useContext, useState, ReactNode } from 'react';

interface ChatContextType {
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  model: string;
  setModel: (model: string) => void;
  useTools: boolean;
  setUseTools: (useTools: boolean) => void;
  shouldStream: boolean;
  setShouldStream: (val: boolean) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function useChatContext() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
}

interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [model, setModel] = useState<string>('gpt-4.1-mini');
  const [useTools, setUseTools] = useState<boolean>(true);
  const [shouldStream, setShouldStream] = useState<boolean>(true);

  const value = {
    conversationId,
    setConversationId,
    model,
    setModel,
    useTools,
    setUseTools,
    shouldStream,
    setShouldStream,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}
