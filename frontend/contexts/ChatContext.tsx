import { createContext, useContext, useState, ReactNode } from 'react';
import type { QualityLevel } from '../components/ui/QualitySlider';

interface ChatContextType {
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  model: string;
  setModel: (model: string) => void;
  useTools: boolean;
  setUseTools: (useTools: boolean) => void;
  shouldStream: boolean;
  setShouldStream: (val: boolean) => void;
  researchMode: boolean;
  setResearchMode: (val: boolean) => void;
  qualityLevel: QualityLevel;
  setQualityLevel: (level: QualityLevel) => void;
  // Deprecated: kept for backward compatibility until all components are updated
  reasoningEffort: string;
  setReasoningEffort: (effort: string) => void;
  verbosity: string;
  setVerbosity: (verbosity: string) => void;
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
  const [researchMode, setResearchMode] = useState<boolean>(false);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>('balanced');
  
  // Derived values for backward compatibility
  const getQualitySettings = (level: QualityLevel) => {
    const settings = {
      quick: { reasoningEffort: 'minimal', verbosity: 'low' },
      balanced: { reasoningEffort: 'medium', verbosity: 'medium' },
      thorough: { reasoningEffort: 'high', verbosity: 'high' }
    };
    return settings[level];
  };
  
  const currentSettings = getQualitySettings(qualityLevel);
  const [reasoningEffort, setReasoningEffort] = useState<string>(currentSettings.reasoningEffort);
  const [verbosity, setVerbosity] = useState<string>(currentSettings.verbosity);

  // Update derived values when quality level changes
  const handleQualityChange = (level: QualityLevel) => {
    setQualityLevel(level);
    const settings = getQualitySettings(level);
    setReasoningEffort(settings.reasoningEffort);
    setVerbosity(settings.verbosity);
  };

  const value = {
    conversationId,
    setConversationId,
    model,
    setModel,
    useTools,
    setUseTools,
    shouldStream,
    setShouldStream,
    researchMode,
    setResearchMode,
    qualityLevel,
    setQualityLevel: handleQualityChange,
    reasoningEffort,
    setReasoningEffort,
    verbosity,
    setVerbosity,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}
