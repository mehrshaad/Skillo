import { describe, expect, it } from 'vitest';
import { parseLinkedInJobUrl } from '@/core/jobIntake/url';

describe('parseLinkedInJobUrl', () => {
  it('reads a bare /jobs/view/ id', () => {
    expect(parseLinkedInJobUrl('https://www.linkedin.com/jobs/view/4432351584').jobId).toBe(
      '4432351584',
    );
  });

  it('reads the id from a slugged /jobs/view/ path', () => {
    expect(
      parseLinkedInJobUrl(
        'https://nl.linkedin.com/jobs/view/back-end-software-engineer-at-ctrlchain-4432351584',
      ).jobId,
    ).toBe('4432351584');
  });

  it('is not confused by digits inside the slug', () => {
    expect(
      parseLinkedInJobUrl('https://www.linkedin.com/jobs/view/engineer-2024-intern-at-foo-4439304178')
        .jobId,
    ).toBe('4439304178');
  });

  it('reads currentJobId from search and collections URLs', () => {
    expect(
      parseLinkedInJobUrl('https://www.linkedin.com/jobs/search/?currentJobId=4432351584&geoId=1')
        .jobId,
    ).toBe('4432351584');
    expect(
      parseLinkedInJobUrl(
        'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4439304178',
      ).jobId,
    ).toBe('4439304178');
  });

  it('tolerates a trailing slash, query and hash', () => {
    expect(
      parseLinkedInJobUrl('https://www.linkedin.com/jobs/view/4432351584/?refId=abc#top').jobId,
    ).toBe('4432351584');
  });

  it('accepts input without a protocol', () => {
    const parsed = parseLinkedInJobUrl('www.linkedin.com/jobs/view/4432351584');
    expect(parsed.jobId).toBe('4432351584');
    expect(parsed.url).toBe('https://www.linkedin.com/jobs/view/4432351584');
  });

  it('recognizes regional subdomains', () => {
    expect(parseLinkedInJobUrl('https://de.linkedin.com/jobs/view/4432351584').isLinkedIn).toBe(true);
  });

  it('flags lnkd.in short links, which hide the id until redirect', () => {
    const parsed = parseLinkedInJobUrl('https://lnkd.in/eXaMpLe');
    expect(parsed.isShortLink).toBe(true);
    expect(parsed.isLinkedIn).toBe(true);
    expect(parsed.jobId).toBeNull();
  });

  it('marks non-LinkedIn URLs', () => {
    const parsed = parseLinkedInJobUrl('https://example.com/careers/123');
    expect(parsed.isLinkedIn).toBe(false);
    expect(parsed.jobId).toBeNull();
  });

  it('rejects a LinkedIn URL that is not a job posting', () => {
    expect(parseLinkedInJobUrl('https://www.linkedin.com/feed/').jobId).toBeNull();
  });

  it('handles garbage input without throwing', () => {
    for (const bad of ['', '   ', 'not a url', 'http://', '::::']) {
      expect(() => parseLinkedInJobUrl(bad)).not.toThrow();
      expect(parseLinkedInJobUrl(bad).jobId).toBeNull();
    }
  });
});
