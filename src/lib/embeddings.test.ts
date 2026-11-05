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
  vi.stubEnv('NVIDIA_API_KEY', 'test-key');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('embedTexts', () => {
  it('embedTexts batches and sends input_type', async () => {
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

  it('embedTexts retries once on 429', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(okResponse(2));

    const pending = embedTexts(['a', 'b'], 'query');
    await vi.advanceTimersByTimeAsync(1000);
    const vectors = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock.mock.calls[1] ?? []).input_type).toBe('query');
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
