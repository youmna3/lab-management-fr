import { createFileRoute, Outlet, redirect, useHydrated } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { authDebug, withAuthTimeout } from "@/integrations/supabase/auth-timeout";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppNav } from "@/components/AppNav";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let result: Awaited<ReturnType<typeof supabase.auth.getSession>>;
    try {
      result = await withAuthTimeout(supabase.auth.getSession(), "Protected route session check");
    } catch (error) {
      console.error("[Auth] PROTECTED ROUTE FAILURE", error);
      throw redirect({ to: "/auth", search: { connection: "failed" } });
    }
    if (result.error || !result.data.session?.user) {
      throw redirect({ to: "/auth", search: { connection: undefined } });
    }
    authDebug("PROTECTED ROUTE ALLOWED", { userId: result.data.session.user.id });
    return { user: result.data.session.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const hydrated = useHydrated();
  if (!hydrated) return null;

  return (
    <AuthProvider>
      <AuthenticatedShell />
    </AuthProvider>
  );
}

function AuthenticatedShell() {
  const { session, loading, error, retry } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm space-y-4 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="font-medium">{error}</p>
          <Button onClick={() => void retry()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-center text-sm">
          {error}{" "}
          <button className="font-semibold underline" onClick={() => void retry()} type="button">
            Retry
          </button>
        </div>
      )}
      <main className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
