export { getDb, resetDbCache } from './client.js';
export { upsertSession } from './sessions.js';
export {
  createConversationBranch,
  getRootBranchId,
  initializeConversationRootBranch,
  getConversationBranch,
  getConversationBranches,
  getActiveBranchId,
  getBranchHeadMessageId,
  setConversationActiveBranch,
  updateConversationBranchHead,
} from './branches.js';
export {
  createConversation,
  getConversationById,
  updateConversationMetadata,
  updateConversationTitle,
  updateConversationProviderId,
  updateConversationModel,
  updateConversationSettings,
  countConversationsBySession,
  listConversations,
  searchConversations,
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
  insertToolMessage,
  markAssistantErrorBySeq,
  getMessagesPage,
  getLastMessage,
  getLastAssistantResponseId,
  getActiveBranchMessages,
  getMessageContentByClientId,
  getPreviousUserMessage,
  updateMessageContent,
  deleteMessagesAfterSeq,
  clearAllMessages,
} from './messages.js';
export {
  listProviders,
  getProviderById,
  getProviderByIdWithApiKey,
  createProvider,
  updateProvider,
  setDefaultProvider,
  deleteProvider,
} from './providers.js';
export {
  insertToolCall,
  insertToolCalls,
  getToolCallsByMessageId,
  getToolCallsByMessageIds,
  getToolCallsByConversationId,
  insertToolOutput,
  insertToolOutputs,
  getToolOutputsByToolCallId,
  getToolOutputsByToolCallIds,
  getToolOutputsByMessageId,
  getToolOutputsByMessageIds,
  deleteToolCallsAndOutputsByMessageId,
} from './toolCalls.js';

export {
  listEvaluationsForConversation,
  getEvaluationByPair,
  createEvaluation,
} from './evaluations.js';

export {
  saveMessageRevision,
  getMessageRevisions,
  getRevisionCountsForConversation,
  getMessageRevisionCount,
} from './revisions.js';
