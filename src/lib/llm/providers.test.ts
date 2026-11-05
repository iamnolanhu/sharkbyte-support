import { describe, it, expect } from 'vitest';
import { getLlmEnv } from '@/lib/config';
import { buildChain, parseProviderList } from './providers';

const SSE_BODY =
  'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n' +
  'data: [DONE]\n\n';

describe('parseProviderList', () => {
  it('parseProviderList defaults and filters', () => {
    expect(parseProviderList(undefined)).toEqual(['cerebras', 'openrouter', 'nvidia']);
    expect(parseProviderList('')).toEqual(['cerebras', 'openrouter', 'nvidia']);
    expect(parseProviderList('bogus, other')).toEqual(['cerebras', 'openrouter', 'nvidia']);
    expect(parseProviderList('nvidia, bogus,NVIDIA')).toEqual(['nvidia']);
    expect(parseProviderList(' OpenRouter ,cerebras')).toEqual(['openrouter', 'cerebras']);
  });
});

describe('getLlmEnv', () => {
  it('reads models, keys and the first-byte timeout with defaults', () => {
    const env = getLlmEnv({});
    expect(env.providers).toEqual(['cerebras', 'openrouter', 'nvidia']);
    expect(env.firstByteTimeoutMs).toBe(8000);
    expect(env.cerebrasModel).toBe('gpt-oss-120b');
    expect(env.nvidiaModel).toBe('openai/gpt-oss-120b');
    expect(env.openrouterModel.endsWith(':free')).toBe(true);
    expect(env.cerebrasKey).toBeUndefined();

    const custom = getLlmEnv({
      LLM_PROVIDERS: 'nvidia',
      LLM_FIRST_BYTE_TIMEOUT_MS: '2500',
      LLM_MODEL: 'llama-x',
      OPENROUTER_MODEL: 'some/model:free',
      NVIDIA_LLM_MODEL: 'nv/model',
      NVIDIA_API_KEY: ' nv-key ',
      CEREBRAS_API_KEY: '   ',
    });
    expect(custom.providers).toEqual(['nvidia']);
    expect(custom.firstByteTimeoutMs).toBe(2500);
    expect(custom.cerebrasModel).toBe('llama-x');
    expect(custom.openrouterModel).toBe('some/model:free');
    expect(custom.nvidiaModel).toBe('nv/model');
    expect(custom.nvidiaKey).toBe('nv-key');
    expect(custom.cerebrasKey).toBeUndefined();
  });
});

describe('buildChain', () => {
  it('openrouter requests carry attribution headers', async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(SSE_BODY, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const env = getLlmEnv({ OPENROUTER_API_KEY: 'or-test', LLM_PROVIDERS: 'openrouter' });
    const [entry] = buildChain(env, fetchImpl);
    expect(entry?.name).toBe('openrouter');
    if (!entry?.model) throw new Error('openrouter entry has no model');

    const result = await entry.model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    await result.stream.cancel();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0]?.headers.get('HTTP-Referer')).toBe('https://sharkbyte-support.localhost');
    expect(calls[0]?.headers.get('X-Title')).toBe('sharkbyte-support');
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer or-test');
  });

  it('missing keys become null entries', () => {
    const chain = buildChain(getLlmEnv({ NVIDIA_API_KEY: 'nv-test' }));
    expect(chain.map((e) => e.name)).toEqual(['cerebras', 'openrouter', 'nvidia']);
    expect(chain[0]?.model).toBeNull();
    expect(chain[1]?.model).toBeNull();
    expect(chain[2]?.model?.modelId).toBe('openai/gpt-oss-120b');
  });

  it('uses each provider base URL and model', async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(SSE_BODY, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const chain = buildChain(
      getLlmEnv({ CEREBRAS_API_KEY: 'c', OPENROUTER_API_KEY: 'o', NVIDIA_API_KEY: 'n' }),
      fetchImpl,
    );
    expect(chain.map((e) => e.model?.modelId)).toEqual([
      'gpt-oss-120b',
      getLlmEnv({}).openrouterModel,
      'openai/gpt-oss-120b',
    ]);
    for (const entry of chain) {
      const result = await entry.model?.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      });
      await result?.stream.cancel();
    }
    expect(urls).toEqual([
      'https://api.cerebras.ai/v1/chat/completions',
      'https://openrouter.ai/api/v1/chat/completions',
      'https://integrate.api.nvidia.com/v1/chat/completions',
    ]);
  });
});
