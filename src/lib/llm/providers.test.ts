import { describe, it, expect } from 'vitest';
import { getLlmEnv } from '@/lib/config';
import { buildChain, parseProviderList, reasoningFields } from './providers';

const SSE_BODY =
  'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n' +
  'data: [DONE]\n\n';

describe('parseProviderList', () => {
  it('parseProviderList defaults and filters', () => {
    expect(parseProviderList(undefined)).toEqual(['nvidia', 'gemini']);
    expect(parseProviderList('')).toEqual(['nvidia', 'gemini']);
    expect(parseProviderList('bogus, other')).toEqual(['nvidia', 'gemini']);
    // OpenRouter and Cerebras stay supported by name.
    expect(parseProviderList('gemini,openrouter,cerebras')).toEqual(['gemini', 'openrouter', 'cerebras']);
    expect(parseProviderList('nvidia, bogus,NVIDIA')).toEqual(['nvidia']);
    expect(parseProviderList(' OpenRouter ,cerebras')).toEqual(['openrouter', 'cerebras']);
  });
});

describe('getLlmEnv', () => {
  it('reads models, keys and the first-byte timeout with defaults', () => {
    const env = getLlmEnv({});
    expect(env.providers).toEqual(['nvidia', 'gemini']);
    expect(env.firstByteTimeoutMs).toBe(8000);
    expect(env.geminiModel).toBe('gemini-3.5-flash-lite');
    expect(env.geminiKey).toBeUndefined();
    expect(getLlmEnv({ GEMINI_API_KEY: ' g-key ', GEMINI_LLM_MODEL: 'gemini-x' })).toMatchObject({
      geminiKey: 'g-key',
      geminiModel: 'gemini-x',
    });
    expect(env.cerebrasModel).toBe('gpt-oss-120b');
    expect(env.nvidiaModel).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
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
    const chain = buildChain(getLlmEnv({ NVIDIA_API_KEY: 'nv-test', LLM_PROVIDERS: 'cerebras,openrouter,nvidia' }));
    expect(chain.map((e) => e.name)).toEqual(['cerebras', 'openrouter', 'nvidia']);
    expect(chain[0]?.model).toBeNull();
    expect(chain[1]?.model).toBeNull();
    expect(chain[2]?.model?.modelId).toBe('nvidia/nemotron-3.5-lightning-30b-a3b');
  });

  it('the default chain is nvidia then gemini; gemini is skipped without GEMINI_API_KEY', () => {
    const withoutKey = buildChain(getLlmEnv({ NVIDIA_API_KEY: 'n' }));
    expect(withoutKey.map((e) => [e.name, e.model?.modelId ?? null])).toEqual([
      ['nvidia', 'nvidia/nemotron-3.5-lightning-30b-a3b'],
      ['gemini', null],
    ]);
    const withKey = buildChain(getLlmEnv({ NVIDIA_API_KEY: 'n', GEMINI_API_KEY: 'g' }));
    expect(withKey[1]?.model?.modelId).toBe('gemini-3.5-flash-lite');
  });

  it('gemini calls the OpenAI-compatible endpoint with its key and a low thinking budget', async () => {
    const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(SSE_BODY, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const [entry] = buildChain(getLlmEnv({ GEMINI_API_KEY: 'g-test', LLM_PROVIDERS: 'gemini' }), fetchImpl);
    if (!entry?.model) throw new Error('gemini entry has no model');
    const result = await entry.model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 600,
    });
    await result.stream.cancel();

    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer g-test');
    expect(calls[0]?.body).toMatchObject({ model: 'gemini-3.5-flash-lite', reasoning_effort: 'low', max_tokens: 600 });
  });

  it('keeps reasoning models inside the answer budget', async () => {
    const bodies: Record<string, Record<string, unknown>> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      bodies[String(input)] = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(SSE_BODY, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const chain = buildChain(
      getLlmEnv({ CEREBRAS_API_KEY: 'c', OPENROUTER_API_KEY: 'o', NVIDIA_API_KEY: 'n', LLM_PROVIDERS: 'cerebras,openrouter,nvidia' }),
      fetchImpl,
    );
    for (const entry of chain) {
      const result = await entry.model?.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        maxOutputTokens: 600,
      });
      await result?.stream.cancel();
    }

    const cerebras = bodies['https://api.cerebras.ai/v1/chat/completions'];
    const openrouter = bodies['https://openrouter.ai/api/v1/chat/completions'];
    const nvidia = bodies['https://integrate.api.nvidia.com/v1/chat/completions'];
    // gpt-oss: low reasoning effort; nemotron: thinking off (otherwise it spends all 600 tokens thinking).
    expect(cerebras).toMatchObject({ model: 'gpt-oss-120b', reasoning_effort: 'low', max_tokens: 600 });
    expect(nvidia).toMatchObject({
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 600,
    });
    expect(nvidia).not.toHaveProperty('reasoning_effort');
    expect(openrouter).not.toHaveProperty('reasoning_effort');
    expect(openrouter).not.toHaveProperty('chat_template_kwargs');
  });

  it('reasoningFields follows the model family, not the provider', () => {
    expect(reasoningFields('openai/gpt-oss-20b')).toEqual({ reasoning_effort: 'low' });
    expect(reasoningFields('nvidia/nemotron-3-super-120b-a12b')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(reasoningFields('google/gemma-4-31b-it:free')).toEqual({});
    // Gemini 2.5 Flash can switch thinking off; 2.5 Pro and Gemini 3 cannot, so they think low.
    expect(reasoningFields('gemini-2.5-flash')).toEqual({ reasoning_effort: 'none' });
    expect(reasoningFields('gemini-2.5-flash-lite')).toEqual({ reasoning_effort: 'none' });
    expect(reasoningFields('gemini-2.5-pro')).toEqual({ reasoning_effort: 'low' });
    expect(reasoningFields('gemini-3.5-flash-lite')).toEqual({ reasoning_effort: 'low' });
  });

  it('uses each provider base URL and model', async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(SSE_BODY, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const chain = buildChain(
      getLlmEnv({ CEREBRAS_API_KEY: 'c', OPENROUTER_API_KEY: 'o', NVIDIA_API_KEY: 'n', LLM_PROVIDERS: 'cerebras,openrouter,nvidia' }),
      fetchImpl,
    );
    expect(chain.map((e) => e.model?.modelId)).toEqual([
      'gpt-oss-120b',
      getLlmEnv({}).openrouterModel,
      'nvidia/nemotron-3.5-lightning-30b-a3b',
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
