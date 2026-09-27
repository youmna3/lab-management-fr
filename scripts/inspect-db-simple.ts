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
  console.log("Checking projects...");
  const { data: projects, error: pErr } = await supabase.from("projects").select("*");
  console.log("Projects:", projects?.length, "Error:", pErr);

  console.log("Checking batches...");
  const { data: batches, error: bErr } = await supabase.from("batches").select("*");
  console.log("Batches:", batches?.length, "Error:", bErr);

  console.log("Checking batch_student_uploads...");
  const { data: uploads, error: uErr } = await supabase.from("batch_student_uploads").select("id, batch_id, created_at");
  console.log("Uploads:", uploads?.length, "Error:", uErr);

  console.log("Checking batch_mega_groups...");
  const { data: bmg, error: bmgErr } = await supabase.from("batch_mega_groups" as any).select("*");
  console.log("batch_mega_groups:", bmg?.length, "Error:", bmgErr);
}

run().catch(console.error);
