/**
 * Action creators module
 *
 * Aggregates all action creator factories for the chat state management system.
 * Action creators are organized by domain (auth, ui, settings, chat, conversation, edit).
 *
 * Each module exports a factory function that creates action objects with
 * dependencies injected (dispatch, refs, state, etc).
 *
 * @module actions
 */

// Action creators index - aggregates all action creator modules

export { createAuthActions } from './authActions';
export type { AuthActionsProps } from './authActions';

export { createUiActions } from './uiActions';
export type { UiActionsProps } from './uiActions';

export { createSettingsActions } from './settingsActions';
export type { SettingsActionsProps } from './settingsActions';

export { createChatActions } from './chatActions';
export type { ChatActionsProps } from './chatActions';

export { createConversationActions } from './conversationActions';
export type { ConversationActionsProps } from './conversationActions';

export { createEditActions } from './editActions';
export type { EditActionsProps } from './editActions';
