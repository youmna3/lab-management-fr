import assert from "node:assert/strict";
import {
  groupStudentsIntoVpSessions,
  validateVpSession,
  type VpStudentCandidate,
} from "../../vp-session-grouping";
import type { VpSessionSummary } from "../../allocation-client";

function students(
  count: number,
  options: Partial<VpStudentCandidate> & Pick<VpStudentCandidate, "grade" | "governorate">,
  prefix: string,
): VpStudentCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    studentId: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    projectId: "project-deci",
    projectName: "DECI Project",
    program: "DECI",
    ...options,
  }));
}

// Test 1: same DECI track + level combines across governorates.
const cyberL3 = [
  ...students(5, { grade: 203, governorate: "Cairo" }, "CAI-CS3"),
  ...students(6, { grade: 203, governorate: "Giza" }, "GIZ-CS3"),
  ...students(7, { grade: 203, governorate: "Alexandria" }, "ALX-CS3"),
];
const test1 = groupStudentsIntoVpSessions(cyberL3);
assert.equal(test1.length, 1);
assert.equal(test1[0].id, "VP-CS-L3-001");
assert.equal(test1[0].studentCount, 18);
assert.deepEqual(test1[0].governorates, ["Alexandria", "Cairo", "Giza"]);

// Test 2: L3 students in different DECI tracks never combine.
const test2 = groupStudentsIntoVpSessions([
  ...students(5, { grade: 203, governorate: "Cairo" }, "CS3"),
  ...students(6, { grade: 303, governorate: "Giza" }, "DA3"),
]);
assert.equal(test2.length, 2);
assert.deepEqual(
  test2.map((session) => session.track),
  ["Cyber Security", "Digital Arts"],
);

// Test 3: DEMI grades stay separate while governorates combine.
const test3 = groupStudentsIntoVpSessions([
  ...students(
    4,
    {
      projectId: "project-demi",
      projectName: "DEMI Project",
      program: "DEMI",
      grade: 4,
      governorate: "Cairo",
    },
    "G4C",
  ),
  ...students(
    6,
    {
      projectId: "project-demi",
      projectName: "DEMI Project",
      program: "DEMI",
      grade: 4,
      governorate: "Giza",
    },
    "G4G",
  ),
  ...students(
    5,
    {
      projectId: "project-demi",
      projectName: "DEMI Project",
      program: "DEMI",
      grade: 5,
      governorate: "Alexandria",
    },
    "G5A",
  ),
]);
assert.deepEqual(
  test3.map((session) => [session.academicLabel, session.studentCount]),
  [
    ["G4", 10],
    ["G5", 5],
  ],
);

// Test 4: capacity packing is deterministic and capped at 30.
const test4 = groupStudentsIntoVpSessions(
  students(34, { grade: 203, governorate: "Cairo" }, "PACK"),
);
assert.deepEqual(
  test4.map((session) => [session.id, session.studentCount]),
  [
    ["VP-CS-L3-001", 30],
    ["VP-CS-L3-002", 4],
  ],
);

// Test 5: runtime validation rejects a mixed-level session.
const mixedCandidates = [
  ...students(1, { grade: 203, governorate: "Cairo" }, "MIX-CS3"),
  ...students(1, { grade: 204, governorate: "Giza" }, "MIX-CS4"),
];
const invalidSession: VpSessionSummary = {
  id: "VP-CS-MIXED-001",
  projectId: "project-deci",
  projectName: "DECI Project",
  program: "DECI",
  academicIdentity: "invalid",
  academicLabel: "Mixed",
  track: "Cyber Security",
  level: 3,
  studentIds: mixedCandidates.map((student) => student.studentId),
  studentCount: mixedCandidates.length,
  capacity: 30,
  governorates: ["Cairo", "Giza"],
};
assert.throws(() => validateVpSession(invalidSession, mixedCandidates), /VP allocation rejected/);

// Test 6: bulk grouping remains fast and academically strict for 220 eligible cohorts.
const largeCandidates: VpStudentCandidate[] = [];
const academicGrades = [203, 204, 303, 304, 403, 404, 503, 504, 603, 604, 703, 704];
for (let cohort = 0; cohort < 220; cohort++) {
  largeCandidates.push(...students(7, {
    grade: academicGrades[cohort % academicGrades.length],
    governorate: `Governorate ${cohort + 1}`,
  }, `BULK-${cohort + 1}`));
}
const largeStartedAt = performance.now();
const largeSessions = groupStudentsIntoVpSessions(largeCandidates);
assert.ok(performance.now() - largeStartedAt < 2_000, "220-cohort VP grouping should finish within two seconds");
assert.equal(largeSessions.reduce((sum, session) => sum + session.studentCount, 0), 1_540);
assert.ok(largeSessions.every((session) => session.studentCount <= 30));
for (const session of largeSessions) {
  const members = largeCandidates.filter((candidate) => session.studentIds.includes(candidate.studentId));
  validateVpSession(session, members);
}

console.log("VP session grouping acceptance tests passed.");
