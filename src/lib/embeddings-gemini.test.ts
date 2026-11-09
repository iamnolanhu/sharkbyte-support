import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMBEDDING_CONFIG } from '@/lib/config';
import { embedTexts } from './embeddings';
import { l2Normalize, MAX_BATCH_TOKENS, planBatches, retryDelayMs } from './embeddings-gemini';

interface GeminiRequest {
  model: string;
  content: { parts: { text: string }[] };
  taskType: string;
  outputDimensionality: number;
}

const KEY = 'gemini-test-key';
const fetchMock = vi.fn<typeof fetch>();

function requestsOf(call: unknown[]): GeminiRequest[] {
  const init = call[1] as RequestInit;
  return (JSON.parse(String(init.body)) as { requests: GeminiRequest[] }).requests;
}

/** Unnormalised vector (norm 2 × |seed|) whose first value encodes the input's number ("text 7" → 7). */
function rawVector(seed: number, dims = 768): number[] {
  const v = Array.from({ length: dims }, () => 0);
  v[0] = seed;
  v[1] = Math.sqrt(3) * seed;
  return v;
}

function geminiOk(requests: GeminiRequest[]): Response {
  const embeddings = requests.map((r) => ({ values: rawVector(Number(r.content.parts[0].text.split(' ')[1]) + 1, r.outputDimensionality) }));
  return new Response(JSON.stringify({ embeddings }), { status: 200 });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GEMINI_API_KEY', KEY);
  vi.stubEnv('EMBEDDING_PROVIDER', '');
  vi.stubEnv('EMBEDDING_DIMS', '');
  vi.stubEnv('EMBEDDING_BATCH_SIZE', '');
  vi.stubEnv('EMBEDDING_MODEL', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Gemini embedding config', () => {
  it('defaults to gemini-embedding-001 at 768 dimensions, batches of 100', () => {
    expect(EMBEDDING_CONFIG.provider).toBe('gemini');
    expect(EMBEDDING_CONFIG.model).toBe('gemini-embedding-001');
    expect(EMBEDDING_CONFIG.dimensions).toBe(768);
    expect(EMBEDDING_CONFIG.batchSize).toBe(100);
  });

  it('keeps NVIDIA at 1024 and honours EMBEDDING_DIMS within halfvec limits', () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'NVIDIA');
    expect(EMBEDDING_CONFIG.dimensions).toBe(1024);
    expect(EMBEDDING_CONFIG.model).toBe('nvidia/nemotron-3.5-embed-1b');
    vi.stubEnv('EMBEDDING_PROVIDER', 'gemini');
    vi.stubEnv('EMBEDDING_DIMS', '1536');
    expect(EMBEDDING_CONFIG.dimensions).toBe(1536);
    vi.stubEnv('EMBEDDING_DIMS', '5000');
    expect(EMBEDDING_CONFIG.dimensions).toBe(768);
    vi.stubEnv('EMBEDDING_BATCH_SIZE', '500');
    expect(EMBEDDING_CONFIG.batchSize).toBe(100);
  });
});

