import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w_]+)\s*=\s*["']?(.*?)["']?\s*$/);
      if (match) {
        process.env[match[1]] = match[2];
      }
    }
  }
} catch (e) {
  console.warn("Could not read .env:", e);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nehhadsqtnbrmkyvjopv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_vIlejUPqy9xT-JFG1TqXyQ_BybEjXtf";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function checkStudentUploads() {
  const { data: uploads } = await supabase
    .from("batch_student_uploads")
    .select("id, batch_id, total_count, created_at, updated_at")
    .order("updated_at", { ascending: false });

  console.log("Uploads:", uploads);
}

checkStudentUploads().catch(console.error);
