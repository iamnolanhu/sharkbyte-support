import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
} from '@ai-sdk/provider';
import type { ProviderName } from '@/lib/config';
import type { ChainEntry } from './providers';

export type FallbackReason = 'missing_key' | 'rate_limited' | 'server_error' | 'timeout' | 'stream_error' | 'error';

export interface FallbackOptions {
  /** Budget for the call plus the first text part, per provider. */
  firstByteTimeoutMs: number;
  onFallback: (from: ProviderName, to: ProviderName, reason: FallbackReason) => void;
  /** An error after text was sent: the stream ends there, no fallback. */
  onStreamError: (provider: ProviderName, error: unknown) => void;
  /** The chain entry that is answering (called once per call, when it starts streaming or generates). */
  onProvider?: (provider: ProviderName, modelId: string) => void;
}

type StreamReader = ReadableStreamDefaultReader<LanguageModelV4StreamPart>;

type Attempt<T> = { ok: true; value: T } | { ok: false; reason: FallbackReason; error: unknown };

class FirstByteTimeoutError extends Error {
  constructor(provider: ProviderName, ms: number) {
    super(`${provider} sent no text within ${ms} ms`);
    this.name = 'FirstByteTimeoutError';
  }
}

const noop = (): void => undefined;

function classify(error: unknown): FallbackReason {
  if (APICallError.isInstance(error) && error.statusCode !== undefined) {
    if (error.statusCode === 429) return 'rate_limited';
    if (error.statusCode >= 500) return 'server_error';
  }
  return 'error';
}

/**
 * One provider's time budget: an abort signal for its HTTP call (merged with the
 * caller's) and a promise that rejects when the budget runs out.
 */
function startBudget(name: ProviderName, ms: number, callerSignal: AbortSignal | undefined) {
  const controller = new AbortController();
  const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const error = new FirstByteTimeoutError(name, ms);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  expired.catch(noop);
  return {
    signal,
    expired,
    timedOut: () => timedOut,
    stop: () => clearTimeout(timer),
    abort: () => controller.abort(),
  };
}

/** Emits the buffered parts, then the rest of `reader` unchanged; an error ends it as one error part. */
function continueStream(
  name: ProviderName,
  buffered: LanguageModelV4StreamPart[],
  reader: StreamReader,
  onStreamError: FallbackOptions['onStreamError'],
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of buffered) controller.enqueue(part);
    },
    async pull(controller) {
      let next: ReadableStreamReadResult<LanguageModelV4StreamPart>;
      try {
        next = await reader.read();
      } catch (error) {
        onStreamError(name, error);
        controller.enqueue({ type: 'error', error });
        controller.close();
        return;
      }
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
      if (next.value.type === 'error') {
        onStreamError(name, next.value.error);
        reader.cancel().catch(noop);
        controller.close();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function attemptStream(
  entry: ChainEntry,
  options: LanguageModelV4CallOptions,
  opts: FallbackOptions,
): Promise<Attempt<LanguageModelV4StreamResult>> {
  const { name, model } = entry;
  if (!model) return { ok: false, reason: 'missing_key', error: new Error(`${name} has no API key`) };

  const budget = startBudget(name, opts.firstByteTimeoutMs, options.abortSignal);
  const call = Promise.resolve(model.doStream({ ...options, abortSignal: budget.signal }));
  let reader: StreamReader | undefined;
  try {
    const result = await Promise.race([call, budget.expired]);
    reader = result.stream.getReader();
    const buffered: LanguageModelV4StreamPart[] = [];
    for (;;) {
      const next = await Promise.race([reader.read(), budget.expired]);
      if (next.done) throw new Error(`${name} ended its stream without text`);
      if (next.value.type === 'error') {
        budget.stop();
        reader.cancel().catch(noop);
        budget.abort();
        return { ok: false, reason: 'stream_error', error: next.value.error };
      }
      buffered.push(next.value);
      if (next.value.type === 'text-delta') {
        budget.stop();
        opts.onProvider?.(name, model.modelId);
        return { ok: true, value: { ...result, stream: continueStream(name, buffered, reader, opts.onStreamError) } };
      }
    }
  } catch (error) {
    budget.stop();
    const reason = budget.timedOut() ? 'timeout' : classify(error);
    if (reader) reader.cancel().catch(noop);
    // A call still in flight may resolve later: release its stream too.
    else call.then((late) => late.stream.cancel(), noop).catch(noop);
    budget.abort();
    return { ok: false, reason, error };
  }
}

async function attemptGenerate(
  entry: ChainEntry,
  options: LanguageModelV4CallOptions,
  opts: FallbackOptions,
): Promise<Attempt<LanguageModelV4GenerateResult>> {
  const { name, model } = entry;
  if (!model) return { ok: false, reason: 'missing_key', error: new Error(`${name} has no API key`) };

  const budget = startBudget(name, opts.firstByteTimeoutMs, options.abortSignal);
  try {
    const value = await Promise.race([model.doGenerate({ ...options, abortSignal: budget.signal }), budget.expired]);
    opts.onProvider?.(name, model.modelId);
    return { ok: true, value };
  } catch (error) {
    budget.abort();
    return { ok: false, reason: budget.timedOut() ? 'timeout' : classify(error), error };
  } finally {
    budget.stop();
  }
}

/** Walks the chain until an attempt succeeds; throws the last error when none does. */
async function walkChain<T>(
  chain: ChainEntry[],
  options: LanguageModelV4CallOptions,
  opts: FallbackOptions,
  attempt: (entry: ChainEntry) => Promise<Attempt<T>>,
): Promise<T> {
  let lastError: unknown = new Error('No LLM provider is configured');
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i] as ChainEntry;
    const result = await attempt(entry);
    if (result.ok) return result.value;
    lastError = result.error;
    // The caller gave up (client disconnected): stop, don't try the next provider.
    if (options.abortSignal?.aborted) throw lastError;
    const next = chain[i + 1];
    if (next) opts.onFallback(entry.name, next.name, result.reason);
  }
  throw lastError;
}

/**
 * A language model that tries each provider in order until one starts streaming
 * text. Failures before the first text part move to the next provider; after it,
 * the stream belongs to that provider and an error simply ends it.
 */
export function createFallbackModel(chain: ChainEntry[], opts: FallbackOptions): LanguageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: `fallback(${chain.map((e) => e.name).join(',')})`,
    modelId: chain.map((e) => `${e.name}:${e.model?.modelId ?? 'no-key'}`).join(','),
    supportedUrls: {},
    doStream: (options) => walkChain(chain, options, opts, (entry) => attemptStream(entry, options, opts)),
    doGenerate: (options) => walkChain(chain, options, opts, (entry) => attemptGenerate(entry, options, opts)),
  };
}
