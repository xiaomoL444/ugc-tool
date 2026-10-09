import type { RequestDiagnostic } from "./requestDiagnostics";

export type SearchScope = "all" | "sound" | "effect" | "bgm";
export type SearchMatchOn = "any" | "visual" | "audio";
export type SearchMode = "basic" | "free" | "custom";
export type ResourceKind = Exclude<SearchScope, "all">;
export interface ResourceCard {
  resourceId: string;
  id: string;
  kind: ResourceKind;
  title: string;
  description: string;
  keywords: string[];
  suggestedUses: string[];
  duration?: number;
  hasAudio?: boolean;
  href: string;
  matchReason?: string;
  matchType?: "feature" | "suggestion";
  audioMatch?: boolean;
}
export interface SearchResource extends ResourceCard {
  locale: string;
  featureText: string;
  audioText: string;
  suggestionText: string;
  visualDescription?: string;
  audioDescription?: string;
  audioKeywords?: string[];
  audioSuggestedUses?: string[];
  audioSuggestionText?: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: ResourceCard[];
  status: "pending" | "complete" | "error" | "canceled";
  mode: SearchMode;
  source: SearchMode;
  model?: string;
  error?: boolean;
  /** Bounded plain model text for a failed response; excluded from model history. */
  rawResponse?: string;
  /** Whitelisted, redacted diagnostics for a failed request; excluded from model history. */
  requestDiagnostic?: RequestDiagnostic;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  contextStart: number;
}
export type ModelProtocol = "auto" | "openai" | "anthropic";
export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  rememberKey: boolean;
  protocol?: ModelProtocol;
}
export interface FreeQuota { remaining: number; limit: number; resetAt: string }
export interface SearchMatch { resourceId: string; reason: string; matchType: "feature" | "suggestion" }
export type RetrievalMode = "local" | "keyword" | "hybrid";
export interface FeatureSync {
  status: "ready" | "stale" | "disabled";
  hashes: { sound?: string; effect?: string; bgm?: string };
  checkedAt?: number;
  lastGoodAt?: number;
  updatedAt?: number;
  errorCode?: string;
}
export interface ServerCatalogInfo {
  featureSync?: FeatureSync;
  catalogVersion: string;
  total: number;
  mode: Exclude<RetrievalMode, "local">;
  coverage: number;
  maxPreviousIds?: number;
  maxExcludeIds?: number;
  maxSearchLimit?: number;
  maxAssetIds?: number;
}
export interface ServerSearchResult extends ServerCatalogInfo {
  items: SearchResource[];
  hasMore: boolean;
  nextCursor?: string;
  retrievalNotice?: { code: "MUSIC_DESCRIPTION_MISSING" | "EFFECT_AUDIO_DESCRIPTION_MISSING" };
  omittedExcluded?: number;
}
export interface ServerSearchInput {
  query: string; scope: SearchScope; locale: string; includeEffectAudio: boolean;
  matchOn?: SearchMatchOn;
  limit?: number; cursor?: string; previousIds?: string[]; previousQuery?: string; excludeIds?: string[];
  searchType?: "feature" | "suggestion" | "both";
  filters?: { minDuration?: number; maxDuration?: number; hasAudio?: boolean; isLoop?: boolean; includeTerms?: string[]; excludeTerms?: string[] };
}
export interface AgentSearchPayload {
  workflow: "agent"; requestId: string; query: string; locale: string; scope: SearchScope; includeEffectAudio: boolean;
  messages: { role: "user" | "assistant"; content: string }[]; previousIds: string[];
  resultLimit?: number;
  matchOn?: SearchMatchOn;
}
export interface ServerChatPayload {
  requestId: string; query: string; locale: string; scope: SearchScope;
  messages: { role: "user" | "assistant"; content: string }[];
  catalogVersion: string; candidateIds: string[]; audioCandidateIds: string[]; includeEffectAudio: boolean;
  resultLimit?: number;
  matchOn?: SearchMatchOn;
}
export interface SearchAnswer { answer: string; matches: SearchMatch[]; model?: string; quota?: FreeQuota; resources?: SearchResource[]; catalogVersion?: string; featureSync?: FeatureSync; retrievalMode?: "keyword" | "hybrid" }
