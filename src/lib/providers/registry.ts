import { ErrorCode, appError } from '@/core/errors';
import {
  PROVIDER_META,
  buildKeyedProvider,
  type ResolvedProvider,
} from '@/core/providers/registry';
import type { ProviderId } from '@/core/providers/types';
import { getSettings, type Settings } from '@/lib/storage';
import { createClaudeCodeProvider } from './claudeCode';

/**
 * The extension's half of provider resolution. Everything reached with a key
 * comes from core, so the web app can build the same providers; the local ones
 * are added here because they need the native-messaging bridge, which only the
 * extension has.
 */
export function buildProvider(id: ProviderId, settings: Settings): ResolvedProvider {
  if (id === 'claude-code') {
    if (!settings.providers.claudeCode?.enabled) {
      throw appError(ErrorCode.NO_PROVIDER, 'Turn on the Claude Code bridge in Settings first.');
    }
    // Claude Code picks its own model; the label is only for display.
    return {
      provider: createClaudeCodeProvider(),
      model: 'claude-code',
      meta: PROVIDER_META[id],
    };
  }

  return buildKeyedProvider(id, settings.providers[id]);
}

export async function getActiveProvider(): Promise<ResolvedProvider> {
  const settings = await getSettings();
  if (!settings.activeProviderId) {
    throw appError(
      ErrorCode.NO_PROVIDER,
      'No model configured yet. Open Settings and add an API key.',
    );
  }
  return buildProvider(settings.activeProviderId, settings);
}
