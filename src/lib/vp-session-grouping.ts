import {
  isVpStudent,
  type MasterAllocationRow,
  type OnlineMigrationSuggestion,
  type VpSessionSummary,
} from "@/lib/allocation-client";

export { isVpStudent };
import {
  getGradeLevelOption,
  getGradeLevelOptions,
  normalizeProjectProgram,
  parseGradeLevel,
} from "@/lib/project-grade-levels";

export const VP_SESSION_CAPACITY = 30;

export interface VpStudentCandidate {
  studentId: string;
  projectId: string;
  projectName: string;
  program: "DECI" | "DEMI" | "CUSTOM";
  grade: number | string;
  track?: string;
  governorate: string;
}

export interface AcademicIdentity {
  key: string;
  label: string;
  token: string;
  track?: string;
  level: number;
}

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackToken(track: string): string {
  const known: Record<string, string> = {
    "computer fundamentals": "CF",
    "computer advanced": "CA",
    "cyber security": "CS",
    "digital arts": "DA",
    "web development": "WD",
    "data science": "DS",
    "embedded systems": "ES",
  };
  return (
    known[normalizeToken(track)] ||
    track
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 3)
      .toUpperCase() ||
    "LVL"
  );
}

export function resolveVpAcademicIdentity(
  program: unknown,
  grade: unknown,
  trackHint?: unknown,
): AcademicIdentity {
  const normalizedProgram = normalizeProjectProgram(program);
  const parsedGrade = parseGradeLevel(grade, normalizedProgram);
  if (parsedGrade == null)
    throw new Error(`VP allocation rejected: invalid grade/level "${String(grade)}".`);

  if (normalizedProgram === "DEMI") {
    return {
      key: `DEMI:G${parsedGrade}`,
      label: `G${parsedGrade}`,
      token: `G${parsedGrade}`,
      level: parsedGrade,
    };
  }

  let option = getGradeLevelOption(parsedGrade);
  if (!option?.track && trackHint) {
    const normalizedTrack = normalizeToken(trackHint);
    option = getGradeLevelOptions("DECI").find(
      (candidate) =>
        candidate.level === parsedGrade && normalizeToken(candidate.track) === normalizedTrack,
    );
  }

  if (option?.track) {
    return {
      key: `DECI:${option.value}`,
      label: option.shortLabel,
      token: `${trackToken(option.track)}-L${option.level}`,
      track: option.track,
      level: option.level,
    };
  }

  // Legacy records may contain only L3/L4/L5. Keep them usable, but isolate them
  // from every named track so they can never be mixed with a known DECI track.
  const legacyTrack = String(trackHint ?? "Unspecified track").trim() || "Unspecified track";
  return {
    key: `DECI:${normalizeToken(legacyTrack) || "unspecified"}:L${parsedGrade}`,
    label: `${legacyTrack} L${parsedGrade}`,
    token: `${trackToken(legacyTrack)}-L${parsedGrade}`,
    track: legacyTrack,
    level: parsedGrade,
  };
}

export function validateVpSession(
  session: VpSessionSummary,
  candidates: VpStudentCandidate[],
): void {
  const members = candidates.filter((candidate) =>
    session.studentIds.includes(candidate.studentId),
  );
  const projects = new Set(members.map((candidate) => candidate.projectId));
  const identities = new Set(
    members.map(
      (candidate) =>
        resolveVpAcademicIdentity(candidate.program, candidate.grade, candidate.track).key,
    ),
  );
  if (
    members.length !== session.studentIds.length ||
    projects.size !== 1 ||
    identities.size !== 1 ||
    members.length > VP_SESSION_CAPACITY
  ) {
    throw new Error(
      `VP allocation rejected for ${session.id}: sessions require one project, one exact academic identity, and at most ${VP_SESSION_CAPACITY} students.`,
    );
  }
}

export function groupStudentsIntoVpSessions(candidates: VpStudentCandidate[]): VpSessionSummary[] {
  const uniqueStudents = new Map<string, VpStudentCandidate>();
  for (const candidate of candidates) {
    const identity = resolveVpAcademicIdentity(candidate.program, candidate.grade, candidate.track);
    const uniqueKey = `${candidate.projectId}\u0000${candidate.studentId}`;
    const existing = uniqueStudents.get(uniqueKey);
    if (existing) {
      const existingIdentity = resolveVpAcademicIdentity(
        existing.program,
        existing.grade,
        existing.track,
      );
      if (existingIdentity.key !== identity.key) {
        throw new Error(
          `VP allocation rejected: student ${candidate.studentId} has conflicting academic levels.`,
        );
      }
      continue;
    }
    uniqueStudents.set(uniqueKey, candidate);
  }

  const grouped = new Map<string, { identity: AcademicIdentity; students: VpStudentCandidate[] }>();
  for (const candidate of uniqueStudents.values()) {
    const identity = resolveVpAcademicIdentity(candidate.program, candidate.grade, candidate.track);
    const key = `${candidate.projectId}\u0000${identity.key}`;
    const current = grouped.get(key) || { identity, students: [] };
    current.students.push(candidate);
    grouped.set(key, current);
  }

  const sessions: VpSessionSummary[] = [];
  for (const [, group] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    group.students.sort((a, b) => a.studentId.localeCompare(b.studentId));
    for (let offset = 0; offset < group.students.length; offset += VP_SESSION_CAPACITY) {
      const members = group.students.slice(offset, offset + VP_SESSION_CAPACITY);
      const first = members[0];
      const sequence = Math.floor(offset / VP_SESSION_CAPACITY) + 1;
      const session: VpSessionSummary = {
        id: `VP-${group.identity.token}-${String(sequence).padStart(3, "0")}`,
        projectId: first.projectId,
        projectName: first.projectName,
        program: first.program,
        academicIdentity: group.identity.key,
        academicLabel: group.identity.label,
        ...(group.identity.track ? { track: group.identity.track } : {}),
        level: group.identity.level,
        studentIds: members.map((member) => member.studentId),
        studentCount: members.length,
        capacity: VP_SESSION_CAPACITY,
        status: "active",
        governorates: Array.from(
          new Set(members.map((member) => member.governorate).filter(Boolean)),
        ).sort(),
      };
      validateVpSession(session, members);
      sessions.push(session);
    }
  }
  return sessions;
}

