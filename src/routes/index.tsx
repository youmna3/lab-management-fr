import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage, withAuthTimeout } from "@/integrations/supabase/auth-timeout";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lab Management System — iSchool" },
      {
        name: "description",
        content:
          "Centralized platform for lab data, project assignment, catering and budget management.",
      },
      { property: "og:title", content: "Lab Management System — iSchool" },
      {
        property: "og:description",
        content:
          "Centralized platform for lab data, project assignment, catering and budget management.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: sessionError } = await withAuthTimeout(
        supabase.auth.getSession(),
        "Startup session check",
      );
      if (sessionError) throw sessionError;
      setLoading(false);
      await navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
    } catch (sessionError) {
      console.error("[Auth] STARTUP SESSION FAILURE", sessionError);
      setError(authErrorMessage());
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <h1 className="sr-only">Lab Management System</h1>
      {loading ? (
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      ) : (
        <div className="space-y-4 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="font-medium">{error}</p>
          <Button onClick={() => void checkSession()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      )}
    </div>
  );
}
