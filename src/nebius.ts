/**
 * Nebius Token Factory client for slash-tokens' hire().run().
 *
 * Token Factory is OpenAI-compatible: POST {base}/chat/completions with a
 * Bearer key. The client maps slash-tokens catalog keys to Token Factory model
 * IDs, turns Nemotron's reasoning on or off per call, caps output at the job's
 * maxOutputTokens (the quote's ceiling), and retries rate limits and server
 * errors with backoff.
 */
import type { CallModel, Message, Usage } from 'slash-tokens';

export const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1';

/** slash-tokens catalog key → Token Factory model ID (GET /v1/models, 2026-10-08). */
export const NEBIUS_MODEL_IDS: Record<string, string> = {
  'nemotron-3-ultra': 'nvidia/Nemotron-3-Ultra-550b-a55b',
  'nemotron-3-super': 'nvidia/nemotron-3-super-120b-a12b',
  'nemotron-3-nano': 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  'nemotron-3.5-lightning': 'nvidia/Nemotron-3_5-Lightning',
};

export interface NebiusOptions {
  /** Token Factory API key. Default: process.env.NEBIUS_API_KEY. */
  apiKey?: string;
  baseUrl?: string;
  /** Cap on output tokens for each call: pass the job's maxOutputTokens. */
  maxTokens?: number;
  /**
   * Nemotron reasons before it answers unless told not to, and reasoning
   * tokens are billed as output. true = let it reason; false = answer
   * directly. Default false.
   */
  reasoning?: boolean;
  temperature?: number;
  /** Retries on 429 and 5xx. Default 3. */
  maxRetries?: number;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests: wait between retries. */
  sleep?: (ms: number) => Promise<void>;
}

export class NebiusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'NebiusError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Seconds from Retry-After, else exponential backoff (1 s, 2 s, 4 s …). */
function retryDelayMs(res: Response, attempt: number): number {
  const after = Number(res.headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) return Math.min(after, 60) * 1000;
  return 1000 * 2 ** attempt;
}

/** A CallModel for hire().run() that sends each job to Token Factory. */
export function nebius(opts: NebiusOptions = {}): CallModel {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const baseUrl = opts.baseUrl ?? NEBIUS_BASE_URL;
  const maxRetries = opts.maxRetries ?? 3;

  return async (model: string, input: string | Message[]) => {
    const apiKey = opts.apiKey ?? process.env.NEBIUS_API_KEY;
    if (!apiKey) throw new NebiusError('No Nebius API key: set NEBIUS_API_KEY or pass apiKey', 401);
    const id = NEBIUS_MODEL_IDS[model];
    if (!id) throw new NebiusError(`Not a Token Factory model: "${model}"`, 400);

    const body: Record<string, unknown> = {
      model: id,
      messages: typeof input === 'string' ? [{ role: 'user', content: input }] : input,
      chat_template_kwargs: { enable_thinking: opts.reasoning ?? false },
    };
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;

    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: Usage };
        if (!json.usage) throw new NebiusError('Token Factory returned no usage', 502);
        return { output: json.choices?.[0]?.message?.content ?? '', usage: json.usage };
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        const text = await res.text().catch(() => '');
        throw new NebiusError(`Token Factory ${res.status}: ${text.slice(0, 200)}`, res.status);
      }
      await sleep(retryDelayMs(res, attempt));
    }
  };
}
