import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { authDebug, authErrorMessage, withAuthTimeout } from "@/integrations/supabase/auth-timeout";

export type AppRole = "lab_manager" | "operations" | "finance" | "administration";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  hasRole: (role: AppRole) => boolean;
  hasAnyRole: (roles: AppRole[]) => boolean;
  retry: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const roleRequestRef = useRef<{ userId: string; request: Promise<void> } | null>(null);

  const loadRoles = useCallback((userId: string) => {
    if (roleRequestRef.current?.userId === userId) {
      return roleRequestRef.current.request;
    }

    const request = (async () => {
      authDebug("PROFILE/ROLE FETCH START", { userId });
      try {
        const { data, error: roleError } = await withAuthTimeout(
          supabase.from("user_roles").select("role").eq("user_id", userId),
          "Profile and role request",
        );
        if (roleError) throw roleError;
        if (!mountedRef.current) return;
        setRoles((data ?? []).map((row) => row.role as AppRole));
        setError(null);
        authDebug("PROFILE/ROLE FETCH SUCCESS", { userId, roleCount: data?.length ?? 0 });
      } catch (roleError) {
        console.error("[Auth] PROFILE/ROLE FETCH FAILURE", roleError);
        if (!mountedRef.current) return;
        setRoles([]);
        setError(authErrorMessage());
      }
    })();

    roleRequestRef.current = { userId, request };
    void request.finally(() => {
      if (roleRequestRef.current?.request === request) roleRequestRef.current = null;
    });
    return request;
  }, []);

  const initialize = useCallback(async () => {
    setLoading(true);
    setError(null);
    authDebug("INIT START");
    try {
      const { data, error: sessionError } = await withAuthTimeout(
        supabase.auth.getSession(),
        "Session initialization",
      );
      if (sessionError) throw sessionError;
      if (!mountedRef.current) return;

      const nextSession = data.session;
      setSession(nextSession);
      authDebug("SESSION RESULT", {
        hasSession: Boolean(nextSession),
        userId: nextSession?.user.id ?? null,
      });

      if (nextSession?.user) await loadRoles(nextSession.user.id);
      else setRoles([]);
    } catch (initializationError) {
      console.error("[Auth] INIT FAILURE", initializationError);
      if (mountedRef.current) setError(authErrorMessage());
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [loadRoles]);

  useEffect(() => {
    mountedRef.current = true;
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mountedRef.current) return;
      setSession(nextSession);
      authDebug("AUTH EVENT", {
        event,
        hasSession: Boolean(nextSession),
        userId: nextSession?.user.id ?? null,
      });

      if (nextSession?.user) {
        window.setTimeout(() => void loadRoles(nextSession.user.id), 0);
      } else {
        roleRequestRef.current = null;
        setRoles([]);
      }
    });

    void initialize();
    return () => {
      mountedRef.current = false;
      subscription.subscription.unsubscribe();
    };
  }, [initialize, loadRoles]);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    roles,
    loading,
    error,
    isAdmin: roles.includes("administration"),
    hasRole: (role) => roles.includes(role),
    hasAnyRole: (requiredRoles) => requiredRoles.some((role) => roles.includes(role)),
    retry: initialize,
    signOut: async () => {
      await withAuthTimeout(supabase.auth.signOut(), "Sign out");
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  lab_manager: "Lab Manager",
  operations: "Operations",
  finance: "Finance",
  administration: "Administration",
};
