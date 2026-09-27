import fs from "fs";
import path from "path";

// Load .env
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

import { supabase } from "../src/integrations/supabase/client";

async function main() {
  console.log("=== INSPECTING ALL BATCHES AND STORED ALLOCATION OUTPUTS IN DATABASE ===\n");

  // 1. Fetch all batches
  const { data: batches, error: bErr } = await supabase
    .from("batches")
    .select("*");
  if (bErr) throw bErr;

  console.log(`Found ${batches?.length || 0} batches:`);
  for (const b of batches || []) {
    console.log(`- Batch ID: ${b.id} | Name: "${b.name}" | Project: ${b.project_id} | Expected Sessions: ${b.expected_sessions_per_group} | Updated: ${b.updated_at}`);
  }

  // 2. Fetch all stored batch_allocation_outputs
  const { data: outputs, error: oErr } = await supabase
    .from("batch_allocation_outputs" as any)
    .select("batch_id, updated_at, summary");
  if (oErr) console.warn("Error fetching batch_allocation_outputs:", oErr);

  console.log(`\nFound ${outputs?.length || 0} batch allocation output records:`);
  for (const o of outputs || []) {
    console.log(`- Output Batch ID: ${o.batch_id} | Updated: ${o.updated_at} | Summary:`, JSON.stringify(o.summary));
  }

  // 3. For each output record, inspect if it contains L556 / Grade 4 rows in master_allocation
  for (const o of outputs || []) {
    const { data: fullOut, error: fErr } = await supabase
      .from("batch_allocation_outputs" as any)
      .select("batch_id, master_allocation, preferences_applied, summary")
      .eq("batch_id", o.batch_id)
      .single();

    if (fErr || !fullOut) continue;

    const master = fullOut.master_allocation || [];
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`Inspecting master_allocation for Batch ${o.batch_id} (${master.length} total rows)...`);
    console.log(`Preferences Applied:`, JSON.stringify(fullOut.preferences_applied));

    // Filter for L556 and Grade 4
    const l556Grade4Rows = master.filter((r: any) => {
      const lab = String(r.Lab_ID ?? r["Lab ID"] ?? "");
      const grade = Number(r.Grade);
      return lab.includes("556") || lab.toLowerCase().includes("l556") || grade === 4;
    });

    console.log(`Found ${l556Grade4Rows.length} rows matching L556 / Grade 4 in Batch ${o.batch_id}`);

    // Filter specifically for Lab L556
    const exactL556 = master.filter((r: any) => {
      const lab = String(r.Lab_ID ?? r["Lab ID"] ?? "");
      return lab.includes("556") || lab.toLowerCase().includes("l556");
    });
    console.log(`Total rows specifically for Lab L556: ${exactL556.length}`);
    if (exactL556.length > 0) {
      console.log(`Sample rows for Lab L556:`);
      for (const r of exactL556.slice(0, 15)) {
        console.log(`  • S_ID: ${r.S_ID}, Group_ID: ${r.Group_ID}, Grade: ${r.Grade}, Lab_ID: ${r.Lab_ID}, Day: ${r.Day}, Time_Slot: ${r.Time_Slot}, Visit_Num: ${r.Visit_Num}, Repeat_Count: ${r.Repeat_Count}, Visit_Type: ${r.Visit_Type}, Mega_Group: ${r.Mega_Group}`);
      }
    }

    // Look for 13 Sept 10:00 AM and 14 Sept 10:00 AM
    const sept13_14 = master.filter((r: any) => {
      const slot = String(r.Time_Slot ?? "");
      const day = String(r.Day ?? "");
      return (slot.includes("13 Sept") || slot.includes("14 Sept") || day.includes("13") || day.includes("14")) && (slot.includes("10:00") || slot.includes("10"));
    });
    console.log(`Rows matching 13/14 Sept 10:00 AM: ${sept13_14.length}`);
    for (const r of sept13_14.slice(0, 15)) {
      console.log(`  • S_ID: ${r.S_ID}, Group_ID: ${r.Group_ID}, Grade: ${r.Grade}, Lab_ID: ${r.Lab_ID}, Day: ${r.Day}, Time_Slot: ${r.Time_Slot}, Visit_Num: ${r.Visit_Num}, Repeat_Count: ${r.Repeat_Count}`);
    }
  }
}

main().catch(console.error);
