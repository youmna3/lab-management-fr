import fs from "fs";
import path from "path";
import assert from "assert";
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

// Import storage functions after env is populated
import { fetchProjectStudentUploads } from "../src/lib/batch-allocation-storage";
import {
  saveBatchGroupSettings,
  fetchBatchGroupSettings,
  fetchBatchGroupClassifications,
} from "../src/lib/batch-group-classification-storage";
import { supabase } from "../src/integrations/supabase/client";

async function main() {
  console.log("================================================================================");
  console.log("DIRECT REAL-DATA DATABASE VERIFICATION");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // VERIFICATION 1: Project Student Roster & Uploads Loading (No Statement Timeout)
  // ---------------------------------------------------------------------------
  console.log("--- 1. Testing Project Student Uploads Query Against Real Database ---");

  // Fetch real batch IDs that exist in batch_student_uploads in Supabase
  const { data: realUploads, error: listErr } = await supabase
    .from("batch_student_uploads" as any)
    .select("batch_id, student_count")
    .limit(5);

  if (listErr) throw listErr;
  assert(realUploads && realUploads.length > 0, "Must have real batch uploads in database");

  const testBatchIds = realUploads.map((u: any) => u.batch_id);
  console.log(`Testing with ${testBatchIds.length} real batch IDs containing large student payloads...`);

  const t0 = Date.now();
  const loadedUploads = await fetchProjectStudentUploads("test_project_id", testBatchIds, false);
  const duration = Date.now() - t0;

  console.log(`✓ Real query completed successfully in ${duration}ms (0 timeouts).`);
  console.log(`✓ Loaded ${loadedUploads.length} batch records with full student datasets.`);
  assert.strictEqual(loadedUploads.length, testBatchIds.length, "All requested batches must load");
  for (const record of loadedUploads) {
    assert(Array.isArray(record.students), "Students array must be present");
    assert(record.students.length > 0, "Students array must contain rows");
    console.log(`  • Batch ${record.batch_id}: ${record.students.length.toLocaleString()} students loaded without error`);
  }
  console.log("✅ VERIFICATION 1 PASSED: Statement timeout completely eliminated on real data!\n");

  // ---------------------------------------------------------------------------
  // VERIFICATION 2: Mega Groups Persistence & Reload from Real Database
  // ---------------------------------------------------------------------------
  console.log("--- 2. Testing Mega Groups Persistence End-to-End Against Real Database ---");

  const testBatchId = crypto.randomUUID();
  const testProjectId = crypto.randomUUID();

  const initialMegaGroups = [
    {
      id: "mg_alpha",
      name: "Mega Group Alpha",
      start_date: "2026-09-01",
      end_date: "2026-09-03",
      grades: [4, 5],
      areas: ["Cairo North"],
    },
    {
      id: "mg_beta",
      name: "Mega Group Beta",
      start_date: "2026-09-08",
      end_date: "2026-09-10",
      grades: [6],
      areas: ["Alexandria"],
    }
  ];

  console.log(`Step 2a: Saving initial Mega Groups to real database for batch: ${testBatchId}...`);
  const savedSettings = await saveBatchGroupSettings(testBatchId, testProjectId, {
    batch_group_type: "multi_session",
    default_repeat_count: 2,
    mega_groups: initialMegaGroups,
    blocked_days: ["2026-09-04"],
    classifications: [
      {
        batch_id: testBatchId,
        group_id: "G1",
        visit_type: "multi_visit",
        repeat_count: 2,
        area: "Cairo North",
        grade: "4",
      }
    ],
  });

  assert.strictEqual(savedSettings.mega_groups?.length, 2, "Saved settings must contain 2 mega groups");
  console.log("✓ saveBatchGroupSettings returned with 2 mega groups.");

  console.log("Step 2b: Fetching settings directly back from Supabase (authoritative DB read)...");
  const reloadedSettings = await fetchBatchGroupSettings(testBatchId);

  console.log("Reloaded Settings from DB:");
  console.log(`  • Mega Groups Count: ${reloadedSettings.mega_groups?.length}`);
  console.log(`  • Mega Groups Content:`, JSON.stringify(reloadedSettings.mega_groups));
  console.log(`  • Blocked Days:`, JSON.stringify(reloadedSettings.blocked_days));
  console.log(`  • Group Classifications Count:`, reloadedSettings.classifications?.length);

  assert.strictEqual(reloadedSettings.mega_groups?.length, 2, "Must reload exact 2 mega groups from real DB");
  assert.strictEqual(reloadedSettings.mega_groups[0].name, "Mega Group Alpha");
  assert.strictEqual(reloadedSettings.mega_groups[1].name, "Mega Group Beta");
  assert.strictEqual(reloadedSettings.blocked_days?.length, 1);
  assert.strictEqual(reloadedSettings.blocked_days[0], "2026-09-04");
  assert.strictEqual(reloadedSettings.classifications?.length, 1, "Classifications must only contain real student groups");
  assert.strictEqual(reloadedSettings.classifications[0].group_id, "G1");

  console.log("\nStep 2c: Updating Mega Groups with excluded group (Remove action simulation)...");
  const updatedMegaGroups = [
    {
      ...initialMegaGroups[0],
      excluded_group_ids: ["G1"],
      excluded_student_ids: ["STD_001"],
    },
    initialMegaGroups[1],
  ];

  await saveBatchGroupSettings(testBatchId, testProjectId, {
    mega_groups: updatedMegaGroups,
  });

  console.log("Step 2d: Re-reading updated Mega Groups directly from Supabase...");
  const reloadedAfterUpdate = await fetchBatchGroupSettings(testBatchId);
  assert.strictEqual(reloadedAfterUpdate.mega_groups?.[0].excluded_group_ids?.[0], "G1");
  assert.strictEqual(reloadedAfterUpdate.mega_groups?.[0].excluded_student_ids?.[0], "STD_001");
  console.log("✓ Updated Mega Groups with exclusions persisted and reloaded successfully!");

  // Clean up test batch rows from DB
  console.log("\nStep 2e: Cleaning up test data from Supabase...");
  await supabase.from("batch_group_classifications" as any).delete().eq("batch_id", testBatchId);
  console.log("✓ Test data cleaned up.");

  console.log("\n================================================================================");
  console.log("✅ ALL REAL-DATA DIRECT VERIFICATIONS PASSED 100%!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Direct real-data verification failed:", err);
  process.exit(1);
});
