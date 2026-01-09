---
description: Claude Agent SDK reference for Humanizer AUI. Covers migration from Claude Code SDK, new features, and integration patterns. Reference when working on AUI or agent functionality.
user-invocable: true
---

# Claude Agent SDK Reference for Humanizer

## Critical Migration Notice

**The Claude Code SDK is now the Claude Agent SDK** (renamed September 2025).

### Package Changes

```json
// BEFORE
{
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.0"
  }
}

// AFTER
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.2"
  }
}
```

### Python Changes

```python
# BEFORE
from claude_code_sdk import query, ClaudeCodeOptions

# AFTER
from claude_agent_sdk import query, ClaudeAgentOptions
```

### Breaking Changes

1. **No default system prompt** - Must be explicitly configured
2. **No auto-loading of local settings** - Opt-in via `settingSources`
3. **`ClaudeCodeOptions` → `ClaudeAgentOptions`**
4. **Legacy SDK entrypoint removed** - Must use new package

---

## Key Features for Humanizer AUI

### 1. Structured Outputs (Beta)

Guaranteed JSON schema conformance for tool responses:

```typescript
import { query, ClaudeAgentOptions } from '@anthropic-ai/claude-agent-sdk';

const options: ClaudeAgentOptions = {
  model: 'claude-sonnet-4-5-20250929',
  // Enable structured outputs
  beta: 'structured-outputs-2025-11-13'
};
```

**AUI Impact**: Tool responses can now be validated against schemas, improving reliability of the tool calling interface.

### 2. Interleaved Thinking (Beta)

Claude can think between tool calls:

```typescript
const options: ClaudeAgentOptions = {
  beta: 'interleaved-thinking-2025-05-14'
};
```

**AUI Impact**: Better reasoning traces for complex multi-tool workflows. Consider exposing thinking blocks in the UI for transparency.

### 3. Web Search Tool

Built-in web search capability:

```typescript
const tools = [
  {
    type: 'web_search_20250305',
    name: 'web_search'
  }
];
```

**AUI Impact**: Can integrate web search as a native AUI tool without external API.

### 4. Code Execution Tool

Sandboxed Python execution:

```typescript
const tools = [
  {
    type: 'code_execution',
    name: 'execute_code'
  }
];
```

**AUI Impact**: Consider adding code execution capability for data analysis workflows.

### 5. Files API (Beta)

Upload and reference files in conversations:

```typescript
// Upload file
const file = await client.files.create({
  file: fs.createReadStream('document.pdf'),
  purpose: 'user_upload'
});

// Reference in message
const message = await client.messages.create({
  model: 'claude-sonnet-4-5',
  messages: [{
    role: 'user',
    content: [
      { type: 'file', file_id: file.id },
      { type: 'text', text: 'Analyze this document' }
    ]
  }]
});
```

**AUI Impact**: Enables document upload and analysis without base64 encoding in the UI.

### 6. MCP Connector (Beta)

Connect to remote MCP servers directly:

```typescript
const options: ClaudeAgentOptions = {
  mcpServers: [
    {
      type: 'url',
      url: 'https://mcp.example.com/sse',
      name: 'my-server'
    }
  ]
};
```

**AUI Impact**: Can integrate with external MCP tools (Asana, Gmail, etc.) for workflow automation.

---

## Permission Modes

```typescript
const options: ClaudeAgentOptions = {
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions'
};
```

- `default`: Prompt for each tool use
- `acceptEdits`: Auto-accept file edits
- `bypassPermissions`: Skip all prompts (requires `allow_dangerously_skip_permissions: true`)

**AUI Implementation**: Use `acceptEdits` for trusted tools, `default` for sensitive operations.

---

## Hooks System

Pre/post hooks for tool use control:

```typescript
const options: ClaudeAgentOptions = {
  hooks: {
    preToolUse: async (tool, input) => {
      // Validate, log, or block tool calls
      if (tool.name === 'dangerous_tool') {
        return { action: 'deny', reason: 'Not allowed' };
      }
      return { action: 'allow' };
    },
    postToolUse: async (tool, input, output) => {
      // Log results, transform output
      console.log(`Tool ${tool.name} completed`);
    }
  }
};
```

**AUI Impact**: Implement hooks for:
- Logging tool usage for audit
- Blocking dangerous operations
- Transforming tool outputs for UI display

---

## Streaming Patterns

```typescript
import { query, ClaudeAgentOptions } from '@anthropic-ai/claude-agent-sdk';

const options: ClaudeAgentOptions = {
  model: 'claude-sonnet-4-5-20250929',
  stream: true
};

for await (const event of query('Your prompt', options)) {
  if (event.type === 'text') {
    // Stream text to UI
    updateUI(event.text);
  } else if (event.type === 'tool_use') {
    // Show tool invocation
    showToolCall(event.tool, event.input);
  } else if (event.type === 'thinking') {
    // Show thinking (if enabled)
    showThinking(event.content);
  }
}
```

---

## Subagent Configuration

```typescript
const options: ClaudeAgentOptions = {
  agents: [
    {
      name: 'researcher',
      model: 'claude-haiku-4-5',
      systemPrompt: 'You are a research assistant...',
      tools: ['web_search', 'read_file']
    }
  ]
};
```

**AUI Impact**: Configure specialized subagents for different AUI tool categories.

---

## Session Management

```typescript
// Create session
const session = await client.sessions.create({
  model: 'claude-sonnet-4-5'
});

// Continue session
const response = await query('Continue our work', {
  sessionId: session.id
});

// List sessions
const sessions = await client.sessions.list();
```

**AUI Impact**: Persist conversation state across app restarts.

---

## Humanizer-Specific Integration Points

### AUI Tool Registration

Map AUI tools to SDK tool definitions:

```typescript
const auiTools = [
  {
    name: 'search_archive',
    description: 'Search conversation archives',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', default: 10 }
      },
      required: ['query']
    }
  },
  // ... other AUI tools
];
```

### Persona Integration

Use system prompts for persona:

```typescript
const options: ClaudeAgentOptions = {
  systemPrompt: `You are ${persona.name}, operating in ${namespace.name} style.
${persona.description}
${style.instructions}`
};
```

### Memory Integration

Connect ChromaDB to SDK sessions:

```typescript
const options: ClaudeAgentOptions = {
  tools: [
    {
      name: 'retrieve_memory',
      description: 'Search ChromaDB memories',
      // ... schema
    }
  ]
};
```

---

## Version Compatibility

| SDK Version | Claude Code | Key Features |
|-------------|-------------|--------------|
| 0.2.2 | 2.1.x | Current - all features |
| 0.1.x | 2.0.x | Legacy - migration needed |

**Action**: Verify package.json has `@anthropic-ai/claude-agent-sdk` version `^0.2.0` or higher.

---

## Quick Migration Checklist

- [ ] Update package.json dependency
- [ ] Change imports in all files
- [ ] Update type references (ClaudeCodeOptions → ClaudeAgentOptions)
- [ ] Set explicit system prompts (no longer auto-inherited)
- [ ] Configure settingSources if using project settings
- [ ] Test all tool integrations
- [ ] Update hook configurations for new API
