export interface ParsedJobUrl {
  /** Numeric LinkedIn job id, when one can be recovered from the URL. */
  jobId: string | null;
  /** The input normalized to an absolute URL, or null if it is not a URL at all. */
  url: string | null;
  isLinkedIn: boolean;
  /** lnkd.in short links hide the job id until the redirect is followed. */
  isShortLink: boolean;
}

const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i;
const SHORT_HOST = /(^|\.)lnkd\.in$/i;

/**
 * Recovers the job id from every LinkedIn URL shape we have seen:
 *   /jobs/view/4432351584
 *   /jobs/view/back-end-software-engineer-at-ctrlchain-4432351584
 *   /jobs/search/?currentJobId=4432351584
 *   /jobs/collections/recommended/?currentJobId=4432351584
 * plus regional subdomains and any of the above with query or hash noise.
 */
export function parseLinkedInJobUrl(input: string): ParsedJobUrl {
  const trimmed = input.trim();
  if (!trimmed) return { jobId: null, url: null, isLinkedIn: false, isShortLink: false };

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let u: URL;
  try {
    u = new URL(withProtocol);
  } catch {
    return { jobId: null, url: null, isLinkedIn: false, isShortLink: false };
  }

  const isShortLink = SHORT_HOST.test(u.hostname);
  const isLinkedIn = LINKEDIN_HOST.test(u.hostname) || isShortLink;
  if (!isLinkedIn) {
    return { jobId: null, url: u.toString(), isLinkedIn: false, isShortLink: false };
  }

  const fromQuery = u.searchParams.get('currentJobId');
  if (fromQuery && /^\d+$/.test(fromQuery)) {
    return { jobId: fromQuery, url: u.toString(), isLinkedIn: true, isShortLink };
  }

  // Greedy prefix so a slug containing digits still yields the trailing id.
  const fromPath = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)(?:\/|$)/);
  if (fromPath?.[1]) {
    return { jobId: fromPath[1], url: u.toString(), isLinkedIn: true, isShortLink };
  }

  return { jobId: null, url: u.toString(), isLinkedIn: true, isShortLink };
}

/** Canonical public URL for a job id — what we fetch and what we store. */
export function jobUrlFor(jobId: string): string {
  return `https://www.linkedin.com/jobs/view/${jobId}`;
}

export function guestApiUrlFor(jobId: string): string {
  return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
}
