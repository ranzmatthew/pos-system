import * as SecureStore from 'expo-secure-store';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
import type { Role } from './roles';

const PROFILE_KEY = 'inventory-pos-profile-v1';
let profileCacheRevision = 0;
let authRevision = 0;
let authOperationRevision = 0;
let profileCacheWrites: Promise<void> = Promise.resolve();

export type AppProfile = { userId: string; email: string; role: Role };

function isNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    message?: unknown;
    details?: unknown;
    cause?: unknown;
  };
  // Supabase auth uses status 0 when fetch cannot reach the server. Do not
  // treat HTTP/server or profile validation errors as an offline condition.
  if (candidate.name === 'AuthRetryableFetchError' && candidate.status === 0) return true;

  const cause = candidate.cause && typeof candidate.cause === 'object'
    ? candidate.cause as { name?: unknown; message?: unknown }
    : null;
  const networkMessage = [candidate.message, candidate.details, cause?.name, cause?.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const hasNetworkMessage = /network request failed|failed to fetch|networkerror|load failed|fetch failed/i.test(networkMessage);

  if (candidate.name === 'TypeError') return hasNetworkMessage;
  // PostgREST wraps a rejected fetch in a PostgrestError response object in
  // some client/runtime combinations. Its status is 0 only when no HTTP
  // response was received; keep HTTP authorization, validation, and server
  // errors out of the offline path.
  return candidate.name === 'PostgrestError'
    && candidate.status === 0
    && (hasNetworkMessage || /\bTypeError\b/i.test(networkMessage));
}

async function cachedProfileForSession(session: Session | null, cached: AppProfile | null): Promise<AppProfile | null> {
  // A cached profile is only used from a recognized network failure path.
  // When auth-js cannot refresh an expired token offline, it can return no
  // session even though this previously authenticated profile is still valid
  // for local use. If a session is available, keep it bound to the same user.
  return cached && (!session || session.user.id === cached.userId) ? cached : null;
}

function profileFrom(value: unknown): AppProfile | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.userId !== 'string' || typeof item.email !== 'string') return null;
  if (item.role !== 'owner' && item.role !== 'staff') return null;
  return { userId: item.userId, email: item.email, role: item.role };
}

function serializeProfileCacheWrite(write: () => Promise<void>): Promise<void> {
  const pending = profileCacheWrites.then(write, write);
  profileCacheWrites = pending.catch(() => {});
  return pending;
}

async function cacheProfile(profile: AppProfile, isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) return;
  profileCacheRevision += 1;
  await serializeProfileCacheWrite(async () => {
    if (isCurrent()) await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile));
  });
}

async function clearCachedProfile(isCurrent: () => boolean = () => true): Promise<void> {
  // Increment before the async delete so any in-flight restore sees the
  // invalidation even if SecureStore has not completed it yet.
  profileCacheRevision += 1;
  await serializeProfileCacheWrite(async () => {
    if (isCurrent()) await SecureStore.deleteItemAsync(PROFILE_KEY);
  });
}

async function cachedProfileAfterNetworkFailure(
  restoreRevision: number,
  session: Session | null
): Promise<AppProfile | null> {
  if (profileCacheRevision !== restoreRevision) return null;
  const currentProfile = await getCachedProfile();
  if (profileCacheRevision !== restoreRevision) return null;
  return cachedProfileForSession(session, currentProfile);
}

