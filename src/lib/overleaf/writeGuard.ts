import { hashText } from '@/core/hash';

/**
 * Decides whether it is safe to replace the Overleaf document.
 *
 * The hash passed in must be of the document **as Skillo read it**, never of
 * the working copy. Skillo's own section editor rewrites the working copy on
 * purpose; if that were the comparison, every locally restructured resume would
 * refuse to apply its own edit. The only question this answers is "did someone
 * change the document in Overleaf since we read it?"
 */
export function documentUnchanged(currentText: string, expectedHash: string): boolean {
  return hashText(currentText) === expectedHash;
}
