import { ErrorCode, appError } from '@/core/errors';
import {
  PROVIDER_META,
  buildKeyedProvider,
  type ResolvedProvider,
} from '@/core/providers/registry';
import type { ProviderId } from '@/core/providers/types';
import { getSettings, type Settings } from '@/lib/storage';
import { createClaudeCodeProvider, createCodexProvider } from './claudeCode';

/**
 * The extension's half of provider resolution. Everything reached with a key
 * comes from core, so the web app can build the same providers; the local ones
 * are added here because they need the native-messaging bridge, which only the
 * extension has.
 */
export function buildProvider(id: ProviderId, settings: Settings): ResolvedProvider {
  // Local CLIs pick their own model; the id is only for display and history.
  if (id === 'claude-code' || id === 'codex-cli') {
    const enabled =
      id === 'claude-code'
        ? settings.providers.claudeCode?.enabled
        : settings.providers.codexCli?.enabled;

    if (!enabled) {
      throw appError(
        ErrorCode.NO_PROVIDER,
        `Turn on the ${PROVIDER_META[id].label} bridge in Settings first.`,
      );
    }
    return {
      provider: id === 'claude-code' ? createClaudeCodeProvider() : createCodexProvider(),
      model: id,
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
