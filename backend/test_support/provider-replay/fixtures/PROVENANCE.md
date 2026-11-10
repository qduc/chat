# Provider replay fixtures

Sanitized recordings of real provider traffic, copied unchanged from qduc/term2
`scripts/provider-black-box/fixtures/` (see that directory's PROVENANCE.md for capture
details, redaction and review). They were captured by Term2, so the *requests* in them are
Term2's; ChatForge's tests replay only the recorded *responses* and assert on the requests
ChatForge itself sends.

| File | Term2 source | Wire family | Model | ChatForge provider type |
| --- | --- | --- | --- | --- |
| `openai-chat.json` | `opencode/tool-continuation-v1.json` | Chat Completions (OpenCode Go) | `deepseek-v4-flash` | `openai` |
| `openai-responses.json` | `openai/tool-continuation-v1.json` | OpenAI Responses | `o3-mini` | `openai-responses` |
| `anthropic.json` | `opencode/tool-continuation-v1-anthropic.json` | Anthropic Messages (OpenCode Go) | `minimax-m3` | `anthropic` |
| `gemini.json` | `google/tool-continuation-v1.json` | Google GenerateContent | `gemini-2.5-flash` | `gemini` |

All four follow probe `tool-continuation-v1`: the user asks the model to use the `fixture`
tool, the model calls `fixture({"a":1})`, the tool returns `{"ok":true,"value":1}`, and the
model summarizes. Reasoning text and signatures are `[REDACTED]` in the recordings.

Refresh by copying the newer Term2 capture; never commit raw (unsanitized) traffic.

## Synthetic fixtures (best guess, not captured)

`../syntheticFixtures.js` derives **parallel tool-call** variants from the recordings above:
it keeps every recorded frame and adds a second `fixture` call (`{"a":7}`, id
`call_<parallel-2>`) in the shape each provider's official SDK parses. They are labelled
`synthetic` on the envelope and are not evidence of what a provider actually sends.

| Variant | Shape of the second call | Source |
| --- | --- | --- |
| `openai-chat` | `delta.tool_calls[].index: 1`; `id`/`type`/`name` on its first chunk only; after call 0 | openai/openai-node `tests/lib/ChatCompletionStream.test.ts` (`customToolChunks`) |
| `openai-chat-interleaved` | Same, argument fragments alternating 0,1,0,1 | openai/openai-node, same file ("preserves interleaved non-strict tool completion notifications") |
| `openai-responses` | Own `function_call` output item at the next `output_index`: added → arguments delta/done → item done; listed in `response.completed`; `sequence_number` renumbered | openai/openai-node `src/lib/responses/ResponseStream.ts` |
| `anthropic` | Own `tool_use` block at the next `index`, after the first block stops | anthropics/anthropic-sdk-typescript `src/lib/MessageStream.ts` |
| `gemini` | Second `functionCall` part in the same candidate, complete args, **no** `thoughtSignature` (only the first call carries it) | googleapis/js-genai `src/types.ts` (`FunctionCall`); vercel/ai `packages/google/src/convert-to-google-messages.ts` and its real Vertex recording `google-stream-no-args-tool-call.chunks.txt` |

Sources were read at the default branch on 2026-11-10 (openai-node `63fbfd8…`). The official
provider docs sites were not reachable from the authoring environment.

**Oracle:** `integration/syntheticFixtureOracle.test.js` serves every fixture to the official
SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`, pinned dev dependencies). Real recordings
must parse to their recorded call (calibration); synthetic ones must parse to both calls with
their own ids and arguments, and Gemini's signature only on the first. This proves the streams
are well formed for the vendors' own parsers, not that a provider emits them. Malformed
derivations (reused Anthropic block index, missing Chat `id`) fail it.

**Replace** each synthetic variant with a real capture when one exists (one "call the fixture
tool twice" prompt per provider), and delete its builder.
