import { createClient } from "@supabase/supabase-js";
import fs from "fs";

let supabaseUrl = "";
let supabaseKey = "";
if (fs.existsSync(".env")) {
  const env = fs.readFileSync(".env", "utf-8");
  for (const line of env.split("\n")) {
    if (line.startsWith("VITE_SUPABASE_URL=")) supabaseUrl = line.split("=")[1].trim().replace(/['"]/g, "");
    if (line.startsWith("VITE_SUPABASE_ANON_KEY=")) supabaseKey = line.split("=")[1].trim().replace(/['"]/g, "");
  }
}

async function check() {
  if (!supabaseUrl || !supabaseKey) {
    console.log("Missing credentials");
    return;
  }
  const sb = createClient(supabaseUrl, supabaseKey);
  const { data: projects } = await sb.from("projects").select("id, name, code");
  console.log("Projects count:", projects?.length);
  if (projects) console.log("Projects:", projects.map(p => ({ id: p.id, name: p.name, code: p.code })));

  const { data: batches } = await sb.from("batches").select("id, name, project_id");
  console.log("Batches count:", batches?.length);
  if (batches) console.log("Batches:", batches.map(b => ({ id: b.id, name: b.name })));

  const { data: uploads } = await sb.from("batch_student_uploads").select("id, batch_id, student_count, file_name");
  console.log("Uploads count:", uploads?.length);
  if (uploads) console.log("Uploads:", uploads);

  const { data: allocs } = await sb.from("batch_allocation_outputs").select("id, batch_id, summary");
  console.log("Allocations count:", allocs?.length);
  if (allocs) console.log("Allocations:", allocs);
}

check().catch(console.error);
