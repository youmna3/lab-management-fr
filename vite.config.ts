// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Note: the lab allocation pipeline used to run through a dev-server-only Vite
// plugin (src/server/allocation-vite-plugin.ts) that shelled out to
// scripts/lab_allocation.py via `python3`. That only ever worked under
// `vite dev` — this app deploys to Cloudflare Workers (see wrangler.json /
// the `nitro: cloudflare` preset above), which has no Node child_process, no
// filesystem, and no Python runtime, so production requests to
// /api/allocation/* had nowhere to go and fell through to the SPA shell.
// The pipeline has been ported to TypeScript and now runs entirely
// client-side (see src/lib/lab-allocation-runner), so it works the same way
// in dev and in production and no longer needs this plugin registered here.

export default defineConfig({
  // Pin Nitro's deployment output to Vercel instead of the wrapper's
  // Cloudflare fallback. The allocation engine remains client-side.
  nitro: { preset: "vercel" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      watch: {
        ignored: ["**/.output/**", "**/.wrangler/**", "**/.tanstack/**"],
      },
    },
  },
});
