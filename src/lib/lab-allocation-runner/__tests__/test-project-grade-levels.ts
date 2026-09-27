import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  DECI_GRADE_LEVEL_OPTIONS,
  DEMI_GRADE_OPTIONS,
  formatGradeLevel,
  getGradeLevelOptions,
  parseAcademicClassification,
  parseGradeLevel,
} from "../../project-grade-levels";
import { loadStudents } from "../parse";
import { runAllocation } from "../run";

async function runProjectGradeLevelTests() {
  assert.deepEqual(getGradeLevelOptions("DEMI").map((option) => option.value), [4, 5, 6]);
  assert.equal(getGradeLevelOptions("DECI").length, 17);
  assert.equal(DEMI_GRADE_OPTIONS.some((option) => option.value === 101), false);
  assert.equal(DECI_GRADE_LEVEL_OPTIONS.some((option) => option.value === 4), false);

  assert.equal(parseGradeLevel("G4", "DEMI"), 4);
  assert.equal(parseGradeLevel("Computer Fundamentals - Level 1", "DECI"), 101);
  assert.equal(parseGradeLevel("Cyber Security - Level 5", "DECI"), 205);
  assert.equal(parseGradeLevel("Digital Arts - Level 4", "DECI"), 304);
  assert.equal(parseGradeLevel("Web Development - Level 3", "DECI"), 403);
  assert.equal(parseGradeLevel("Data Science - Level 5", "DECI"), 505);
  assert.equal(parseGradeLevel("Embedded Systems - Level 4", "DECI"), 604);
  assert.equal(parseGradeLevel(9, "DECI"), 9, "legacy numeric values must remain readable");
  assert.equal(formatGradeLevel(503, "DECI"), "Data Science - Level 3");
  assert.equal(parseAcademicClassification("L3", "DECI", "Cyber Security"), 203);
  assert.equal(parseAcademicClassification("3", "DECI", "Digital Arts"), 303);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { S_ID: "DECI-1", Grade: "Computer Advanced - Level 2", "Physical Area": "Nasr City" },
    { S_ID: "DECI-2", Grade: "Embedded Systems - Level 5", "Physical Area": "Dokki" },
  ]), "Students");
  const file = new File(
    [XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })],
    "deci-students.xlsx",
  );
  const students = await loadStudents(file, "DECI");
  assert.deepEqual(students.map((student) => student.Grade), [102, 605]);

  const splitWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(splitWorkbook, XLSX.utils.json_to_sheet([
    { S_ID: "DECI-SPLIT-1", Track: "Cyber Security", Level: "L3", "Physical Area": "Nasr City" },
    { S_ID: "DECI-SPLIT-2", Track: "Digital Arts", Level: "L3", "Physical Area": "Nasr City" },
  ]), "Students");
  const splitFile = new File(
    [XLSX.write(splitWorkbook, { type: "buffer", bookType: "xlsx" })],
    "deci-split-students.xlsx",
  );
  const splitStudents = await loadStudents(splitFile, "DECI");
  assert.deepEqual(splitStudents.map((student) => student.Grade), [203, 303]);

  const labWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(labWorkbook, XLSX.utils.json_to_sheet([
    { "Lab ID": "LAB-NASR", Area: "Nasr City", "Lab Capacity": 10 },
    { "Lab ID": "LAB-DOKKI", Area: "Dokki", "Lab Capacity": 10 },
  ]), "Labs");
  const labFile = new File(
    [XLSX.write(labWorkbook, { type: "buffer", bookType: "xlsx" })],
    "labs.xlsx",
  );
  const allocation = await runAllocation({
    studentFile: file,
    labFile,
    program: "DECI",
    prefix: "Physical-DECI-G",
    preferences: { overfillRules: [], preferredLabRules: [], extraLabs: [] },
  });
  assert.equal(allocation.payload.summary.assigned_count, 2);
  assert.deepEqual(
    [...new Set(allocation.payload.master_allocation.map((row) => row.Grade))].sort((a, b) => a - b),
    [102, 605],
    "allocation must preserve distinct DECI track / level identifiers",
  );

  const acceptanceRows = [
    ...Array.from({ length: 15 }, (_, idx) => ({ S_ID: `CS-${idx + 1}`, Grade: "Cyber Security L3", "Physical Area": "Nasr City" })),
    ...Array.from({ length: 12 }, (_, idx) => ({ S_ID: `DA-${idx + 1}`, Grade: "Digital Arts L3", "Physical Area": "Nasr City" })),
    ...Array.from({ length: 8 }, (_, idx) => ({ S_ID: `WEB-${idx + 1}`, Grade: "Web Development L3", "Physical Area": "Nasr City" })),
  ];
  const acceptanceWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(acceptanceWorkbook, XLSX.utils.json_to_sheet(acceptanceRows), "Students");
  const acceptanceFile = new File(
    [XLSX.write(acceptanceWorkbook, { type: "buffer", bookType: "xlsx" })],
    "deci-acceptance.xlsx",
  );
  const acceptanceAllocation = await runAllocation({
    studentFile: acceptanceFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DECI-G",
    preferences: { overfillRules: [], preferredLabRules: [], extraLabs: [] },
  });

  const nasrSummary = acceptanceAllocation.payload.area_grade_summary
    .filter((row) => row["Physical Area"] === "Nasr City")
    .map((row) => [row.Academic_Label, row.Track, row.Level, row.Total_Students])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(nasrSummary, [
    ["Cyber Security L3", "Cyber Security", "L3", 15],
    ["Digital Arts L3", "Digital Arts", "L3", 12],
    ["Web Development L3", "Web Development", "L3", 8],
  ]);
  assert.equal(
    Object.keys(acceptanceAllocation.payload.dashboard_summary[0]).some((key) => key.includes("Grade3") || key.includes("G3")),
    false,
    "DECI analytics must not collapse L3 tracks into Grade3/G3 columns",
  );

  console.log("Project-specific grade / level catalog and import tests passed.");
}

void runProjectGradeLevelTests();
