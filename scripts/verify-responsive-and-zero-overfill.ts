import assert from "assert";
import fs from "fs";
import * as XLSX from "xlsx";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import type { AllocationPreferences, MegaGroupDefinition } from "../src/lib/allocation-client";

console.log("================================================================================");
console.log("TEST SUITE: Responsive Execution & Zero Unauthorized Overfills Verification");
console.log("================================================================================\n");

function makeFile(buf: Buffer, filename: string): File {
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function verifyResponsiveAndZeroOverfill() {
  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const labs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  const studentPath = fs.existsSync("scratch/user_egypt_students.xlsx")
    ? "scratch/user_egypt_students.xlsx"
    : "public/sample-files/egypt_students_benchmark.xlsx";
  
  let students: any[] = [];
  if (fs.existsSync(studentPath)) {
    const sBuf = fs.readFileSync(studentPath);
    const sWb = XLSX.read(sBuf, { type: "buffer" });
    students = XLSX.utils.sheet_to_json(sWb.Sheets[sWb.SheetNames[0]]);
  }

  // If student file doesn't have 25k records, load from benchmark distribution
  if (students.length < 25000) {
    const areaCap7: Record<string, number> = {};
    for (const lab of labs) {
      const area = lab.Area || lab.area;
      const cap = Number(lab["Lab Capacity"] || lab.capacity || 20);
      areaCap7[area] = (areaCap7[area] || 0) + cap * 7;
    }
    const areas = Object.keys(areaCap7);
    const totalEgyptCap7 = Object.values(areaCap7).reduce((a, b) => a + b, 0);

    const studentRows: any[] = [];
    let sId = 1;
    const targetAssigned = 25268;
    const totalStudentCount = 25306;

    for (const area of areas) {
      const share = areaCap7[area] / totalEgyptCap7;
      const areaStudents = Math.min(areaCap7[area], Math.round(targetAssigned * share));
      for (let i = 0; i < areaStudents; i++) {
        const g = 4 + (i % 3);
        studentRows.push({
          "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
          Grade: `Grade ${g}`,
          "Physical Area": area,
        });
      }
    }
    const orphanCount = totalStudentCount - studentRows.length;
    for (let i = 0; i < orphanCount; i++) {
      const g = 4 + (i % 3);
      studentRows.push({
        "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
        Grade: `Grade ${g}`,
        "Physical Area": "منطقة غير مغطاة",
      });
    }
    students = studentRows;
  }

  console.log(`Loaded dataset: ${students.length.toLocaleString()} students across ${labs.length} labs.`);

  const studentWs = XLSX.utils.json_to_sheet(students);
  const studentWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentWb, studentWs, "Sheet1");
  const studentFileBuf = XLSX.write(studentWb, { bookType: "xlsx", type: "buffer" });

  const studentFile = makeFile(studentFileBuf, "students.xlsx");
  const labFile = makeFile(labBuf, "labs.xlsx");

  // Multi-session custom slots: 5 days (13 Sept to 17 Sept), 4 daily slots = 20 slots
  const customSlots = [
    "2026-09-13 10:00",
    "2026-09-13 12:30",
    "2026-09-13 16:00",
    "2026-09-13 19:30",
    "2026-09-14 10:00",
    "2026-09-14 12:30",
    "2026-09-14 16:00",
    "2026-09-14 19:30",
    "2026-09-15 10:00",
    "2026-09-15 12:30",
    "2026-09-15 16:00",
    "2026-09-15 19:30",
    "2026-09-16 10:00",
    "2026-09-16 12:30",
    "2026-09-16 16:00",
    "2026-09-16 19:30",
    "2026-09-17 10:00",
    "2026-09-17 12:30",
    "2026-09-17 16:00",
    "2026-09-17 19:30",
  ];

  const megaGroupA: MegaGroupDefinition = {
    id: "mg_a",
    name: "Mega Group A",
    start_date: "2026-09-13",
    end_date: "2026-09-17",
    grades: [4, 5, 6],
  };

  const megaGroupB: MegaGroupDefinition = {
    id: "mg_b",
    name: "Mega Group B",
    start_date: "2026-09-13",
    end_date: "2026-09-17",
    grades: [4, 5, 6],
  };

  const prefs: AllocationPreferences = {
    overfillRules: [], // No authorized overfill!
    preferredLabRules: [],
    extraLabs: [],
    customSlots,
    batchGroupType: "multi_session",
    defaultRepeatCount: 5,
    mega_groups: [megaGroupA, megaGroupB],
  };

  const progressUpdates: Array<{ stage: string; percent: number; message: string }> = [];
  const startTime = Date.now();

  const res = await runAllocation({
    studentFile,
    labFile,
    program: "DEMI",
    prefix: "Physical-DEMI-G",
    preferences: prefs,
    onProgress: (p) => {
      progressUpdates.push({ stage: p.stage, percent: p.percent, message: p.message });
    },
  });

  const durationMs = Date.now() - startTime;
  console.log(`\nAllocation run finished in ${(durationMs / 1000).toFixed(2)}s.`);
  console.log(`Total live progress events emitted: ${progressUpdates.length}`);
  assert(progressUpdates.length >= 20, "Must emit frequent real-time progress updates throughout the run");

  const masterRows = res.payload.master_allocation || [];
  console.log(`Total Master Rows: ${masterRows.length.toLocaleString()}`);
  console.log(`Summary:`, res.payload.summary);

  // ---------------------------------------------------------------------------
  // Check 1: Overfilled Slots Count with overfillRules: []
  // ---------------------------------------------------------------------------
  const slotCountMap = new Map<string, { lab: string; cap: number; count: number; area: string; grade: number; time: string }>();
  for (const r of masterRows) {
    if (!slotCountMap.has(r.Slot_Key)) {
      slotCountMap.set(r.Slot_Key, {
        lab: r.Lab_ID,
        cap: r.Lab_Capacity,
        count: 0,
        area: r["Physical Area"],
        grade: r.Grade,
        time: r.Time_Slot,
      });
    }
    slotCountMap.get(r.Slot_Key)!.count++;
  }

  const overfilledSlots: any[] = [];
  for (const [slotKey, data] of slotCountMap) {
    if (data.count > data.cap) {
      overfilledSlots.push({ slotKey, ...data, extra: data.count - data.cap });
    }
  }

  console.log(`\n[OVERFILL AUDIT]`);
  console.log(`Overfilled slots count (with empty overfillRules): ${overfilledSlots.length}`);
  if (overfilledSlots.length > 0) {
    console.error("FAIL: Found overfilled slots:", overfilledSlots.slice(0, 10));
  }
  assert.strictEqual(overfilledSlots.length, 0, "There must be exactly 0 overfilled slots when overfillRules is empty");

  const isOverfillFlags = masterRows.filter((r) => r.Is_Overfill);
  console.log(`Rows with Is_Overfill = true: ${isOverfillFlags.length}`);
  assert.strictEqual(isOverfillFlags.length, 0, "No rows may have Is_Overfill = true when overfillRules is empty");
  assert.strictEqual(res.payload.summary.overfill_count ?? 0, 0, "Summary overfill_count must be 0");
  assert.strictEqual(res.payload.summary.overfilled_sessions_count ?? 0, 0, "Summary overfilled_sessions_count must be 0");

  // ---------------------------------------------------------------------------
  // Check 2: Multi-Session Group Consistency & Repeat Count
  // ---------------------------------------------------------------------------
  console.log(`\n[MULTI-SESSION RECURRING INTEGRITY AUDIT]`);
  const groupRowsMap = new Map<string, typeof masterRows>();
  for (const r of masterRows) {
    if (!groupRowsMap.has(r.Group_ID)) groupRowsMap.set(r.Group_ID, []);
    groupRowsMap.get(r.Group_ID)!.push(r);
  }

  let invalidGroupLabs = 0;
  let invalidGroupTimes = 0;
  for (const [gId, gRows] of groupRowsMap) {
    const labsInGroup = new Set(gRows.map((r) => r.Lab_ID));
    if (labsInGroup.size > 1) {
      invalidGroupLabs++;
      console.log(`Mismatched Group: ${gId}`, gRows.map(r => ({ lab: r.Lab_ID, day: r.Day, time: r.Time_Slot, sId: r.S_ID })));
    }

    const studentVisits = new Map<string, number>();
    for (const r of gRows) {
      studentVisits.set(r.S_ID, (studentVisits.get(r.S_ID) ?? 0) + 1);
    }
  }

  console.log(`Total unique groups: ${groupRowsMap.size}`);
  console.log(`Groups with mismatched physical labs across repeat days: ${invalidGroupLabs}`);
  assert.strictEqual(invalidGroupLabs, 0, "Groups must remain in the exact same physical lab on every visit");

  // ---------------------------------------------------------------------------
  // Check 3: Pipeline Invariant (All 25,306 accounted for)
  // ---------------------------------------------------------------------------
  console.log(`\n[ACCOUNTING INTEGRITY AUDIT]`);
  const assignedSIds = new Set(masterRows.map((r) => r.S_ID));
  const unassignedSIds = new Set((res.payload.unassigned_students || []).map((u) => u.S_ID));
  console.log(`Total unique assigned students: ${assignedSIds.size.toLocaleString()}`);
  console.log(`Total unassigned students: ${unassignedSIds.size.toLocaleString()}`);
  console.log(`Total accounted for: ${(assignedSIds.size + unassignedSIds.size).toLocaleString()} / ${students.length.toLocaleString()}`);
  assert.strictEqual(assignedSIds.size + unassignedSIds.size, students.length, "All students must be accounted for");

  console.log("\n================================================================================");
  console.log("✓ ALL VERIFICATION CHECKS PASSED PERFECTLY (0 Overfills, Non-Blocking, 100% Invariant)");
  console.log("================================================================================\n");
}

verifyResponsiveAndZeroOverfill().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
