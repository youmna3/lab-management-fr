import { EGYPT_AREA_TO_GOV, normalizeArabic } from "../arabic";
import { resolveVpAcademicIdentity } from "../vp-session-grouping";
import type { LabRow, StudentRow } from "./parse";

export interface PhysicalConsolidationResult {
  students: StudentRow[];
  consolidatedStudentCount: number;
  analysis: ConsolidationAnalysisDecision[];
}

export interface ConsolidationSourceArea {
  sourceArea: string;
  studentsMoved: number;
}

export interface ConsolidationAnalysisDecision {
  governorate: string;
  track?: string;
  level: number;
  academicLabel: string;
  destinationArea: string;
  destinationExistingStudents: number;
  studentsMoved: number;
  finalCohortSize: number;
  sourceAreas: ConsolidationSourceArea[];
  selectionReason: string;
  reason: string;
}

export function resolveStudentGovernorate(student: Pick<StudentRow, "Physical Area"> & Partial<StudentRow>): string {
  const explicit = student.Gov || student.Governorate;
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const area = String(student["Physical Area"] || "").trim();
  if (EGYPT_AREA_TO_GOV[area]) return EGYPT_AREA_TO_GOV[area];
  const normalized = normalizeArabic(area);
  for (const [knownArea, governorate] of Object.entries(EGYPT_AREA_TO_GOV)) {
    if (normalizeArabic(knownArea) === normalized) return governorate;
  }
  return area || "Unknown";
}

/** Creates solver-only effective locations without mutating the project roster. */
export function consolidatePhysicalCohorts(
  sourceStudents: StudentRow[],
  labRows: LabRow[],
  program: "DECI" | "DEMI" | "CUSTOM",
): PhysicalConsolidationResult {
  const capacityByArea = new Map<string, number>();
  for (const lab of labRows) {
    capacityByArea.set(lab.Area, (capacityByArea.get(lab.Area) || 0) + Math.max(0, lab["Lab Capacity"]));
  }

  const cohorts = new Map<string, StudentRow[]>();
  for (const student of sourceStudents) {
    const governorate = resolveStudentGovernorate(student);
    const identity = resolveVpAcademicIdentity(program, student.Grade, student.Track || student.Course);
    const key = `${governorate}\u0000${identity.key}`;
    const cohort = cohorts.get(key) || [];
    cohort.push(student);
    cohorts.set(key, cohort);
  }

  const allocationAreaByStudent = new Map<string, string>();
  const analysis: ConsolidationAnalysisDecision[] = [];
  for (const cohort of cohorts.values()) {
    if (cohort.length < 8) continue;
    const areaCounts = new Map<string, number>();
    for (const student of cohort) {
      const area = student["Physical Area"];
      areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
    }

    const ranked = (areas: string[]) => [...areas].sort((a, b) => {
      const countDelta = (areaCounts.get(b) || 0) - (areaCounts.get(a) || 0);
      if (countDelta) return countDelta;
      const labDelta = Number(capacityByArea.has(b)) - Number(capacityByArea.has(a));
      if (labDelta) return labDelta;
      const capacityDelta = (capacityByArea.get(b) || 0) - (capacityByArea.get(a) || 0);
      if (capacityDelta) return capacityDelta;
      return a.localeCompare(b);
    });

    const allAreas = [...areaCounts.keys()];
    const viableAreas = allAreas.filter((area) => (areaCounts.get(area) || 0) >= 8);
    let anchors = viableAreas;
    if (anchors.length === 0) {
      const areasWithLabs = allAreas.filter((area) => capacityByArea.has(area));
      anchors = [ranked(areasWithLabs.length > 0 ? areasWithLabs : allAreas)[0]];
    } else {
      const viableAreasWithLabs = anchors.filter((area) => capacityByArea.has(area));
      if (viableAreasWithLabs.length > 0) anchors = viableAreasWithLabs;
    }
    const destination = ranked(anchors)[0];
    const identity = resolveVpAcademicIdentity(program, cohort[0].Grade, cohort[0].Track || cohort[0].Course);
    const sourceAreas = [...areaCounts.entries()]
      .filter(([area, count]) => area !== destination && count < 8)
      .map(([sourceArea, studentsMoved]) => ({ sourceArea, studentsMoved }))
      .sort((a, b) => a.sourceArea.localeCompare(b.sourceArea));
    const studentsMoved = sourceAreas.reduce((sum, source) => sum + source.studentsMoved, 0);
    const destinationExistingStudents = areaCounts.get(destination) || 0;
    const hasValidLab = capacityByArea.has(destination);
    const selectionReason = hasValidLab
      ? "it had the strongest student cohort with valid lab availability within the same governorate"
      : "it had the highest student count within the same governorate";
    if (studentsMoved > 0) {
      const sourceDescription = sourceAreas
        .map((source) => `${source.sourceArea} (${source.studentsMoved} ${source.studentsMoved === 1 ? "student" : "students"})`)
        .join(", ");
      const academicDescription = program === "DEMI" ? `grade ${identity.label}` : `${identity.track || "Unspecified track"} - Level ${identity.level}`;
      analysis.push({
        governorate: resolveStudentGovernorate(cohort[0]),
        track: identity.track,
        level: identity.level,
        academicLabel: identity.label,
        destinationArea: destination,
        destinationExistingStudents,
        studentsMoved,
        finalCohortSize: destinationExistingStudents + studentsMoved,
        sourceAreas,
        selectionReason,
        reason: `${studentsMoved} ${studentsMoved === 1 ? "student was" : "students were"} moved from ${sourceAreas.length} small ${sourceAreas.length === 1 ? "area" : "areas"} (${sourceDescription}) to ${destination} because all students belong to the same governorate and exact ${academicDescription}. The destination was selected because ${selectionReason}. After consolidation, the cohort reached ${destinationExistingStudents + studentsMoved} students.`,
      });
    }
    for (const student of cohort) {
      if ((areaCounts.get(student["Physical Area"]) || 0) < 8) {
        allocationAreaByStudent.set(student.S_ID, destination);
      }
    }
  }

  let consolidatedStudentCount = 0;
  const students = sourceStudents.map((student) => {
    const originalArea = student["Physical Area"];
    const allocationArea = allocationAreaByStudent.get(student.S_ID) || originalArea;
    if (allocationArea !== originalArea) consolidatedStudentCount += 1;
    return {
      ...student,
      Original_Physical_Area: originalArea,
      Allocation_Area: allocationArea,
      "Physical Area": allocationArea,
      Gov: resolveStudentGovernorate(student),
      Governorate: resolveStudentGovernorate(student),
    };
  });
  return { students, consolidatedStudentCount, analysis };
}