describe('embedTexts with Gemini', () => {
  it('sends batchEmbedContents with the key in a header, RETRIEVAL_DOCUMENT and the configured size', async () => {
    fetchMock.mockImplementation(async (url, init) => geminiOk(requestsOf([url, init])));

    const vectors = await embedTexts(['text 0', 'text 1'], 'passage');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
    );
    expect(String(url)).not.toContain(KEY);
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(requestsOf(fetchMock.mock.calls[0])).toEqual([
      { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'text 0' }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
      { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'text 1' }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
    ]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(768);
  });

  it('embeds questions as RETRIEVAL_QUERY', async () => {
    fetchMock.mockImplementation(async (url, init) => geminiOk(requestsOf([url, init])));
    await embedTexts(['text 3'], 'query');
    expect(requestsOf(fetchMock.mock.calls[0])[0].taskType).toBe('RETRIEVAL_QUERY');
  });

  it('L2-normalises every vector (truncated Gemini output is not unit length)', async () => {
    fetchMock.mockImplementation(async (url, init) => geminiOk(requestsOf([url, init])));
    const [v] = await embedTexts(['text 4'], 'passage');
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
    expect(v[0]).toBeCloseTo(0.5, 10);
    expect(v[1]).toBeCloseTo(Math.sqrt(3) / 2, 10);
  });

  it('caps a request at 100 inputs and keeps order across batches', async () => {
    fetchMock.mockImplementation(async (url, init) => geminiOk(requestsOf([url, init])));
    const texts = Array.from({ length: 250 }, (_, i) => `text ${i}`);

    const vectors = await embedTexts(texts, 'passage');

    expect(fetchMock.mock.calls.map((c) => requestsOf(c).length)).toEqual([100, 100, 50]);
    // rawVector(n + 1) normalised: v[0] = 0.5 for every n, so check order via the request texts instead.
    expect(fetchMock.mock.calls.flatMap((c) => requestsOf(c).map((r) => r.content.parts[0].text))).toEqual(texts);
    expect(vectors).toHaveLength(250);
  });

  it('caps a request by estimated tokens to stay under the free-tier tokens per minute', () => {
    const big = 'x'.repeat(3200); // ~800 tokens, a full chunk
    const batches = planBatches(Array.from({ length: 60 }, () => big), 100, MAX_BATCH_TOKENS);
    expect(batches.map((b) => b.length)).toEqual([25, 25, 10]);
    // A single text larger than the budget still goes alone.
    expect(planBatches(['y'.repeat(MAX_BATCH_TOKENS * 8)], 100, MAX_BATCH_TOKENS)).toHaveLength(1);
  });

  it('falls back to one input per request when a batch gets a 4xx or 5xx', async () => {
    for (const failing of [400, 500]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async (url, init) => {
        const requests = requestsOf([url, init]);
        return requests.length > 1 ? new Response('{}', { status: failing }) : geminiOk(requests);
      });

      const vectors = await embedTexts(['text 0', 'text 1', 'text 2'], 'passage');

      expect(vectors).toHaveLength(3);
      expect(fetchMock.mock.calls.map((c) => requestsOf(c).length)).toEqual([3, 1, 1, 1]);
      expect(fetchMock.mock.calls.slice(1).map((c) => requestsOf(c)[0].content.parts[0].text)).toEqual([
        'text 0',
        'text 1',
        'text 2',
      ]);
    }
  });

  it('waits Google\'s retryDelay after a 429 and retries the same batch', async () => {
    vi.useFakeTimers();
    let calls = 0;
    fetchMock.mockImplementation(async (url, init) => {
      calls++;
      if (calls === 1) {
        return new Response(
          JSON.stringify({ error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }] } }),
          { status: 429 },
        );
      }
      return geminiOk(requestsOf([url, init]));
    });

    const pending = embedTexts(['text 0', 'text 1'], 'passage');
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const vectors = await pending;

    expect(vectors).toHaveLength(2);
    expect(fetchMock.mock.calls.map((c) => requestsOf(c).length)).toEqual([2, 2]);
  });

  it('gives a question at most two short 429 retries', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 429 }));

    const pending = embedTexts(['text 0'], 'query');
    const outcome = expect(pending).rejects.toThrow('Gemini embeddings failed with HTTP 429');
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops waiting when the crawl signal aborts', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 429 }));
    const controller = new AbortController();

    const pending = embedTexts(['text 0'], 'passage', { signal: controller.signal });
    const outcome = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(500);
    controller.abort(new Error('slice over'));
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a vector of the wrong size and a missing key', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ embeddings: [{ values: [1, 2, 3] }] })));
    await expect(embedTexts(['text 0'], 'passage')).rejects.toThrow('dimension 3, expected 768');
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(embedTexts(['text 0'], 'passage')).rejects.toThrow('GEMINI_API_KEY is not set');
  });
});

describe('helpers', () => {
  it('retryDelayMs reads RetryInfo and ignores anything else', () => {
    expect(retryDelayMs({ error: { details: [{ retryDelay: '37s' }] } })).toBe(37_000);
    expect(retryDelayMs({ error: { details: [{ retryDelay: '1.5s' }] } })).toBe(1_500);
    expect(retryDelayMs({ error: {} })).toBeNull();
    expect(retryDelayMs(null)).toBeNull();
  });

  it('l2Normalize leaves a zero vector alone', () => {
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
    expect(l2Normalize([3, 4])).toEqual([0.6, 0.8]);
  });
});
