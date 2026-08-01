import { ErrorCode, appError, toAppError } from '@/lib/errors';
import { hashText } from '@/lib/hash';
import {
  OVERLEAF_ORIGIN,
  RESPONSE_SOURCE,
  isRequestMessage,
  type OverleafOp,
  type OverleafOpResult,
} from '@/lib/overleaf/protocol';

/**
 * Runs in the page's own JavaScript world, which is the only place the
 * CodeMirror 6 instance is reachable. Everything that knows about Overleaf's
 * internals lives here and in the ISOLATED-world bridge beside it.
 *
 * Overleaf has no public API on free accounts. CodeMirror attaches its
 * ContentView to the `.cm-content` element as `cmView`, and dispatching a
 * transaction on the view goes through Overleaf's own change pipeline — so the
 * edit syncs to the server and lands as a single undo step, exactly as typing
 * would. This is undocumented, so every access is feature-detected and failures
 * come back as guidance rather than a crash.
 */

interface CodeMirrorView {
  state: { doc: { toString(): string; length: number } };
  dispatch(spec: unknown): void;
}

function getView(): CodeMirrorView | null {
  const el = document.querySelector('.cm-content') as (Element & { cmView?: { view?: unknown } }) | null;
  const view = el?.cmView?.view as CodeMirrorView | undefined;
  if (!view || typeof view.dispatch !== 'function') return null;
  if (typeof view.state?.doc?.toString !== 'function') return null;
  return view;
}

function editorNotFound() {
  return appError(
    ErrorCode.OVERLEAF_EDITOR_NOT_FOUND,
    'Skillo could not find an open LaTeX editor on this Overleaf page.',
    'Open your resume\'s .tex file in the Code Editor (not the Visual Editor or the PDF-only view), then try again.',
  );
}

/** Display-only. Overleaf renames these classes often, so failure is fine. */
function currentFilename(): string | undefined {
  const selectors = [
    '.file-tree li[aria-selected="true"] .item-name-button-text',
    '.file-tree .selected .item-name-button-text',
    '[class*="file-tree"] [aria-selected="true"]',
    '.editor-header .file-name',
  ];
  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  return undefined;
}

function handle(payload: OverleafOp): OverleafOpResult {
  const view = getView();
  if (!view) return { ok: false, error: editorNotFound() };

  if (payload.op === 'read') {
    const latex = view.state.doc.toString();
    return {
      ok: true,
      data: { latex, hash: hashText(latex), filename: currentFilename() },
    };
  }

  // Write lands in a later milestone; refuse clearly rather than half-doing it.
  return {
    ok: false,
    error: appError(ErrorCode.OVERLEAF_WRITE_FAILED, 'Writing to Overleaf is not enabled yet.'),
  };
}

export default defineContentScript({
  matches: ['https://www.overleaf.com/project/*'],
  world: 'MAIN',
  main() {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.origin !== OVERLEAF_ORIGIN) return;
      if (!isRequestMessage(event.data)) return;

      let result: OverleafOpResult;
      try {
        result = handle(event.data.payload);
      } catch (e) {
        result = { ok: false, error: toAppError(e, ErrorCode.OVERLEAF_EDITOR_NOT_FOUND) };
      }

      window.postMessage({ source: RESPONSE_SOURCE, id: event.data.id, result }, OVERLEAF_ORIGIN);
    });
  },
});
