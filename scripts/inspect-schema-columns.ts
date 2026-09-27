import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env manually
try {
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
} catch (e) {
  console.error("Error loading .env:", e);
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

async function run() {
  console.log("=== CHECKING TABLE STRUCTURES VIA TEST INSERTS / SELECTS ===");

  // 1. Check batches columns by testing empty update
  const { error: bErr1 } = await supabase.from("batches").update({ blocked_days: [] } as any).eq("id", "00000000-0000-0000-0000-000000000000");
  console.log("batches.blocked_days:", bErr1?.code === "PGRST204" ? "MISSING" : bErr1?.message || "EXISTS");

  const { error: bErr2 } = await supabase.from("batches").update({ mega_groups: [] } as any).eq("id", "00000000-0000-0000-0000-000000000000");
  console.log("batches.mega_groups:", bErr2?.code === "PGRST204" ? "MISSING" : bErr2?.message || "EXISTS");

  const { error: bErr3 } = await supabase.from("batches").update({ time_slots: [] } as any).eq("id", "00000000-0000-0000-0000-000000000000");
  console.log("batches.time_slots:", bErr3?.code === "PGRST204" ? "MISSING" : bErr3?.message || "EXISTS");

  const { error: bErr4 } = await supabase.from("batches").update({ dates: [] } as any).eq("id", "00000000-0000-0000-0000-000000000000");
  console.log("batches.dates:", bErr4?.code === "PGRST204" ? "MISSING" : bErr4?.message || "EXISTS");

  const { error: bErr5 } = await supabase.from("batches").update({ expected_sessions_per_group: 1 } as any).eq("id", "00000000-0000-0000-0000-000000000000");
  console.log("batches.expected_sessions_per_group:", bErr5?.code === "PGRST204" ? "MISSING" : bErr5?.message || "EXISTS");

  // 2. Check batch_group_classifications columns
  const { data: bgc, error: bgcErr } = await supabase.from("batch_group_classifications").select("*").limit(1);
  console.log("batch_group_classifications sample query error:", bgcErr?.message || "EXISTS (columns accessible)");

  // 3. Check batch_allocation_outputs columns
  const { data: bao, error: baoErr } = await supabase.from("batch_allocation_outputs").select("id, batch_id, created_at").limit(1);
  console.log("batch_allocation_outputs error:", baoErr?.message || "EXISTS");
}

run().catch(console.error);
