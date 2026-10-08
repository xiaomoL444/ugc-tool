export interface FeatureIdentity {
  id: string;
  resourceId: string;
  kind: 'sound' | 'effect' | 'bgm';
  titles: Record<string, string>;
  hasAudio: boolean;
  facetTexts?: { feature?: string; audio?: string; suggestion?: string; audioSuggestion?: string };
  [field: string]: unknown;
}
export interface FeatureSidecar {
  schemaVersion: 1;
  project: 'SoundEffectPlayer' | 'EffectPlayer';
  kind: 'sound' | 'effect';
  baseIndexVersion: string;
  resources: Record<string, { searchMetadata: Record<string, unknown> }>;
  i18nSource?: 'project-i18n-v1';
  i18n: Record<string, Record<string, string>>;
  lexical?: Record<string, unknown>;
  lexicalFeatureHash?: string;
  hashAlgorithm?: string;
}
export interface FeatureAsset extends FeatureIdentity {
  description: Record<string, string>;
  detailedDescription: Record<string, string>;
  keywords: Record<string, string[]>;
  suggestedUses: Record<string, string[]>;
  audio: { description: Record<string, string>; detailedDescription: Record<string, string>; keywords: Record<string, string[]>; suggestedUses: Record<string, string[]> };
}
export type FeatureIdentities = FeatureIdentity[] | { assets: FeatureIdentity[]; indexVersion?: string };
export interface FeatureParseOptions { project?: string; kind?: string; baseIndexVersion?: string; identities?: FeatureIdentities; requireCompiled?: boolean; dictionaries?: Record<string, unknown> }
export const FEATURE_LOCALES: string[];
export const FEATURE_HASH_ALGORITHM: string;
export const FEATURE_LIMITS: Record<string, number>;
export class AssetFeatureError extends Error { code: string; status: number }
export function extractAssetFeatureDictionaries(project: string, dictionaries: Record<string, unknown>): Record<string, Record<string, string>>;
export function computeAssetFeatureSourceHash(feature: string, dictionaryHashes: Record<string, string>): Promise<string>;
export function parseAssetFeatureSidecar(raw: unknown, options?: FeatureParseOptions): FeatureSidecar;
export function verifyAssetFeatureSidecar(raw: unknown, options?: FeatureParseOptions): Promise<FeatureSidecar>;
export function computeLexicalFeatureHash(sidecar: FeatureSidecar): Promise<string>;
export function computeLexicalIndexHash(lexical: Record<string, unknown>): Promise<string>;
export function computeAssetCatalogVersion(baseIndexVersion: string, hashes: { sound: string; effect: string }): Promise<string>;
export function normalizeAssetFeatureResources(sidecar: FeatureSidecar, identities: FeatureIdentities, options?: { includeFacetTexts?: boolean }): FeatureAsset[];
