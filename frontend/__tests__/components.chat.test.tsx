// Test stubs for Chat component observable UI behaviors
/* eslint-disable */
// Declare Jest-like globals to keep TypeScript happy without a runner setup
declare const describe: any;
declare const test: any;

describe('<Chat />', () => {
	test.todo('renders welcome state when there are no messages');
	test.todo('sends a message on Enter and shows assistant streaming');
	test.todo('stops streaming when Stop is clicked');
	test.todo('allows model selection and uses selected model for next send');

	// History panel behaviors
	test.todo('shows history list when persistence is enabled');
	test.todo('selecting a conversation loads its messages');
	test.todo('deleting a conversation removes it from history and resets view if active');
	test.todo('paginates history with Load more');

	// UX affordances
	test.todo('auto-grows the textarea on input');
	test.todo('copy button copies assistant message content to clipboard');

	// Error state
	test.todo('shows error banner when sendChat fails');

	// Responses API conversation continuity
	test.todo('resets previousResponseId when starting a new chat');
	test.todo('resets previousResponseId when switching conversations');

	// History list coherence
	test.todo('prepends newly created conversation to history list after New Chat');
});

export {};
