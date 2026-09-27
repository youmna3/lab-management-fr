import type { MegaGroupDefinition } from "@/lib/allocation-client";
import type { StudentRow } from "./parse";

export interface PartitionedMegaGroupResult {
  megaGroups: MegaGroupDefinition[];
  groupMembershipsByMg: Map<string, Array<{
    groupId: string;
    shortGroupId: string;
    grade: number;
    physicalArea: string;
    studentCount: number;
    studentIds: string[];
    isExcluded: boolean;
  }>>;
}

/**
 * Extracts short group identifier (e.g. "G1" from "Physical-DEMI-SUM-26-G1" or "Cohort-G4-1").
 */
export function extractShortGroupId(groupId: string): string {
  if (!groupId) return "";
  const clean = String(groupId).trim();
  const matchG = clean.match(/[-_]?(G\d+)(?:[-_]|$)/i) || clean.match(/\b(G\d+)\b/i);
  if (matchG) return matchG[1].toUpperCase();
  const matchNamed = clean.match(/\b(?:Group|GRP)[-_\s]?(\d+)\b/i);
  if (matchNamed) return `G${matchNamed[1]}`;
  const matchTrailingNum = clean.match(/[-_](\d+)$/);
  if (matchTrailingNum) return `G${matchTrailingNum[1]}`;
  if (/^\d+$/.test(clean)) return `G${clean}`;
  return clean;
}

/**
 * Extracts short mega group identifier (e.g. "Mega Group A" -> "MGA", "Group 1" -> "MG1", "Sub-Batch 2" -> "SB2", "MGA" -> "MGA").
 */
export function extractShortMegaGroupId(mgName: string): string {
  if (!mgName) return "";
  const clean = String(mgName).trim();

  // 1. Matches "Mega Group A", "Mega Group 1", "MegaGroup-A", "Mega-Group 2" -> "MGA" / "MG1"
  const matchMegaGroup = clean.match(/\bMega[-_\s]?Group[-_\s]?([A-Za-z0-9]+)\b/i);
  if (matchMegaGroup) return `MG${matchMegaGroup[1].toUpperCase()}`;

  // 2. Matches "Sub-Batch 1", "SubBatch A", "SB1", "SB-A" -> "SB1" / "SBA"
  const matchSb = clean.match(/\b(?:Sub[-_\s]?Batch|SB)[-_\s]?([A-Za-z0-9]+)\b/i);
  if (matchSb) return `SB${matchSb[1].toUpperCase()}`;

  // 3. Matches "MG1", "MG-1", "MG_A", "MG A", "Mega A", "Mega-1" -> "MG1" / "MGA"
  const matchMg = clean.match(/\b(?:Mega|MG)[-_\s]?([A-Za-z0-9]+)\b/i);
  if (matchMg) return `MG${matchMg[1].toUpperCase()}`;

  // 4. Matches "Group A", "Group 1", "GRP-A", "GRP 1" (e.g. user names Mega Group as "Group A") -> "MGA" / "MG1"
  const matchGroup = clean.match(/\b(?:Group|GRP)[-_\s]?([A-Za-z0-9]+)\b/i);
  if (matchGroup) return `MG${matchGroup[1].toUpperCase()}`;

  // 5. Matches single letter or number: "A" -> "MGA", "1" -> "MG1"
  if (/^[A-Za-z0-9]$/.test(clean)) return `MG${clean.toUpperCase()}`;

  // 6. If short enough (<= 4 chars), return uppercase without spaces, else return acronym.
  const abbrev = clean.length <= 4
    ? clean.replace(/\s+/g, "").toUpperCase()
    : clean.split(/\s+/).map((w) => w[0]).join("").toUpperCase();
  return abbrev.startsWith("MG") || abbrev.startsWith("SB") ? abbrev : `MG${abbrev}`;
}

