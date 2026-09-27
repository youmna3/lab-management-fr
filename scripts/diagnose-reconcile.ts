import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { fetchBatchAllocationOutput } from "../src/lib/batch-allocation-storage.js";
import { deriveAllocationLabUsage } from "../src/lib/allocation-lab-needs.js";

// Load .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";

function createSupabaseFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, k) => headers.set(k, value));
    }
    if (key.startsWith("sb_publishable_") && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: createSupabaseFetch(supabaseKey),
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function main() {
  console.log("Fetching projects and batches...");
  const { data: projects, error: pErr } = await supabase.from("projects").select("id, name, code").order("created_at", { ascending: false }).limit(5);
  if (pErr) console.error("Projects error:", pErr);
  console.log("Projects:", projects?.map(p => `${p.name} (${p.id})`));

  const { data: batches, error: bErr } = await supabase.from("batches").select("id, name, project_id").order("created_at", { ascending: false }).limit(10);
  if (bErr) console.error("Batches error:", bErr);
  console.log("Batches:", batches?.map(b => `${b.name} (${b.id}) [project: ${b.project_id}]`));

  for (const batch of batches ?? []) {
    console.log(`\n--- Testing batch: ${batch.name} (${batch.id}) ---`);
    try {
      const [n, a, sessionRes, l, q, allocation] = await Promise.all([
        supabase.from("batch_needs").select("*").eq("batch_id", batch.id),
        supabase.from("assignments").select("*").eq("batch_id", batch.id),
        supabase.from("assignment_sessions").select("*").eq("batch_id", batch.id),
        supabase.from("labs").select("*").eq("is_active", true),
        supabase.from("lab_quality").select("lab_id, quality_score"),
        fetchBatchAllocationOutput(batch.id).catch((err) => {
          console.warn("fetchBatchAllocationOutput error:", err);
          return null;
        }),
      ]);

      console.log(`Needs count: ${n.data?.length ?? 0}`);
      console.log(`Assignments count: ${a.data?.length ?? 0}`);
      console.log(`Sessions count: ${sessionRes.data?.length ?? 0}`);
      console.log(`Allocation loaded: ${allocation ? `run_id=${allocation.run_id}, status=${allocation.sync_status}` : "null"}`);

      if (allocation?.run_id && allocation.sync_status !== "offline") {
        const usage = deriveAllocationLabUsage(allocation);
        console.log(`Authoritative lab usages derived: ${usage.length}`);
        
        // Let's check assignments with replaces_assignment_id or denied
        const denied = (a.data ?? []).filter(item => item.status === "denied");
        const replacements = (a.data ?? []).filter(item => item.replaces_assignment_id);
        console.log(`Denied assignments: ${denied.length}, Replacements: ${replacements.length}`);
      }
    } catch (err) {
      console.error(`Error in batch ${batch.name}:`, err);
    }
  }
}

main().catch(console.error);
