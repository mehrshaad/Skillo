import type { AppError } from '@/core/errors';
import type { OverleafDoc } from '@/lib/messages';

/**
 * Wire format between the ISOLATED content script and the MAIN-world script.
 * Both sides check `source` and the window origin before trusting a message.
 */
export const OVERLEAF_ORIGIN = 'https://www.overleaf.com';
export const REQUEST_SOURCE = 'skillo-overleaf-request';
export const RESPONSE_SOURCE = 'skillo-overleaf-response';

export type OverleafOp =
  | { op: 'read' }
  | { op: 'write'; content: string; expectedCurrentHash: string };

export interface OverleafRequestMessage {
  source: typeof REQUEST_SOURCE;
  id: string;
  payload: OverleafOp;
}

export type OverleafOpResult =
  | { ok: true; data: OverleafDoc | { applied: true } }
  | { ok: false; error: AppError };

export interface OverleafResponseMessage {
  source: typeof RESPONSE_SOURCE;
  id: string;
  result: OverleafOpResult;
}

export function isRequestMessage(value: unknown): value is OverleafRequestMessage {
  const msg = value as OverleafRequestMessage | null;
  return Boolean(msg && msg.source === REQUEST_SOURCE && typeof msg.id === 'string');
}

export function isResponseMessage(value: unknown): value is OverleafResponseMessage {
  const msg = value as OverleafResponseMessage | null;
  return Boolean(msg && msg.source === RESPONSE_SOURCE && typeof msg.id === 'string');
}
