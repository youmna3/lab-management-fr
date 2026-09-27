import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

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

async function main() {
  console.log("Querying batch 'lasthope' from database...");
  const { data: batches, error } = await supabase
    .from("batches")
    .select("*");

  if (error) {
    console.error("Error fetching batches:", error);
    return;
  }

  console.log(`Found ${batches?.length || 0} batches total:`);
  for (const b of batches || []) {
    console.log(`- ID: ${b.id}, Name: "${b.name}", ExpectedSessions: ${b.expected_sessions_per_group}, TimeSlots: ${b.time_slots?.length || 0}, BlockedDays: ${JSON.stringify(b.blocked_days)}, MegaGroups: ${JSON.stringify(b.mega_groups)}`);
  }

  const lasthopeBatch = (batches || []).find((b: any) => b.name?.toLowerCase().includes("hope") || b.id?.toLowerCase().includes("hope") || b.name?.toLowerCase().includes("last"));
  if (lasthopeBatch) {
    console.log("\n=== LASTHOPE BATCH RECORD ===");
    console.log(JSON.stringify(lasthopeBatch, null, 2));

    // Fetch batch_allocation_outputs for this batch
    const { data: output, error: outErr } = await supabase
      .from("batch_allocation_outputs")
      .select("batch_id, summary, preferences_applied, updated_at")
      .eq("batch_id", lasthopeBatch.id)
      .maybeSingle();

    if (output) {
      console.log("\n=== LASTHOPE STORED ALLOCATION OUTPUT ===");
      console.log("Summary:", JSON.stringify(output.summary, null, 2));
      console.log("Preferences Applied:", JSON.stringify(output.preferences_applied, null, 2));
    } else {
      console.log("No batch_allocation_outputs found for lasthope:", outErr);
    }
  }
}

main().catch(console.error);
