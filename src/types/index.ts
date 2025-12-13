/**
 * SharkByte Support - Type Definitions
 */

// ============================================
// Knowledge Base Types
// ============================================

export interface KnowledgeBase {
  id: string;
  name: string;
  status: 'indexing' | 'indexed' | 'error';
  embedding_model_id: string;
  region: string;
  document_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface CreateKBResponse {
  knowledge_base: KnowledgeBase;
}

export interface GetKBResponse {
  knowledge_base: KnowledgeBase;
}

// ============================================
// Agent Types
// ============================================

export interface Agent {
  id: string;
  name: string;
  status: 'active' | 'creating' | 'error';
  model_id: string;
  knowledge_base_ids: string[];
  endpoint?: string;
  instruction?: string;
  created_at: string;
}

export interface CreateAgentResponse {
  agent: Agent;
}

export interface GetAgentResponse {
  agent: Agent;
}

// ============================================
// Access Key Types
// ============================================

export interface AccessKey {
  id: string;
  name: string;
  key: string;
  created_at: string;
}

export interface CreateAccessKeyResponse {
  access_key: AccessKey;
}

// ============================================
// Chat Types
// ============================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  include_retrieval_info?: boolean;
}

export interface RetrievalSource {
  document_id: string;
  chunk_id: string;
  content: string;
  score: number;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: ChatMessage;
    delta?: { content?: string };
  }>;
  retrieval_info?: {
    sources: RetrievalSource[];
  };
}

// ============================================
// API Route Types
// ============================================

export interface CreateAgentRequest {
  url: string;
  maxPages?: number;
}

export interface CreateAgentApiResponse {
  success: boolean;
  agentId: string;
  kbId: string;
  status: 'creating' | 'indexing' | 'ready' | 'error';
  message?: string;
}

export interface AgentStatusResponse {
  status: 'creating' | 'indexing' | 'ready' | 'error';
  kbStatus?: string;
  agentStatus?: string;
  endpoint?: string;
  accessKey?: string;
  error?: string;
}

// ============================================
// Local Storage Types
// ============================================

export interface StoredAgent {
  id: string;
  kbId: string;
  url: string;
  endpoint: string;
  accessKey: string;
  createdAt: string;
}

// ============================================
// Error Types
// ============================================

export interface DOApiError {
  id: string;
  message: string;
  request_id?: string;
}
