export const PROVIDER_IDS = [
  'openrouter',
  'openai',
  'anthropic',
  'huggingface',
  'claude-code',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** What a keyed provider needs to run. Stored per provider so switching keeps both. */
export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * No `temperature`: current Anthropic models reject it with a 400, and the user
 * may point any provider at any model, so the safe request is the one that
 * omits it. Model defaults are fine for both pipeline stages.
 */
export interface CompletionRequest {
  messages: ChatMessage[];
  model: string;
  maxTokens: number;
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
