import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authDebug, authErrorMessage, withAuthTimeout } from "@/integrations/supabase/auth-timeout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ISchoolLogo } from "@/components/ISchoolLogo";
import { BrandIcon } from "@/components/BrandIcon";
import { AlertCircle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    connection: search.connection === "failed" ? "failed" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in – iSchool Lab Management" },
      {
        name: "description",
        content: "Sign in to the official iSchool Lab & Operations Management Portal.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const [tab, setTab] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(
    search.connection ? authErrorMessage() : null,
  );

  async function checkExistingSession() {
    setCheckingSession(true);
    setConnectionError(null);
    try {
      const { data, error } = await withAuthTimeout(
        supabase.auth.getSession(),
        "Sign-in page session check",
      );
      if (error) throw error;
      if (data.session) await navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      console.error("[Auth] SIGN-IN PAGE SESSION FAILURE", error);
      setConnectionError(authErrorMessage());
    } finally {
      setCheckingSession(false);
    }
  }

  useEffect(() => {
    void checkExistingSession();
    // The session check is intentionally run once when this page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setConnectionError(null);
    authDebug("SIGN-IN ATTEMPT", { method: "password" });
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        "Password sign in",
      );
      if (error) {
        authDebug("SIGN-IN FAILURE", { method: "password", reason: error.message });
        return toast.error(error.message);
      }
      authDebug("SIGN-IN SUCCESS", { method: "password" });
      await router.invalidate();
      await navigate({ to: "/lab-allocation", replace: true });
    } catch (error) {
      console.error("[Auth] PASSWORD SIGN-IN FAILURE", error);
      authDebug("SIGN-IN FAILURE", { method: "password", reason: "connection" });
      setConnectionError(authErrorMessage());
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setConnectionError(null);
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        }),
        "Password reset request",
      );
      if (error) return toast.error(error.message);
      toast.success("Password reset email sent. Check your inbox.");
      setTab("signin");
    } catch (error) {
      console.error("[Auth] PASSWORD RESET REQUEST FAILURE", error);
      setConnectionError(authErrorMessage());
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    setConnectionError(null);
    authDebug("SIGN-IN ATTEMPT", { method: "google" });
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        }),
        "Google sign in",
      );
      if (error) {
        authDebug("SIGN-IN FAILURE", { method: "google", reason: error.message });
        toast.error(error.message);
      } else {
        authDebug("SIGN-IN SUCCESS", { method: "google", redirectStarted: true });
      }
    } catch (error) {
      console.error("[Auth] GOOGLE SIGN-IN FAILURE", error);
      authDebug("SIGN-IN FAILURE", { method: "google", reason: "connection" });
      setConnectionError(authErrorMessage());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#F7FAFF] dark:bg-[#11172E] px-4 py-12 overflow-hidden">
      {/* Decorative Brand Ambient Background Mesh */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-[#056FEC]/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-[#05ACFF]/15 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-[#FF7F1C]/5 blur-3xl" />

      <div className="relative z-10 w-full max-w-md space-y-6">
        <div className="flex flex-col items-center justify-center text-center space-y-2">
          <ISchoolLogo variant="full" size="lg" tagText="B2G Operations Portal" />
          <p className="text-xs text-[#597587] dark:text-[#85A5B9] font-medium tracking-wide">
            Today's Generation Tomorrow's Tech Leaders
          </p>
        </div>

        <Card className="border border-[#E6EDF1] dark:border-[#1F2A55] bg-white dark:bg-[#1F2A55] shadow-xl shadow-[#056FEC]/5 rounded-2xl overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
              {tab === "signin" ? "Portal Sign In" : "Reset Password"}
            </CardTitle>
            <CardDescription className="text-[#597587] dark:text-[#85A5B9] text-xs">
              {tab === "signin"
                ? "Access the centralized lab management and allocation portal."
                : "We'll email you a secure reset link."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connectionError && (
              <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{connectionError}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={checkingSession}
                  onClick={() => void checkExistingSession()}
                >
                  <RefreshCw
                    className={`mr-1.5 h-3.5 w-3.5 ${checkingSession ? "animate-spin" : ""}`}
                  />
                  Retry
                </Button>
              </div>
            )}
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsContent value="signin" className="mt-4 space-y-4">
                <form onSubmit={handleSignIn} className="space-y-3.5">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="email"
                      className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF]"
                    >
                      Email Address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      placeholder="name@ischool.app"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="border-[#E6EDF1] dark:border-[#182245] focus-visible:ring-[#05ACFF]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="password"
                      className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF]"
                    >
                      Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="border-[#E6EDF1] dark:border-[#182245] focus-visible:ring-[#05ACFF]"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-md shadow-[#056FEC]/25 transition-all"
                    disabled={busy}
                  >
                    {busy ? "Signing in…" : "Sign In to Portal"}
                  </Button>
                  <button
                    type="button"
                    className="block w-full text-center text-xs text-[#597587] dark:text-[#85A5B9] hover:text-[#056FEC] dark:hover:text-[#05ACFF] transition-colors"
                    onClick={() => setTab("forgot")}
                  >
                    Forgot password?
                  </button>
                </form>

                <Separator />

                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-[#E6EDF1] dark:border-[#182245] hover:bg-[#F7FAFF] dark:hover:bg-[#182245] text-xs"
                  onClick={handleGoogle}
                  disabled={busy}
                >
                  Continue with Google
                </Button>
              </TabsContent>

              {tab === "forgot" && (
                <div className="mt-4">
                  <form onSubmit={handleForgot} className="space-y-3.5">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="forgot-email"
                        className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF]"
                      >
                        Email Address
                      </Label>
                      <Input
                        id="forgot-email"
                        type="email"
                        required
                        placeholder="name@ischool.app"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="border-[#E6EDF1] dark:border-[#182245] focus-visible:ring-[#05ACFF]"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-md shadow-[#056FEC]/25"
                      disabled={busy}
                    >
                      {busy ? "Sending…" : "Send Reset Link"}
                    </Button>
                    <button
                      type="button"
                      className="block w-full text-center text-xs text-[#597587] dark:text-[#85A5B9] hover:text-[#056FEC] dark:hover:text-[#05ACFF]"
                      onClick={() => setTab("signin")}
                    >
                      Back to sign in
                    </button>
                  </form>
                </div>
              )}
            </Tabs>
          </CardContent>
        </Card>
      </div>
      <Toaster />
    </div>
  );
}

function Separator() {
  return (
    <div className="relative my-2">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-[#E6EDF1] dark:border-[#182245]" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-white dark:bg-[#1F2A55] px-2 text-[#85A5B9]">or</span>
      </div>
    </div>
  );
}
