import type { StorageClass } from "../../services/storage/storage";
import { MAX_SEARCH_RESULTS, normalizeResultLimit } from "./resultLimits";
import { boundedRawResponse } from "./responseDiagnostics";
import type { ChatMessage, Conversation, ResourceCard, SearchMode } from "./types";

export const AI_SEARCH_ARCHIVE_PROJECT_ID = "AISearch";
export const AI_SEARCH_ARCHIVE_PATH = "/archive.json";
// Match the previous history restore limit, measured in serialized characters.
export const MAX_AI_SEARCH_ARCHIVE_LENGTH = 2500000;

export interface AISearchArchive {
  version: 1;
  conversations: unknown[];
  activeConversationId: string;
  selectedMode: SearchMode;
  resultLimit: number;
}

export interface AISearchArchiveInput {
  conversations: readonly unknown[];
  activeConversationId: string;
  selectedMode: SearchMode;
  resultLimit?: number;
}

type ArchiveStorage = Pick<StorageClass, "setProject" | "exists" | "mkdir" | "readFile" | "writeFile">;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown, maximum: number): string => typeof value === "string" ? value.slice(0, maximum) : "";
const isMode = (value: unknown): value is SearchMode => value === "basic" || value === "free" || value === "custom";
const strings = (value: unknown, maximum: number, count: number): string[] => (Array.isArray(value) ? value : [])
  .map(item => text(item, maximum)).filter(Boolean).slice(0, count);

function serializeCard(value: unknown): ResourceCard | undefined {
  const card = record(value);
  const match = text(card.resourceId, 40).match(/^(sound|effect|bgm):(\d{1,12})$/);
  if (!match) return;
  const kind = match[1] as ResourceCard["kind"];
  const project = { sound: "SoundEffectPlayer", effect: "EffectPlayer", bgm: "BgmPlayer" }[kind];
  return {
    resourceId: match[0], id: match[2], kind,
    title: text(card.title, 200), description: text(card.description, 1600),
    keywords: strings(card.keywords, 80, 10), suggestedUses: strings(card.suggestedUses, 200, 3),
    href: `/${project}?id=${match[2]}`, matchReason: text(card.matchReason, 800),
    matchType: card.matchType === "suggestion" ? "suggestion" : "feature",
    audioMatch: card.audioMatch === true,
    ...(typeof card.hasAudio === "boolean" ? { hasAudio: card.hasAudio } : {}),
    ...(typeof card.duration === "number" && Number.isFinite(card.duration) && card.duration >= 0 ? { duration: card.duration } : {}),
  };
}

function serializeMessage(value: unknown): ChatMessage | undefined {
  const message = record(value);
  if (message.role !== "user" && message.role !== "assistant") return;
  const mode = isMode(message.mode) ? message.mode : "basic";
  const status = message.status === "complete" || message.status === "error" ? message.status : "canceled";
  const rawResponse = message.role === "assistant" && status === "error" ? boundedRawResponse(message.rawResponse) : undefined;
  return {
    id: text(message.id, 100), role: message.role, content: text(message.content, 4000),
    cards: (Array.isArray(message.cards) ? message.cards : []).slice(0, MAX_SEARCH_RESULTS)
      .flatMap(value => { const card = serializeCard(value); return card ? [card] : []; }),
    status, mode, source: mode, model: text(message.model, 100), error: status === "error",
    ...(rawResponse ? { rawResponse } : {}),
  };
}

function serializeConversation(value: unknown): Conversation | undefined {
  const conversation = record(value);
  if (typeof conversation.id !== "string" || !Array.isArray(conversation.messages)) return;
  const rawMessages = conversation.messages;
  const firstRetainedIndex = Math.max(0, rawMessages.length - 100);
  const originalContextStart = Number.isInteger(conversation.contextStart)
    ? Math.min(rawMessages.length, Math.max(0, Number(conversation.contextStart))) : 0;
  const messages: ChatMessage[] = [];
  let contextStart = 0;
  rawMessages.slice(firstRetainedIndex).forEach((value, index) => {
    const message = serializeMessage(value);
    if (!message) return;
    messages.push(message);
    // A reset boundary is an offset in the original array. Shift it when
    // dropping old messages, including malformed messages before the boundary.
    if (firstRetainedIndex + index < originalContextStart) contextStart++;
  });
  return {
    id: text(conversation.id, 100), title: text(conversation.title, 80),
    updatedAt: typeof conversation.updatedAt === "number" && Number.isFinite(conversation.updatedAt) ? conversation.updatedAt : 0,
    messages, contextStart,
  };
}

