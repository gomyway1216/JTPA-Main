"use client";

import {
  type User,
  onIdTokenChanged,
} from "firebase/auth";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import { refreshSessionWithIdToken } from "@/app/actions/auth";
import { clientAuth } from "@/lib/firebase/client";
import type { SessionUser } from "@/lib/types";

interface AuthContextValue {
  user: SessionUser | null;
  firebaseUser: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  firebaseUser: null,
  loading: true,
});

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: SessionUser | null;
  children: React.ReactNode;
}) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [, startSessionRefresh] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const unsub = onIdTokenChanged(clientAuth, (u) => {
      setFirebaseUser(u);
      if (!u) {
        setLoading(false);
        return;
      }

      // Firebase persists the browser login and rotates its ID token, but the
      // server's httpOnly session cookie has a separate fixed lifetime. Renew
      // that cookie whenever Firebase restores or rotates the user so active
      // visitors do not appear signed out while Google still knows them.
      startSessionRefresh(async () => {
        try {
          const idToken = await u.getIdToken();
          const result = await refreshSessionWithIdToken(idToken);
          if (active && result.ok && initialUser?.uid !== u.uid) {
            router.refresh();
          }
        } catch (error) {
          console.warn("[auth] Unable to renew browser session", error);
        } finally {
          if (active) setLoading(false);
        }
      });
    });
    return () => {
      active = false;
      unsub();
    };
  }, [initialUser?.uid, router]);

  const value = useMemo<AuthContextValue>(
    () => ({ user: initialUser, firebaseUser, loading }),
    [initialUser, firebaseUser, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
