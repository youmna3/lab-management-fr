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
  const testBatchId = "batch_cloud_test_" + Date.now();
  console.log("Testing shared cloud database persistence for batch_allocation_outputs...");

  const samplePayload = {
    batch_id: testBatchId,
    project_id: null,
    summary: {
      total_students: 100,
      assigned_count: 100,
      unassigned_count: 0,
      total_labs: 5,
      total_sessions_available: 20,
      total_sessions_assigned: 10,
      overfill_count: 0,
      areas_count: 2,
    },
    dashboard_summary: [],
    master_allocation: [
      {
        Group_ID: "G1",
        S_ID: "STU-1",
        Grade: 4,
        "Physical Area": "Cairo",
        Lab_ID: "L1",
        Day: "Sunday",
        Session: "10:00 AM",
        Time_Slot: "10:00 AM",
        Slot_Key: "L1_0",
        Lab_Capacity: 20,
        Slot_Num: 0,
        Is_Overfill: false,
      }
    ],
    lab_pivot: [],
    lab_allocation: [],
    unassigned_students: [],
    shortfall_math: [],
    preferences_applied: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 5,
    },
    logs: ["Test log entry"],
    updated_at: new Date().toISOString(),
  };

  console.log("1. Executing upsert to Supabase `batch_allocation_outputs`...");
  const { error: upsertErr } = await supabase
    .from("batch_allocation_outputs")
    .upsert(samplePayload as any, { onConflict: "batch_id" });

  if (upsertErr) {
    console.error("Upsert failed:", upsertErr);
    return;
  }
  console.log("✓ Cloud upsert succeeded!");

  console.log("2. Querying row back from Supabase by batch_id...");
  const { data: readData, error: readErr } = await supabase
    .from("batch_allocation_outputs")
    .select("batch_id, summary, preferences_applied, updated_at")
    .eq("batch_id", testBatchId)
    .single();

  if (readErr || !readData) {
    console.error("Query failed:", readErr);
    return;
  }
  console.log("✓ Successfully read back from shared cloud database:", readData);

  console.log("3. Cleaning up test record...");
  await supabase.from("batch_allocation_outputs").delete().eq("batch_id", testBatchId);
  console.log("✓ Cleanup complete!");
}

main().catch(console.error);