/**
 * Pre-allocation step: Divides eligible student groups as evenly as possible
 * (`Math.floor(total / N)` each), assigning any remainder groups to the LAST super group.
 *
 * This division is executed and persisted BEFORE the solver runs so each super group
 * has an explicit, predictable share of groups/students.
 */
export function partitionGroupsEvenlyAcrossMegaGroups(
  students: StudentRow[],
  megaGroups: MegaGroupDefinition[],
  options?: {
    avgGroupSize?: number;
    prefix?: string;
    strategy?: "bin-packing" | "balanced";
  }
): PartitionedMegaGroupResult {
  if (!megaGroups || megaGroups.length === 0 || !students || students.length === 0) {
    return {
      megaGroups: megaGroups || [],
      groupMembershipsByMg: new Map(),
    };
  }

  const avgGroupSize = options?.avgGroupSize && options.avgGroupSize > 0 ? options.avgGroupSize : 20;
  const prefix = options?.prefix || "Group";
  // Default strategy is bin-packing to minimize wasted/fragmented seats across labs & slots
  const strategy = options?.strategy || "bin-packing";

  // Group mega groups into clusters that share the exact same grade and area criteria
  const clusters: Array<{
    mgs: MegaGroupDefinition[];
    grades: number[];
    areas: string[];
  }> = [];

  for (const mg of megaGroups) {
    const mgGrades = Array.isArray(mg.grades)
      ? mg.grades.map((g) => Number(String(g).replace(/\D/g, ""))).filter((n) => !isNaN(n)).sort((a, b) => a - b)
      : [];
    const mgAreas = Array.isArray(mg.areas)
      ? mg.areas.map((a) => a.trim().toLowerCase()).filter(Boolean).sort()
      : [];

    const clusterKey = `${mgGrades.join(",")}__${mgAreas.join(",")}`;
    let cluster = clusters.find((c) => `${c.grades.join(",")}__${c.areas.join(",")}` === clusterKey);
    if (!cluster) {
      cluster = { mgs: [], grades: mgGrades, areas: mgAreas };
      clusters.push(cluster);
    }
    cluster.mgs.push(mg);
  }

  const updatedMegaGroups: MegaGroupDefinition[] = [];
  const groupMembershipsByMg = new Map<string, Array<{
    groupId: string;
    shortGroupId: string;
    grade: number;
    physicalArea: string;
    studentCount: number;
    studentIds: string[];
    isExcluded: boolean;
  }>>();

  const assignedStudentIdSet = new Set<string>();

  for (const cluster of clusters) {
    const { mgs, grades, areas } = cluster;
    const N = mgs.length;

    // Filter students eligible for this cluster
    const eligibleStudents = students.filter((s) => {
      if (assignedStudentIdSet.has(s.S_ID)) return false;
      const sGrade = Number(s.Grade);
      const sArea = String(s["Physical Area"] || "").trim().toLowerCase();

      if (grades.length > 0 && !grades.includes(sGrade)) return false;
      if (areas.length > 0 && !areas.some((a) => sArea.includes(a) || a.includes(sArea))) return false;
      return true;
    });

    if (eligibleStudents.length === 0) {
      for (const mg of mgs) {
        updatedMegaGroups.push({
          ...mg,
          group_ids: mg.group_ids || [],
          student_ids: mg.student_ids || [],
        });
        groupMembershipsByMg.set(mg.name, []);
      }
      continue;
    }

    const mgGroupsMap = new Map<number, Array<{
      groupId: string;
      shortGroupId: string;
      grade: number;
      physicalArea: string;
      studentCount: number;
      studentIds: string[];
      isExcluded: boolean;
    }>>();

    for (let i = 0; i < N; i++) {
      mgGroupsMap.set(i, []);
    }

    const studentAssignments = mgs.map(() => new Map<string, StudentRow>());
    const claimedInCluster = new Set<string>();
    const normalizedSourceGroup = (student: StudentRow) => String(
      (student as any).Group_ID ?? (student as any).GroupId ??
      (student as any)["Group ID"] ?? (student as any).group_id ??
      (student as any).Cohort ?? (student as any).Class ?? (student as any).Section ?? "",
    ).trim().toLowerCase();
    const isExcludedFrom = (student: StudentRow, megaGroup: MegaGroupDefinition) => {
      const excludedStudents = new Set((megaGroup.excluded_student_ids ?? []).map((id) => String(id).trim().toLowerCase()));
      const excludedGroups = new Set((megaGroup.excluded_group_ids ?? []).map((id) => String(id).trim().toLowerCase()));
      return excludedStudents.has(student.S_ID.toLowerCase()) || excludedGroups.has(normalizedSourceGroup(student));
    };
    const assign = (student: StudentRow, index: number) => {
      if (claimedInCluster.has(student.S_ID) || isExcludedFrom(student, mgs[index])) return false;
      studentAssignments[index].set(student.S_ID, student);
      claimedInCluster.add(student.S_ID);
      return true;
    };

    // Preserve explicit student and source-group membership before balancing.
    for (let i = 0; i < N; i++) {
      const explicitStudents = new Set((mgs[i].student_ids ?? []).map((id) => String(id).trim().toLowerCase()));
      const explicitGroups = new Set((mgs[i].group_ids ?? []).map((id) => String(id).trim().toLowerCase()));
      for (const student of eligibleStudents) {
        if (explicitStudents.has(student.S_ID.toLowerCase()) || explicitGroups.has(normalizedSourceGroup(student))) {
          assign(student, i);
        }
      }
    }

    // Balance remaining students directly. Temporary presentation groups do not
    // influence Mega Group population or the solver's physical capacity groups.
    const remainingStudents = eligibleStudents
      .filter((student) => !claimedInCluster.has(student.S_ID))
      .sort((a, b) => {
        const areaCompare = String(a["Physical Area"]).localeCompare(String(b["Physical Area"]));
        if (areaCompare !== 0) return areaCompare;
        if (a.Grade !== b.Grade) return a.Grade - b.Grade;
        return a.S_ID.localeCompare(b.S_ID);
      });

    for (const student of remainingStudents) {
      const candidates = mgs
        .map((megaGroup, index) => ({ index, size: studentAssignments[index].size, excluded: isExcludedFrom(student, megaGroup) }))
        .filter((candidate) => !candidate.excluded)
        .sort((a, b) => a.size - b.size || a.index - b.index);
      if (candidates.length > 0) assign(student, candidates[0].index);
    }

    let groupCounter = 1;
    for (let i = 0; i < N; i++) {
      const buckets = new Map<string, StudentRow[]>();
      for (const student of studentAssignments[i].values()) {
        const key = `${student["Physical Area"]}__${student.Grade}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(student);
      }
      for (const [key, bucket] of buckets) {
        const [area, gradeValue] = key.split("__");
        const totalBucket = bucket.length;
        if (totalBucket <= 0) continue;

        let effectiveGroups = Math.max(1, Math.floor(totalBucket / avgGroupSize));
        const rem = totalBucket % avgGroupSize;
        if (rem >= 8) {
          effectiveGroups = Math.floor(totalBucket / avgGroupSize) + 1;
        } else if (rem > 0 && rem < 8) {
          // If remainder is < 8, adjust so each group has at least 8 students
          const candidateGroups = Math.max(1, Math.round(totalBucket / avgGroupSize));
          if (candidateGroups > 1 && totalBucket / candidateGroups < 8) {
            effectiveGroups = Math.max(1, Math.floor(totalBucket / 8));
          } else {
            effectiveGroups = candidateGroups;
          }
        }

        const groupSizes = new Array(effectiveGroups).fill(0);
        let remStudents = totalBucket;
        for (let gIdx = 0; gIdx < effectiveGroups; gIdx++) {
          const take = Math.ceil(remStudents / (effectiveGroups - gIdx));
          groupSizes[gIdx] = take;
          remStudents -= take;
        }

        let sliceStart = 0;
        for (const gSize of groupSizes) {
          if (gSize <= 0) continue;
          const groupStudents = bucket.slice(sliceStart, sliceStart + gSize);
          sliceStart += gSize;
          mgGroupsMap.get(i)!.push({
            groupId: `${prefix}-G${groupCounter}`,
            shortGroupId: `G${groupCounter}`,
            grade: Number(gradeValue),
            physicalArea: area,
            studentCount: groupStudents.length,
            studentIds: groupStudents.map((student) => student.S_ID),
            isExcluded: false,
          });
          groupCounter += 1;
        }
      }
    }

    // Populate updated mega groups and membership tracking
    for (let i = 0; i < N; i++) {
      const mg = mgs[i];
      const assignedGroups = mgGroupsMap.get(i) || [];

      const mgStudentIds = [...studentAssignments[i].keys()];
      const mgGroupIds = [...(mg.group_ids ?? [])];

      for (const g of assignedGroups) {
        mgGroupIds.push(g.groupId);
      }
      for (const studentId of mgStudentIds) assignedStudentIdSet.add(studentId);

      const updatedMg: MegaGroupDefinition = {
        ...mg,
        group_ids: mgGroupIds,
        student_ids: mgStudentIds,
      };

      updatedMegaGroups.push(updatedMg);
      groupMembershipsByMg.set(mg.name, assignedGroups);
    }
  }

  return {
    megaGroups: updatedMegaGroups,
    groupMembershipsByMg,
  };
}

export const MEGA_GROUP_SPLIT_THRESHOLD = 30;

/**
 * Automatically splits cohorts by threshold (>= 30 students -> 2 Mega Groups; < 30 -> 1 Mega Group)
 * for the default flow where no explicit Mega Groups are defined by the user.
 */
export function autoSplitCohortsByThreshold(
  students: StudentRow[],
  threshold: number = MEGA_GROUP_SPLIT_THRESHOLD,
  prefix: string = "MG"
): MegaGroupDefinition[] {
  if (!students || students.length === 0) return [];

  // Group students by Area and Grade
  const cohorts = new Map<string, { area: string; grade: number; students: StudentRow[] }>();
  for (const student of students) {
    const key = `${student["Physical Area"]}__${student.Grade}`;
    if (!cohorts.has(key)) {
      cohorts.set(key, {
        area: student["Physical Area"],
        grade: student.Grade,
        students: [],
      });
    }
    cohorts.get(key)!.students.push(student);
  }

  const result: MegaGroupDefinition[] = [];

  for (const [, cohort] of cohorts) {
    const sorted = [...cohort.students].sort((a, b) => a.S_ID.localeCompare(b.S_ID));
    const total = sorted.length;

    if (total >= threshold) {
      // Split evenly into 2 Mega Groups
      const mid = Math.ceil(total / 2);
      const part1 = sorted.slice(0, mid);
      const part2 = sorted.slice(mid);

      result.push({
        id: `auto_${cohort.area}_G${cohort.grade}_A`,
        name: `${cohort.area} G${cohort.grade} - Part A`,
        areas: [cohort.area],
        grades: [cohort.grade],
        student_ids: part1.map((s) => s.S_ID),
      });

      result.push({
        id: `auto_${cohort.area}_G${cohort.grade}_B`,
        name: `${cohort.area} G${cohort.grade} - Part B`,
        areas: [cohort.area],
        grades: [cohort.grade],
        student_ids: part2.map((s) => s.S_ID),
      });
    } else {
      result.push({
        id: `auto_${cohort.area}_G${cohort.grade}`,
        name: `${cohort.area} G${cohort.grade}`,
        areas: [cohort.area],
        grades: [cohort.grade],
        student_ids: sorted.map((s) => s.S_ID),
      });
    }
  }

  return result;
}
