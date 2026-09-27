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
  console.log("1. Checking batch_allocation_outputs...");
  const { data: outputs, error: oErr } = await supabase
    .from("batch_allocation_outputs")
    .select("batch_id, summary, preferences_applied, updated_at");
  console.log(`Outputs found: ${outputs?.length || 0}`, oErr || "");
  for (const o of outputs || []) {
    console.log(`- Batch: ${o.batch_id}, Updated: ${o.updated_at}, Summary:`, o.summary);
    console.log(`  Preferences:`, JSON.stringify(o.preferences_applied, null, 2));
  }

  console.log("\n2. Checking batch_student_uploads...");
  const { data: uploads, error: uErr } = await supabase
    .from("batch_student_uploads")
    .select("batch_id, file_name, student_count, updated_at");
  console.log(`Uploads found: ${uploads?.length || 0}`, uErr || "");
  for (const u of uploads || []) {
    console.log(`- Batch: ${u.batch_id}, File: ${u.file_name}, Count: ${u.student_count}`);
  }

  console.log("\n3. Checking projects...");
  const { data: projects, error: pErr } = await supabase
    .from("projects")
    .select("id, name, code, program");
  console.log(`Projects found: ${projects?.length || 0}`, pErr || "");
  for (const p of projects || []) {
    console.log(`- Project: ${p.id}, Name: ${p.name}, Code: ${p.code}`);
  }
}

main().catch(console.error);
