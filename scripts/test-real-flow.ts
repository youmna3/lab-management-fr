import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import { generateDummyStudents, generatePhysicalLabsFromRealData } from "../src/lib/lab-allocation-runner/runner";
import type { AllocationPreferences } from "../src/lib/allocation-client";

async function testRealFlow() {
  console.log("Generating 25,304 students and real labs...");
  const students = generateDummyStudents();
  const labs = generatePhysicalLabsFromRealData();
  console.log(`Generated ${students.length} students across ${labs.length} labs.`);

  // Create 1,336 group classifications for DEMI prefix
  const prefix = "Physical-DEMI-SUM-26-G";
  const numGroups = 1336;
  const classifications = [];
  for (let i = 1; i <= numGroups; i++) {
    classifications.push({
      group_id: `${prefix}${i}`,
      visit_type: "multi_visit" as const,
      repeat_count: 3,
    });
  }

  const prefs: AllocationPreferences = {
    batchGroupType: "multi_session",
    defaultRepeatCount: 3,
    groupClassifications: classifications,
  };

  console.log("\nExecuting runAllocation with Multi-Session (3x) and 1,336 group classifications...");
  const { payload } = await runAllocation({
    studentFile: students,
    labFile: labs,
    program: "DEMI",
    prefix: prefix,
    preferences: prefs,
  });

  const master = payload.master_allocation || [];
  console.log(`Master rows: ${master.length}`);

  // Check visits per group
  const groupVisits = new Map<string, Array<{ visitNum: number; day: string; slot: string; lab: string }>>();
  for (const r of master) {
    const gid = r.Group_ID;
    if (!groupVisits.has(gid)) groupVisits.set(gid, []);
    const list = groupVisits.get(gid)!;
    if (!list.some(v => v.visitNum === r.Visit_Num)) {
      list.push({ visitNum: r.Visit_Num!, day: r.Day, slot: r.Time_Slot, lab: r.Lab_ID });
    }
  }

  console.log(`Unique groups in master_allocation: ${groupVisits.size}`);
  
  let fullyResolvedCount = 0;
  let partialResolvedCount = 0;
  for (const [gid, visits] of groupVisits.entries()) {
    if (visits.length >= 3) fullyResolvedCount++;
    else partialResolvedCount++;
  }
  console.log(`Groups with all 3 visits resolved: ${fullyResolvedCount}`);
  console.log(`Groups with <3 visits resolved: ${partialResolvedCount}`);

  // Sample groups
  for (let i = 1; i <= 5; i++) {
    const gid = `${prefix}${i}`;
    const visits = groupVisits.get(gid);
    console.log(`Group ${gid} visits:`, visits);
  }

  // Check pivot
  const pivot = payload.lab_pivot || [];
  console.log(`Pivot rows: ${pivot.length}`);
  if (pivot.length > 0) {
    console.log("Sample pivot row:", pivot[0]);
  }
}

testRealFlow().catch(console.error);
