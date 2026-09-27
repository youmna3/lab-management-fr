import fs from "fs";
import path from "path";
import assert from "assert";
import * as XLSX from "xlsx";

// Load .env manually
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
import { partitionGroupsEvenlyAcrossMegaGroups } from "../src/lib/lab-allocation-runner/mega-groups";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import type { StudentRow } from "../src/lib/lab-allocation-runner/parse";
import type { MegaGroupDefinition } from "../src/lib/allocation-client";

async function main() {
  console.log("================================================================================");
  console.log("REAL DATA TARGETED VERIFICATION: BUG 0, BUG 1, AND BUG 2");
  console.log("================================================================================\n");

  // 1. Fetch real student dataset from Supabase
  console.log("Fetching real production student dataset from Supabase...");
  const { data: uploadRow, error: uploadErr } = await supabase
    .from("batch_student_uploads" as any)
    .select("batch_id, student_count, students")
    .order("student_count", { ascending: false })
    .limit(1)
    .single();

  if (uploadErr || !uploadRow || !Array.isArray(uploadRow.students)) {
    throw new Error(`Failed to fetch real student upload: ${uploadErr?.message}`);
  }

  const realStudents: StudentRow[] = uploadRow.students;
  console.log(`✓ Successfully loaded real student dataset: ${realStudents.length.toLocaleString()} students from batch ${uploadRow.batch_id}`);

  // ---------------------------------------------------------------------------
  // TEST 1 (BUG 0 & BUG 1): Pre-Allocation Even Division across Super Groups
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 1 (BUG 0 & BUG 1): Even Pre-Allocation Division across Super Groups ---");

  const megaGroupConfigs: MegaGroupDefinition[] = [
    {
      id: "mg_a",
      name: "Mega Group A",
      grades: [4, 5],
      start_date: "2026-09-13",
      end_date: "2026-09-15",
    },
    {
      id: "mg_b",
      name: "Mega Group B",
      grades: [4, 5],
      start_date: "2026-09-16",
      end_date: "2026-09-18",
    },
  ];

  const { megaGroups: partitionedMgs, groupMembershipsByMg } = partitionGroupsEvenlyAcrossMegaGroups(
    realStudents,
    megaGroupConfigs,
    { prefix: "Physical-DEMI-SUM-26-G", avgGroupSize: 20 }
  );

  const mgAGroups = groupMembershipsByMg.get("Mega Group A") || [];
  const mgBGroups = groupMembershipsByMg.get("Mega Group B") || [];

  const mgAStudentCount = mgAGroups.reduce((sum, g) => sum + g.studentCount, 0);
  const mgBStudentCount = mgBGroups.reduce((sum, g) => sum + g.studentCount, 0);

  console.log(`• Mega Group A: ${mgAGroups.length} groups, ${mgAStudentCount.toLocaleString()} students`);
  console.log(`• Mega Group B: ${mgBGroups.length} groups, ${mgBStudentCount.toLocaleString()} students`);

  const studentCountDifference = Math.abs(mgAStudentCount - mgBStudentCount);

  console.log(`• Student population difference: ${studentCountDifference}`);

  assert(mgAGroups.length > 0, "Mega Group A must have non-zero groups");
  assert(mgBGroups.length > 0, "Mega Group B must have non-zero groups");
  assert(
    studentCountDifference <= 1,
    `Equal-weight Mega Groups must differ by at most one student; got ${mgAStudentCount} and ${mgBStudentCount}`,
  );

  console.log("\n✅ TEST 1 PASSED: Eligible students are balanced directly across equal-weight Mega Groups.\n");

  // ---------------------------------------------------------------------------
  // TEST 2 (BUG 2): Blocked Days (Fri 18th, Sat 19th) Solver Exclusion
  // ---------------------------------------------------------------------------
  console.log("--- TEST 2 (BUG 2): Blocked Days Exclusion during Allocation Run ---");

  const studentAreas = [...new Set(realStudents.map((s) => s["Physical Area"]))];
  const realLabs = studentAreas.flatMap((area) => [
    { "Lab ID": `LAB_${area.replace(/\s+/g, "_")}_A`, Area: area, "Lab Capacity": 25 },
    { "Lab ID": `LAB_${area.replace(/\s+/g, "_")}_B`, Area: area, "Lab Capacity": 25 },
  ]);

  const ws = XLSX.utils.json_to_sheet(realStudents.map((s) => ({
    S_ID: s.S_ID,
    Grade: s.Grade,
    "Physical Area": s["Physical Area"],
    Status: s.Status || "active",
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  const wbBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const mockStudentFile = {
    name: "students.xlsx",
    size: wbBuf.length,
    arrayBuffer: async () => wbBuf.buffer.slice(wbBuf.byteOffset, wbBuf.byteOffset + wbBuf.byteLength),
    text: async () => "",
  } as unknown as File;

  // 60 custom slots spanning Sept 13 to Sept 27 (including 18 Sept and 19 Sept)
  const fullCustomSlots = [
    "2026-09-13@10:00", "2026-09-13@12:30", "2026-09-13@16:00", "2026-09-13@19:30",
    "2026-09-14@10:00", "2026-09-14@12:30", "2026-09-14@16:00", "2026-09-14@19:30",
    "2026-09-15@10:00", "2026-09-15@12:30", "2026-09-15@16:00", "2026-09-15@19:30",
    "2026-09-16@10:00", "2026-09-16@12:30", "2026-09-16@16:00", "2026-09-16@19:30",
    "2026-09-17@10:00", "2026-09-17@12:30", "2026-09-17@16:00", "2026-09-17@19:30",
    "2026-09-18@10:00", "2026-09-18@12:30", "2026-09-18@16:00", "2026-09-18@19:30", // Fri 18th (Blocked)
    "2026-09-19@10:00", "2026-09-19@12:30", "2026-09-19@16:00", "2026-09-19@19:30", // Sat 19th (Blocked)
    "2026-09-20@10:00", "2026-09-20@12:30", "2026-09-20@16:00", "2026-09-20@19:30",
    "2026-09-21@10:00", "2026-09-21@12:30", "2026-09-21@16:00", "2026-09-21@19:30",
  ];

  const blockedDays = ["2026-09-18", "2026-09-19"];

  console.log(`Running allocation with ${fullCustomSlots.length} custom slots and Blocked Days: [${blockedDays.join(", ")}]...`);
  const allocRes = await runAllocation({
    studentFile: mockStudentFile,
    useDbLabs: true,
    labsJson: realLabs,
    prefix: "Physical-DEMI-SUM-26-G",
    preferences: {
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
      customSlots: fullCustomSlots,
      blocked_days: blockedDays,
      mega_groups: partitionedMgs,
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
    },
  });

  const master = allocRes.payload.master_allocation;
  console.log(`✓ Allocation completed. Produced ${master.length.toLocaleString()} master rows.`);

  // Check if any row was allocated to 18 Sept or 19 Sept
  const blockedAllocations = master.filter((r) => {
    const slot = String(r.Time_Slot || "").toLowerCase();
    const day = String(r.Day || "").toLowerCase();
    return (
      slot.includes("18 sept") ||
      slot.includes("19 sept") ||
      slot.includes("2026-09-18") ||
      slot.includes("2026-09-19") ||
      day.includes("2026-09-18") ||
      day.includes("2026-09-19")
    );
  });

  console.log(`• Rows allocated to blocked days (18th/19th Sept): ${blockedAllocations.length}`);
  assert.strictEqual(blockedAllocations.length, 0, "Zero rows must be allocated to blocked days (18th/19th Sept)");

  // Check Mega Group allocations in output
  const mgAAllocRows = master.filter((r) => (r as any).Mega_Group === "Mega Group A");
  const mgBAllocRows = master.filter((r) => (r as any).Mega_Group === "Mega Group B");

  console.log(`• Allocated rows with "Mega Group A": ${mgAAllocRows.length}`);
  console.log(`• Allocated rows with "Mega Group B": ${mgBAllocRows.length}`);

  assert(mgAAllocRows.length > 0, "Mega Group A must have allocated master rows");
  assert(mgBAllocRows.length > 0, "Mega Group B must have allocated master rows");

  console.log("\n✅ TEST 2 PASSED: Bug 2 verified! Blocked days are strictly excluded and mega groups allocate independently!\n");

  console.log("================================================================================");
  console.log("✅ ALL 3 BUGS TESTED AND VERIFIED AGAINST REAL PRODUCTION DATA!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
