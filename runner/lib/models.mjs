// One conversation, two possible models. Every turn goes to the Anthropic API
// first; if a call fails (after the SDK's own retries), the runner switches to
// the local model for the rest of the run and carries on with the same
// conversation, translated to the OpenAI-compatible chat format that Ollama and
// friends speak.
//
// The conversation is kept in the Anthropic Messages format throughout. Turns
// from the local model are converted back into it, so the agent loop never
// needs to know which model answered.

import Anthropic from '@anthropic-ai/sdk';

// A refusal is a decision, not an outage. Never route around it to another model.
export class RefusalError extends Error {}

export class Models {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 4 }) : null;
    this.usingLocal = !this.client;
    this.fallbackReason = this.client ? null : 'ANTHROPIC_API_KEY is not set';
    this.used = new Set();
  }

  get hasLocal() {
    return Boolean(this.config.localModel);
  }

  // Which models actually answered during this run, for the PR description.
  describe() {
    const names = [...this.used];
    if (!names.length) return 'no model calls';
    return names.join(' and ');
  }

  // tools: [{ name, description, input_schema, localOnly? }]
  // serverTools: Anthropic server tools (web search, web fetch), used only on the API.
  async turn({ system, messages, tools, serverTools = [] }) {
    if (!this.usingLocal) {
      try {
        const result = await this.anthropicTurn({ system, messages, tools, serverTools });
        this.used.add(`${this.config.model} (Anthropic API)`);
        return result;
      } catch (error) {
        if (error instanceof RefusalError || !this.hasLocal) throw error;
        this.fallbackReason = describeError(error);
        this.usingLocal = true;
        this.log(`Anthropic API call failed: ${this.fallbackReason}`);
        this.log(`Falling back to the local model ${this.config.localModel} for the rest of this run.`);
      }
    }
    if (!this.hasLocal) throw new Error(`No Anthropic API key and no local model configured (${this.fallbackReason}).`);
    const result = await this.localTurn({ system, messages, tools });
    this.used.add(`${this.config.localModel} (local)`);
    return result;
  }

  async anthropicTurn({ system, messages, tools, serverTools }) {
    const stream = this.client.beta.messages.stream({
      model: this.config.model,
      max_tokens: 64000,
      system,
      messages,
      tools: [
        ...tools.filter((t) => !t.localOnly).map(({ localOnly, ...t }) => ({ ...t, eager_input_streaming: true })),
        ...serverTools,
      ],
      thinking: { type: 'adaptive' },
      output_config: { effort: this.config.effort },
      // If the model declines for policy reasons, let the API retry on its default substitute.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      const details = message.stop_details;
      throw new RefusalError(`The model declined this task${details?.category ? ` (${details.category})` : ''}.`);
    }
    return { content: message.content, stop_reason: message.stop_reason };
  }

  async localTurn({ system, messages, tools }) {
    const res = await fetch(`${this.config.localBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.localApiKey && { Authorization: `Bearer ${this.config.localApiKey}` }),
      },
      body: JSON.stringify({
        model: this.config.localModel,
        messages: toOpenAI(system, messages),
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
      }),
      signal: AbortSignal.timeout(this.config.localTimeoutMs),
    });
    if (!res.ok) throw new Error(`Local model: ${res.status} ${await res.text()}`);
    return fromOpenAI(await res.json());
  }
}

function describeError(error) {
  if (error instanceof Anthropic.APIError && error.status) return `${error.status} ${error.message}`;
  return error?.message || String(error);
}

// Anthropic messages -> OpenAI chat messages. Thinking and server-tool blocks
// (web search results) have no equivalent and are dropped; their substance
// is already reflected in the text and tool calls around them.
export function toOpenAI(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = message.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      if (!text && !calls.length) continue;
      out.push({ role: 'assistant', content: text || null, ...(calls.length && { tool_calls: calls }) });
      continue;
    }
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: resultText(block.content) });
      } else if (block.type === 'text') {
        out.push({ role: 'user', content: block.text });
      }
    }
  }
  return out;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  return (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

// OpenAI chat completion -> an assistant turn in Anthropic's shape.
export function fromOpenAI(completion) {
  const choice = completion.choices?.[0];
  if (!choice) throw new Error(`Local model returned no choices: ${JSON.stringify(completion).slice(0, 500)}`);
  const content = [];
  // Some local models put their reasoning inline in <think> tags; it isn't part of the answer.
  const text = (choice.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (text) content.push({ type: 'text', text });
  for (const [i, call] of (choice.message?.tool_calls ?? []).entries()) {
    let input;
    try {
      input = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments || '{}') : call.function.arguments ?? {};
    } catch {
      input = { _unparseable_arguments: call.function.arguments };
    }
    content.push({ type: 'tool_use', id: call.id || `call_${Date.now()}_${i}`, name: call.function.name, input });
  }
  const hasCalls = content.some((b) => b.type === 'tool_use');
  const stop_reason = hasCalls ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
  return { content, stop_reason };
}
