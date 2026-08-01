import { browser } from 'wxt/browser';
import { ErrorCode, appError } from '@/lib/errors';
import { sendToTab } from '@/lib/messages';
import { MIN_USABLE_DESCRIPTION } from './domExtract';
import { parseHtmlOffscreen } from './offscreenParse';
import { guestApiUrlFor, jobUrlFor, parseLinkedInJobUrl } from './url';
import type { JobPosting, JobSource, ParsedJob } from './types';

const TAB_LOAD_TIMEOUT_MS = 20_000;
const HYDRATION_ATTEMPTS = 5;
const HYDRATION_DELAY_MS = 1_500;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toPosting(
  parsed: ParsedJob,
  url: string,
  jobId: string | null,
  source: JobSource,
): JobPosting {
  return { ...parsed, url, jobId, source, extractedAt: new Date().toISOString() };
}

/**
 * Strategy ladder. Each rung is tried only if the previous one came back empty,
 * and manual paste (handled by its own message) is always available underneath.
 *
 *   1. jobs-guest API endpoint      — no auth, no tab, verified stable markup
 *   2. public job page              — same markup, covers ids the API rejects
 *   3. the tab the user is looking at
 *   4. a throwaway background tab   — rides the signed-in session
 */
export async function fetchJobFromUrl(rawUrl: string): Promise<JobPosting> {
  const parsed = parseLinkedInJobUrl(rawUrl);

  if (!parsed.url) {
    throw appError(ErrorCode.INVALID_URL, 'That does not look like a URL.');
  }
  if (!parsed.isLinkedIn) {
    throw appError(
      ErrorCode.INVALID_URL,
      'Skillo currently understands LinkedIn job links. Paste the description manually for other sites.',
    );
  }

  const { jobId } = parsed;

  if (jobId) {
    const url = jobUrlFor(jobId);

    const viaApi = await tryFetchAndParse(guestApiUrlFor(jobId));
    if (viaApi) return toPosting(viaApi, url, jobId, 'guest-api');

    const viaPage = await tryFetchAndParse(url);
    if (viaPage) return toPosting(viaPage, url, jobId, 'guest-api');

    const viaActive = await tryActiveTab(jobId);
    if (viaActive) return toPosting(viaActive, url, jobId, 'active-tab');
  }

  // No id (e.g. an lnkd.in short link) — a real tab resolves the redirect for us.
  const target = jobId ? jobUrlFor(jobId) : parsed.url;
  const viaBackground = await tryBackgroundTab(target);
  if (viaBackground) {
    return toPosting(viaBackground.job, viaBackground.finalUrl, jobId, 'background-tab');
  }

  throw appError(
    ErrorCode.EXTRACTION_FAILED,
    'Could not read this posting automatically.',
    'Open the job in a tab and use "Use current tab", or paste the description manually.',
  );
}

/* --------------------------------------------------------------- strategies */

/**
 * Unauthenticated fetch. Cookies are deliberately omitted: signed-out responses
 * carry the stable `topcard__*` markup, while signed-in ones return an app shell
 * with hashed class names and no description.
 */
async function tryFetchAndParse(url: string): Promise<ParsedJob | null> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  } catch {
    return null; // offline or blocked — fall through to the tab strategies
  }

  if (res.status === 404) {
    throw appError(
      ErrorCode.JOB_NOT_FOUND,
      'LinkedIn says this job posting does not exist. It may have been taken down.',
    );
  }
  if (!res.ok) return null;
  if (/\/authwall|\/uas\/login|\/checkpoint\//.test(res.url)) return null;

  const parsed = await parseHtmlOffscreen(await res.text());
  return parsed && parsed.descriptionText.length >= MIN_USABLE_DESCRIPTION ? parsed : null;
}

async function tryActiveTab(jobId: string): Promise<ParsedJob | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  if (parseLinkedInJobUrl(tab.url).jobId !== jobId) return null;

  const res = await sendToTab(tab.id, { type: 'job/extractFromDom' });
  return res.ok ? res.data : null;
}

async function tryBackgroundTab(
  url: string,
): Promise<{ job: ParsedJob; finalUrl: string } | null> {
  let tabId: number | undefined;
  try {
    tabId = (await browser.tabs.create({ url, active: false })).id;
  } catch {
    return null; // let the caller report the friendly end-of-ladder message
  }
  if (tabId === undefined) return null;

  try {
    await waitForTabComplete(tabId);

    // LinkedIn hydrates after load; retry rather than guess a single delay.
    for (let attempt = 0; attempt < HYDRATION_ATTEMPTS; attempt++) {
      await delay(HYDRATION_DELAY_MS);
      const res = await sendToTab(tabId, { type: 'job/extractFromDom' });
      if (res.ok && res.data.descriptionText.length >= MIN_USABLE_DESCRIPTION) {
        const current = await browser.tabs.get(tabId);
        return { job: res.data, finalUrl: current.url ?? url };
      }
      // A login wall will not resolve by waiting.
      if (!res.ok && res.error.code === ErrorCode.LINKEDIN_LOGIN_WALL) throw res.error;
    }
    return null;
  } finally {
    await browser.tabs.remove(tabId).catch(() => {});
  }
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId: number, info: { status?: string }) => {
      if (updatedTabId === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, TAB_LOAD_TIMEOUT_MS);
    browser.tabs.onUpdated.addListener(listener);

    // The tab may already be done before the listener attached.
    browser.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') finish();
      },
      () => finish(),
    );
  });
}

/* ------------------------------------------------------------- other inputs */

export async function extractFromActiveTab(): Promise<JobPosting> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw appError(ErrorCode.NO_LINKEDIN_TAB, 'No active tab to read.');
  }

  const parsed = parseLinkedInJobUrl(tab.url);
  if (!parsed.isLinkedIn) {
    throw appError(
      ErrorCode.NO_LINKEDIN_TAB,
      'The active tab is not a LinkedIn page. Open the job posting first.',
    );
  }

  const res = await sendToTab(tab.id, { type: 'job/extractFromDom' });
  if (!res.ok) throw res.error;

  return toPosting(res.data, tab.url, parsed.jobId, 'active-tab');
}

export function buildManualPosting(url: string, text: string): JobPosting {
  const description = text.trim();
  if (description.length < MIN_USABLE_DESCRIPTION) {
    throw appError(
      ErrorCode.EXTRACTION_FAILED,
      `That is only ${description.length} characters. Paste the full job description so the analysis has something to work with.`,
    );
  }

  const parsed = parseLinkedInJobUrl(url);
  return {
    jobId: parsed.jobId,
    url: parsed.url ?? url,
    title: '',
    company: '',
    location: '',
    descriptionText: description,
    source: 'manual',
    extractedAt: new Date().toISOString(),
  };
}
