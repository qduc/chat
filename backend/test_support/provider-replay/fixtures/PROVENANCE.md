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
