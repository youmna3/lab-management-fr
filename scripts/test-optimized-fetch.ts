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

async function optimizedFetchProjectStudentUploads(batchIds: string[]) {
  console.log(`\nOptimized fetch starting for ${batchIds.length} batch(es)...`);
  const t0 = Date.now();

  // 1. Lightweight metadata query
  const { data: metaList, error: metaErr } = await supabase
    .from("batch_student_uploads")
    .select("id, batch_id, student_count, file_name, created_at, updated_at")
    .in("batch_id", batchIds);

  const t1 = Date.now();
  console.log(`1. Metadata query completed in ${t1 - t0}ms. Rows found: ${metaList?.length || 0}`);
  if (metaErr) throw metaErr;
  if (!metaList || metaList.length === 0) return [];

  // 2. Fetch full students per batch individually
  const results: any[] = [];
  for (const meta of metaList) {
    const fetchStart = Date.now();
    const { data: fullRow, error: rowErr } = await supabase
      .from("batch_student_uploads")
      .select("*")
      .eq("batch_id", meta.batch_id)
      .single();

    const fetchTime = Date.now() - fetchStart;
    if (rowErr) {
      console.warn(`Error fetching row for batch ${meta.batch_id}:`, rowErr.message);
    } else if (fullRow) {
      const studentCount = Array.isArray(fullRow.students) ? fullRow.students.length : 0;
      console.log(`  -> Batch ${meta.batch_id}: Fetched ${studentCount} students in ${fetchTime}ms`);
      results.push(fullRow);
    }
  }

  const totalTime = Date.now() - t0;
  console.log(`Total optimized fetch completed in ${totalTime}ms. Total records: ${results.length}`);
  return results;
}

async function run() {
  // Get sample batches from database
  const { data: uploads } = await supabase
    .from("batch_student_uploads")
    .select("batch_id")
    .limit(5);

  const sampleBatchIds = uploads?.map((u) => u.batch_id) || [];
  console.log("Testing with 5 real batch IDs:", sampleBatchIds);

  await optimizedFetchProjectStudentUploads(sampleBatchIds);
}

run().catch(console.error);
