import { describe, test, expect } from '@jest/globals';
import { extractSystemPrompt, extractSystemPromptAsync } from '../src/lib/toolOrchestrationUtils.js';

describe('Date Injection - Regression Tests', () => {
  /**
   * Regression test for bug where agent doesn't know the current date when no
   * system prompt is configured. The fix ensures that a minimal system message
   * with the current date is always injected.
   *
   * Issue: When no system prompt (neither from body, bodyIn, nor persistence)
   * was provided, the extractSystemPromptAsync returned an empty string, which
   * meant no system message was added. This caused the AI model to not know
   * the current date.
   */
  test('extractSystemPromptAsync always returns date even when no user prompt exists', async () => {
    const result = await extractSystemPromptAsync({
      body: {},
      bodyIn: {},
      persistence: null,
      userId: null,
    });

    // Should return a system instructions block with the current date
    expect(result).toBeTruthy();
    expect(result).toContain('<system_instructions>');
    expect(result).toContain("Today's date:");

    // Verify the date format is YYYY-MM-DD
    const currentDate = new Date().toISOString().split('T')[0];
    expect(result).toContain(currentDate);
  });

  test('extractSystemPrompt (sync) always returns date even when no user prompt exists', () => {
    const result = extractSystemPrompt({
      body: {},
      bodyIn: {},
      persistence: null,
    });

    // Should return a system instructions block with the current date
    expect(result).toBeTruthy();
    expect(result).toContain('<system_instructions>');
    expect(result).toContain("Today's date:");

    // Verify the date format is YYYY-MM-DD
    const currentDate = new Date().toISOString().split('T')[0];
    expect(result).toContain(currentDate);
  });

  test('extractSystemPromptAsync returns date when conversation has no system prompt in metadata', async () => {
    const result = await extractSystemPromptAsync({
      body: {},
      bodyIn: {},
      persistence: {
        persist: true,
        conversationId: 'test-conv',
        conversationMeta: {
          metadata: {}  // No system_prompt, no active_system_prompt_id
        }
      },
      userId: 'test-user',
    });

    // Should return a system instructions block with the current date
    expect(result).toBeTruthy();
    expect(result).toContain('<system_instructions>');
    expect(result).toContain("Today's date:");
  });

  test('extractSystemPromptAsync includes shared modules when available', async () => {
    const result = await extractSystemPromptAsync({
      body: {},
      bodyIn: {},
      persistence: null,
      userId: null,
    });

    // Should contain shared modules like knowledge cutoff
    expect(result).toContain("Today's date:");
    // The knowledge_cutoff module should be included
    expect(result).toContain('knowledge cutoff');
  });
});
