import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `src/core` is the half of Skillo that the web app shares with the extension.
 * It may not reach for Chrome, for extension storage, or for the panel — the
 * moment it does, the web app stops building and the split has quietly failed.
 *
 * This is a guard rather than a unit test: it reads the source rather than
 * running it, because the failure it prevents is architectural and would
 * otherwise only surface months later when the app is wired up.
 */

const CORE = resolve(__dirname, '../src/core');

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(full);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

function importsIn(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]!);
  return specifiers;
}

const files = tsFilesUnder(CORE);

describe('src/core stays portable', () => {
  it('is actually looking at something', () => {
    // Without this, a broken path would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(20);
  });

  it('imports nothing from the extension half', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const spec of importsIn(source)) {
        const banned =
          spec.startsWith('wxt/') ||
          spec === 'wxt' ||
          spec.startsWith('@/lib/') ||
          spec.startsWith('@/components/') ||
          spec.startsWith('@/entrypoints/');
        if (banned) offenders.push(`${relative(CORE, file)} imports ${spec}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never reaches outside itself with a relative path', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const spec of importsIn(source)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(file, '..', spec);
        if (!target.startsWith(CORE)) {
          offenders.push(`${relative(CORE, file)} imports ${spec}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('touches no extension global', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Word-boundary so `browserFetch` or a comment mentioning Chrome is fine.
      if (/\b(?:chrome|browser)\s*\.\s*(?:runtime|storage|tabs|scripting|sidePanel|offscreen)\b/.test(source)) {
        offenders.push(relative(CORE, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
