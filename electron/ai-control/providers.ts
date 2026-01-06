/**
 * AI Provider Implementations
 *
 * Actual LLM provider calls for:
 * - Ollama (local inference)
 * - Anthropic (Claude)
 * - OpenAI (GPT)
 *
 * These are used by AIControlService to execute requests.
 */

import type { AIProviderType, AIRequest, AIResponse, AIStreamChunk } from './types';

// ═══════════════════════════════════════════════════════════════════
// MESSAGE TYPES
// ═══════════════════════════════════════════════════════════════════

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderConfig {
  endpoint?: string;
  apiKey?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// ═══════════════════════════════════════════════════════════════════
// OLLAMA PROVIDER
// ═══════════════════════════════════════════════════════════════════

export async function callOllama(
  messages: LLMMessage[],
  config: ProviderConfig
): Promise<ProviderResponse> {
  const baseUrl = config.endpoint || 'http://localhost:11434';

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      options: {
        num_predict: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama error: ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  return {
    content: data.message?.content || '',
    model: config.model,
    inputTokens: data.prompt_eval_count || 0,
    outputTokens: data.eval_count || 0,
  };
}

export async function* streamOllama(
  messages: LLMMessage[],
  config: ProviderConfig
): AsyncGenerator<AIStreamChunk> {
  const baseUrl = config.endpoint || 'http://localhost:11434';

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      options: {
        num_predict: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.message?.content) {
          yield {
            token: data.message.content,
            done: false,
            modelUsed: config.model,
          };
        }
        if (data.prompt_eval_count) inputTokens = data.prompt_eval_count;
        if (data.eval_count) outputTokens = data.eval_count;
        if (data.done) {
          yield {
            token: '',
            done: true,
            modelUsed: config.model,
            inputTokens,
            outputTokens,
          };
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ANTHROPIC PROVIDER
// ═══════════════════════════════════════════════════════════════════

export async function callAnthropic(
  messages: LLMMessage[],
  config: ProviderConfig
): Promise<ProviderResponse> {
  const baseUrl = config.endpoint || 'https://api.anthropic.com';
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error('Anthropic API key required');
  }

  // Extract system message
  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens || 4096,
      system: systemMessage?.content,
      messages: chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic error: ${error}`);
  }

  const data = await response.json();
  return {
    content: data.content[0]?.text || '',
    model: data.model,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

export async function* streamAnthropic(
  messages: LLMMessage[],
  config: ProviderConfig
): AsyncGenerator<AIStreamChunk> {
  const baseUrl = config.endpoint || 'https://api.anthropic.com';
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error('Anthropic API key required');
  }

  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens || 4096,
      system: systemMessage?.content,
      messages: chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic error: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

    for (const line of lines) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'content_block_delta' && data.delta?.text) {
          yield {
            token: data.delta.text,
            done: false,
            modelUsed: config.model,
          };
        }
        if (data.type === 'message_delta' && data.usage) {
          outputTokens = data.usage.output_tokens || 0;
        }
        if (data.type === 'message_start' && data.message?.usage) {
          inputTokens = data.message.usage.input_tokens || 0;
        }
        if (data.type === 'message_stop') {
          yield {
            token: '',
            done: true,
            modelUsed: config.model,
            inputTokens,
            outputTokens,
          };
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// OPENAI PROVIDER
// ═══════════════════════════════════════════════════════════════════

export async function callOpenAI(
  messages: LLMMessage[],
  config: ProviderConfig
): Promise<ProviderResponse> {
  const baseUrl = config.endpoint || 'https://api.openai.com';
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error('OpenAI API key required');
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI error: ${error}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0]?.message?.content || '',
    model: data.model,
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

export async function* streamOpenAI(
  messages: LLMMessage[],
  config: ProviderConfig
): AsyncGenerator<AIStreamChunk> {
  const baseUrl = config.endpoint || 'https://api.openai.com';
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error('OpenAI API key required');
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI error: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

    for (const line of lines) {
      if (line === 'data: [DONE]') {
        yield {
          token: '',
          done: true,
          modelUsed: config.model,
        };
        continue;
      }

      try {
        const data = JSON.parse(line.slice(6));
        const content = data.choices?.[0]?.delta?.content;
        if (content) {
          yield {
            token: content,
            done: false,
            modelUsed: config.model,
          };
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// UNIFIED CALLER
// ═══════════════════════════════════════════════════════════════════

/**
 * Call the appropriate provider based on type
 */
export async function callProvider(
  provider: AIProviderType,
  messages: LLMMessage[],
  config: ProviderConfig
): Promise<ProviderResponse> {
  switch (provider) {
    case 'ollama':
      return callOllama(messages, config);
    case 'anthropic':
      return callAnthropic(messages, config);
    case 'openai':
      return callOpenAI(messages, config);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Stream from the appropriate provider
 */
export async function* streamProvider(
  provider: AIProviderType,
  messages: LLMMessage[],
  config: ProviderConfig
): AsyncGenerator<AIStreamChunk> {
  switch (provider) {
    case 'ollama':
      yield* streamOllama(messages, config);
      break;
    case 'anthropic':
      yield* streamAnthropic(messages, config);
      break;
    case 'openai':
      yield* streamOpenAI(messages, config);
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
