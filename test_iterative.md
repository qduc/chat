# Testing Iterative Orchestration

## How to Test

1. Start the development server:
   ```bash
   npm --prefix backend run dev
   npm --prefix frontend run dev
   ```

2. Open the chat interface at http://localhost:3000

3. Enable tools (iterative mode is now the default when tools are enabled)

4. Test with queries that require multiple tool calls and thinking:

### Test Case 1: Multi-step Search and Analysis
```
"Search for 'AI programming trends 2024' and then tell me the current time, then analyze how these trends might affect development this year"
```

Expected behavior:
- AI thinks about the request
- Calls web_search tool
- Streams search results  
- AI thinks about the results
- Calls get_time tool
- Streams time result
- AI analyzes and provides final comprehensive response

### Test Case 2: Iterative Problem Solving
```
"What time is it? Then search for 'best practices for API design' and give me a summary"
```

Expected behavior:
- AI gets current time first
- Streams time result
- AI decides to search next
- Calls web search
- Streams search results
- AI provides final analysis combining both pieces of information

## Implementation Details

- Backend uses `handleIterativeOrchestration()` for dynamic tool orchestration
- Frontend streams events in real-time showing thinking process
- Tools are executed sequentially with AI reasoning between calls
- Maximum 10 iterations to prevent infinite loops

## Key Features Added

1. **Backend**: `iterativeOrchestrator.js` - Dynamic orchestration loop
2. **Frontend**: Automatic iterative mode when tools are enabled
3. **Streaming**: Real-time display of thinking and tool execution
4. **Safety**: Iteration limits and error handling
5. **Default Behavior**: Iterative orchestration is now the default for all tool-enabled requests