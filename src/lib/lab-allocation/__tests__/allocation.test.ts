import { parseAndValidateStudents } from "../student-importer";
import { generateGroups } from "../group-generator";
import { runAllocation } from "../allocation-engine";
import { normalizeLabFromDb, parseLabsFromSheet } from "../lab-adapter";
import { validateAllocationSafety } from "../allocation-validator";
import {
  type AllocationLab,
  type AllocationConfig,
  DEFAULT_ALLOCATION_CONFIG,
  STANDARD_TIME_SLOTS,
} from "../types";

function createMockLab(
  id: string,
  labCode: string,
  area: string,
  capacity: number,
  slotGradeOverrides: Record<string, string> = {},
): AllocationLab {
  const slots = new Map();
  STANDARD_TIME_SLOTS.forEach((slotDef) => {
    slots.set(slotDef.key, {
      slotKey: slotDef.key,
      day: slotDef.day,
      time: slotDef.time,
      targetGrade: slotGradeOverrides[slotDef.key] ?? null,
      isOccupied: false,
      assignedGroupId: null,
      assignedGroupCode: null,
    });
  });

  return {
    id,
    labCode,
    name: `Lab ${labCode}`,
    gov: area,
    area,
    capacity,
    slots,
  };
}

export function runTestSuite(): { passed: number; failed: number; errors: string[] } {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  function test(name: string, fn: () => void) {
    try {
      fn();
      passed++;
      // console.log(`✓ ${name}`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`FAIL: ${name} -> ${msg}`);
      // console.error(`✗ ${name}: ${msg}`);
    }
  }

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  function assertEqual(actual: unknown, expected: unknown, msg: string) {
    if (actual !== expected) {
      throw new Error(`${msg} - Expected: ${expected}, Actual: ${actual}`);
    }
  }

  // --- 1. Student Import & Validation ---
  test("Student Import: Validates clean student sheet", () => {
    const rawRows = [
      { S_ID: "1001", Grade: "G4", "Physical Area": "Cairo" },
      { S_ID: "1002", Grade: "G4", "Physical Area": "Cairo" },
      { S_ID: "1003", Grade: "G5", "Physical Area": "Giza" },
    ];
    const res = parseAndValidateStudents(rawRows);
    assertEqual(res.validStudents.length, 3, "All 3 students should be valid");
    assertEqual(res.invalidRows.length, 0, "No invalid rows");
  });

  test("Student Import: Flags missing S_ID, duplicate S_ID, missing Grade, missing Area", () => {
    const rawRows = [
      { S_ID: "", Grade: "G4", "Physical Area": "Cairo" }, // Missing S_ID
      { S_ID: "1001", Grade: "G4", "Physical Area": "Cairo" }, // Valid 1001
      { S_ID: "1001", Grade: "G4", "Physical Area": "Cairo" }, // Duplicate 1001
      { S_ID: "1002", Grade: "", "Physical Area": "Cairo" }, // Missing Grade
      { S_ID: "1003", Grade: "G4", "Physical Area": "" }, // Missing Area
    ];
    const res = parseAndValidateStudents(rawRows);
    assertEqual(res.validStudents.length, 1, "Only 1 valid student (first 1001)");
    assertEqual(res.invalidRows.length, 4, "4 invalid rows should be reported");
    assert(
      res.issues.some((i) => i.type === "MISSING_S_ID"),
      "Should contain MISSING_S_ID issue",
    );
    assert(
      res.issues.some((i) => i.type === "DUPLICATE_STUDENT"),
      "Should contain DUPLICATE_STUDENT issue",
    );
    assert(
      res.issues.some((i) => i.type === "MISSING_GRADE"),
      "Should contain MISSING_GRADE issue",
    );
    assert(
      res.issues.some((i) => i.type === "MISSING_AREA"),
      "Should contain MISSING_AREA issue",
    );
  });

  // --- 2. Group Generation ---
  test("Group Generator: 63 students with capacity 25 produces 25 + 25 + 13", () => {
    const students = Array.from({ length: 63 }, (_, i) => ({
      sId: `S-${1000 + i}`,
      grade: "G4",
      physicalArea: "Cairo",
      rowNumber: i + 2,
      rawGrade: "G4",
      rawArea: "Cairo",
    }));

    const groups = generateGroups(students, 25);
    assertEqual(groups.length, 3, "63 students / 25 should produce 3 groups");
    assertEqual(groups[0].studentCount, 25, "Group 1 size");
    assertEqual(groups[1].studentCount, 25, "Group 2 size");
    assertEqual(groups[2].studentCount, 13, "Group 3 size");
    assertEqual(groups[0].groupCode, "CA-G4-01", "Group 1 code");
    assertEqual(groups[1].groupCode, "CA-G4-02", "Group 2 code");
    assertEqual(groups[2].groupCode, "CA-G4-03", "Group 3 code");
  });

  test("Group Generator: Exact capacity produces full groups", () => {
    const students = Array.from({ length: 50 }, (_, i) => ({
      sId: `S-${2000 + i}`,
      grade: "G5",
      physicalArea: "Giza",
      rowNumber: i + 2,
      rawGrade: "G5",
      rawArea: "Giza",
    }));

    const groups = generateGroups(students, 25);
    assertEqual(groups.length, 2, "50 students / 25 should produce 2 groups");
    assertEqual(groups[0].studentCount, 25, "Group 1 size 25");
    assertEqual(groups[1].studentCount, 25, "Group 2 size 25");
  });

  // --- 3. Allocation Engine Normal Case ---
  test("Allocation: Normal case allocates all groups and students", () => {
    const students = Array.from({ length: 50 }, (_, i) => ({
      sId: `S-${3000 + i}`,
      grade: "G4",
      physicalArea: "Cairo",
      rowNumber: i + 2,
      rawGrade: "G4",
      rawArea: "Cairo",
    }));
    const groups = generateGroups(students, 25);
    const labs = [createMockLab("lab-1", "L001", "Cairo", 30)];

    const result = runAllocation(groups, labs);
    assertEqual(result.stats.allocatedStudents, 50, "All 50 students allocated");
    assertEqual(result.stats.unallocatedStudents, 0, "0 unallocated students");
    assertEqual(result.allocations.filter((a) => a.status === "Allocated").length, 2, "2 groups allocated");
    assertEqual(result.summary[0].status, "Fully Allocated", "Summary status is Fully Allocated");
  });

  // --- 4. Allocation Engine: Insufficient Capacity ---
  test("Allocation: Insufficient lab capacity prevents allocation with INSUFFICIENT_CAPACITY", () => {
    const students = Array.from({ length: 25 }, (_, i) => ({
      sId: `S-${4000 + i}`,
      grade: "G4",
      physicalArea: "Cairo",
      rowNumber: i + 2,
      rawGrade: "G4",
      rawArea: "Cairo",
    }));
    const groups = generateGroups(students, 25); // Group size 25
    const labs = [createMockLab("lab-1", "L001", "Cairo", 20)]; // Lab capacity only 20

    const result = runAllocation(groups, labs);
    assertEqual(result.stats.allocatedStudents, 0, "0 students allocated due to small lab");
    assertEqual(result.stats.unallocatedStudents, 25, "25 unallocated students");
    assertEqual(result.unallocatedGroups[0].issue?.type, "INSUFFICIENT_CAPACITY", "Issue type is INSUFFICIENT_CAPACITY");
  });

  // --- 5. Allocation Engine: No Labs in Area ---
  test("Allocation: Missing lab in area marks unallocated with NO_AVAILABLE_LAB", () => {
    const students = [
      {
        sId: "S-5001",
        grade: "G4",
        physicalArea: "Aswan",
        rowNumber: 2,
        rawGrade: "G4",
        rawArea: "Aswan",
      },
    ];
    const groups = generateGroups(students, 25);
    const labs = [createMockLab("lab-1", "L001", "Cairo", 30)]; // Lab only in Cairo, no lab in Aswan

    const result = runAllocation(groups, labs);
    assertEqual(result.stats.allocatedStudents, 0, "0 students allocated");
    assertEqual(result.unallocatedGroups[0].issue?.type, "NO_AVAILABLE_LAB", "Issue type is NO_AVAILABLE_LAB");
  });

  // --- 6. Allocation Engine: Slot Exhaustion ---
  test("Allocation: No available slots remaining marks unallocated with NO_AVAILABLE_SLOT", () => {
    // 8 groups of 25 = 200 students. Lab has only 7 standard slots.
    const students = Array.from({ length: 200 }, (_, i) => ({
      sId: `S-${6000 + i}`,
      grade: "G4",
      physicalArea: "Cairo",
      rowNumber: i + 2,
      rawGrade: "G4",
      rawArea: "Cairo",
    }));
    const groups = generateGroups(students, 25); // 8 groups
    const labs = [createMockLab("lab-1", "L001", "Cairo", 30)]; // 1 lab = 7 slots maximum

    const result = runAllocation(groups, labs);
    assertEqual(result.stats.allocatedGroups, 7, "7 groups allocated to the 7 available slots");
    assertEqual(result.stats.unallocatedGroups, 1, "1 group unallocated due to slot exhaustion");
    assertEqual(result.unallocatedGroups[0].issue?.type, "NO_AVAILABLE_SLOT", "Issue is NO_AVAILABLE_SLOT");
  });

  // --- 7. Allocation Engine: Grade Slot Restriction Compatibility ---
  test("Allocation: Respects Thu 9 AM Grade slot restriction", () => {
    const studentsG4 = Array.from({ length: 25 }, (_, i) => ({
      sId: `S-${7000 + i}`,
      grade: "G4",
      physicalArea: "Cairo",
      rowNumber: i + 2,
      rawGrade: "G4",
      rawArea: "Cairo",
    }));
    const studentsG6 = Array.from({ length: 25 }, (_, i) => ({
      sId: `S-${8000 + i}`,
      grade: "G6",
      physicalArea: "Cairo",
      rowNumber: i + 27,
      rawGrade: "G6",
      rawArea: "Cairo",
    }));

    const groups = [
      ...generateGroups(studentsG4, 25),
      ...generateGroups(studentsG6, 25),
    ];

    // Lab has 1 slot reserved for G4 and 1 slot open
    const lab = createMockLab("lab-1", "L001", "Cairo", 30, {
      "Thu 9 AM": "G4",
    });

    const result = runAllocation(groups, [lab]);
    assertEqual(result.stats.allocatedGroups, 2, "Both groups allocated");

    const g4Alloc = result.allocations.find((a) => a.group.grade === "G4");
    const g6Alloc = result.allocations.find((a) => a.group.grade === "G6");

    assertEqual(g4Alloc?.slotKey, "Thu 9 AM", "G4 was assigned to the G4-designated slot");
    assert(g6Alloc?.slotKey !== "Thu 9 AM", "G6 was not assigned to the G4-designated slot");
  });

  // --- 8. Allocation Validator Safety Invariants ---
  test("Validator: Detects schedule conflict if same lab slot assigned twice", () => {
    const group1 = {
      id: "grp-1",
      groupCode: "CA-G4-01",
      area: "Cairo",
      grade: "G4",
      studentCount: 25,
      studentIds: ["1", "2"],
      students: [],
    };
    const group2 = {
      id: "grp-2",
      groupCode: "CA-G4-02",
      area: "Cairo",
      grade: "G4",
      studentCount: 25,
      studentIds: ["3", "4"],
      students: [],
    };
    const lab = createMockLab("lab-1", "L001", "Cairo", 30);

    const conflictAllocations = [
      { group: group1, status: "Allocated" as const, lab, slotKey: "Thu 9 AM" },
      { group: group2, status: "Allocated" as const, lab, slotKey: "Thu 9 AM" },
    ];

    const issues = validateAllocationSafety(conflictAllocations, [lab]);
    assert(
      issues.some((i) => i.type === "SCHEDULE_CONFLICT"),
      "Validator must detect schedule conflict on the same lab/slot",
    );
  });

  // --- 9. Master Lab Schedule Importer (DEMI / DECI Operations Sheet) ---
  test("Master Sheet Importer: Parses 232-lab operations sheet with occupied slots and groups", async () => {
    const { isMasterLabScheduleSheet, parseMasterLabScheduleSheet } = await import("../master-sheet-importer");
    const sampleRows = [
      {
        "Lab ID": "L1",
        Gov: "أسوان",
        Area: "أسوان",
        "Lab Capacity": 20,
        "Vendor Name": "Ischool",
        "Center Name": "الاكاديمية الأمريكية للتدريب",
        "Lab Name": "الاكاديمية الأمريكية للتدريب 1",
        "عدد الطلاب بالمعمل": 92,
        "Number of Sessions": 6,
        "Thu 9 AM Grade": "G5",
        "Thu 12 PM Grade": "G5",
        "Thu 3 PM Grade": "G4",
        "Thu 6 PM Grade": "G4",
        "Fri 9 AM Grade": "",
        "Fri 3 PM Grade": "G4",
        "Fri 6 PM Grade": "G4",
        "Thu 9 AM": "Physical-DS-G6",
        "Thu 12 PM": "Physical-DS-G5",
        "Thu 3 PM": "Physical-DS-G4",
        "Thu 6 PM": "Physical-DS-G3",
        "Fri 9 AM": "",
        "Fri 3 PM": "Physical-DS-G2",
        "Fri 6 PM": "Physical-DS-G1",
      },
      {
        "Lab ID": "L521",
        Gov: "أسوان",
        Area: "أسوان",
        "Lab Capacity": 20,
        "Vendor Name": "Ischool",
        "Center Name": "الاكاديمية الأمريكية للتدريب",
        "Lab Name": "الاكاديمية الأمريكية للتدريب 2",
        "عدد الطلاب بالمعمل": 19,
        "Number of Sessions": 2,
        "Fri 3 PM Grade": "G6",
        "Fri 6 PM Grade": "G6",
        "Fri 3 PM": "Physical-DS-G9",
        "Fri 6 PM": "Physical-DS-G8",
      },
    ];

    assert(isMasterLabScheduleSheet(sampleRows), "Should recognize master lab schedule sheet");
    const parsed = parseMasterLabScheduleSheet(sampleRows);
    assertEqual(parsed.labs.length, 2, "Should parse 2 labs");
    assertEqual(parsed.groups.length, 8, "Should extract 8 groups (6 from L1, 2 from L521)");
    assertEqual(parsed.totalSlotsOccupied, 8, "Should detect 8 occupied slots");
    const allocRes = runAllocation(parsed.groups, parsed.labs);
    assert(allocRes.stats.allocatedGroups > 0, "Should allocate extracted groups");
  });

  return { passed, failed, errors };
}
