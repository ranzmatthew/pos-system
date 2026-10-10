import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { restoreSession, signIn as startSignIn, signOut as endSession, subscribeToAuthChanges, type AppProfile } from './session';

type AuthContextValue = {
  profile: AppProfile | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [ready, setReady] = useState(false);
  const authRevision = useRef(0);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeToAuthChanges((next) => {
      if (mounted) {
        authRevision.current += 1;
        setProfile(next);
      }
    });
    const restoreRevision = authRevision.current;
    restoreSession()
      .then((restored) => {
        if (mounted && authRevision.current === restoreRevision) setProfile(restored);
      })
      .catch(() => {
        if (mounted && authRevision.current === restoreRevision) setProfile(null);
      })
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; authRevision.current += 1; unsubscribe(); };
  }, []);

  async function signIn(email: string, password: string) {
    const revision = ++authRevision.current;
    const next = await startSignIn(email, password);
    if (authRevision.current === revision) setProfile(next);
  }

  async function signOut() {
    authRevision.current += 1;
    setProfile(null);
    await endSession();
  }

  return <AuthContext.Provider value={{ profile, ready, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
