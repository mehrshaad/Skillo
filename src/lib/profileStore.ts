import { browser } from 'wxt/browser';
import { EMPTY_PROFILE, type UserProfile } from '@/core/profile';

/**
 * The profile stays on this machine, like API keys and for the same reason:
 * it is the most personal thing Skillo holds — visa status, salary floor, why
 * you are leaving — and storage.sync round-trips through Google's servers.
 *
 * The cost is that a second machine asks for it again. That is the right trade,
 * and the storage test asserts it.
 */
const PROFILE_KEY = 'profile';

export async function getProfile(): Promise<UserProfile> {
  const raw = await browser.storage.local.get(PROFILE_KEY);
  const stored = raw[PROFILE_KEY] as Partial<UserProfile> | undefined;
  return { ...EMPTY_PROFILE, ...stored };
}

export async function saveProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
  const next: UserProfile = {
    ...(await getProfile()),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await browser.storage.local.set({ [PROFILE_KEY]: next });
  return next;
}

export async function clearProfile(): Promise<void> {
  await browser.storage.local.remove(PROFILE_KEY);
}
