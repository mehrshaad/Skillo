import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ErrorCode, type AppError } from '@/core/errors';
import type { ParsedJob } from '@/core/jobIntake/types';

const parseHtmlOffscreen = vi.hoisted(() => vi.fn());
vi.mock('@/lib/jobIntake/offscreenParse', () => ({ parseHtmlOffscreen }));

const { buildManualPosting, fetchJobFromUrl } = await import('@/lib/jobIntake/fetchJob');

const goodJob = (overrides: Partial<ParsedJob> = {}): ParsedJob => ({
  title: 'Back-end Software Engineer',
  company: 'CtrlChain',
  location: 'Eindhoven, North Brabant, Netherlands',
  descriptionText: 'x'.repeat(1200),
  ...overrides,
});

const response = (init: { status?: number; url?: string; body?: string }) =>
  ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? 'https://www.linkedin.com/jobs/view/4432351584',
    text: async () => init.body ?? '<html></html>',
  }) as unknown as Response;

describe('fetchJobFromUrl', () => {
  beforeEach(() => {
    parseHtmlOffscreen.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fakeBrowser.reset();
  });

  it('rejects a non-LinkedIn URL with guidance toward manual paste', async () => {
    await expect(fetchJobFromUrl('https://example.com/careers/1')).rejects.toMatchObject({
      code: ErrorCode.INVALID_URL,
    });
  });

  it('rejects input that is not a URL at all', async () => {
    await expect(fetchJobFromUrl('hello there')).rejects.toMatchObject({
      code: ErrorCode.INVALID_URL,
    });
  });

  it('returns the posting from the jobs-guest API on the first try', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ body: '<html>job</html>' }));
    vi.stubGlobal('fetch', fetchMock);
    parseHtmlOffscreen.mockResolvedValue(goodJob());

    const job = await fetchJobFromUrl('https://www.linkedin.com/jobs/view/4432351584');

    expect(job.source).toBe('guest-api');
    expect(job.jobId).toBe('4432351584');
    expect(job.title).toBe('Back-end Software Engineer');
    expect(job.url).toBe('https://www.linkedin.com/jobs/view/4432351584');
    expect(job.extractedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain('/jobs-guest/jobs/api/jobPosting/4432351584');
    // Cookies must stay out of it: the signed-in response has no usable markup.
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' });
  });

  it('surfaces a removed posting rather than silently falling through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 404 })));

    await expect(
      fetchJobFromUrl('https://www.linkedin.com/jobs/view/999999999999'),
    ).rejects.toMatchObject({ code: ErrorCode.JOB_NOT_FOUND });
  });

  it('falls through to the public page when the API yields nothing usable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ body: '<html>job</html>' }));
    vi.stubGlobal('fetch', fetchMock);
    parseHtmlOffscreen.mockResolvedValueOnce(null).mockResolvedValueOnce(goodJob());

    const job = await fetchJobFromUrl('https://www.linkedin.com/jobs/view/4432351584');

    expect(job.company).toBe('CtrlChain');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe('https://www.linkedin.com/jobs/view/4432351584');
  });

  it('treats a too-short description as no result and keeps going', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ body: '<html>job</html>' }));
    vi.stubGlobal('fetch', fetchMock);
    parseHtmlOffscreen
      .mockResolvedValueOnce(goodJob({ descriptionText: 'Apply on our website.' }))
      .mockResolvedValueOnce(goodJob());

    const job = await fetchJobFromUrl('https://www.linkedin.com/jobs/view/4432351584');

    expect(job.descriptionText.length).toBe(1200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not treat a redirect to the auth wall as a posting', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ url: 'https://www.linkedin.com/authwall?trk=x' }));
    vi.stubGlobal('fetch', fetchMock);
    parseHtmlOffscreen.mockResolvedValue(goodJob());
    // Cut the ladder short at the last rung so the test does not open a tab.
    vi.spyOn(fakeBrowser.tabs, 'create').mockRejectedValue(new Error('no tabs in tests'));

    await expect(
      fetchJobFromUrl('https://www.linkedin.com/jobs/view/4432351584'),
    ).rejects.toMatchObject({ code: ErrorCode.EXTRACTION_FAILED });

    // Both fetch rungs recognised the auth wall without parsing anything.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(parseHtmlOffscreen).not.toHaveBeenCalled();
  });

  it('recovers the id from a search URL before fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ body: '<html>job</html>' }));
    vi.stubGlobal('fetch', fetchMock);
    parseHtmlOffscreen.mockResolvedValue(goodJob());

    const job = await fetchJobFromUrl(
      'https://www.linkedin.com/jobs/search/?currentJobId=4439304178&geoId=1',
    );

    expect(job.jobId).toBe('4439304178');
    expect(fetchMock.mock.calls[0]![0]).toContain('4439304178');
  });
});

describe('buildManualPosting', () => {
  it('accepts a pasted description', () => {
    const job = buildManualPosting(
      'https://www.linkedin.com/jobs/view/4432351584',
      'y'.repeat(500),
    );
    expect(job.source).toBe('manual');
    expect(job.jobId).toBe('4432351584');
    expect(job.descriptionText.length).toBe(500);
  });

  it('works with no URL at all', () => {
    const job = buildManualPosting('', 'y'.repeat(500));
    expect(job.jobId).toBeNull();
    expect(job.source).toBe('manual');
  });

  it('refuses a snippet too short to analyze, and says how short', () => {
    try {
      buildManualPosting('', 'too short');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.EXTRACTION_FAILED);
      expect((e as AppError).message).toContain('9 characters');
    }
  });
});
