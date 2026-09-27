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

console.log("Supabase URL:", supabaseUrl);
console.log("Supabase Key prefix:", supabaseKey ? supabaseKey.slice(0, 15) : "none");

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
  console.log("=== 1. FETCHING ALL BATCHES ===");
  const { data: batches, error: bErr } = await supabase
    .from("batches")
    .select("*")
    .order("created_at", { ascending: false });

  if (bErr) {
    console.error("Error fetching batches:", bErr);
    return;
  }

  console.log(`Found ${batches?.length || 0} batches:`);
  for (const b of batches || []) {
    console.log(`\n--------------------------------------------------------------`);
    console.log(`Batch ID: ${b.id}`);
    console.log(`  Name: "${b.name}"`);
    console.log(`  Status: ${b.status}`);
    console.log(`  Expected Sessions: ${b.expected_sessions_per_group}`);
    console.log(`  Mode (batch_group_distribution_mode): ${b.batch_group_distribution_mode}`);
    console.log(`  Default Repeat Count: ${b.default_repeat_count}`);
    console.log(`  Created At: ${b.created_at}`);

    // Check batch_group_classifications
    const { data: classes, count: cCount, error: cErr } = await supabase
      .from("batch_group_classifications")
      .select("*", { count: "exact" })
      .eq("batch_id", b.id);

    console.log(`  Classifications: count=${cCount ?? classes?.length ?? 0} (err=${cErr?.message || "none"})`);
    if (classes && classes.length > 0) {
      const multiCount = classes.filter((c: any) => c.visit_type === "multi_visit").length;
      const singleCount = classes.filter((c: any) => c.visit_type === "single_visit").length;
      console.log(`    Classifications breakdown: Multi-Visit=${multiCount}, Single-Visit=${singleCount}`);
      console.log(`    Sample Classifications (first 2):`, JSON.stringify(classes.slice(0, 2)));
    }

    // Check batch_allocation_outputs
    const { data: outputs, error: oErr } = await supabase
      .from("batch_allocation_outputs")
      .select("*")
      .eq("batch_id", b.id);

    console.log(`  Allocation Outputs: count=${outputs?.length || 0} (err=${oErr?.message || "none"})`);
    if (outputs && outputs.length > 0) {
      for (const out of outputs) {
        console.log(`    Output ID: ${out.id}`);
        console.log(`    Total Students: ${out.total_students}`);
        console.log(`    Assigned Count: ${out.assigned_count}`);
        console.log(`    Total Seat Visits: ${out.total_seat_visits}`);
        console.log(`    Batch Group Type: ${out.batch_group_type}`);
        console.log(`    Single Count: ${out.single_session_groups_count}`);
        console.log(`    Multi Count: ${out.multi_session_groups_count}`);
        console.log(`    Created At: ${out.created_at}`);
        console.log(`    Updated At: ${out.updated_at}`);
        
        const payload = out.output_payload as any;
        if (payload) {
          const master = payload.master_allocation || [];
          console.log(`    Master Allocation Rows: ${master.length}`);
          if (master.length > 0) {
            console.log(`    Sample Master Row:`, JSON.stringify(master[0]));
            
            // Check visit_nums in master
            const visitNums = new Set(master.map((r: any) => r.Visit_Num ?? r.visit_num));
            const repeatCounts = new Set(master.map((r: any) => r.Repeat_Count ?? r.repeat_count));
            const visitTypes = new Set(master.map((r: any) => r.Visit_Type ?? r.visit_type));
            console.log(`    Distinct Visit_Nums in master:`, Array.from(visitNums));
            console.log(`    Distinct Repeat_Counts in master:`, Array.from(repeatCounts));
            console.log(`    Distinct Visit_Types in master:`, Array.from(visitTypes));

            // Check groups with multiple visits
            const groupVisitMap = new Map<string, Set<number>>();
            for (const r of master) {
              const gid = r.Group_ID || r.group_id;
              const vnum = r.Visit_Num ?? r.visit_num ?? 1;
              if (!groupVisitMap.has(gid)) groupVisitMap.set(gid, new Set());
              groupVisitMap.get(gid)!.add(vnum);
            }
            let multiVisitGroupCount = 0;
            let singleVisitGroupCount = 0;
            for (const [gid, vset] of groupVisitMap.entries()) {
              if (vset.size > 1) multiVisitGroupCount++;
              else singleVisitGroupCount++;
            }
            console.log(`    Groups in master with >1 distinct Visit_Num: ${multiVisitGroupCount}, with 1 visit: ${singleVisitGroupCount}`);
            
            // Sample group:
            const sampleGids = Array.from(groupVisitMap.keys()).slice(0, 3);
            for (const sg of sampleGids) {
              const rows = master.filter((r: any) => (r.Group_ID || r.group_id) === sg);
              console.log(`    Group "${sg}" rows (${rows.length}):`);
              for (const row of rows) {
                console.log(`      • Visit ${row.Visit_Num ?? row.visit_num}: Day=${row.Day || row.day} Slot=${row.Session || row.session || row.Time_Slot} Lab=${row.Lab_ID || row.lab_id} SlotKey=${row.Slot_Key || row.slot_key}`);
              }
            }
          }
        }
      }
    }
  }
}

main().catch(console.error);
