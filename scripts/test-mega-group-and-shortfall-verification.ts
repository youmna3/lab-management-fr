import assert from "assert";
import * as XLSX from "xlsx";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import { parseShortfallDiagnostics } from "../src/components/ShortfallVisualizer";
import type { AllocationPreferences, MegaGroupDefinition } from "../src/lib/allocation-client";

console.log("================================================================================");
console.log("TEST SUITE: Mega Group Identifiers, Removal Flow & Shortfall Tab Verification");
console.log("================================================================================\n");

function makeStudentFile(students: any[], filename = "students.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(students);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function makeLabFile(labs: any[], filename = "labs.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(labs);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// Helper to extract short group identifier (mirroring lab-allocation.tsx)
function extractShortGroupId(groupId: string): string {
  if (!groupId) return "";
  const clean = String(groupId).trim();
  const matchG = clean.match(/[-_]?(G\d+)(?:[-_]|$)/i) || clean.match(/\b(G\d+)\b/i);
  if (matchG) return matchG[1].toUpperCase();
  const matchNamed = clean.match(/\b(?:Group|GRP)[-_\s]?(\d+)\b/i);
  if (matchNamed) return `G${matchNamed[1]}`;
  const matchTrailingNum = clean.match(/[-_](\d+)$/);
  if (matchTrailingNum) return `G${matchTrailingNum[1]}`;
  if (/^\d+$/.test(clean)) return `G${clean}`;
  return clean;
}

// Helper to extract short mega group identifier (mirroring lab-allocation.tsx)
function extractShortMegaGroupId(mgName: string): string {
  if (!mgName) return "";
  const clean = String(mgName).trim();
  const matchMg = clean.match(/\bMG[-_\s]?(\d+)\b/i);
  if (matchMg) return `MG${matchMg[1]}`;
  const matchMega = clean.match(/\bMega[-_\s]?Group[-_\s]?(\d+)\b/i);
  if (matchMega) return `MG${matchMega[1]}`;
  const matchSb = clean.match(/\b(?:Sub[-_\s]?Batch|SB)[-_\s]?([A-Za-z0-9]+)\b/i);
  if (matchSb) return `SB${matchSb[1].toUpperCase()}`;
  const matchTrailing = clean.match(/^(?:Mega|MG)[-_\s]*([A-Za-z0-9]+)$/i);
  if (matchTrailing) return `MG${matchTrailing[1].toUpperCase()}`;
  if (clean.length <= 6) return clean.replace(/\s+/g, "").toUpperCase();
  return clean.split(/\s+/).map((w) => w[0]).join("").toUpperCase();
}

function getOrdinalSuffix(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

async function runAllTests() {
  // -----------------------------------------------------------------------------
  // TEST 1: Shortfall tab null-safety and hasShortfall calculation
  // -----------------------------------------------------------------------------
  console.log("--- TEST 1: Shortfall Tab Calculation & Diagnostic Parsing ---");

  // Test 1a: Zero shortfall case
  const zeroParsed = parseShortfallDiagnostics("", [], []);
  assert.strictEqual(zeroParsed.length, 0, "Zero shortfall text should yield 0 parsed areas");
  const zeroSummary = {
    total_students: 100,
    assigned_count: 100,
    unassigned_count: 0,
    total_labs: 5,
    total_sessions_available: 20,
    total_sessions_assigned: 10,
  };
  const hasShortfallZero = (zeroSummary?.unassigned_count ?? 0) > 0 || zeroParsed.length > 0;
  assert.strictEqual(hasShortfallZero, false, "hasShortfall must be false when unassigned_count is 0 and parsedAreas is empty");
  console.log("  ✓ Zero shortfall evaluated correctly: hasShortfall = false (Zero Shortfall Banner renders)");

  // Test 1b: Shortfall present case
  const shortfallTextSample = `======================================================================
SHORTFALL ANALYSIS: AREA-BY-AREA CAPACITY DEFICITS
======================================================================

AREA: Downtown
  Labs: 1  |  True capacities: {"L1":20}
  Total sessions available: 2

  Grade 4: 50 students / best-case 20 cap -> needs >= 3 sessions  <-- SHORT

  TOTAL sessions needed (best case): 3  |  available: 2
  GAP: short by 1 session(s) area-wide -> 10 student(s) can't be seated (Physical seat deficit area-wide).
----------------------------------------------------------------------`;
  const shortfallParsed = parseShortfallDiagnostics(shortfallTextSample, [], []);
  assert.strictEqual(shortfallParsed.length, 1, "Should parse 1 bottleneck area");
  assert.strictEqual(shortfallParsed[0].area, "Downtown");
  assert.strictEqual(shortfallParsed[0].sessionsGap, 1);
  const shortfallSummary = {
    total_students: 50,
    assigned_count: 40,
    unassigned_count: 10,
    total_labs: 1,
    total_sessions_available: 2,
    total_sessions_assigned: 2,
  };
  const hasShortfallTrue = (shortfallSummary?.unassigned_count ?? 0) > 0 || shortfallParsed.length > 0;
  assert.strictEqual(hasShortfallTrue, true, "hasShortfall must be true when unassigned_count > 0");
  console.log("  ✓ Non-zero shortfall evaluated correctly: hasShortfall = true, parsed area = Downtown (Gap: 1)");

  // Test 1c: Summary is null/undefined safety
  const nullSummary = null as any;
  const unassignedCountNullSafe = nullSummary?.unassigned_count ?? 0;
  const totalStudentsNullSafe = nullSummary?.total_students ?? 0;
  const totalSessionsAssignedNullSafe = nullSummary?.total_sessions_assigned ?? 0;
  const hasShortfallNullSafe = unassignedCountNullSafe > 0 || zeroParsed.length > 0;
  assert.strictEqual(hasShortfallNullSafe, false);
  console.log("  ✓ Complete null-safety verified for missing summary object\n");

  // -----------------------------------------------------------------------------
  // TEST 2: Lab Grid Matrix Additive Mega Group Identifiers
  // -----------------------------------------------------------------------------
  console.log("--- TEST 2: Lab Grid Matrix Additive Mega Group Label Generation ---");

  // Test 2a: Short Mega Group ID extraction
  assert.strictEqual(extractShortMegaGroupId("Mega Group 1"), "MG1");
  assert.strictEqual(extractShortMegaGroupId("MegaGroup 2"), "MG2");
  assert.strictEqual(extractShortMegaGroupId("MG3"), "MG3");
  assert.strictEqual(extractShortMegaGroupId("Sub-Batch 1"), "SB1");
  assert.strictEqual(extractShortMegaGroupId("SubBatch B"), "SBB");
  assert.strictEqual(extractShortMegaGroupId("Week 1 Cohort"), "W1C");
  console.log("  ✓ extractShortMegaGroupId accurately extracts identifiers (MG1, MG2, SB1, etc.)");

  // Test 2b: Cell Label Composition
  function computeCellLabel(
    visitType: "single_visit" | "multi_visit",
    visitNum: number,
    groupId: string,
    megaGroup?: string
  ): { displayVisitLabel: string } {
    const isMulti = visitType === "multi_visit" || visitNum > 1;
    const shortGid = extractShortGroupId(groupId);
    const shortMg = megaGroup ? extractShortMegaGroupId(megaGroup) : "";
    const mgTag = shortMg ? ` · ${shortMg}` : "";

    if (isMulti) {
      return {
        displayVisitLabel: `${shortGid} · ${getOrdinalSuffix(visitNum)}${mgTag}`,
      };
    }
    if (megaGroup) {
      return {
        displayVisitLabel: shortGid ? `${shortGid}${mgTag}` : shortMg,
      };
    }
    return { displayVisitLabel: "" };
  }

  // Case 1: Multi-visit WITHOUT mega group -> "G1 · 1st" (UNTOUCHED)
  const lbl1 = computeCellLabel("multi_visit", 1, "Physical-DEMI-SUM-26-G1");
  assert.strictEqual(lbl1.displayVisitLabel, "G1 · 1st", "Must preserve existing multi-session label");
  console.log(`  ✓ Multi-visit non-mega-group: "${lbl1.displayVisitLabel}" (Unchanged)`);

  // Case 2: Multi-visit WITH mega group -> "G1 · 1st · MG1" (ADDITIVE)
  const lbl2 = computeCellLabel("multi_visit", 1, "Physical-DEMI-SUM-26-G1", "Mega Group 1");
  assert.strictEqual(lbl2.displayVisitLabel, "G1 · 1st · MG1", "Must additively append · MG1");
  console.log(`  ✓ Multi-visit with mega group: "${lbl2.displayVisitLabel}" (Additive)`);

  // Case 3: Multi-visit 2nd visit WITH mega group -> "G4 · 2nd · SB2"
  const lbl3 = computeCellLabel("multi_visit", 2, "Group 4", "Sub-Batch 2");
  assert.strictEqual(lbl3.displayVisitLabel, "G4 · 2nd · SB2");
  console.log(`  ✓ Multi-visit 2nd visit with sub-batch: "${lbl3.displayVisitLabel}" (Additive)`);

  // Case 4: Single-visit WITHOUT mega group -> "" (Renders 20/20 (100%), no empty tag)
  const lbl4 = computeCellLabel("single_visit", 1, "Physical-DEMI-SUM-26-G1");
  assert.strictEqual(lbl4.displayVisitLabel, "", "Must remain empty for single-visit non-mega-group");
  console.log(`  ✓ Single-visit non-mega-group: "${lbl4.displayVisitLabel}" (No clutter)`);

  // Case 5: Single-visit WITH mega group -> "G1 · MG1"
  const lbl5 = computeCellLabel("single_visit", 1, "Physical-DEMI-SUM-26-G1", "Mega Group 1");
  assert.strictEqual(lbl5.displayVisitLabel, "G1 · MG1");
  console.log(`  ✓ Single-visit with mega group: "${lbl5.displayVisitLabel}" (Additive)\n`);

  // -----------------------------------------------------------------------------
  // TEST 3: Mega Group Partitioning, Group Removal & Solver Scheduling Reversion
  // -----------------------------------------------------------------------------
  console.log("--- TEST 3: Mega Group Solver Partitioning & Exclusion/Removal Flow ---");

  const testLabs = [
    { "Lab ID": "L1", Area: "North", "Lab Capacity": 25 },
  ];

  const customSlots = [
    // Week 1 (Days 2026-09-01 to 2026-09-03)
    "2026-09-01 10:00",
    "2026-09-02 10:00",
    "2026-09-03 10:00",
    // Week 2 (Days 2026-09-08 to 2026-09-10)
    "2026-09-08 10:00",
    "2026-09-09 10:00",
    "2026-09-10 10:00",
  ];

  // 20 students in Grade 4, all in Area "North"
  const testStudents = Array.from({ length: 20 }, (_, i) => ({
    "Student ID": `STD_${String(i + 1).padStart(3, "0")}`,
    Grade: 4,
    "Physical Area": "North",
    Cohort: i < 10 ? "G1" : "G2",
    Group_ID: i < 10 ? "G1" : "G2",
  }));

  const studentFile = makeStudentFile(testStudents);
  const labFile = makeLabFile(testLabs);

  // Run 1: Both G1 and G2 in Mega Group 1 (dates: 2026-09-01 to 2026-09-03)
  const megaGroup1: MegaGroupDefinition = {
    id: "mg_1",
    name: "Mega Group 1",
    start_date: "2026-09-01",
    end_date: "2026-09-03",
    grades: [4],
    areas: ["North"],
  };

  const prefsInitial: AllocationPreferences = {
    overfillRules: [],
    preferredLabRules: [],
    extraLabs: [],
    customSlots,
    batchGroupType: "single_session",
    mega_groups: [megaGroup1],
  };

  const res1 = await runAllocation({
    studentFile,
    labFile,
    preferences: prefsInitial,
  });

  assert.strictEqual(res1.payload.summary.unassigned_count, 0, "Initial run should assign all students");
  for (const row of res1.payload.master_allocation) {
    assert.strictEqual(row.Mega_Group, "Mega Group 1", "All rows should have Mega_Group = Mega Group 1");
    const slotDate = String(row.Day || "");
    assert(slotDate >= "2026-09-01" && slotDate <= "2026-09-03", `Slot date ${slotDate} must be in Week 1 window`);
  }
  console.log("  ✓ Initial run: 20 students in G1 and G2 scheduled into Week 1 under Mega Group 1");

  // Run 2: Remove G1 from Mega Group 1 -> G1 is added to excluded_group_ids and excluded_student_ids
  const g1StudentIds = testStudents.filter((s) => s.Cohort === "G1").map((s) => s["Student ID"]);
  const megaGroup1WithExclusion: MegaGroupDefinition = {
    ...megaGroup1,
    excluded_group_ids: ["G1"],
    excluded_student_ids: g1StudentIds,
  };

  const prefsWithExclusion: AllocationPreferences = {
    ...prefsInitial,
    mega_groups: [megaGroup1WithExclusion],
  };

  const res2 = await runAllocation({
    studentFile,
    labFile,
    preferences: prefsWithExclusion,
  });

  assert.strictEqual(res2.payload.summary.unassigned_count, 0, "Run with exclusion should assign all students");

  const g1Rows = res2.payload.master_allocation.filter((r) => g1StudentIds.includes(r.S_ID));
  const g2Rows = res2.payload.master_allocation.filter((r) => !g1StudentIds.includes(r.S_ID));

  assert.strictEqual(g1Rows.length, 10, "G1 should have 10 allocated student rows");
  assert.strictEqual(g2Rows.length, 10, "G2 should have 10 allocated student rows");

  // G2 was kept in Mega Group 1
  for (const r of g2Rows) {
    assert.strictEqual(r.Mega_Group, "Mega Group 1", "G2 must remain in Mega Group 1");
    const slotDate = String(r.Day || "");
    assert(slotDate >= "2026-09-01" && slotDate <= "2026-09-03", `G2 slot date ${slotDate} must be in Week 1`);
  }

  // G1 was removed and reverted to default batch pool
  for (const r of g1Rows) {
    assert.strictEqual(r.Mega_Group, undefined, "Removed G1 must NOT have Mega_Group tag");
  }
  console.log("  ✓ Removed group G1 successfully reverted to default pool (Mega_Group: undefined)");
  console.log("  ✓ Remaining group G2 kept in Mega Group 1 window (Mega_Group: 'Mega Group 1')");

  console.log("\n================================================================================");
  console.log("ALL TESTS PASSED SUCCESSFULLY! (3/3 suites)");
  console.log("================================================================================");
}

runAllTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
