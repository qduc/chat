# Development-Only Streaming Rendering Deep Dive

This document explains a subtle frontend bug where streamed assistant output appeared to **skip numbers/tokens in development**, even though the backend SSE stream and persisted message were correct.

## Short version

The bug was **not** caused by the backend dropping tokens.

The bug was a **development-only React rendering/commit timing issue** in the frontend streaming path:

- the app received essentially all tokens correctly
- the placeholder assistant message state was updated rapidly during streaming
- in development, React did not reliably paint every intermediate token update before the next one arrived
- the UI therefore looked like it was "skipping" values even though the final accumulated content was correct

The fix was to force **synchronous React commits for streamed text updates in development only** using `flushSync()` inside `frontend/hooks/useMessageSendPipeline.ts`.

## Observable symptom

Typical reproduction:

1. Ask the model for deterministic incremental output such as `Output from 1 to 20`
2. Watch the live response in development (`localhost:3003`)
3. Notice that the visible stream appears to skip values while the message is streaming
4. Reload the page
5. The full saved message is correct

That combination is the tell:

- **live rendering wrong**
- **reloaded/persisted content correct**

That strongly suggests a frontend presentation problem rather than upstream data loss.

## Why it was confusing

At first glance, the symptom looked like any of these:

- SSE parser bug
- markdown rendering bug
- message revision / persistence bug
- proxy buffering bug
- provider sending malformed chunks

All of those are plausible. Only one was guilty.

## What was investigated

The debugging path intentionally moved from the wire inward.

### 1. SSE parsing and accumulation

Relevant files:

- `frontend/lib/streaming.ts`
- `frontend/lib/api/streaming-handler.ts`
- `frontend/hooks/useMessageSendPipeline.ts`

The parser and streaming handler were inspected first to confirm:

- SSE events were being parsed line-by-line
- text deltas were appended in order
- state updates were applied to the placeholder assistant message

### 2. Markdown / rendering path

Relevant file:

- `frontend/components/Markdown.tsx`

A working theory was that markdown parsing or throttling was too expensive during live streaming, especially in dev mode.

A diagnostic experiment temporarily bypassed markdown rendering for the live stream.

**Result:** the issue still reproduced.

That ruled out markdown as the sole root cause.

### 3. Stream handler pacing

Relevant file:

- `frontend/lib/api/streaming-handler.ts`

Another diagnostic experiment inserted a development-only `requestAnimationFrame()` yield between parsed SSE events so the browser had more opportunities to paint between chunks.

**Result:** not sufficient.

That suggested the problem was deeper than simple parser-side starvation.

### 4. Raw network inspection

The exact user request was replayed with:

- timestamped `curl`
- raw receive tracing (`--trace-time --trace-ascii`)

This was crucial.

#### Important finding

The SSE delivery was mostly healthy:

- events arrived every few milliseconds
- some adjacent events were coalesced into a single socket read
- but there was no catastrophic buffering or missing data pattern

In other words, the wire was not obviously lying.

## What the evidence meant

Once these were true together:

- live stream wrong
- reload correct
- raw SSE mostly correct
- markdown bypass did not fix it
- yielding between SSE events did not fix it

…the most likely remaining explanation was:

> React development rendering was not painting every intermediate streamed state update before the next update arrived.

This is easiest to hit when token frequency is high and each update competes with dev-only work such as:

- extra development checks
- StrictMode-related overhead
- hot-reload instrumentation
- more expensive reconciliation than production

If updates arrive faster than the browser can commit and paint them, the user sees only a subset of intermediate states. Nothing is actually lost; some visual frames are simply never painted.

A rough intuition is the browser has about $16.7\text{ ms}$ per frame at $60\text{ Hz}$. If streamed updates plus React/dev overhead consume too much of that budget repeatedly, visible intermediate states get skipped.

## The actual fix

Relevant file:

- `frontend/hooks/useMessageSendPipeline.ts`

A development-only wrapper was introduced around streamed text updates:

- `onToken`
- `onEvent('text')`

Instead of always scheduling a normal state update, the frontend now does this in development:

- call `flushSync(update)`
- force React to commit the streamed text update immediately

Conceptually:

- **before**: queue update and let React schedule the commit
- **after (dev only)**: force the commit now so the browser can paint the exact intermediate state

## Why `flushSync()` fixed it

`flushSync()` tells React to synchronously flush pending updates inside the callback instead of deferring them.

That matters here because the bug was not token corruption; it was **missed visible intermediate commits**.

By forcing the commit for each streamed token/text event in development:

- the DOM stays closer to the true token stream
- React has less chance to merge away visually important intermediate states
- the browser can paint the stream as the user expects

## Why this is development-only

The fix is intentionally gated to development.

Reasons:

1. The bug reproduced only in development.
2. `flushSync()` is expensive if overused.
3. Production already behaved correctly.
4. Forcing sync commits on every token in production would trade throughput for no user-visible benefit.

So the logic is:

- **development:** prioritize faithful debugging / visual correctness
- **production:** prioritize normal React scheduling and performance

## Why the final message was still correct before the fix

The underlying stream content was still being accumulated.

The discrepancy was between:

- **what arrived in state over time**, and
- **which intermediate states actually made it to the screen before newer ones replaced them**

That is why reload showed the correct content:

- persisted content was correct
- only the real-time visual playback was misleading

## A useful mental model

Think of the message stream as a flipbook:

- backend delivers frames correctly
- frontend creates state for many frames correctly
- development rendering fails to paint every frame
- user sees a choppier version and assumes frames were never generated

But the saved movie is complete.

## Diagnostics that helped separate causes

When debugging similar issues, use this order:

1. **Check raw SSE delivery**
   - if raw chunks are missing, it is transport/backend
2. **Check whether reload shows correct content**
   - if yes, it is likely not persistence
3. **Bypass expensive rendering layers**
   - markdown, syntax highlighting, math, etc.
4. **Inspect the state update path**
   - especially rapid append loops
5. **Test React scheduling hypotheses**
   - `flushSync()` can be a useful diagnostic scalpel

## Trade-offs and cautions

`flushSync()` is powerful but sharp.

Use it carefully:

- it can reduce throughput if used broadly
- it should be narrowly scoped
- it is best reserved for UI states where every intermediate render matters

In this case it is acceptable because:

- the scope is tiny
- it only applies to streamed text updates
- it only runs in development

## Related files

- `frontend/hooks/useMessageSendPipeline.ts`
- `frontend/lib/api/streaming-handler.ts`
- `frontend/lib/streaming.ts`
- `frontend/components/Markdown.tsx`
- `docs/frontend_code_flow.md`

## Takeaways

1. A wrong-looking live stream does **not** automatically mean the backend stream is wrong.
2. Reload-correct / live-wrong is a strong signal for a rendering or commit-timing issue.
3. Development mode can expose timing bugs that production hides.
4. React scheduling can make a correct state history look visually incorrect when intermediate commits do not paint.
5. `flushSync()` is sometimes the right debugging tool when the problem is not data integrity but UI faithfulness.
