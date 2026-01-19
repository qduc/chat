# Changelog

All notable changes to ChatForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
<!-- New features coming in the next release -->

### Changed
<!-- Improvements to existing features -->

### Fixed
<!-- Bug fixes -->

### Deprecated
<!-- Features being phased out -->

### Breaking Changes
<!-- Changes that require user action -->

---

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
