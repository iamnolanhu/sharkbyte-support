import { describe, it, expect, vi } from 'vitest';
import { APICallError, type LanguageModelV4, type LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4, convertReadableStreamToArray } from 'ai/test';
import type { ChainEntry } from './providers';
import { createFallbackModel, type FallbackReason } from './fallback-model';
import type { ProviderName } from '@/lib/config';

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }];

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function textParts(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    { type: 'finish', usage: USAGE, finishReason: { unified: 'stop', raw: 'stop' } },
  ];
}

function okModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(textParts(text)) }) });
}

function partsModel(parts: LanguageModelV4StreamPart[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(parts) }) });
}

function throwingModel(error: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw error;
    },
    doGenerate: async () => {
      throw error;
    },
  });
}

function httpError(statusCode: number): APICallError {
  return new APICallError({ message: `HTTP ${statusCode}`, url: 'https://llm.test', requestBodyValues: {}, statusCode });
}

function entry(name: ProviderName, model: LanguageModelV4 | null): ChainEntry {
  return { name, model };
}

function setup(chain: ChainEntry[], firstByteTimeoutMs = 1000) {
  const onFallback = vi.fn<(from: ProviderName, to: ProviderName, reason: FallbackReason) => void>();
  const onStreamError = vi.fn<(provider: ProviderName, error: unknown) => void>();
  const model = createFallbackModel(chain, { firstByteTimeoutMs, onFallback, onStreamError });
  return { model, onFallback, onStreamError };
}

async function streamParts(model: LanguageModelV4): Promise<LanguageModelV4StreamPart[]> {
  const { stream } = await model.doStream({ prompt: PROMPT });
  return convertReadableStreamToArray(stream);
}

function textOf(parts: LanguageModelV4StreamPart[]): string {
  return parts.map((p) => (p.type === 'text-delta' ? p.delta : '')).join('');
}

