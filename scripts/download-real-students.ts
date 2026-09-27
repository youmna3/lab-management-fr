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
  const { data: uploads } = await supabase
    .from("batch_student_uploads")
    .select("batch_id, file_name, student_count, students")
    .eq("student_count", 25304)
    .limit(1);

  if (uploads && uploads.length > 0) {
    const students = uploads[0].students;
    console.log(`Downloaded ${students?.length} real students from batch ${uploads[0].batch_id}`);
    fs.writeFileSync("scratch/real_25304_students.json", JSON.stringify(students));
    console.log("Saved to scratch/real_25304_students.json");
  } else {
    console.log("No 25304 student upload found, checking any...");
    const { data: anyUpload } = await supabase
      .from("batch_student_uploads")
      .select("batch_id, file_name, student_count, students")
      .order("student_count", { ascending: false })
      .limit(1);
    if (anyUpload && anyUpload.length > 0) {
      console.log(`Found batch ${anyUpload[0].batch_id} with count ${anyUpload[0].student_count}`);
      fs.writeFileSync("scratch/real_25304_students.json", JSON.stringify(anyUpload[0].students));
    }
  }
}

main().catch(console.error);
