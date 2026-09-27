import {
  mergeStudentDatasets,
  convertStudentsToCsv,
  type StudentRecord,
} from "../../batch-allocation-storage";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log("Testing Batch Allocation Storage & Merge Strategies...");

const existingStudents: StudentRecord[] = [
  { S_ID: "STU-001", Grade: "Grade 4", "Physical Area": "Nasr City" },
  { S_ID: "STU-002", Grade: "Grade 5", "Physical Area": "Nasr City" },
  { S_ID: "STU-003", Grade: "Grade 6", "Physical Area": "Dokki" },
];

const incomingStudents: StudentRecord[] = [
  { S_ID: "STU-002", Grade: "Grade 6", "Physical Area": "Heliopolis" }, // Conflict
  { S_ID: "STU-004", Grade: "Grade 4", "Physical Area": "Maadi" }, // New
];

// Test 1: Replace
const resReplace = mergeStudentDatasets(existingStudents, incomingStudents, "replace");
assert(resReplace.merged.length === 2, "Replace count must be 2");
assert(resReplace.merged[0].S_ID === "STU-002", "First student is STU-002");
assert(resReplace.merged[1].S_ID === "STU-004", "Second student is STU-004");
console.log("✓ Replace strategy passed");

// Test 2: Merge Overwrite
const resOverwrite = mergeStudentDatasets(existingStudents, incomingStudents, "merge_overwrite");
assert(resOverwrite.merged.length === 4, "Overwrite merged count must be 4");
assert(resOverwrite.duplicateCount === 1, "Duplicate count must be 1");
const updatedStu2 = resOverwrite.merged.find((s) => s.S_ID === "STU-002");
assert(updatedStu2?.Grade === "Grade 6", "Overwritten student grade must be Grade 6");
assert(updatedStu2?.["Physical Area"] === "Heliopolis", "Overwritten student area must be Heliopolis");
console.log("✓ Merge Overwrite strategy passed");

// Test 3: Merge Skip
const resSkip = mergeStudentDatasets(existingStudents, incomingStudents, "merge_skip");
assert(resSkip.merged.length === 4, "Skip merged count must be 4");
assert(resSkip.duplicateCount === 1, "Duplicate count must be 1");
const originalStu2 = resSkip.merged.find((s) => s.S_ID === "STU-002");
assert(originalStu2?.Grade === "Grade 5", "Preserved student grade must be Grade 5");
assert(originalStu2?.["Physical Area"] === "Nasr City", "Preserved student area must be Nasr City");
console.log("✓ Merge Skip strategy passed");

// Test 4: CSV Conversion
const csv = convertStudentsToCsv(existingStudents);
assert(csv.includes("S_ID,Grade,Physical Area"), "CSV header present");
assert(csv.includes('"STU-001"'), "CSV record present");
console.log("✓ CSV Conversion passed");

console.log("All batch storage tests passed successfully!");
