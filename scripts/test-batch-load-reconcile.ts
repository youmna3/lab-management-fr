import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Set Supabase URL and publishable key environment variables before running this script.",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function run() {
  console.log("Checking projects and batches...");
  const { data: projects, error: pErr } = await supabase
    .from("projects")
    .select("id, name, code")
    .limit(5);
  if (pErr) {
    console.error("Projects error:", pErr);
    return;
  }
  console.log("Projects:", projects);

  const { data: batches, error: bErr } = await supabase
    .from("batches")
    .select("id, name, project_id, dates")
    .limit(10);
  if (bErr) {
    console.error("Batches error:", bErr);
    return;
  }
  console.log(
    "Batches:",
    batches?.map((b) => ({ id: b.id, name: b.name, project_id: b.project_id })),
  );

  if (!batches || batches.length === 0) return;

  for (const batch of batches) {
    console.log(`\nTesting batch ${batch.name} (${batch.id}):`);
    const [n, a, sessionRes, alloc] = await Promise.all([
      supabase.from("batch_needs").select("*").eq("batch_id", batch.id),
      supabase.from("assignments").select("*").eq("batch_id", batch.id),
      supabase.from("assignment_sessions").select("*").eq("batch_id", batch.id),
      supabase
        .from("batch_allocation_outputs")
        .select("run_id, updated_at, allocation_storage_path")
        .eq("batch_id", batch.id)
        .maybeSingle(),
    ]);

    console.log(`- batch_needs: ${n.data?.length ?? 0}`);
    console.log(`- assignments: ${a.data?.length ?? 0}`);
    console.log(`- assignment_sessions: ${sessionRes.data?.length ?? 0}`);
    console.log(
      `- allocation_output: run_id=${alloc.data?.run_id}, path=${alloc.data?.allocation_storage_path}`,
    );
  }
}

run().catch(console.error);
