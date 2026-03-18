export interface ApiResponse<T> {
  status: 'ok' | 'error';
  result?: T;
  error?: { code: string; message: string };
  time?: number;
}

export interface MemoryRecord {
  id: string;
  text: string;
  type: MemoryType;
  category: MemoryCategory;
  agentId?: string;
  userId?: string;
  uri: string;
  l0Abstract: string;
  l1Overview: string;
  l2Content: string;
  score?: number;
  createdAt: string;
  updatedAt: string;
}

export type MemoryType = 'user' | 'agent';

export type MemoryCategory =
  | 'profile'
  | 'preferences'
  | 'entities'
  | 'events'
  | 'cases'
  | 'patterns'
  | 'general';

export interface ResourceRecord {
  id: string;
  title: string;
  uri: string;
  sourceUrl?: string;
  l0Abstract: string;
  l1Overview: string;
  l2Content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  agentId?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface SearchResult {
  id: string;
  uri: string;
  text: string;
  score: number;
  l0Abstract: string;
  category?: string;
  type?: string;
}

export interface VikingNode {
  uri: string;
  name: string;
  type: 'file' | 'directory';
  children?: VikingNode[];
}
