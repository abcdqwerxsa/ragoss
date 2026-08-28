/** Shared types and provider contracts. */

export type MediaKind = "text" | "image" | "audio" | "video";

export interface ObjectRecord {
  storage: string;
  key: string;
  size: number;
  mime: string;
  mtime: string; // ISO
  etag: string;
}

export interface Chunk {
  storage: string;
  key: string;
  ordinal: number;
  kind: MediaKind;
  /** markdown chunk text; for media: filename / caption if any (may be empty) */
  text: string;
}

/** Multimodal input for embedding. All media as base64. */
export interface EmbeddingInput {
  text?: string;
  image?: { mime: string; dataBase64: string };
  audio?: { mime: string; dataBase64: string };
  video?: { mime: string; dataBase64: string };
}

export interface EmbeddingProvider {
  /** route name from config, used as vector column key */
  readonly name: string;
  readonly dims: number;
  embed(input: EmbeddingInput): Promise<number[]>;
}

export interface FetchedObject {
  mime: string;
  data: Buffer;
}

export interface StorageProvider {
  readonly name: string;
  list(): Promise<ObjectRecord[]>;
  get(key: string): Promise<FetchedObject>;
  put(key: string, data: Buffer, mime: string): Promise<void>;
}

export interface RetrievalFilter {
  storage?: string;
  mimePrefix?: string; // e.g. "image/"
  pathPrefix?: string;
  since?: string; // ISO, mtime >=
}

export interface RetrievalHit {
  chunk: Chunk;
  score: number;
  /** which embedding route produced the score */
  route: string;
}

export interface RerankProvider {
  readonly name: string;
  /**
   * Contract is multimodal from day one: query text plus image-capable hits.
   * Default no-op returns hits unchanged.
   */
  rerank(query: string, hits: RetrievalHit[]): Promise<RetrievalHit[]>;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; dataBase64: string };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  parts: ChatPart[];
}

export interface QaProvider {
  readonly protocol: string;
  chat(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string>;
}
