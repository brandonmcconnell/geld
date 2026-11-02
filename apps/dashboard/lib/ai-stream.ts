import 'server-only';
import { z } from 'zod';
import { joinUrl } from '@geld/review/ai-client';
import type { ChatMessage } from '@geld/review/ai-client';
import {completeConfigured} from './ai-config';
import type { AiConfiguration } from './ai-config';
const openAiChunk = z.object({ choices: z.array(z.object({ delta: z.object({ content: z.string().nullable().optional() }) })) });
const claudeChunk = z.object({ type: z.string(), delta: z.object({ text: z.string().optional() }).optional() });
export async function openAiStream(config: AiConfiguration, messages: readonly ChatMessage[], signal: AbortSignal): Promise<Response | null> {
  try {
    if(config.provider==='companion'){if(signal.aborted)return null;const result=await completeConfigured(config,{messages,fetch,baseUrl:config.baseUrl,apiKey:config.apiKey,model:config.model,signal});return result.ok&&!signal.aborted?new Response(`data: ${JSON.stringify({choices:[{delta:{content:result.text}}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}}):null;}
    const claude = config.provider === 'claude';
    const response = await fetch(claude ? 'https://api.anthropic.com/v1/messages' : joinUrl(config.baseUrl, '/v1/chat/completions'), { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]), headers: claude ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } : { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(claude ? { model: config.model, stream: true, max_tokens: 4000, system: messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n'), messages: messages.filter((message) => message.role !== 'system') } : { model: config.model, stream: true, messages, max_tokens: 4000 }) });
    return response.ok && response.body ? response : null;
  } catch { return null; }
}
export async function* textDeltas(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let pending = ''; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true }); size += chunk.value.length;
      if (size > 2_000_000) throw new Error('The response exceeded its limit');
      const lines = pending.split('\n'); pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let value: unknown;
        try { value = JSON.parse(data); } catch { continue; }
        const terminal = z.object({ type: z.string() }).safeParse(value);
        if (terminal.success && terminal.data.type === 'message_stop') return;
        if ((terminal.success && terminal.data.type === 'error') || (typeof value === 'object' && value !== null && 'error' in value)) throw new Error('The provider interrupted the response');
        const openAi = openAiChunk.safeParse(value);
        if (openAi.success) { const text = openAi.data.choices[0]?.delta.content; if (text) yield text; continue; }
        const claude = claudeChunk.safeParse(value);
        if (claude.success && claude.data.type === 'content_block_delta' && claude.data.delta?.text) yield claude.data.delta.text;
      }
    }
    throw new Error('The provider stream ended before completion');
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
