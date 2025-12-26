/**
 * SharkByte Support - Type Definitions
 */

// ============================================
// Knowledge Base Types
// ============================================

export interface DataSourceJob {
  data_source_uuid: string;
  status: string;
  indexed_item_count?: string;
  skipped_item_count?: string;
  started_at?: string;
  completed_at?: string;
}

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
  completed_at?: string;
  error?: string;
  data_source_jobs?: DataSourceJob[];
}

export interface KnowledgeBaseDataSource {
  web_crawler_data_source?: Record<string, unknown>;
  file_upload_data_source?: Record<string, unknown>;
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
  datasources?: KnowledgeBaseDataSource[];
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
  // DO API may return different field names for KB IDs
  knowledge_base_ids?: string[];
  knowledge_base_uuid?: string;
  knowledge_base_uuids?: string[];
  endpoint?: string;
  deployment?: {
    url?: string;
    visibility?: string;
  };
  instruction?: string;
  created_at: string;
  updated_at?: string;
  // Agent configuration (optional, returned by DO API)
  retrieval_method?: string;
  k?: number;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface CreateAgentResponse {
  agent: Agent;
}

export interface GetAgentResponse {
  agent: Agent;
}

// ============================================
// API Key Types
// ============================================

export interface ApiKeyInfo {
  uuid?: string;
  name?: string;
  secret_key: string;    // The actual API key - only returned once on creation
  created_by?: string;
  created_at?: string;
}

export interface AccessKey {
  id?: string;
  name?: string;
  key?: string;          // Legacy format
  api_key?: string;      // Legacy format
  created_at?: string;
}

export interface CreateAccessKeyResponse {
  api_key_info?: ApiKeyInfo;  // New format from /api_keys endpoint
  access_key?: AccessKey;      // Legacy format
}

export interface ListedApiKey {
  uuid: string;
  name: string;
  created_by?: string;
  created_at?: string;
  // Note: secret_key is NOT returned when listing - only on creation
}

export interface ListAccessKeysResponse {
  api_keys: ListedApiKey[];
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
export type KBType = 'crawl' | 'uploads' | 'structured' | 'custom';

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
  kbId: string; // Primary crawl KB ID (for backward compatibility)
  kbIds?: string[]; // All 3 KB IDs [crawl, uploads, structured]
  endpoint: string;
  accessKey: string;
  isExisting: boolean;
  status: 'creating' | 'indexing' | 'ready' | 'error';
  message?: string;
  error?: string;
}

export interface AgentStatusResponse {
  status: 'creating' | 'indexing' | 'deploying' | 'ready' | 'error';
  kbStatus?: string;
  agentStatus?: string;
  endpoint?: string;
  accessKey?: string;
  error?: string;
  message?: string; // Status message for UI display (e.g., "Using enhanced scraping...")
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
