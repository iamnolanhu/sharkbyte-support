import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMBEDDING_CONFIG } from '@/lib/config';
import { embedTexts } from './embeddings';

interface EmbeddingsBody {
  model: string;
  input: string[];
  input_type: string;
  encoding_format: string;
  truncate: string;
  dimensions?: number;
}

function vector(dims: number = EMBEDDING_CONFIG.dimensions): number[] {
  return Array.from({ length: dims }, (_, i) => i / dims);
}

function okResponse(count: number, dims: number = EMBEDDING_CONFIG.dimensions): Response {
  // Out of order on purpose: the client must sort by index.
  const data = Array.from({ length: count }, (_, index) => ({ object: 'embedding', index, embedding: vector(dims) }))
    .reverse();
  return new Response(JSON.stringify({ object: 'list', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyOf(call: unknown[]): EmbeddingsBody {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as EmbeddingsBody;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('EMBEDDING_PROVIDER', 'nvidia');
  vi.stubEnv('NVIDIA_API_KEY', 'test-key');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A vector whose first value is the number in the text ("text 7" → 7), so order can be checked. */
function taggedResponse(input: string[]): Response {
  const data = input.map((text, index) => {
    const v = vector();
    v[0] = Number(text.split(' ')[1]);
    return { object: 'embedding', index, embedding: v };
  });
  return new Response(JSON.stringify({ object: 'list', data }), { status: 200 });
}

describe('embedTexts', () => {
  it('embedTexts sends one input per request by default', async () => {
    fetchMock.mockImplementation(async (_url, init) => taggedResponse(bodyOf([_url, init]).input));
    const texts = ['text 0', 'text 1', 'text 2'];

    const vectors = await embedTexts(texts, 'passage');

    expect(fetchMock.mock.calls.map((c) => bodyOf(c).input)).toEqual([['text 0'], ['text 1'], ['text 2']]);
    expect(vectors.map((v) => v[0])).toEqual([0, 1, 2]);
  });

  it('embedTexts splits a batch that gets a 5xx down to single inputs, keeping order', async () => {
    vi.stubEnv('EMBEDDING_BATCH_SIZE', '8');
    // The upstream failure seen on NVIDIA: any request with more than one input is a 500.
    fetchMock.mockImplementation(async (url, init) => {
      const input = bodyOf([url, init]).input;
      return input.length > 1 ? new Response('service inference failed', { status: 500 }) : taggedResponse(input);
    });
    const texts = Array.from({ length: 8 }, (_, i) => `text ${i}`);

    const vectors = await embedTexts(texts, 'passage');

    expect(vectors.map((v) => v[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const sizes = fetchMock.mock.calls.map((c) => bodyOf(c).input.length);
    expect(sizes.filter((n) => n === 1)).toHaveLength(8);
    // 8 → 4+4 → 2+2+2+2: seven failed batch requests, no retry sleeps for batches.
    expect(sizes.filter((n) => n > 1)).toHaveLength(7);
  });

  it('embedTexts stops before the next request once the caller aborts', async () => {
    fetchMock.mockImplementation(async (url, init) => taggedResponse(bodyOf([url, init]).input));
    const controller = new AbortController();
    controller.abort();

    await expect(embedTexts(['text 0'], 'passage', { signal: controller.signal })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('embedTexts batches and sends input_type', async () => {
    vi.stubEnv('EMBEDDING_BATCH_SIZE', '32');
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as EmbeddingsBody;
      return okResponse(body.input.length);
    });
    const texts = Array.from({ length: 70 }, (_, i) => `text ${i}`);

    const vectors = await embedTexts(texts, 'passage');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map(bodyOf);
    expect(bodies.map((b) => b.input.length)).toEqual([32, 32, 6]);
    expect(bodies.every((b) => b.input_type === 'passage')).toBe(true);
    expect(bodies[0]).toMatchObject({
      model: EMBEDDING_CONFIG.model,
      encoding_format: 'float',
      truncate: 'END',
      dimensions: 1024,
    });
    expect(bodies[2]?.input[5]).toBe('text 69');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://integrate.api.nvidia.com/v1/embeddings');
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(vectors).toHaveLength(70);
    expect(vectors[0]).toHaveLength(1024);
  });

  it('embedTexts retries a batch once on 429 without splitting it', async () => {
    vi.stubEnv('EMBEDDING_BATCH_SIZE', '2');
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(okResponse(2));

    const pending = embedTexts(['a', 'b'], 'query');
    await vi.advanceTimersByTimeAsync(1000);
    const vectors = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock.mock.calls[1] ?? []).input_type).toBe('query');
    expect(bodyOf(fetchMock.mock.calls[1] ?? []).input).toEqual(['a', 'b']);
    expect(vectors).toHaveLength(2);
  });

  it('embedTexts gives up after one retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }));

    const pending = embedTexts(['a'], 'passage');
    const assertion = expect(pending).rejects.toThrow(/503/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('embedTexts rejects a wrong dimension', async () => {
    fetchMock.mockResolvedValue(okResponse(1, 768));
    await expect(embedTexts(['a'], 'passage')).rejects.toThrow(/dimension/i);
  });

  it('embedTexts throws when the key is unset', async () => {
    vi.stubEnv('NVIDIA_API_KEY', '');
    await expect(embedTexts(['a'], 'passage')).rejects.toThrow(/NVIDIA_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
