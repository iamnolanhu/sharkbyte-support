/**
 * SharkByte Support - Type Definitions
 */

import type { RailName } from '@/lib/rails';

// ============================================
// Chat Types
// ============================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ============================================
// Local Storage Types
// ============================================

export interface StoredAgent {
  id: string;
  name: string; // Agent display name (e.g., "Sammy - acme.com")
  url: string;
  ownerToken?: string; // only present in the browser that created the agent
  createdAt: string;
}

// ============================================
// Postgres-backed agent types
// ============================================

export type AgentStatus = 'crawling' | 'ready' | 'failed';

export interface AgentRow {
  id: string;
  domain: string;
  url: string;
  name: string;
  instruction: string;
  status: AgentStatus;
  pagesCrawled: number;
  pagesTotal: number;
  chunkCount: number;
  createdAt: Date;
  lastUsedAt: Date;
  crawlStartedAt: Date | null;
  /** When the crawl last made progress (a slice started or a page finished). */
  crawlProgressAt: Date | null;
  lastError: string | null;
  pinned: boolean;
  ownerTokenHash: string | null;
}

export interface ChunkInput {
  url: string;
  title: string;
  pos: number;
  content: string;
  embedding: number[];
}

export interface RetrievedChunk {
  url: string;
  title: string;
  content: string;
  score: number;
}

// ============================================
// API response shapes
// ============================================

export interface PublicAgent {
  id: string;
  name: string;
  domain: string;
  url: string;
  status: AgentStatus;
  pagesCrawled: number;
  pagesTotal: number;
  chunkCount: number;
  createdAt: string;
  lastUsedAt: string;
  pinned: boolean;
  instruction: string;
  lastError: string | null;
}

export interface CreateAgentApiResponse {
  success: true;
  agentId: string;
  agentName: string;
  url: string;
  status: AgentStatus;
  isExisting: boolean;
  ownerToken?: string;
}

export interface AgentStatusResponse {
  success: true;
  status: AgentStatus;
  pagesCrawled: number;
  pagesTotal: number;
  chunkCount: number;
  message: string;
  error?: string;
}

export interface GetAgentResponse {
  success: true;
  agent: PublicAgent;
  isOwner: boolean;
}

export interface ListAgentsResponse {
  success: true;
  agents: PublicAgent[];
}

export interface DemoConfigResponse {
  success: true;
  agentId: string;
  status: AgentStatus;
}

export interface ApiErrorBody {
  success: false;
  error: string;
  rail?: RailName;
}
