import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ErrorCode, appError } from '@/core/errors';
import { fail, ok, sendToTab } from '@/lib/messages';

/**
 * The exact wording Chrome uses when a tab has no content script listening.
 * This is the whole bug: a LinkedIn or Overleaf tab that was already open when
 * the extension loaded never got one, because MV3 injects at navigation time.
 */
const NO_LISTENER = 'Could not establish connection. Receiving end does not exist.';

/** The fake's typings are looser than the real API; the shape is what matters. */
const scripting = () => fakeBrowser.scripting as unknown as {
  executeScript: (...args: unknown[]) => Promise<unknown>;
};

const injectedFiles = (exec: { mock: { calls: unknown[][] } }) =>
  exec.mock.calls.map((call) => (call[0] as { files: string[] }).files[0]);

describe('sendToTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fakeBrowser.reset();
  });

  it('returns the reply and injects nothing when a script is already listening', async () => {
    const send = vi
      .spyOn(fakeBrowser.tabs, 'sendMessage')
      .mockResolvedValue(ok({ pages: 2 }) as never);
    const exec = vi.spyOn(scripting(), 'executeScript');

    const res = await sendToTab(7, { type: 'overleaf/csPageCount' });

    expect(res).toEqual(ok({ pages: 2 }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(exec).not.toHaveBeenCalled();
  });

  it('passes a content-script failure straight through without injecting', async () => {
    // The script answered; it just said no. Injecting would not help and would
    // put a second copy of the script in the page.
    const refusal = fail(appError(ErrorCode.OVERLEAF_DOC_CHANGED, 'Document changed.'));
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(refusal as never);
    const exec = vi.spyOn(scripting(), 'executeScript');

    const res = await sendToTab(7, { type: 'overleaf/csRead' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(ErrorCode.OVERLEAF_DOC_CHANGED);
    expect(exec).not.toHaveBeenCalled();
  });

  it('injects and retries exactly once when nothing is listening', async () => {
    const doc = { latex: '\\documentclass{article}', hash: 'abc' };
    const send = vi
      .spyOn(fakeBrowser.tabs, 'sendMessage')
      .mockRejectedValueOnce(new Error(NO_LISTENER))
      .mockResolvedValueOnce(ok(doc) as never);
    const exec = vi.spyOn(scripting(), 'executeScript').mockResolvedValue([]);

    const res = await sendToTab(7, { type: 'overleaf/csRead' });

    expect(res).toEqual(ok(doc));
    expect(send).toHaveBeenCalledTimes(2);
    // MAIN world first: the isolated bridge posts to it.
    expect(injectedFiles(exec)).toEqual([
      '/content-scripts/overleaf-main.js',
      '/content-scripts/overleaf.js',
    ]);
    expect((exec.mock.calls[0]![0] as { world?: string }).world).toBe('MAIN');
    expect((exec.mock.calls[1]![0] as { world?: string }).world).toBeUndefined();
  });

  it('injects the LinkedIn script for a DOM extraction', async () => {
    // The reported bug: "Use current tab" on a LinkedIn page that predates the
    // extension. This is the path that had no injection at all.
    const job = { title: 'Engineer', company: 'Example', location: 'Amsterdam', descriptionText: 'x' };
    vi.spyOn(fakeBrowser.tabs, 'sendMessage')
      .mockRejectedValueOnce(new Error(NO_LISTENER))
      .mockResolvedValueOnce(ok(job) as never);
    const exec = vi.spyOn(scripting(), 'executeScript').mockResolvedValue([]);

    const res = await sendToTab(7, { type: 'job/extractFromDom' });

    expect(res.ok).toBe(true);
    expect(injectedFiles(exec)).toEqual(['/content-scripts/linkedin.js']);
  });

  it('does not inject for a transport failure that injecting cannot fix', async () => {
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockRejectedValue(
      new Error('Frame with ID 0 was removed.'),
    );
    const exec = vi.spyOn(scripting(), 'executeScript');

    const res = await sendToTab(7, { type: 'overleaf/csRead' });

    expect(res.ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('gives up after one retry rather than looping', async () => {
    const send = vi
      .spyOn(fakeBrowser.tabs, 'sendMessage')
      .mockRejectedValue(new Error(NO_LISTENER));
    const exec = vi.spyOn(scripting(), 'executeScript').mockResolvedValue([]);

    const res = await sendToTab(7, { type: 'overleaf/csRead' });

    expect(send).toHaveBeenCalledTimes(2);
    // One round of injection for the two Overleaf scripts, not a second round.
    expect(exec).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.detail).toContain('Reload the tab');
  });

  it('reports actionable guidance when injecting is not permitted', async () => {
    const send = vi
      .spyOn(fakeBrowser.tabs, 'sendMessage')
      .mockRejectedValue(new Error(NO_LISTENER));
    vi.spyOn(scripting(), 'executeScript').mockRejectedValue(
      new Error('Cannot access contents of the page.'),
    );

    const res = await sendToTab(7, { type: 'job/extractFromDom' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain('could not reach that page');
      expect(res.error.detail).toContain('Reload the tab');
    }
  });
});
