export function responsesUrl(base: string): string;
export function toResponsesRequest(source: Record<string, unknown>, endpoint?: string): Record<string, unknown>;
export function responsesInputBytes(payload: Record<string, unknown>): number;
export function normalizeResponsesResponse(raw: Record<string, unknown>): Record<string, unknown>;
