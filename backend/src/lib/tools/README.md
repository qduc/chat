# Tool Registry

The files in this directory define the server-side tool registry used by the chat orchestration layer. Each tool lives in its own module and exposes the same interface via the `createTool` helper.

## Adding a new tool

1. **Create a module** – Add a new file next to the existing tools (e.g. `myTool.js`). Import `createTool` from `./baseTool.js` and export a tool definition:
   - `name`: unique string identifier (must match the OpenAI tool name).
   - `description`: optional human-readable summary.
   - `validate(args)`: (optional) synchronous validator. Return sanitized arguments or throw an error.
   - `handler(args)`: async function that performs the work and returns serializable output.
   - `openAI`: the OpenAI tool specification (the return value of this property is exposed verbatim to the provider layer).

2. **Register the tool** – Import your tool in `index.js` and append it to the `registeredTools` array. The helper ensures names stay unique and automatically exposes the tool via `tools`, `generateOpenAIToolSpecs`, and `getAvailableTools`.

3. **Cover it with tests** – Update or create tests under `backend/__tests__` to cover validation, happy-path execution, and error cases.

4. **Document environment needs** – If the tool requires configuration (API keys, URLs, etc.), make sure to declare the environment variables in `backend/src/env.js` and document them in the repo README.

Following these steps keeps the tool registry predictable and makes it easy to extend orchestration without touching unrelated code.
