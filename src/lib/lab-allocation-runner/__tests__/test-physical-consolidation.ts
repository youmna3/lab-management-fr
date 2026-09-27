import assert from "node:assert/strict";
import { consolidatePhysicalCohorts } from "../physical-consolidation";
import { runAllocation } from "../run";
import type { StudentRow } from "../parse";
import * as XLSX from "xlsx";

function cohort(counts: Record<string, number>, grade: number, prefix: string): StudentRow[] {
  let id = 0;
  return Object.entries(counts).flatMap(([area, count]) => Array.from({ length: count }, () => ({
    S_ID: `${prefix}-${++id}`, Grade: grade, "Physical Area": area,
    Gov: "Test Governorate", Governorate: "Test Governorate",
  })));
}

export async function runPhysicalConsolidationTests() {
  const labs = [
    { "Lab ID": "LAB-A", Area: "Area A", "Lab Capacity": 30 },
    { "Lab ID": "LAB-B", Area: "Area B", "Lab Capacity": 20 },
  ];

  const sourceEight = cohort({ "Area A": 5, "Area B": 1, "Area C": 1, "Area D": 1 }, 101, "T1");
  const consolidatedEight = consolidatePhysicalCohorts(sourceEight, labs, "DECI");
  assert.equal(consolidatedEight.consolidatedStudentCount, 3);
  assert.equal(consolidatedEight.analysis.length, 1);
  assert.deepEqual(consolidatedEight.analysis[0].sourceAreas, [
    { sourceArea: "Area B", studentsMoved: 1 },
    { sourceArea: "Area C", studentsMoved: 1 },
    { sourceArea: "Area D", studentsMoved: 1 },
  ]);
  assert.equal(consolidatedEight.analysis[0].destinationExistingStudents, 5);
  assert.equal(consolidatedEight.analysis[0].finalCohortSize, 8);
  assert.match(consolidatedEight.analysis[0].reason, /same governorate and exact Computer Fundamentals - Level 1/);
  assert.ok(consolidatedEight.students.every((student) => student["Physical Area"] === "Area A"));
  assert.deepEqual(sourceEight.map((student) => student["Physical Area"]), ["Area A", "Area A", "Area A", "Area A", "Area A", "Area B", "Area C", "Area D"]);

  const sourceSeven = cohort({ "Area A": 5, "Area B": 2 }, 203, "T2");
  const consolidatedSeven = consolidatePhysicalCohorts(sourceSeven, labs, "DECI");
  assert.equal(consolidatedSeven.consolidatedStudentCount, 0);
  assert.deepEqual(consolidatedSeven.students.map((student) => student["Physical Area"]), sourceSeven.map((student) => student["Physical Area"]));

  const multipleViable = consolidatePhysicalCohorts(cohort({ "Area A": 20, "Area B": 15, "Area C": 3 }, 203, "T3"), labs, "DECI");
  assert.equal(multipleViable.students.filter((student) => student.Allocation_Area === "Area A").length, 23);
  assert.equal(multipleViable.students.filter((student) => student.Allocation_Area === "Area B").length, 15);

  const isolatedTracks = consolidatePhysicalCohorts([
    ...cohort({ "Area A": 5, "Area B": 3 }, 203, "CS"),
    ...cohort({ "Area A": 4, "Area B": 4 }, 303, "DA"),
  ], labs, "DECI");
  assert.equal(isolatedTracks.students.filter((student) => student.Grade === 203 && student.Allocation_Area === "Area A").length, 8);
  assert.equal(isolatedTracks.students.filter((student) => student.Grade === 303 && student.Allocation_Area === "Area A").length, 8);

  const isolatedComputerLevels = consolidatePhysicalCohorts([
    ...cohort({ "Area A": 5, "Area B": 3 }, 101, "CF"),
    ...cohort({ "Area A": 4, "Area B": 4 }, 102, "CA"),
  ], labs, "DECI");
  assert.equal(new Set(isolatedComputerLevels.students.map((student) => student.Grade)).size, 2);
  assert.ok(isolatedComputerLevels.students.every((student) => student.Allocation_Area === "Area A"));

  const csv = ["S_ID,Grade,Physical Area,Gov", ...sourceEight.map((student) => `${student.S_ID},101,${student["Physical Area"]},Test Governorate`)].join("\n");
  const run = await runAllocation({
    studentFile: new File([csv], "students.csv", { type: "text/csv" }), labFile: null,
    program: "DECI", prefix: "Physical-TEST-G", useDbLabs: true, labsJson: labs,
    preferences: { overfillRules: [], preferredLabRules: [], extraLabs: [] },
  });
  assert.equal(run.payload.online_migration_suggestions?.length, 0, "A governorate cohort of 8 must not receive a VP recommendation");
  assert.equal(run.payload.summary.consolidated_students_count, 3);
  assert.equal(run.payload.consolidation_analysis?.[0].studentsMoved, 3);
  const masterWorkbook = XLSX.read(await run.files.master_allocation.blob.arrayBuffer(), { type: "array" });
  assert.ok(masterWorkbook.SheetNames.includes("Consolidation Analysis"));
  const analysisRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(masterWorkbook.Sheets["Consolidation Analysis"]);
  assert.equal(analysisRows.length, 3);
  assert.deepEqual(analysisRows.map((row) => row["Source Area"]), ["Area B", "Area C", "Area D"]);
  assert.ok(run.payload.master_allocation.every((row) => row["Physical Area"] === "Area A"));
  const moved = run.payload.master_allocation.find((row) => row.S_ID === "T1-6");
  assert.equal(moved?.Original_Physical_Area, "Area B");
  assert.equal(moved?.Allocation_Area, "Area A");

  const sevenCsv = ["S_ID,Grade,Physical Area,Gov", ...sourceSeven.map((student) => `${student.S_ID},203,${student["Physical Area"]},Test Governorate`)].join("\n");
  const sevenRun = await runAllocation({
    studentFile: new File([sevenCsv], "students-seven.csv", { type: "text/csv" }), labFile: null,
    program: "DECI", prefix: "Physical-TEST-G", useDbLabs: true, labsJson: labs,
    preferences: { overfillRules: [], preferredLabRules: [], extraLabs: [] },
  });
  assert.equal(sevenRun.payload.online_migration_suggestions?.length, 1, "A governorate academic cohort of 7 must receive a VP recommendation");
  assert.equal(sevenRun.payload.summary.consolidated_students_count, 0);

  console.log("Physical cohort consolidation tests passed.");
}
