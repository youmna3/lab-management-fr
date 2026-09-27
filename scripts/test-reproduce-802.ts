import fs from "fs";
import { loadLabCapacity, type StudentRow } from "../src/lib/lab-allocation-runner/parse";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";

async function main() {
  const studentsRaw = JSON.parse(fs.readFileSync("scratch/real_25304_students.json", "utf-8")) as StudentRow[];
  console.log(`Loaded ${studentsRaw.length} real students`);

  const labBuf = fs.readFileSync("public/sample-files/egypt_labs_benchmark.xlsx");
  const labs = await loadLabCapacity(new File([labBuf], "egypt_labs_benchmark.xlsx"));
  console.log(`Loaded ${labs.length} benchmark labs`);

  // Define candidate test cases
  const testCases: Array<{
    name: string;
    customSlots: string[];
    mega_groups?: any[];
    blocked_days?: string[];
    repeatCount: number;
    batchGroupType?: "single_session" | "multi_session";
  }> = [];

  // Case 1: 5-day week (20 slots: 13-17 Sept), repeat=2
  const week1Days = ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];
  const week2Days = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
  const times = ["10:00", "12:30", "16:00", "19:30"];

  const week1Slots: string[] = [];
  for (const d of week1Days) for (const t of times) week1Slots.push(`${d}@${t}`);

  const week2Slots: string[] = [];
  for (const d of week2Days) for (const t of times) week2Slots.push(`${d}@${t}`);

  const all40Slots = [...week1Slots, ...week2Slots];

  // Config A: Two mega groups with 40 slots, repeat = 2
  testCases.push({
    name: "2 Mega Groups across 2 weeks (40 slots), repeatCount=2",
    customSlots: all40Slots,
    repeatCount: 2,
    batchGroupType: "multi_session",
    mega_groups: [
      { name: "Mega Group A", dates: week1Days, grades: [], areas: [], time_slots: [] },
      { name: "Mega Group B", dates: week2Days, grades: [], areas: [], time_slots: [] }
    ]
  });

  // Config B: Two mega groups with 40 slots, repeatCount=3
  testCases.push({
    name: "2 Mega Groups across 2 weeks (40 slots), repeatCount=3",
    customSlots: all40Slots,
    repeatCount: 3,
    batchGroupType: "multi_session",
    mega_groups: [
      { name: "Mega Group A", dates: week1Days, grades: [], areas: [], time_slots: [] },
      { name: "Mega Group B", dates: week2Days, grades: [], areas: [], time_slots: [] }
    ]
  });

  // Config C: Single 5-day week (20 slots), repeatCount=2
  testCases.push({
    name: "Single 5-day week (20 slots), repeatCount=2, no mega groups",
    customSlots: week1Slots,
    repeatCount: 2,
    batchGroupType: "multi_session"
  });

  // Config D: Single 5-day week (20 slots), repeatCount=3, no mega groups
  testCases.push({
    name: "Single 5-day week (20 slots), repeatCount=3, no mega groups",
    customSlots: week1Slots,
    repeatCount: 3,
    batchGroupType: "multi_session"
  });

  // Config E: 7 slots (standard single week), repeatCount=1
  testCases.push({
    name: "7 slots, single_session",
    customSlots: [
      "2026-09-10@10:00", "2026-09-10@12:30", "2026-09-10@16:00", "2026-09-10@19:30",
      "2026-09-11@10:00", "2026-09-11@16:00", "2026-09-11@19:30"
    ],
    repeatCount: 1,
    batchGroupType: "single_session"
  });

  // Convert students to CSV text for studentFile
  const csvHeader = "S_ID,Grade,Physical Area\n";
  const csvBody = studentsRaw.map((s) => `"${s.S_ID}",${s.Grade},"${s["Physical Area"]}"`).join("\n");
  const studentFile = new File([csvHeader + csvBody], "students.csv");
  const labFile = new File([labBuf], "egypt_labs_benchmark.xlsx");

  for (const tc of testCases) {
    console.log(`\n======================================================`);
    console.log(`RUNNING TEST CASE: ${tc.name}`);
    const res = await runAllocation({
      studentFile,
      labFile,
      preferences: {
        customSlots: tc.customSlots,
        mega_groups: tc.mega_groups || [],
        blocked_days: tc.blocked_days || [],
        batchGroupType: tc.batchGroupType || "multi_session",
        defaultRepeatCount: tc.repeatCount,
        overfillRules: [],
        preferredLabRules: []
      }
    });

    const s = res.payload.summary;
    console.log(`SUMMARY RESULT:`);
    console.log(`  Total Demand: ${s.total_students}`);
    console.log(`  Assigned: ${s.assigned_count}`);
    console.log(`  Unassigned: ${s.unassigned_count}`);
    console.log(`  Overfill: ${s.overfill_count || 0}`);
  }
}

main().catch(console.error);
