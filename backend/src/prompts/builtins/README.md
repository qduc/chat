# Built-in System Prompts

This directory contains built-in system prompts that are available to all users. Each markdown file represents a single prompt with YAML front-matter containing metadata.

## File Format

Each file should have YAML front-matter followed by the prompt body:

```markdown
---
slug: unique-identifier
name: Display Name
description: Brief description of what this prompt does
order: 10
---

The actual prompt content goes here. This will be used as the system message.
```

## Front-matter Fields

- `slug`: Unique identifier for the prompt (used in API as `built:{slug}`)
- `name`: Human-readable name displayed in UI
- `description`: Brief explanation of the prompt's purpose
- `order`: Display order (lower numbers appear first)

## Guidelines

- Keep slugs simple and descriptive (e.g., "classification", "creative-writing")
- Names should be concise but descriptive
- Descriptions should explain the prompt's use case
- Prompt content should be well-structured and clear
- Use order values in increments of 10 to allow for insertion

## Loading

These prompts are loaded at server startup and cached in memory. Changes require a server restart to take effect.