export async function getCachedProfile(): Promise<AppProfile | null> {
  try {
    const value = await SecureStore.getItemAsync(PROFILE_KEY);
    return value ? profileFrom(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

async function profileForSession(
  session: Session | null,
  isCurrent: () => boolean = () => true
): Promise<AppProfile | null> {
  if (!session?.user) return null;
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('id, email, role')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data || (data.role !== 'owner' && data.role !== 'staff')) {
    throw new Error('This account has no valid POS profile. Ask the owner to set its role in Supabase.');
  }
  const profile: AppProfile = {
    userId: data.id,
    email: data.email || session.user.email || '',
    role: data.role,
  };
  if (!isCurrent()) return null;
  await cacheProfile(profile, isCurrent);
  if (!isCurrent()) return null;
  return profile;
}

export async function signIn(email: string, password: string): Promise<AppProfile> {
  if (!isSupabaseConfigured()) throw new Error('Set the Supabase URL and anon key before signing in.');
  const operationRevision = ++authOperationRevision;
  const startingAuthRevision = authRevision;
  const { data, error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    // Keep a potentially usable offline profile only for network failures;
    // restoreSession will still require it to match the persisted user ID.
    if (!isNetworkFailure(error)) {
      await clearCachedProfile(() => operationRevision === authOperationRevision
        && startingAuthRevision === authRevision);
    }
    throw error;
  }

  const profileRevision = authRevision;
  const isCurrent = () => operationRevision === authOperationRevision && profileRevision === authRevision;
  try {
    const profile = await profileForSession(data.session, isCurrent);
    if (!profile) throw new Error('Sign-in did not return a valid session.');
    return profile;
  } catch (profileError) {
    // A network outage may leave a cached profile available for the same
    // persisted session. A missing or invalid online profile must revoke it.
    if (!isNetworkFailure(profileError)) await clearCachedProfile(isCurrent);
    throw profileError;
  }
}

export async function restoreSession(): Promise<AppProfile | null> {
  const restoreRevision = profileCacheRevision;
  const restoreAuthRevision = authRevision;
  const restoreOperationRevision = authOperationRevision;
  const isCurrent = () => restoreAuthRevision === authRevision
    && restoreOperationRevision === authOperationRevision;
  const cached = await getCachedProfile();
  if (!isCurrent() || profileCacheRevision !== restoreRevision) return null;
  if (!isSupabaseConfigured()) return cached;
  try {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) {
      if (isNetworkFailure(error)) return cachedProfileAfterNetworkFailure(restoreRevision, data.session);
      await clearCachedProfile(isCurrent);
      return null;
    }
    if (!data.session) {
      await clearCachedProfile(isCurrent);
      return null;
    }
    try {
      return (await profileForSession(data.session, isCurrent)) ?? null;
    } catch (profileError) {
      if (isNetworkFailure(profileError)) {
        return cachedProfileAfterNetworkFailure(restoreRevision, data.session);
      }
      // Online profile lookup succeeded but the account is revoked or has no
      // valid role. Remove stale cached authorization instead of using it.
      await clearCachedProfile(isCurrent);
      return null;
    }
  } catch (error) {
    if (isNetworkFailure(error)) {
      try {
        const { data, error: retryError } = await getSupabase().auth.getSession();
        if (retryError && !isNetworkFailure(retryError)) {
          await clearCachedProfile(isCurrent);
          return null;
        }
        if (!retryError && !data.session) {
          await clearCachedProfile(isCurrent);
          return null;
        }
        if (retryError) {
          return cachedProfileAfterNetworkFailure(restoreRevision, data.session);
        }
        if (data.session) {
          try {
            return await profileForSession(data.session, isCurrent);
          } catch (profileError) {
            if (isNetworkFailure(profileError)) {
              return cachedProfileAfterNetworkFailure(restoreRevision, data.session);
            }
            await clearCachedProfile(isCurrent);
            return null;
          }
        }
      } catch (retryError) {
        if (isNetworkFailure(retryError)) {
          return cachedProfileAfterNetworkFailure(restoreRevision, null);
        }
        await clearCachedProfile(isCurrent);
      }
      return null;
    }
    await clearCachedProfile(isCurrent);
    return null;
  }
}

export async function signOut(): Promise<void> {
  authOperationRevision += 1;
  authRevision += 1;
  await clearCachedProfile();
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().auth.signOut({ scope: 'local' });
    if (error) throw error;
  }
}

export function subscribeToAuthChanges(
  listener: (profile: AppProfile | null) => void
): () => void {
  if (!isSupabaseConfigured()) return () => {};
  let active = true;
  let subscriptionRevision = 0;
  const { data } = getSupabase().auth.onAuthStateChange((_event: AuthChangeEvent, session) => {
    const revision = ++subscriptionRevision;
    const authEventRevision = ++authRevision;
    const isCurrent = () => active
      && revision === subscriptionRevision
      && authEventRevision === authRevision;
    // Supabase warns against awaiting another client call inside this callback.
    if (!session) {
      void clearCachedProfile(isCurrent).then(() => {
        if (isCurrent()) listener(null);
      });
      return;
    }
    void Promise.resolve()
      .then(() => profileForSession(session, isCurrent))
      .then((profile) => {
        if (isCurrent()) listener(profile);
      })
      .catch(async (error) => {
        if (!isCurrent()) return;
        const cached = await getCachedProfile();
        if (!isCurrent()) return;
        if (isNetworkFailure(error)) {
          const offlineProfile = await cachedProfileForSession(session, cached);
          if (isCurrent()) listener(offlineProfile);
          return;
        }
        // A missing/invalid online profile revokes cached authorization.
        await clearCachedProfile(isCurrent);
        if (isCurrent()) listener(null);
      });
  });
  return () => {
    active = false;
    subscriptionRevision += 1;
    data.subscription.unsubscribe();
  };
}
