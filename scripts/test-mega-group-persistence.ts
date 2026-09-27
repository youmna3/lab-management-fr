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
  const testBatchId = "test_batch_persistence_" + Date.now();
  const testMegaGroups = [
    { id: "mg1", name: "Mega Group 1", start_date: "2026-09-01", end_date: "2026-09-03", grades: [4], areas: ["North"] }
  ];

  console.log("1. Writing mega groups to batch_group_classifications under __BATCH_MEGA_GROUPS__ for batch:", testBatchId);
  const { error: insertErr } = await supabase.from("batch_group_classifications").upsert({
    batch_id: testBatchId,
    group_id: "__BATCH_MEGA_GROUPS__",
    visit_type: "single_visit",
    repeat_count: 1,
    notes: JSON.stringify(testMegaGroups),
    updated_at: new Date().toISOString(),
  }, { onConflict: "batch_id,group_id" });

  console.log("Upsert result:", insertErr ? insertErr.message : "SUCCESS!");

  console.log("2. Reading back from batch_group_classifications...");
  const { data: readData, error: readErr } = await supabase
    .from("batch_group_classifications")
    .select("*")
    .eq("batch_id", testBatchId);

  console.log("Read result count:", readData?.length, "Error:", readErr?.message || "none");
  if (readData && readData.length > 0) {
    const mgRow = readData.find((r: any) => r.group_id === "__BATCH_MEGA_GROUPS__");
    if (mgRow) {
      const parsedMg = JSON.parse(mgRow.notes);
      console.log("Parsed Mega Groups from DB:", JSON.stringify(parsedMg));
    }
  }

  // Clean up test row
  await supabase.from("batch_group_classifications").delete().eq("batch_id", testBatchId);
  console.log("3. Cleaned up test row.");
}

run().catch(console.error);
