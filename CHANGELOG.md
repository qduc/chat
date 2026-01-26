# Changelog

All notable changes to ChatForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.15.0] - 2026-01-26

### Added
- N-way judge evaluation for comparing responses from multiple models with configurable judge models
- Real-time conversation title updates for new and existing conversations

### Changed
- Improved backend test coverage with additional test cases
- Improved frontend test coverage with additional test cases
- Enhanced useChat hook for better maintainability and reliability
- Refactored MessageList.tsx component for improved code quality
- Optimized mobile UI header row layout
- Judge evaluation now uses actual model names instead of generic 'primary' label
- Removed category parameters from SearXNG search tool for better search result quality

### Fixed
- Type errors in codebase
- Ensured messageId is correctly assigned in useChat hook for non-primary conversation cases
- ChatHeader dropdown styling for consistent behavior across breakpoints
- Reduced test output noise with `--silent` flag


## [0.14.1] - 2026-01-24

### Changed
- Improved visual presentation of judge response display
- Updated delete icon to use consistent Trash component across UI


## [0.14.0] - 2026-01-24

### Added
- **Judge/Evaluation System** - Compare model responses with automated judge model evaluation, scoring, and reasoning
- **Custom Request Parameters** - User-defined request parameters with multi-select support for advanced API configuration
- **Usage Tracking with Timing Metrics** - Comprehensive performance insights including prompt tokens, cached tokens, and timing data
- **Judge Response Management** - Delete judge responses from evaluation comparisons

### Changed
- **Message ID Protocol** - Unified to use UUIDs consistently for assistant responses across frontend and backend
- **OpenAI API Compatibility** - Updated response_format parameter handling (moved to text.format for compatibility)
- **Judge Response Format** - Enhanced judge evaluation response structure for better display and usability

### Fixed
- **Custom Parameters UI** - Improved width consistency in custom request parameter popup items
- **Message ID Handling** - Resolved issue where frontend mixed sequential (integer-based) and UUID formats in judge requests


## [0.13.2] - 2026-01-23

### Added
- Clear button for custom parameters and tools to quickly reset configurations
- Copy button for custom parameters settings to duplicate existing configurations
- Auto-generated IDs for custom parameter settings for better tracking and management


## [0.13.1] - 2026-01-22

### Added
- Show content of custom parameters on hover for better visibility

### Changed
- Improved tooltip visual styling

### Fixed
- Tooltips no longer remain visible after clicking buttons that open popups
- Corrected prompt_tokens calculation in timings to properly account for cached tokens


## [0.13.0] - 2026-01-22

### Added
- Custom server parameters support for advanced configuration
- Usage tracking with timing metrics for improved performance insights
- Multiple selection support for Custom Request Params
- Additional metadata in conversation creation responses

### Changed
- Improved Custom Request Params setting design
- Enhanced usage extraction and timing normalization for better performance metrics
- Reduced toolbar clutter by hiding message toolbars until hover
- Consolidated search functionality into Tools selector (wrench icon), removing dedicated web search button

### Fixed
- Premature ending of thinking blocks containing code blocks
- Loading animation persisting when errors occur
- Incorrect monospace font styling in thinking blocks


## [0.12.4] - 2026-01-21

### Fixed
- Inline code blocks now correctly display in monospaced font (CSS variable scoping issue resolved)
- Browsers no longer attempt to autofill API key fields in settings
- Firecrawl tool is now properly disabled when no API key is configured


## [0.12.3] - 2026-01-19

### Added
- Firecrawl search tool integration
- Changelog extraction and automatic inclusion in GitHub release body

### Changed
- Refactored settings modal for improved organization

### Fixed
- Model list not updating after changing provider configuration
- Last items in model selector not fully visible


## [0.12.2] - 2026-01-09

### Fixed
- **Dark mode readability** - Improved text contrast in dark mode for better legibility
- **Code block display** - Fixed code block headers that were covering message content
- **Documentation** - Corrected image link in README

### Changed
- **Updated guides** - Added setup instructions for Electron desktop app and Playwright browser automation

---

## [0.12.1] - 2026-01-08

### Fixed
- **Dark mode** - Improved text color contrast in dark mode
- **Token counter** - Fixed token streaming speed measurement

---

## [0.12.0] - 2026-01-07

### Added
- **Voice input** - Record and send voice messages directly in the chat
- **Audio for Gemini** - Gemini model now supports audio input and generation
- **Image generation with Gemini** - Generate images using Gemini's image generation capability
- **Persistent sidebar state** - Your sidebar preferences now save when you reload

### Fixed
- **Audio player sizing** - Fixed layout issues when audio players appear in messages

---

## [0.11.0] - 2025-12-20

### Added
- **Image generation in chats** - Generate images directly within your conversations without interruption
- **Better file display** - Improved readability of uploaded documents and text files

### Fixed
- **Image generation feedback** - Visual indicator now shows when images are being generated
- **Error handling** - Error messages now clear properly when you continue chatting
- **Login stability** - Fixed occasional authentication issues during token refresh

---

## [0.10.6] - 2025-12-10

### Fixed
- **Message history** - Draft messages no longer accidentally appear in conversation history

---

## [0.10.5] - 2025-12-08

### Added
- **Linked conversations** - Conversations can now reference and include messages from other conversations
- **Faster model switching** - Models now load faster with background caching and batch fetching

---

## [0.10.4] - 2025-12-05

### Added
- **Better token tracking** - Token usage now shows direction (input vs output) for clarity

### Changed
- **Cleaner metadata** - Consolidated token and model info into a single display

---

## [0.10.3] - 2025-12-01

### Added
- **Fork conversations** - Fork button restored to user messages for exploring alternative paths

### Changed
- **Improved token display** - Better visualization of token usage

---

## [0.10.2] and earlier

For detailed information on changes in earlier versions, please refer to the [git commit history](https://github.com/qduc/chat/commits/main).

---

## Version Comparison

Want to see exactly what changed between versions?

- [v0.12.2 vs v0.12.1](https://github.com/qduc/chat/compare/v0.12.1...v0.12.2)
- [v0.12.1 vs v0.12.0](https://github.com/qduc/chat/compare/v0.12.0...v0.12.1)
- [v0.12.0 vs v0.11.0](https://github.com/qduc/chat/compare/v0.11.0...v0.12.0)
- [All changes since v0.12.2](https://github.com/qduc/chat/compare/v0.12.2...HEAD)

---

**Tip:** Check the [README](./README.md) for setup instructions and feature documentation.