type AllocationRowWithVp = MasterAllocationRow & Record<string, unknown>;

export function applyAcceptedVpGrouping(
  rows: MasterAllocationRow[],
  suggestions: OnlineMigrationSuggestion[],
  project: { id: string; name: string; program: "DECI" | "DEMI" | "CUSTOM" },
  additionalStudents: Array<
    Partial<MasterAllocationRow> & Pick<MasterAllocationRow, "S_ID" | "Grade" | "Physical Area">
  > = [],
): { rows: MasterAllocationRow[]; sessions: VpSessionSummary[] } {
  const accepted = suggestions.filter((suggestion) => suggestion.status === "accepted");
  const acceptedStudentIds = new Set(
    accepted.flatMap((suggestion) => suggestion.affectedStudentIds),
  );
  const governorateByStudent = new Map<string, string>();
  const trackByStudent = new Map<string, string>();
  for (const suggestion of accepted) {
    const governorate = suggestion.governorate || suggestion.gov || suggestion.area || "Unknown";
    for (const studentId of suggestion.affectedStudentIds) {
      governorateByStudent.set(studentId, governorate);
      if (suggestion.track) trackByStudent.set(studentId, suggestion.track);
    }
  }

  const rowStudentIds = new Set(rows.map((row) => row.S_ID));
  const syntheticRows: MasterAllocationRow[] = additionalStudents
    .filter((student) => acceptedStudentIds.has(student.S_ID) && !rowStudentIds.has(student.S_ID))
    .map((student) => ({
      ...student,
      Group_ID: student.Group_ID || "VP-PENDING",
      S_ID: student.S_ID,
      Grade: student.Grade,
      "Physical Area": student["Physical Area"],
      Lab_ID: student.Lab_ID || "ONLINE",
      Day: student.Day || "",
      Session: student.Session || "VP",
      Time_Slot: student.Time_Slot || "",
      Slot_Key: student.Slot_Key || "VP-PENDING",
      Slot_Num: student.Slot_Num || 0,
      Lab_Capacity: student.Lab_Capacity || VP_SESSION_CAPACITY,
    }));
  const allRows = [...rows, ...syntheticRows];

  const candidates: VpStudentCandidate[] = allRows
    .filter((row) => acceptedStudentIds.has(row.S_ID))
    .map((row) => {
      const extended = row as AllocationRowWithVp;
      return {
        studentId: row.S_ID,
        projectId: project.id,
        projectName: project.name,
        program: project.program,
        grade: row.Grade,
        track:
          String(
            extended.Track ||
              extended.track ||
              extended.Course ||
              trackByStudent.get(row.S_ID) ||
              "",
          ) || undefined,
        governorate: String(
          extended.Gov || extended.Governorate || governorateByStudent.get(row.S_ID) || "Unknown",
        ),
      };
    });
  const sessions = groupStudentsIntoVpSessions(candidates);
  const sessionByStudent = new Map(
    sessions.flatMap((session) => session.studentIds.map((id) => [id, session] as const)),
  );

  // Assign deterministic slot numbers to sessions and propagate to student rows
  const sessionSlotMap = new Map<string, number>();
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const existingPositiveSlot = allRows
      .filter((r) => session.studentIds.includes(r.S_ID) && Number(r.Slot_Num) > 0)
      .map((r) => Number(r.Slot_Num))[0];
    const assignedSlot = existingPositiveSlot || (i % 7) + 1;
    session.slotNum = assignedSlot;
    sessionSlotMap.set(session.id, assignedSlot);
  }

  const updatedRows = allRows.map((row) => {
    const session = sessionByStudent.get(row.S_ID);
    if (!session) {
      return {
        ...row,
        Session_Type: (row as any).Session_Type || "physical",
        session_type: (row as any).session_type || "physical",
      } as unknown as MasterAllocationRow;
    }
    const extended = row as AllocationRowWithVp;
    const sessionSlotNum = sessionSlotMap.get(session.id) || 1;
    return {
      ...row,
      Session_Type: "vp",
      session_type: "vp",
      Original_Lab_ID:
        extended.Original_Lab_ID || extended.Assigned_Lab || row.Lab_ID || row["Lab ID"] || "",
      Is_Online: true,
      is_online: true,
      Assigned_Lab: "ONLINE",
      Lab_ID: "ONLINE",
      Lab_Capacity: VP_SESSION_CAPACITY,
      Group_ID: session.id,
      Slot_Key: session.id,
      online_group: session.id,
      VP_Session_ID: session.id,
      Academic_Identity: session.academicIdentity,
      ...(session.track ? { Track: session.track } : {}),
      Level: session.level,
      Slot_Num: sessionSlotNum,
      Session: row.Session || "VP",
    } as unknown as MasterAllocationRow;
  });
  return { rows: updatedRows, sessions };
}
