export type OutputMode = "auto" | "json_schema" | "json_object" | "prompt";
export type OutputConstraint = Exclude<OutputMode, "auto">;
export interface AnswerSection { answer: string; resourceIds: string[] }
export function normalizeAnswerSections(value: unknown, resourceIds: string[]): AnswerSection[];
export interface OutputPolicy { provider: "openai" | "claude" | "deepseek" | "qwen" | "doubao" | "unknown"; protocol: "openai" | "anthropic"; mode: OutputConstraint; inferred: boolean; requested: OutputMode }
export const OUTPUT_MODES: readonly OutputMode[];
export const OUTPUT_CONSTRAINTS: readonly OutputConstraint[];
export function detectModelOutput(config: { baseUrl?: string; upstream?: string; model: string; protocol?: string; outputMode?: string }): OutputPolicy;
export function searchAnswerSchema(ids: string[], resultLimit?: number, agent?: boolean, native?: boolean): Record<string, unknown>;
export function modelOutputOptions(policy: OutputPolicy, ids: string[], resultLimit: number, agent?: boolean): Record<string, unknown>;
export function outputThinkingOptions(config: { baseUrl?: string; upstream?: string; model: string }): Record<string, unknown>;
export function outputPrompt(agent?: boolean): string;
export function isOutputConstraintRejection(status: number, text: string): boolean;
export function weakerOutputPolicy(policy: OutputPolicy): OutputPolicy | undefined;
