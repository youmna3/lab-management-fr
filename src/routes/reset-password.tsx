import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ISchoolLogo } from "@/components/ISchoolLogo";
import { KeyRound, ArrowLeft } from "lucide-react";
import { BrandIcon } from "@/components/BrandIcon";
import { authErrorMessage, withAuthTimeout } from "@/integrations/supabase/auth-timeout";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset Password – iSchool Lab Management" },
      { name: "description", content: "Set a new password for your account." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      return toast.error("Password must be at least 6 characters long.");
    }
    if (password !== confirmPassword) {
      return toast.error("Passwords do not match.");
    }

    setBusy(true);
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.updateUser({ password }),
        "Password update",
      );
      if (error) return toast.error(error.message);

      setSuccess(true);
      toast.success("Password updated successfully.");
    } catch (error) {
      console.error("[Auth] PASSWORD UPDATE FAILURE", error);
      toast.error(authErrorMessage());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#F7FAFF] dark:bg-[#11172E] px-4 py-12 overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-[#056FEC]/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-[#05ACFF]/15 blur-3xl" />

      <div className="relative z-10 w-full max-w-md space-y-6">
        <div className="flex flex-col items-center justify-center text-center">
          <ISchoolLogo variant="full" size="lg" />
        </div>
        <Card className="w-full border border-[#E6EDF1] dark:border-[#1F2A55] bg-white dark:bg-[#1F2A55] shadow-xl shadow-[#056FEC]/5 rounded-2xl">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#056FEC]/10 text-[#056FEC] dark:bg-[#05ACFF]/20 dark:text-[#05ACFF]">
              <KeyRound className="h-6 w-6" />
            </div>
            <CardTitle className="text-2xl font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
              Reset Password
            </CardTitle>
            <CardDescription className="text-[#597587] dark:text-[#85A5B9]">
              Choose a new secure password for your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="space-y-4 text-center py-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#BCECCA]/40 dark:bg-[#0A852D]/30 text-[#0EAA3A]">
                  <BrandIcon name="checkmark" size={28} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                    Password Updated!
                  </h3>
                  <p className="text-sm text-[#597587] dark:text-[#85A5B9]">
                    Your password has been changed. You can now use your new password.
                  </p>
                </div>
                <Button
                  className="w-full mt-4 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-md"
                  onClick={() => navigate({ to: "/dashboard", replace: true })}
                >
                  Go to Dashboard
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="password"
                    className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF]"
                  >
                    New Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-[#E6EDF1] dark:border-[#182245] focus-visible:ring-[#05ACFF]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="confirm-password"
                    className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF]"
                  >
                    Confirm New Password
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={6}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="border-[#E6EDF1] dark:border-[#182245] focus-visible:ring-[#05ACFF]"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-md shadow-[#056FEC]/20"
                  disabled={busy}
                >
                  {busy ? "Updating..." : "Update Password"}
                </Button>
                <div className="pt-2 text-center">
                  <Link
                    to="/auth"
                    search={{ connection: undefined }}
                    className="inline-flex items-center text-xs text-[#597587] dark:text-[#85A5B9] hover:text-[#056FEC] dark:hover:text-[#05ACFF] transition-colors"
                  >
                    <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Sign In
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <Toaster />
    </div>
  );
}
