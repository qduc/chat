import { useEffect } from 'react';

interface UseDocumentTitleOptions {
  conversationId: string | null;
  currentConversationTitle: string | null;
  conversations: Array<{ id: string; title?: string | null }>;
  fallbackTitle?: string;
}

export function useDocumentTitle({ 
  conversationId, 
  currentConversationTitle,
  conversations, 
  fallbackTitle = 'ChatForge' 
}: UseDocumentTitleOptions) {
  useEffect(() => {
    let title = fallbackTitle;
    
    if (conversationId) {
      // First priority: use currentConversationTitle if available
      if (currentConversationTitle) {
        title = `${currentConversationTitle} - ChatForge`;
      }
      // Fallback: search in conversations array
      else if (conversations.length > 0) {
        const currentConversation = conversations.find(c => c.id === conversationId);
        if (currentConversation?.title) {
          title = `${currentConversation.title} - ChatForge`;
        }
      }
    }
    
    document.title = title;
  }, [conversationId, currentConversationTitle, conversations, fallbackTitle]);
}