/** Snapshot only archive fields; provider configuration and credentials never enter this file. */
export function serializeAISearchArchive(input: AISearchArchiveInput): string {
  const conversations = input.conversations.slice(0, 30).flatMap(value => {
    const conversation = serializeConversation(value);
    return conversation ? [conversation] : [];
  });
  const requestedId = text(input.activeConversationId, 100);
  const envelope: AISearchArchive = {
    version: 1, conversations,
    activeConversationId: conversations.some(item => item.id === requestedId) ? requestedId : conversations[0]?.id || "",
    selectedMode: isMode(input.selectedMode) ? input.selectedMode : "basic",
    resultLimit: normalizeResultLimit(input.resultLimit),
  };
  const serialized = JSON.stringify(envelope);
  if (serialized.length > MAX_AI_SEARCH_ARCHIVE_LENGTH) throw new Error("AI_SEARCH_ARCHIVE_TOO_LARGE");
  return serialized;
}

function parseArchive(serialized: string): AISearchArchive {
  if (serialized.length > MAX_AI_SEARCH_ARCHIVE_LENGTH) throw new Error("AI_SEARCH_ARCHIVE_TOO_LARGE");
  const archive = record(JSON.parse(serialized));
  if (archive.version !== 1 || !Array.isArray(archive.conversations) ||
      typeof archive.activeConversationId !== "string" || !isMode(archive.selectedMode)) {
    throw new Error("AI_SEARCH_ARCHIVE_INVALID_FORMAT");
  }
  // Conversation restoration belongs to the caller. Returning an explicit
  // envelope also avoids exposing arbitrary top-level properties from a file.
  return {
    version: 1, conversations: archive.conversations,
    activeConversationId: text(archive.activeConversationId, 100), selectedMode: archive.selectedMode,
    resultLimit: normalizeResultLimit(archive.resultLimit),
  };
}

/** Uses the application's initialized browser/desktop provider and its sync lock. */
export class AISearchArchiveRepository {
  private mutations: Promise<void> = Promise.resolve();
  private inspected = false;
  private lastWriteError: unknown;

  constructor(private readonly storage: ArchiveStorage) {}

  private async readArchive(): Promise<AISearchArchive | null> {
    this.inspected = false;
    // StorageClass shares a mutable project namespace with other pages. Every
    // provider call must set it again, especially after an asynchronous call.
    if (!await this.storage.setProject(AI_SEARCH_ARCHIVE_PROJECT_ID).exists(AI_SEARCH_ARCHIVE_PATH)) {
      this.inspected = true;
      return null;
    }
    const serialized = await this.storage.setProject(AI_SEARCH_ARCHIVE_PROJECT_ID).readFile(AI_SEARCH_ARCHIVE_PATH);
    const archive = parseArchive(serialized);
    this.inspected = true;
    return archive;
  }

  async read(): Promise<AISearchArchive | null> {
    await this.mutations;
    return this.readArchive();
  }

  write(input: AISearchArchiveInput): Promise<void> {
    let serialized = "";
    let serializationFailed = false;
    let serializationError: unknown;
    try {
      // Capture now, before queuing, so later edits cannot change this save.
      serialized = serializeAISearchArchive(input);
    } catch (error) {
      serializationFailed = true;
      serializationError = error;
    }
    const result = this.mutations.then(async () => {
      // Validation failures also occupy their place in the queue, so an older
      // successful save cannot hide a newer failed request from flush().
      if (serializationFailed) throw serializationError;
      // Even a caller that skips read() must not replace a damaged archive.
      if (!this.inspected) await this.readArchive();
      await this.storage.setProject(AI_SEARCH_ARCHIVE_PROJECT_ID).mkdir("/");
      await this.storage.setProject(AI_SEARCH_ARCHIVE_PROJECT_ID).writeFile(AI_SEARCH_ARCHIVE_PATH, serialized);
      this.lastWriteError = undefined;
    });
    this.mutations = result.catch(error => { this.lastWriteError = error; });
    return result;
  }

  async flush(): Promise<void> {
    await this.mutations;
    if (this.lastWriteError !== undefined) throw this.lastWriteError;
  }
}
