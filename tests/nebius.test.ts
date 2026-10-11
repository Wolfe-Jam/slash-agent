/**
 * Token Factory client. Offline with a stub fetch; the live test runs only
 * with NEBIUS_LIVE=1 and NEBIUS_API_KEY set (one tiny call, a fraction of a cent).
 */
import { describe, it, expect } from 'bun:test';
import { hire, CATALOG } from 'slash-tokens';
import { nebius, NebiusError, NEBIUS_MODEL_IDS } from '../src';

type Sent = { url: string; body: any; auth: string };

function stub(responses: Response[], sent: Sent[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>).Authorization });
    return responses.shift()!;
  }) as unknown as typeof fetch;
}

const ok = (content = 'ok', usage = { prompt_tokens: 23, completion_tokens: 2 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });

describe('nebius() — a CallModel for hire().run()', () => {
  it('maps every Nebius catalog model to a Token Factory ID', () => {
    const nebiusModels = Object.entries(CATALOG).filter(([, e]) => e.provider === 'Nebius').map(([k]) => k).sort();
    expect(Object.keys(NEBIUS_MODEL_IDS).sort()).toEqual(nebiusModels);
  });

  it('sends the Token Factory ID, the cap, reasoning off by default, and the key', async () => {
    const sent: Sent[] = [];
    const call = nebius({ apiKey: 'k', maxTokens: 200, fetch: stub([ok()], sent) });
    const res = await call('nemotron-3.5-lightning', 'hello');
    expect(res).toEqual({ output: 'ok', usage: { prompt_tokens: 23, completion_tokens: 2 } });
    expect(sent[0].url).toBe('https://api.tokenfactory.nebius.com/v1/chat/completions');
    expect(sent[0].auth).toBe('Bearer k');
    expect(sent[0].body).toEqual({
      model: 'nvidia/Nemotron-3_5-Lightning',
      messages: [{ role: 'user', content: 'hello' }],
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 200,
    });
  });

  it('reasoning: true lets Nemotron think; messages pass through', async () => {
    const sent: Sent[] = [];
    const msgs = [{ role: 'system', content: 'Plan first.' }, { role: 'user', content: 'Fix the bug.' }];
    await nebius({ apiKey: 'k', reasoning: true, fetch: stub([ok()], sent) })('nemotron-3-ultra', msgs);
    expect(sent[0].body.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(sent[0].body.messages).toEqual(msgs);
    expect(sent[0].body).not.toHaveProperty('max_tokens');
  });

  it('retries 429 and 5xx (Retry-After, then backoff), then succeeds', async () => {
    const waits: number[] = [];
    const call = nebius({
      apiKey: 'k',
      fetch: stub([
        new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
        new Response('oops', { status: 503 }),
        ok(),
      ]),
      sleep: async ms => { waits.push(ms); },
    });
    expect((await call('nemotron-3-nano', 'hi')).output).toBe('ok');
    expect(waits).toEqual([2000, 2000]);
  });

  it('gives up after maxRetries; never retries a 4xx other than 429', async () => {
    const sleep = async () => {};
    const many = Array.from({ length: 4 }, () => new Response('busy', { status: 429 }));
    await expect(nebius({ apiKey: 'k', maxRetries: 3, fetch: stub(many), sleep })('nemotron-3-nano', 'hi')).rejects.toThrow('Token Factory 429');
    const sent: Sent[] = [];
    await expect(nebius({ apiKey: 'k', fetch: stub([new Response('bad', { status: 400 })], sent), sleep })('nemotron-3-nano', 'hi')).rejects.toBeInstanceOf(NebiusError);
    expect(sent).toHaveLength(1);
  });

  it('refuses a model Token Factory does not serve, and a missing key', async () => {
    await expect(nebius({ apiKey: 'k', fetch: stub([]) })('claude-opus-5', 'hi')).rejects.toThrow('Not a Token Factory model');
    const saved = process.env.NEBIUS_API_KEY;
    delete process.env.NEBIUS_API_KEY;
    try {
      await expect(nebius({ fetch: stub([]) })('nemotron-3-nano', 'hi')).rejects.toThrow('No Nebius API key');
    } finally {
      if (saved !== undefined) process.env.NEBIUS_API_KEY = saved;
    }
  });

  it('plugs into hire().run(): booked model, receipt from the real usage shape', async () => {
    const sent: Sent[] = [];
    const agent = hire({ floor: 1 });
    const { decision, receipt } = await agent.run({
      input: 'Fix the off-by-one.', model: 'nemotron-3-ultra', maxOutputTokens: 200,
      call: nebius({ apiKey: 'k', maxTokens: 200, fetch: stub([ok('done', { prompt_tokens: 22, completion_tokens: 40 })], sent) }),
    });
    expect(decision.action).toBe('downgrade');
    expect(sent[0].body.model).toBe(NEBIUS_MODEL_IDS[decision.chosen!.model]);
    expect(receipt!.underReported).toBe(false);
    expect(receipt!.withinQuote).toBe(true);
  });
});

describe.if(process.env.NEBIUS_LIVE === '1' && !!process.env.NEBIUS_API_KEY)('live Token Factory', () => {
  it('one real call: answer without reasoning, honest receipt', async () => {
    const agent = hire({ floor: 1 });
    const { output, receipt } = await agent.run({
      input: 'Reply with the single word: ok', model: 'nemotron-3-ultra', maxOutputTokens: 16,
      call: nebius({ maxTokens: 16 }),
    });
    expect((output ?? '').toLowerCase()).toContain('ok');
    expect(receipt!.actual.reasoningTokens).toBe(0);
    expect(receipt!.underReported).toBe(false);
  }, 60_000);
});
