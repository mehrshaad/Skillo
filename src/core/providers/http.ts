import { ErrorCode, appError } from '@/core/errors';

const RETRY_DELAYS_MS = [2_000, 8_000];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One place where provider HTTP failures become AppErrors, so every provider
 * reports "check your key" and rate limits the same way.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  providerLabel: string,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await delay(RETRY_DELAYS_MS[attempt - 1]!);

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      lastError = appError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `Could not reach ${providerLabel}. Check your internet connection.`,
        e instanceof Error ? e.message : String(e),
      );
      continue;
    }

    if (res.ok) return res.json();

    const body = await res.text().catch(() => '');
    const detail = extractMessage(body);

    if (res.status === 401 || res.status === 403) {
      throw appError(
        ErrorCode.PROVIDER_AUTH,
        `${providerLabel} rejected your API key. Check it in Settings.`,
        detail,
      );
    }
    if (res.status === 404) {
      throw appError(
        ErrorCode.PROVIDER_REQUEST_FAILED,
        `${providerLabel} does not recognize that model. Pick a different one in Settings.`,
        detail,
      );
    }
    if (res.status === 400) {
      throw appError(
        ErrorCode.PROVIDER_REQUEST_FAILED,
        `${providerLabel} rejected the request.`,
        detail,
      );
    }

    // 429 and 5xx are worth retrying; anything else is not.
    if (res.status !== 429 && res.status < 500) {
      throw appError(
        ErrorCode.PROVIDER_REQUEST_FAILED,
        `${providerLabel} returned an error (HTTP ${res.status}).`,
        detail,
      );
    }

    lastError = appError(
      res.status === 429 ? ErrorCode.PROVIDER_RATE_LIMIT : ErrorCode.PROVIDER_UNAVAILABLE,
      res.status === 429
        ? `${providerLabel} is rate limiting your key. Wait a moment and try again.`
        : `${providerLabel} is having trouble (HTTP ${res.status}). Try again shortly.`,
      detail,
    );
  }

  throw lastError;
}

/** Providers bury the useful line in different shapes; try the common ones. */
function extractMessage(body: string): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    return parsed.error?.message ?? parsed.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}
