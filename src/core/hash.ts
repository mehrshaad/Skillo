/**
 * FNV-1a 32-bit, suffixed with the length. Used only to detect that an Overleaf
 * document changed under us between read and write — not for security.
 */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${text.length}`;
}
