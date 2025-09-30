export { getDb, resetDbCache } from './client.js';
export { upsertSession } from './sessions.js';
export {
  createConversation,
  getConversationById,
  updateConversationMetadata,
  updateConversationTitle,
  updateConversationProviderId,
  updateConversationModel,
  countConversationsBySession,
  listConversations,
  softDeleteConversation,
  listConversationsIncludingDeleted,
  forkConversationFromMessage,
} from './conversations.js';
export {
  countMessagesByConversation,
  getNextSeq,
  insertUserMessage,
  createAssistantDraft,
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError,
  insertAssistantFinal,
  markAssistantErrorBySeq,
  getMessagesPage,
  getLastMessage,
  getLastAssistantResponseId,
  updateMessageContent,
  deleteMessagesAfterSeq,
  clearAllMessages,
} from './messages.js';
export { retentionSweep } from './retention.js';
export {
  listProviders,
  getProviderById,
  getProviderByIdWithApiKey,
  createProvider,
  updateProvider,
  setDefaultProvider,
  deleteProvider,
} from './providers.js';