describe('createFallbackModel', () => {
  it('reports the chain as its provider and model id', () => {
    const { model } = setup([entry('cerebras', null), entry('nvidia', okModel('x'))]);
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toContain('cerebras');
    expect(model.provider).toContain('nvidia');
  });

  it('falls back past a missing key and reports it', async () => {
    const { model, onFallback, onStreamError } = setup([entry('cerebras', null), entry('openrouter', okModel('Hello'))]);
    const parts = await streamParts(model);
    expect(textOf(parts)).toBe('Hello');
    expect(onFallback.mock.calls).toEqual([['cerebras', 'openrouter', 'missing_key']]);
    expect(onStreamError).not.toHaveBeenCalled();
  });

  it('skips a listed provider whose key is missing between two others', async () => {
    const nvidia = okModel('From NVIDIA');
    const { model, onFallback, onStreamError } = setup([
      entry('cerebras', throwingModel(httpError(429))),
      entry('openrouter', null),
      entry('nvidia', nvidia),
    ]);
    const parts = await streamParts(model);
    expect(textOf(parts)).toBe('From NVIDIA');
    expect(parts.some((p) => p.type === 'error')).toBe(false);
    expect(onFallback.mock.calls).toEqual([
      ['cerebras', 'openrouter', 'rate_limited'],
      ['openrouter', 'nvidia', 'missing_key'],
    ]);
    expect(onStreamError).not.toHaveBeenCalled();
  });

  it('falls back on 429 and 5xx thrown by doStream', async () => {
    const { model, onFallback } = setup([
      entry('cerebras', throwingModel(httpError(429))),
      entry('openrouter', throwingModel(httpError(503))),
      entry('nvidia', okModel('Third time lucky')),
    ]);
    expect(textOf(await streamParts(model))).toBe('Third time lucky');
    expect(onFallback.mock.calls).toEqual([
      ['cerebras', 'openrouter', 'rate_limited'],
      ['openrouter', 'nvidia', 'server_error'],
    ]);
  });

  it('falls back past a 402 (an account out of quota) and a 410 (a retired model)', async () => {
    const { model, onFallback } = setup([
      entry('cerebras', throwingModel(httpError(402))),
      entry('openrouter', throwingModel(httpError(410))),
      entry('nvidia', okModel('still swimming')),
    ]);
    expect(textOf(await streamParts(model))).toBe('still swimming');
    expect(onFallback.mock.calls).toEqual([
      ['cerebras', 'openrouter', 'error'],
      ['openrouter', 'nvidia', 'error'],
    ]);
  });

  it('falls back on any other thrown error as error', async () => {
    const { model, onFallback } = setup([
      entry('cerebras', throwingModel(httpError(401))),
      entry('openrouter', throwingModel(new Error('socket hang up'))),
      entry('nvidia', okModel('ok')),
    ]);
    expect(textOf(await streamParts(model))).toBe('ok');
    expect(onFallback.mock.calls).toEqual([
      ['cerebras', 'openrouter', 'error'],
      ['openrouter', 'nvidia', 'error'],
    ]);
  });

  it('falls back when the stream errors before any text', async () => {
    const { model, onFallback, onStreamError } = setup([
      entry('cerebras', partsModel([{ type: 'stream-start', warnings: [] }, { type: 'error', error: new Error('boom') }])),
      entry('openrouter', okModel('Rescued')),
    ]);
    const parts = await streamParts(model);
    expect(textOf(parts)).toBe('Rescued');
    expect(parts.some((p) => p.type === 'error')).toBe(false);
    expect(onFallback.mock.calls).toEqual([['cerebras', 'openrouter', 'stream_error']]);
    expect(onStreamError).not.toHaveBeenCalled();
  });

  it('falls back when the stream ends with no text', async () => {
    const { model, onFallback } = setup([
      entry('cerebras', partsModel([{ type: 'stream-start', warnings: [] }])),
      entry('openrouter', okModel('Rescued')),
    ]);
    expect(textOf(await streamParts(model))).toBe('Rescued');
    expect(onFallback.mock.calls).toEqual([['cerebras', 'openrouter', 'error']]);
  });

  it('falls back when no text arrives within the first-byte timeout', async () => {
    const cancelled = vi.fn();
    const silent = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
          },
          cancel: cancelled,
        }),
      }),
    });
    const { model, onFallback } = setup([entry('cerebras', silent), entry('openrouter', okModel('Fast fins'))], 20);
    expect(textOf(await streamParts(model))).toBe('Fast fins');
    expect(onFallback.mock.calls).toEqual([['cerebras', 'openrouter', 'timeout']]);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('times out a doStream call that never resolves', async () => {
    let seenSignal: AbortSignal | undefined;
    const hanging = new MockLanguageModelV4({
      doStream: (options) => {
        seenSignal = options.abortSignal;
        return new Promise(() => undefined);
      },
    });
    const { model, onFallback } = setup([entry('cerebras', hanging), entry('openrouter', okModel('ok'))], 20);
    expect(textOf(await streamParts(model))).toBe('ok');
    expect(onFallback.mock.calls).toEqual([['cerebras', 'openrouter', 'timeout']]);
    expect(seenSignal?.aborted).toBe(true);
  });

  it('an error after text ends the stream without fallback', async () => {
    const failure = new Error('connection reset');
    const backup = okModel('should never stream');
    const { model, onFallback, onStreamError } = setup([
      entry(
        'cerebras',
        partsModel([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'Hel' },
          { type: 'error', error: failure },
          { type: 'text-delta', id: 't', delta: 'lo' },
        ]),
      ),
      entry('openrouter', backup),
    ]);
    const parts = await streamParts(model);
    expect(textOf(parts)).toBe('Hel');
    expect(parts.filter((p) => p.type === 'error')).toEqual([{ type: 'error', error: failure }]);
    expect(parts.at(-1)?.type).toBe('error');
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(onStreamError.mock.calls).toEqual([['cerebras', failure]]);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('a read failure after text becomes one error part', async () => {
    const failure = new Error('stream torn');
    let pulls = 0;
    const torn = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          pull(controller) {
            pulls++;
            if (pulls === 1) controller.enqueue({ type: 'text-delta', id: 't', delta: 'Hel' });
            else controller.error(failure);
          },
        }),
      }),
    });
    const { model, onFallback, onStreamError } = setup([entry('cerebras', torn), entry('openrouter', okModel('no'))]);
    const parts = await streamParts(model);
    expect(textOf(parts)).toBe('Hel');
    expect(parts.filter((p) => p.type === 'error')).toEqual([{ type: 'error', error: failure }]);
    expect(onStreamError.mock.calls).toEqual([['cerebras', failure]]);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('rethrows when every provider fails before text', async () => {
    const last = httpError(500);
    const { model, onFallback } = setup([
      entry('cerebras', null),
      entry('openrouter', throwingModel(httpError(429))),
      entry('nvidia', throwingModel(last)),
    ]);
    await expect(model.doStream({ prompt: PROMPT })).rejects.toBe(last);
    expect(onFallback).toHaveBeenCalledTimes(2);
  });

  it('doGenerate falls back on call errors', async () => {
    const good = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: 'generated' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: USAGE,
        warnings: [],
      },
    });
    const { model, onFallback } = setup([
      entry('cerebras', null),
      entry('openrouter', throwingModel(httpError(503))),
      entry('nvidia', good),
    ]);
    const result = await model.doGenerate({ prompt: PROMPT });
    expect(result.content).toEqual([{ type: 'text', text: 'generated' }]);
    expect(onFallback.mock.calls).toEqual([
      ['cerebras', 'openrouter', 'missing_key'],
      ['openrouter', 'nvidia', 'server_error'],
    ]);
  });
});
