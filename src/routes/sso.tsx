import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { exchangeSsoToken } from "@/lib/sso.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/sso")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? (search["token"] as string) : "",
  }),
  head: () => ({
    meta: [
      { title: "Single Sign-On Handoff | iSchool Lab Management" },
      {
        name: "description",
        content:
          "Secure single sign-on handoff for the iSchool lab management platform. Verifies your signed access token and opens your dashboard.",
      },
      { property: "og:title", content: "Single Sign-On Handoff | iSchool Lab Management" },
      {
        property: "og:description",
        content: "Secure single sign-on handoff into the iSchool lab management platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SsoHandoff,
});

function SsoHandoff() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const exchange = useServerFn(exchangeSsoToken);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      if (!token) {
        setError("No sign-in token was provided.");
        return;
      }
      try {
        const { tokenHash } = await exchange({ data: { token } });
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "magiclink",
        });
        if (otpError) throw new Error(otpError.message);
        await navigate({ to: "/dashboard", replace: true });
      } catch {
        setError("This sign-in link is invalid or has expired. Please start again from your hub.");
      }
    })();
  }, [token, exchange, navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="py-10 flex flex-col items-center text-center gap-4">
          {error ? (
            <>
              <ShieldAlert className="h-10 w-10 text-destructive" />
              <h1 className="text-lg font-semibold">Sign-in failed</h1>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={() => void navigate({ to: "/auth", search: { connection: undefined } })}>
                Go to sign in
              </Button>
            </>
          ) : (
            <>
              <span className="relative">
                <ShieldCheck className="h-10 w-10 text-primary" />
              </span>
              <h1 className="text-lg font-semibold">Signing you in…</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Verifying your secure handoff token
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
