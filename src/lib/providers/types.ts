export const PROVIDER_IDS = ['openrouter', 'openai', 'anthropic', 'claude-code'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface CompletionResponse {
  text: string;
  /** Normalized: 'stop' | 'length' | provider-specific string. 'length' means truncated. */
  stopReason?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface LLMProvider {
  id: ProviderId;
  complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse>;
  /** Only providers with a discoverable catalogue implement this (OpenRouter). */
  listModels?(): Promise<ModelInfo[]>;
  /** Cheap round-trip used by the Settings "Test connection" button. Throws AppError on failure. */
  test(): Promise<void>;
}
