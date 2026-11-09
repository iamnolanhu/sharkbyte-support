import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { LlmEnv, ProviderName } from '@/lib/config';

export { parseProviderList, type ProviderName } from '@/lib/config';

/** One provider in the chain; `model` is null when its API key is not set. */
export interface ChainEntry {
  name: ProviderName;
  model: LanguageModelV4 | null;
}

interface ProviderSpec {
  baseURL: string;
  headers?: Record<string, string>;
  apiKey: (env: LlmEnv) => string | undefined;
  modelId: (env: LlmEnv) => string;
}

const PROVIDERS: Record<ProviderName, ProviderSpec> = {
  cerebras: {
    baseURL: 'https://api.cerebras.ai/v1',
    apiKey: (env) => env.cerebrasKey,
    modelId: (env) => env.cerebrasModel,
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    // Every OpenRouter request names the app that sent it.
    headers: { 'HTTP-Referer': 'https://sharkbyte-support.localhost', 'X-Title': 'sharkbyte-support' },
    apiKey: (env) => env.openrouterKey,
    modelId: (env) => env.openrouterModel,
  },
  nvidia: {
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: (env) => env.nvidiaKey,
    modelId: (env) => env.nvidiaModel,
  },
  // Gemini's OpenAI-compatible endpoint, with the GEMINI_API_KEY embeddings already use.
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: (env) => env.geminiKey,
    modelId: (env) => env.geminiModel,
  },
};

/** The OpenAI-compatible API root a provider is called at (LLM analytics `$ai_base_url`). */
export function providerBaseUrl(name: ProviderName): string {
  return PROVIDERS[name].baseURL;
}

/**
 * Request fields that keep a reasoning model's thinking out of the way: answers get 600 output
 * tokens and the first text must arrive within the first-byte timeout. Nemotron models think by
 * default and can spend the whole budget doing it, so thinking is switched off; gpt-oss models
 * reason at low effort. Gemini 2.5 Flash models switch thinking off with reasoning_effort "none".
 * Later Flash models cannot, so they think at "minimal": at "low", gemini-3.5-flash-lite spent
 * 450-570 of the 600 tokens thinking and cut replies off mid-sentence. Pro models think at "low".
 */
export function reasoningFields(modelId: string): Record<string, unknown> {
  if (modelId.includes('nemotron')) return { chat_template_kwargs: { enable_thinking: false } };
  if (modelId.includes('gpt-oss')) return { reasoning_effort: 'low' };
  if (modelId.startsWith('gemini-2.5') && !modelId.includes('pro')) return { reasoning_effort: 'none' };
  if (modelId.startsWith('gemini') && modelId.includes('flash')) return { reasoning_effort: 'minimal' };
  if (modelId.startsWith('gemini')) return { reasoning_effort: 'low' };
  return {};
}

/** The providers in `env.providers` order, each an OpenAI-compatible chat model. */
export function buildChain(env: LlmEnv, fetchImpl?: typeof fetch): ChainEntry[] {
  return env.providers.map((name) => {
    const spec = PROVIDERS[name];
    const apiKey = spec.apiKey(env);
    if (!apiKey) return { name, model: null };
    const modelId = spec.modelId(env);
    const extra = reasoningFields(modelId);
    const provider = createOpenAICompatible({
      name,
      baseURL: spec.baseURL,
      apiKey,
      headers: spec.headers,
      fetch: fetchImpl,
      includeUsage: true,
      transformRequestBody: (args) => ({ ...args, ...extra }),
    });
    return { name, model: provider.chatModel(modelId) };
  });
}
