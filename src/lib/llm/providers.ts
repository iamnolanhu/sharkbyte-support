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
};

/** The providers in `env.providers` order, each an OpenAI-compatible chat model. */
export function buildChain(env: LlmEnv, fetchImpl?: typeof fetch): ChainEntry[] {
  return env.providers.map((name) => {
    const spec = PROVIDERS[name];
    const apiKey = spec.apiKey(env);
    if (!apiKey) return { name, model: null };
    const provider = createOpenAICompatible({
      name,
      baseURL: spec.baseURL,
      apiKey,
      headers: spec.headers,
      fetch: fetchImpl,
      includeUsage: true,
    });
    return { name, model: provider.chatModel(spec.modelId(env)) };
  });
}
