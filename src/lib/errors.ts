/**
 * Stable error codes. The UI switches on `code` to show targeted guidance, so
 * these strings are part of the contract between background, content scripts
 * and the panel — rename with care.
 */
export const ErrorCode = {
  UNKNOWN_MESSAGE: 'UNKNOWN_MESSAGE',
  INTERNAL: 'INTERNAL',

  // Job intake
  INVALID_URL: 'INVALID_URL',
  LINKEDIN_LOGIN_WALL: 'LINKEDIN_LOGIN_WALL',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  NO_LINKEDIN_TAB: 'NO_LINKEDIN_TAB',

  // Resume input
  INVALID_RESUME_FILE: 'INVALID_RESUME_FILE',

  // Overleaf
  OVERLEAF_NO_TAB: 'OVERLEAF_NO_TAB',
  OVERLEAF_EDITOR_NOT_FOUND: 'OVERLEAF_EDITOR_NOT_FOUND',
  OVERLEAF_DOC_CHANGED: 'OVERLEAF_DOC_CHANGED',
  OVERLEAF_WRITE_FAILED: 'OVERLEAF_WRITE_FAILED',

  // Providers
  NO_PROVIDER: 'NO_PROVIDER',
  PROVIDER_AUTH: 'PROVIDER_AUTH',
  PROVIDER_RATE_LIMIT: 'PROVIDER_RATE_LIMIT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_REQUEST_FAILED: 'PROVIDER_REQUEST_FAILED',

  // Native messaging bridge
  BRIDGE_NOT_INSTALLED: 'BRIDGE_NOT_INSTALLED',
  BRIDGE_TIMEOUT: 'BRIDGE_TIMEOUT',
  BRIDGE_BUSY: 'BRIDGE_BUSY',
  BRIDGE_CLI_NOT_FOUND: 'BRIDGE_CLI_NOT_FOUND',
  BRIDGE_FAILED: 'BRIDGE_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // Pipeline
  LLM_TRUNCATED: 'LLM_TRUNCATED',
  LLM_BAD_FORMAT: 'LLM_BAD_FORMAT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  GENERATION_INTERRUPTED: 'GENERATION_INTERRUPTED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AppError {
  code: ErrorCode;
  message: string;
  detail?: string;
}

export function appError(code: ErrorCode, message: string, detail?: string): AppError {
  return detail === undefined ? { code, message } : { code, message, detail };
}

/** Normalizes anything thrown into an AppError so nothing crosses a message boundary as a raw throw. */
export function toAppError(e: unknown, fallbackCode: ErrorCode = ErrorCode.INTERNAL): AppError {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) return e as AppError;
  if (e instanceof Error) return appError(fallbackCode, e.message, e.stack);
  return appError(fallbackCode, String(e));
}
