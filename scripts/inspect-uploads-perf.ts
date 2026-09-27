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
  console.log("=== INSPECTING BATCH_STUDENT_UPLOADS ROWS ===");
  const { data: uploads, error: uErr } = await supabase
    .from("batch_student_uploads")
    .select("id, batch_id, student_count, file_name, created_at, updated_at");

  if (uErr) {
    console.error("Error:", uErr);
    return;
  }

  console.log(`Found ${uploads.length} upload records:`);
  for (const u of uploads) {
    console.log(`- Upload ID: ${u.id}, Batch ID: ${u.batch_id}, Student Count: ${u.student_count}, File: ${u.file_name}, Created: ${u.created_at}`);
  }

  // Let's test timing of fetching all 51 rows with select("*") vs select("id, batch_id, ...")
  console.log("\n--- Testing query with select('*') across all batch_ids ---");
  const allBatchIds = uploads.map((u) => u.batch_id);
  const start = Date.now();
  try {
    const { data: fullData, error: fErr } = await supabase
      .from("batch_student_uploads")
      .select("*")
      .in("batch_id", allBatchIds.slice(0, 10)); // test just first 10
    const elapsed = Date.now() - start;
    console.log(`Fetched 10 rows with select('*') in ${elapsed}ms. Error:`, fErr);
    if (fullData) {
      for (const r of fullData) {
        const studentArr = Array.isArray(r.students) ? r.students : [];
        console.log(`  Row ${r.batch_id}: ${studentArr.length} students in JSON blob`);
      }
    }
  } catch (e) {
    console.error("Query failed with exception:", e);
  }

  console.log("\n--- Testing query with select('*') across ALL 51 batch_ids ---");
  const startAll = Date.now();
  try {
    const { data: allData, error: allErr } = await supabase
      .from("batch_student_uploads")
      .select("*")
      .in("batch_id", allBatchIds);
    const elapsedAll = Date.now() - startAll;
    console.log(`Fetched all 51 rows with select('*') in ${elapsedAll}ms. Error:`, allErr);
  } catch (e) {
    console.error("Query failed with exception:", e);
  }
}

run().catch(console.error);
