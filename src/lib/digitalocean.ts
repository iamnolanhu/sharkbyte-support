/**
 * DigitalOcean Gradient AI API Client
 */

import type {
  CreateKBResponse,
  GetKBResponse,
  CreateAgentResponse,
  GetAgentResponse,
  CreateAccessKeyResponse,
} from '@/types';

const DO_API_BASE = 'https://api.digitalocean.com/v2';

function getHeaders(): HeadersInit {
  const token = process.env.DO_API_TOKEN;
  if (!token) {
    throw new Error('DO_API_TOKEN environment variable is not set');
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ============================================
// Knowledge Base Functions
// ============================================

interface CreateKBOptions {
  name: string;
  seedUrls: string[];
  maxPages?: number;
}

export async function createKnowledgeBase(
  options: CreateKBOptions
): Promise<CreateKBResponse> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      name: options.name,
      embedding_model_id:
        process.env.DO_EMBEDDING_MODEL || 'text-embedding-3-small',
      region: process.env.DO_REGION || 'nyc3',
      data_sources: [
        {
          type: 'web_crawl',
          config: {
            seed_urls: options.seedUrls,
            max_pages: options.maxPages || 100,
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Knowledge Base creation failed: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function getKnowledgeBase(kbId: string): Promise<GetKBResponse> {
  const response = await fetch(
    `${DO_API_BASE}/gen-ai/knowledge_bases/${kbId}`,
    {
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to get Knowledge Base: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function deleteKnowledgeBase(kbId: string): Promise<void> {
  const response = await fetch(
    `${DO_API_BASE}/gen-ai/knowledge_bases/${kbId}`,
    {
      method: 'DELETE',
      headers: getHeaders(),
    }
  );

  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(`Failed to delete Knowledge Base: ${JSON.stringify(error)}`);
  }
}

// ============================================
// Agent Functions
// ============================================

interface CreateAgentOptions {
  name: string;
  knowledgeBaseId: string;
  instruction?: string;
}

const DEFAULT_INSTRUCTION = `You are SharkByte, a friendly and knowledgeable customer support agent.

Guidelines:
- Answer questions using ONLY the provided website content
- If you cannot find the answer in the content, say "I couldn't find that information on the website. Could you rephrase your question or ask about something else?"
- Be helpful, concise, and friendly in your responses
- Use a conversational tone while remaining professional
- If asked about topics outside the website content, politely redirect to relevant topics you can help with`;

export async function createAgent(
  options: CreateAgentOptions
): Promise<CreateAgentResponse> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      name: options.name,
      model_id: process.env.DO_LLM_MODEL || 'gpt-4o',
      knowledge_base_ids: [options.knowledgeBaseId],
      instruction: options.instruction || DEFAULT_INSTRUCTION,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Agent creation failed: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function getAgent(agentId: string): Promise<GetAgentResponse> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to get Agent: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function deleteAgent(agentId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(`Failed to delete Agent: ${JSON.stringify(error)}`);
  }
}

// ============================================
// Access Key Functions
// ============================================

export async function createAccessKey(
  agentId: string
): Promise<CreateAccessKeyResponse> {
  const response = await fetch(
    `${DO_API_BASE}/gen-ai/agents/${agentId}/access_keys`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        name: `sharkbyte-key-${Date.now()}`,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create Access Key: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// ============================================
// Utility Functions
// ============================================

export function generateResourceName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/[^a-z0-9]/gi, '-');
    const timestamp = Date.now().toString(36);
    return `sharkbyte-${hostname}-${timestamp}`;
  } catch {
    const timestamp = Date.now().toString(36);
    return `sharkbyte-custom-${timestamp}`;
  }
}

export function normalizeUrl(url: string): string {
  let normalized = url.trim();

  // Add https:// if no protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }

  // Validate URL
  try {
    new URL(normalized);
    return normalized;
  } catch {
    throw new Error('Invalid URL format');
  }
}

// ============================================
// Retry Helper
// ============================================

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(2, i))
        );
      }
    }
  }

  throw lastError;
}
