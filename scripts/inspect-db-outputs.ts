import fs from "fs";
import path from "path";

// Load .env
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

import { supabase } from "../src/integrations/supabase/client";

async function main() {
  const { data: outputs, error } = await supabase
    .from("batch_allocation_outputs" as any)
    .select("batch_id, preferences_applied, master_allocation, updated_at");
  if (error) {
    console.error("Fetch error:", error);
    return;
  }

  for (const o of outputs || []) {
    console.log("================================================================================");
    console.log(`BATCH ID: ${o.batch_id} (Updated: ${o.updated_at})`);
    console.log(`PREFERENCES:`, JSON.stringify(o.preferences_applied, null, 2));
    const master = o.master_allocation || [];
    console.log(`Total Master Rows: ${master.length}`);

    // Filter rows for Lab L556
    const l556 = master.filter((r: any) => String(r.Lab_ID || r["Lab ID"] || "").toUpperCase().includes("L556") || String(r.Lab_ID || r["Lab ID"] || "").includes("556"));
    console.log(`Total L556 Rows: ${l556.length}`);

    // Group by Day and Time_Slot
    const bySlot: Record<string, any[]> = {};
    for (const r of l556) {
      const key = `${r.Day || r.Date || ""} @ ${r.Time_Slot || r.Slot || ""}`;
      if (!bySlot[key]) bySlot[key] = [];
      bySlot[key].push(r);
    }

    for (const [slotKey, rows] of Object.entries(bySlot)) {
      const gIds = [...new Set(rows.map((r: any) => r.Group_ID || r.group_id))];
      const visitNums = [...new Set(rows.map((r: any) => r.Visit_Num || r.visit_num))];
      const repeatCounts = [...new Set(rows.map((r: any) => r.Repeat_Count || r.repeat_count))];
      const megaGroups = [...new Set(rows.map((r: any) => r.Mega_Group || r.mega_group))];
      const grades = [...new Set(rows.map((r: any) => r.Grade || r.grade))];
      console.log(`\n  Slot: [${slotKey}]`);
      console.log(`    - Count of Students: ${rows.length}`);
      console.log(`    - Grades: ${JSON.stringify(grades)}`);
      console.log(`    - Group_IDs: ${JSON.stringify(gIds)}`);
      console.log(`    - Visit_Nums: ${JSON.stringify(visitNums)}`);
      console.log(`    - Repeat_Counts: ${JSON.stringify(repeatCounts)}`);
      console.log(`    - Mega_Groups: ${JSON.stringify(megaGroups)}`);
      console.log(`    - Sample row:`, {
        S_ID: rows[0].S_ID || rows[0].student_id,
        Group_ID: rows[0].Group_ID || rows[0].group_id,
        Lab_ID: rows[0].Lab_ID || rows[0].lab_id,
        Grade: rows[0].Grade || rows[0].grade,
        Time_Slot: rows[0].Time_Slot || rows[0].slot,
        Day: rows[0].Day || rows[0].day,
        Visit_Num: rows[0].Visit_Num,
        Repeat_Count: rows[0].Repeat_Count,
        Visit_Type: rows[0].Visit_Type,
        Mega_Group: rows[0].Mega_Group
      });
    }
  }
}

main().catch(console.error);
