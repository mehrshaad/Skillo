import { browser } from 'wxt/browser';
import type { ScriptPublicPath } from 'wxt/utils/inject-script';
import type { MessageType } from './messages';

/**
 * Content scripts are declared for LinkedIn and Overleaf, but MV3 only injects
 * them at navigation time. A tab that was already open when the extension was
 * installed, updated, reloaded, or re-enabled has no listener in it, and
 * `tabs.sendMessage` rejects with "Receiving end does not exist".
 *
 * Rather than telling the user to reload, put the script there on demand. This
 * is the whole reason "Use current tab" failed on a LinkedIn tab that had been
 * sitting open since before the extension loaded.
 */

interface ScriptSpec {
  /**
   * WXT generates this type as the union of paths that actually ship, so a
   * renamed bundle breaks the build instead of breaking injection silently.
   */
  file: ScriptPublicPath;
  /** Only the CodeMirror bridge needs the page's own world. */
  world?: 'MAIN';
}

/*
 * WXT names each bundle after its entrypoint, so `overleaf.content.ts` builds
 * to `content-scripts/overleaf.js`. Listed here rather than read back from the
 * manifest because the world a script needs is not recoverable from its path,
 * and getting the world wrong fails silently.
 */
const OVERLEAF_SCRIPTS: ScriptSpec[] = [
  // MAIN first: the ISOLATED bridge posts to it, so the listener should exist
  // before anything can call. One less race to reason about.
  { file: '/content-scripts/overleaf-main.js', world: 'MAIN' },
  { file: '/content-scripts/overleaf.js' },
];

const LINKEDIN_SCRIPTS: ScriptSpec[] = [{ file: '/content-scripts/linkedin.js' }];

/** Which content scripts serve which tab-directed message. */
const SCRIPTS_FOR: Partial<Record<MessageType, ScriptSpec[]>> = {
  'job/extractFromDom': LINKEDIN_SCRIPTS,
  'overleaf/csRead': OVERLEAF_SCRIPTS,
  'overleaf/csWrite': OVERLEAF_SCRIPTS,
  'overleaf/csPageCount': OVERLEAF_SCRIPTS,
};

/**
 * Injects whatever serves `type` into the tab. Returns false when there is
 * nothing to inject, or when injecting is not allowed — a restricted page, a
 * host we hold no permission for, or a tab that has since closed. Callers treat
 * false as "give up and report the original failure".
 */
export async function injectScriptsFor(type: MessageType, tabId: number): Promise<boolean> {
  const scripts = SCRIPTS_FOR[type];
  if (!scripts) return false;

  try {
    for (const { file, world } of scripts) {
      await browser.scripting.executeScript({
        target: { tabId },
        files: [file],
        ...(world ? { world } : {}),
      });
    }
    return true;
  } catch {
    return false;
  }
}
