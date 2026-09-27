import { createServerFn } from "@tanstack/react-start";

/**
 * Exchanges an HMAC-signed SSO handoff token from the hub (sid = "national-lab")
 * for a one-time Supabase magic-link hash the browser can turn into a session.
 */
export const exchangeSsoToken = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => {
    if (!data || typeof data.token !== "string" || data.token.length === 0 || data.token.length > 4096) {
      throw new Error("Missing token");
    }
    return { token: data.token };
  })
  .handler(async ({ data }) => {
    const signingKey = process.env["SSO_SIGNING_KEY"];
    if (!signingKey) throw new Error("SSO is not configured");

    const { verifySsoToken } = await import("./sso.server");
    const payload = await verifySsoToken(data.token, signingKey);
    const email = payload.sub.trim().toLowerCase();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
    let hashedToken = link.data?.properties?.hashed_token;

    if (link.error || !hashedToken) {
      // First handoff for this account: provision it, then retry.
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { sso_provider: payload.sid },
      });
      if (created.error && !created.error.message.toLowerCase().includes("already")) {
        throw new Error("Unable to establish session");
      }
      const retry = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
      hashedToken = retry.data?.properties?.hashed_token;
      if (!hashedToken) throw new Error("Unable to establish session");
    }

    return { tokenHash: hashedToken, email };
  });
