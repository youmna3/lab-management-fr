import * as XLSX from "xlsx";
import { pathToFileURL } from "node:url";
import { runAllocation } from "../run";
import { getSlotDayKey, getSlotTimeKey } from "../master";
import { partitionGroupsEvenlyAcrossMegaGroups } from "../mega-groups";
import type { MasterAllocationRow, MegaGroupDefinition } from "../../allocation-client";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[ASSERTION FAILED] ${message}`);
}

function makeStudentFile(count: number): File {
  const rows = Array.from({ length: count }, (_, index) => ({
    S_ID: `STU-${String(index + 1).padStart(3, "0")}`,
    Grade: 4,
    "Physical Area": "Test Area",
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Students");
  return new File([XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })], "students.xlsx");
}

function dateSlots(dates: string[]): string[] {
  return dates.map((date) => `${date}@10:00`);
}

function assertRecurringIntegrity(rows: MasterAllocationRow[], expectedDatesByMegaGroup: Map<string, string[]>) {
  const rowsByGroup = new Map<string, MasterAllocationRow[]>();
  const visitsByStudentDate = new Set<string>();
  for (const row of rows) {
    if (!rowsByGroup.has(row.Group_ID)) rowsByGroup.set(row.Group_ID, []);
    rowsByGroup.get(row.Group_ID)!.push(row);
    const date = getSlotDayKey(row as never);
    const studentDate = `${row.S_ID}__${date}`;
    assert(!visitsByStudentDate.has(studentDate), `${row.S_ID} must have at most one visit on ${date}`);
    visitsByStudentDate.add(studentDate);
  }

  for (const [groupId, groupRows] of rowsByGroup) {
    const megaGroup = groupRows[0].Mega_Group!;
    const expectedDates = expectedDatesByMegaGroup.get(megaGroup)!;
    assert(new Set(groupRows.map((row) => row.Lab_ID)).size === 1, `${groupId} must use one lab`);
    assert(new Set(groupRows.map((row) => getSlotTimeKey(row as never))).size === 1, `${groupId} must use one time`);
    const dates = new Set(groupRows.map((row) => getSlotDayKey(row as never)));
    assert(dates.size === expectedDates.length, `${groupId} must have ${expectedDates.length} dates`);
    assert(expectedDates.every((date) => dates.has(date)), `${groupId} must cover every active date`);
  }
}

async function runTwoWindowScenario(blockedDays: string[] = []) {
  const datesA = ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];
  const datesB = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
  const megaGroups: MegaGroupDefinition[] = [
    { name: "Group A", start_date: datesA[0], end_date: datesA.at(-1) },
    { name: "Group B", start_date: datesB[0], end_date: datesB.at(-1) },
  ];
  const output = await runAllocation({
    studentFile: makeStudentFile(100),
    labFile: null,
    useDbLabs: true,
    labsJson: [
      { "Lab ID": "LAB-1", Area: "Test Area", "Lab Capacity": 25 },
      { "Lab ID": "LAB-2", Area: "Test Area", "Lab Capacity": 25 },
    ],
    program: "CUSTOM",
    prefix: "Physical-G",
    preferences: {
      overfillRules: [], preferredLabRules: [], extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 5,
      batchDates: [...datesA, ...datesB],
      customSlots: dateSlots([...datesA, ...datesB]),
      blocked_days: blockedDays,
      mega_groups: megaGroups,
    },
  });
  return { output, datesA, datesB };
}

export async function runMultiSessionRecurringTrackTests() {
  console.log("===============================================================");
  console.log("MULTI-SESSION RECURRING TRACK ACCEPTANCE TESTS");
  console.log("===============================================================");

  const { output, datesA, datesB } = await runTwoWindowScenario();
  const rows = output.payload.master_allocation;
  const debugGroupSizes = [...new Set(rows.map((row) => row.Group_ID))].map((groupId) => ({
    groupId,
    megaGroup: rows.find((row) => row.Group_ID === groupId)?.Mega_Group,
    students: new Set(rows.filter((row) => row.Group_ID === groupId).map((row) => row.S_ID)).size,
  }));
  assert(
    output.payload.summary.assigned_count === 100,
    `all 100 students must be assigned (assigned=${output.payload.summary.assigned_count}, unassigned=${output.payload.summary.unassigned_count}, rows=${rows.length}, groups=${JSON.stringify(debugGroupSizes)}, reasons=${JSON.stringify(output.payload.unassigned_students.slice(0, 3))})`,
  );
  assert(output.payload.summary.unassigned_count === 0, "no students may be unassigned");
  assert(output.payload.summary.total_seat_visits === 500, "100 students x 5 dates must produce 500 visits");
  const studentsA = new Set(rows.filter((row) => row.Mega_Group === "Group A").map((row) => row.S_ID));
  const studentsB = new Set(rows.filter((row) => row.Mega_Group === "Group B").map((row) => row.S_ID));
  assert(studentsA.size === 50 && studentsB.size === 50, "equal Mega Groups must contain 50 students each");
  assert([...studentsA].every((id) => !studentsB.has(id)), "Mega Group student membership must be isolated");
  assert([...studentsA].every((id) => rows.filter((row) => row.S_ID === id).length === 5), "Group A students must have five visits");
  assert([...studentsB].every((id) => rows.filter((row) => row.S_ID === id).length === 5), "Group B students must have five visits");
  assertRecurringIntegrity(rows, new Map([["Group A", datesA], ["Group B", datesB]]));
  const recurringTracks = (megaGroup: string) => new Set(
    rows
      .filter((row) => row.Mega_Group === megaGroup)
      .map((row) => `${row.Lab_ID}__${getSlotTimeKey(row as never)}`),
  );
  assert(
    [...recurringTracks("Group A")].every((track) => recurringTracks("Group B").has(track)),
    "non-overlapping Mega Groups must be able to reuse the same lab/time tracks",
  );
  const repeatedRuns = [output, (await runTwoWindowScenario()).output, (await runTwoWindowScenario()).output];
  const deterministicSignature = (run: typeof output) => JSON.stringify({
    inputChecksum: run.payload.summary.input_checksum,
    assigned: run.payload.summary.assigned_count,
    unassigned: run.payload.summary.unassigned_count,
    seatVisits: run.payload.summary.total_seat_visits,
    vpAssigned: run.payload.master_allocation.filter((row) => row.Session_Type === "vp").length,
  });
  assert(
    repeatedRuns.every((run) => deterministicSignature(run) === deterministicSignature(output)),
    "three unchanged reruns must have the same checksum and allocation accounting",
  );
  console.log("PASS: two non-overlapping five-day Mega Groups allocated 100 students / 500 visits with reusable tracks.");
  console.log("PASS: three unchanged reruns produced identical checksums and accounting.");

  const blocked = "2026-09-15";
  const blockedRun = await runTwoWindowScenario([blocked]);
  const blockedRows = blockedRun.output.payload.master_allocation;
  const blockedUnassigned = blockedRun.output.payload.unassigned_students.filter((row) => row.S_ID.startsWith("STU-"));
  assert(blockedRows.every((row) => row.Mega_Group !== "Group A"), "Group A must not receive an incomplete four-date track");
  assert(blockedUnassigned.length === 50, `Group A must leave 50 students unassigned, got ${blockedUnassigned.length}`);
  assert(blockedRows.every((row) => getSlotDayKey(row as never) !== blocked), "blocked date must not be allocated");
  assertRecurringIntegrity(blockedRows, new Map([["Group B", blockedRun.datesB]]));
  console.log("PASS: a blocked day that makes the five-session track incomplete leaves Group A unassigned.");

  const capacityDates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
  const capacityRun = await runAllocation({
    studentFile: makeStudentFile(55),
    labFile: null,
    useDbLabs: true,
    labsJson: ["LAB-1", "LAB-2", "LAB-3"].map((labId) => ({
      "Lab ID": labId, Area: "Test Area", "Lab Capacity": 25,
    })),
    program: "CUSTOM",
    prefix: "Physical-G",
    preferences: {
      overfillRules: [], preferredLabRules: [], extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 5,
      batchDates: capacityDates,
      customSlots: dateSlots(capacityDates),
      mega_groups: [{ name: "Capacity Group", start_date: capacityDates[0], end_date: capacityDates.at(-1) }],
    },
  });
  const uniqueSizes = [...new Set(capacityRun.payload.master_allocation.map((row) => row.Group_ID))]
    .map((groupId) => new Set(capacityRun.payload.master_allocation.filter((row) => row.Group_ID === groupId).map((row) => row.S_ID)).size);
  assert(JSON.stringify(uniqueSizes) === JSON.stringify([19, 18, 18]), `balanced physical groups must be 19,18,18 (no group < 8); got ${uniqueSizes.join(",")}`);
  assert(uniqueSizes.every((size) => size <= 25), "no recurring track may exceed lab capacity");
  assert(uniqueSizes.every((size) => size >= 8), "no recurring track may have fewer than 8 students");
  console.log("PASS: balanced physical groups are exactly 19, 18, and 18 with 0 groups below 8 students.");

  const incompleteRun = await runAllocation({
    studentFile: makeStudentFile(10),
    labFile: null,
    useDbLabs: true,
    labsJson: [{ "Lab ID": "LAB-1", Area: "Test Area", "Lab Capacity": 25 }],
    program: "CUSTOM",
    prefix: "Physical-G",
    preferences: {
      overfillRules: [], preferredLabRules: [], extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 5,
      batchDates: capacityDates,
      customSlots: dateSlots(capacityDates.slice(0, 4)),
      mega_groups: [{ name: "Incomplete Group", start_date: capacityDates[0], end_date: capacityDates.at(-1) }],
    },
  });
  assert(incompleteRun.payload.summary.assigned_count === 0, "an incomplete recurring track must not allocate students");
  assert(incompleteRun.payload.summary.unassigned_count === 10, "all students without a complete recurring track must be unassigned");
  assert(
    incompleteRun.payload.unassigned_students.every((row) =>
      row.Reason === "No complete recurring same-lab/same-time track is available for all active multi-session dates."),
    "incomplete recurring tracks must report the explicit recurring-track reason",
  );
  console.log("PASS: an incomplete five-date recurring track remains unassigned with the required reason.");

  const partitionStudents = Array.from({ length: 6 }, (_, index) => ({
    S_ID: `STU-${index + 1}`,
    Grade: 4,
    "Physical Area": "Test Area",
    ...(index === 3 ? { Group_ID: "COHORT-LOCKED" } : {}),
  }));
  const partitioned = partitionGroupsEvenlyAcrossMegaGroups(partitionStudents, [
    { name: "Explicit A", student_ids: ["STU-1"], excluded_student_ids: ["STU-3"] },
    { name: "Explicit B", student_ids: ["STU-2"], group_ids: ["COHORT-LOCKED"] },
  ]);
  const assignedA = new Set(partitioned.megaGroups[0].student_ids);
  const assignedB = new Set(partitioned.megaGroups[1].student_ids);
  assert(assignedA.has("STU-1") && assignedB.has("STU-2"), "explicit Mega Group assignments must be preserved");
  assert(assignedB.has("STU-4"), "explicit Mega Group group IDs must be preserved");
  assert(!assignedA.has("STU-3"), "excluded students must not enter the excluded Mega Group");
  assert(Math.abs(assignedA.size - assignedB.size) <= 1, "automatic Mega Group populations must differ by at most one student");
  assert([...assignedA].every((id) => !assignedB.has(id)), "partitioned student membership must remain isolated");
  const oddPartition = partitionGroupsEvenlyAcrossMegaGroups(
    Array.from({ length: 7 }, (_, index) => ({ S_ID: `ODD-${index + 1}`, Grade: 4, "Physical Area": "Test Area" })),
    [{ name: "Odd A" }, { name: "Odd B" }],
  );
  const oddSizes = oddPartition.megaGroups.map((group) => group.student_ids?.length ?? 0);
  assert(Math.abs(oddSizes[0] - oddSizes[1]) === 1, `odd Mega Group populations must differ by one; got ${oddSizes.join(",")}`);
  console.log("PASS: deterministic student-level balancing preserves explicit assignments and exclusions.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMultiSessionRecurringTrackTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
