/**
 * Tavily client: web search and page extraction, for facts a model can't know
 * from training (today's release notes, the latest version of a library).
 *
 * Plain fetch with a Bearer key, like the Token Factory client. Each reply
 * carries Tavily's own credit count (include_usage), which goes on the receipt.
 */

export const TAVILY_BASE_URL = 'https://api.tavily.com';
/** Pay-as-you-go price of one credit, USD (docs.tavily.com, API credits). */
export const TAVILY_CREDIT_USD = 0.008;

export interface TavilyOptions {
  /** Default: process.env.TAVILY_API_KEY. */
  apiKey?: string;
  baseUrl?: string;
  /** For tests. */
  fetch?: typeof fetch;
}

export interface SearchResult {
  title: string;
  url: string;
  score: number;
}

export interface Tavily {
  search(query: string, opts?: { includeDomains?: readonly string[]; maxResults?: number }): Promise<{ results: SearchResult[]; credits: number }>;
  /** One page's text. With `query`, only the parts most relevant to it. */
  extract(url: string, opts?: { query?: string; chunks?: number }): Promise<{ content: string; credits: number }>;
}

export class TavilyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TavilyError';
  }
}

export function tavily(opts: TavilyOptions = {}): Tavily {
  const apiKey = opts.apiKey ?? process.env.TAVILY_API_KEY;
  const base = opts.baseUrl ?? TAVILY_BASE_URL;
  const doFetch = opts.fetch ?? fetch;

  const post = async (path: string, body: Record<string, unknown>) => {
    if (!apiKey) throw new TavilyError('No Tavily API key: set TAVILY_API_KEY.', 401);
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, include_usage: true }),
    });
    if (!res.ok) throw new TavilyError(`Tavily ${path} ${res.status}`, res.status);
    return res.json() as Promise<any>;
  };

  return {
    async search(query, o = {}) {
      const d = await post('/search', {
        query, search_depth: 'basic', max_results: o.maxResults ?? 3,
        ...(o.includeDomains ? { include_domains: o.includeDomains } : {}),
      });
      const results: SearchResult[] = (d.results ?? []).map((r: any) => ({ title: String(r.title ?? ''), url: String(r.url ?? ''), score: Number(r.score ?? 0) }));
      return { results, credits: Number(d.usage?.credits ?? 0) };
    },
    async extract(url, o = {}) {
      const d = await post('/extract', {
        urls: [url], extract_depth: 'basic',
        ...(o.query ? { query: o.query, chunks_per_source: o.chunks ?? 5 } : {}),
      });
      return { content: String(d.results?.[0]?.raw_content ?? ''), credits: Number(d.usage?.credits ?? 0) };
    },
  };
}
