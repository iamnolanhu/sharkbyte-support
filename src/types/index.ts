/**
 * SharkByte Support - Type Definitions
 */

// ============================================
// Knowledge Base Types
// ============================================

export interface IndexingJob {
  uuid: string;
  knowledge_base_uuid: string;
  status: string;
  phase: string;
  tokens?: number;
  total_tokens?: string;
  total_datasources?: number;
  completed_datasources?: number;
  created_at: string;
  updated_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface KnowledgeBase {
  uuid: string;
  name: string;
  status?: 'indexing' | 'indexed' | 'error';
  embedding_model_uuid: string;
  project_id: string;
  region: string;
  database_id?: string;
  document_count?: number;
  created_at: string;
  updated_at?: string;
  last_indexing_job?: IndexingJob;
}

export interface CreateKBResponse {
  knowledge_base: KnowledgeBase;
}

export interface GetKBResponse {
  knowledge_base: KnowledgeBase;
}

export interface ListKBResponse {
  knowledge_bases: KnowledgeBase[];
}

// ============================================
// Agent Types
// ============================================

export interface Agent {
  uuid: string;
  name: string;
  status?: 'active' | 'creating' | 'error';
  model_uuid: string;
  project_id: string;
  region: string;
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
// Multi-KB Types
// ============================================

// Knowledge base type classification
export type KBType = 'crawl' | 'uploads' | 'faq' | 'custom';

// Extended KB info with type for multi-KB management
export interface KnowledgeBaseInfo {
  uuid: string;
  name: string;
  type: KBType;
  status: 'creating' | 'indexing' | 'indexed' | 'error';
  documentCount?: number;
  sourceUrl?: string; // For crawl type
  createdAt: string;
}

// Agent with full KB context
export interface AgentWithKBs {
  uuid: string;
  name: string;
  domain: string;
  endpoint: string;
  status: 'creating' | 'active' | 'error';
  knowledgeBases: KnowledgeBaseInfo[];
  createdAt: string;
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
  agentName: string;
  kbId: string;
  endpoint: string;
  accessKey: string;
  isExisting: boolean;
  status: 'creating' | 'indexing' | 'ready' | 'error';
  message?: string;
  error?: string;
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
  name: string; // Agent display name (e.g., "Sammy - acme.com")
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
