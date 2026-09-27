import { loadStudents, loadLabCapacity, loadDashboardTemplate, CANONICAL_GRADE_LABELS, type LabRow, type StudentRow } from "./parse";
import { buildFullSessionGrid, type ExtraLabDefinition, type SessionRow } from "./grid";
import {
  assertMegaGroupDateRanges,
  deriveMegaGroupActiveDates,
  extractIsoDate,
  resolveSlotSchedule,
  DEFAULT_SLOT_INFO,
} from "./schedule";
import { normalizeTimeSlot } from "../time-slots";
import { runIlpAllAreas } from "./ilp";
import { runGroupOptimization, type AugmentedSession } from "./distribute";
import { generateMasterAllocation, type MasterAllocationInternalRow, type UnassignedInternalRow } from "./master";
import { partitionGroupsEvenlyAcrossMegaGroups } from "./mega-groups";
import {
  buildDashboardStyleSummary,
  buildReadableMaster,
  buildAreaTimePivot,
  buildVpPivotSummary,
  buildGroupCountSummary,
  buildLabAllocationTable,
  buildShortfallExplanation,
  buildDashboardOutput,
} from "./summaries";
import { workbookToBlob, textToBlob, zipFromFiles, type SheetSpec } from "./excel-export";
import { yieldToMainThread } from "./async-util";
import { applyAcceptedVpGrouping, resolveVpAcademicIdentity } from "../vp-session-grouping";
import { formatGradeLevel, getAcademicLevel, getAcademicTrack } from "../project-grade-levels";
import { consolidatePhysicalCohorts, resolveStudentGovernorate } from "./physical-consolidation";
import { calculateAllocationAccounting, isVpStudent } from "@/lib/allocation-client";
import type {
  AllocationPreferences,
  AllocationResultPayload,
  RunAllocationParams,
  OverfillSlotDetail,
  GroupClassificationPreference,
  MegaGroupDefinition,
  OnlineMigrationSuggestion,
  OverflowFragmentNotice,
} from "@/lib/allocation-client";

export interface GeneratedFileEntry {
  filename: string;
  blob: Blob;
}

export interface RunAllocationOutput {
  payload: AllocationResultPayload;
  files: Record<string, GeneratedFileEntry>;
}

function makeJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeFileNamePart(s: string): string {
  return String(s).replace(/\//g, "-");
}

/** Deterministic 32-bit FNV-1a checksum of any string */
function computeChecksum(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function deduplicateDemandByStudentId(rows: StudentRow[]): {
  students: StudentRow[];
  duplicateIds: string[];
} {
  const byId = new Map<string, StudentRow>();
  const duplicateIds: string[] = [];
  for (const student of rows) {
    if (byId.has(student.S_ID)) duplicateIds.push(student.S_ID);
    else byId.set(student.S_ID, student);
  }
  return { students: [...byId.values()], duplicateIds };
}

function decorateAcademicRow<T extends Record<string, any>>(row: T, program: RunAllocationParams["program"]): T {
  const grade = row.Grade ?? row.grade;
  return {
    ...row,
    Academic_Label: formatGradeLevel(grade, program, true),
    Track: getAcademicTrack(grade, program),
    Level: getAcademicLevel(grade, program),
  };
}

export async function runAllocation(params: RunAllocationParams): Promise<RunAllocationOutput> {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  const jobId = makeJobId();
  const timestamp = new Date().toISOString();

  const prefs: AllocationPreferences = {
    overfillRules: params.preferences?.overfillRules ?? [],
    preferredLabRules: params.preferences?.preferredLabRules ?? [],
    extraLabs: params.preferences?.extraLabs ?? [],
    customSlots: params.preferences?.customSlots,
    batchDates: params.preferences?.batchDates,
    batchGroupType: params.preferences?.batchGroupType,
    defaultRepeatCount: params.preferences?.defaultRepeatCount,
    groupClassifications: params.preferences?.groupClassifications ?? [],
    blocked_days: params.preferences?.blocked_days ?? [],
    mega_groups: params.preferences?.mega_groups ?? [],
    slotIdTemplate: params.preferences?.slotIdTemplate || "original",
    slotIdStartInteger: params.preferences?.slotIdStartInteger || 14000,
    onlineMigrationDecisions: params.preferences?.onlineMigrationDecisions,
  };

  const activeCustomSlots = prefs.customSlots;
  const slotInfo = resolveSlotSchedule(activeCustomSlots, prefs.blocked_days).sort((a, b) => {
    if (a.date && b.date) {
      const dateOrder = `${a.date}T${a.time || "00:00"}`.localeCompare(`${b.date}T${b.time || "00:00"}`);
      if (dateOrder !== 0) return dateOrder;
    }
    return a.num - b.num;
  });

  if (!params.studentFile) throw new Error("Missing required student file.");
  const loadedStudents: StudentRow[] = (await loadStudents(params.studentFile, params.program))
    .sort((a, b) => String(a.S_ID).localeCompare(String(b.S_ID)));
  const { students: originalStudents, duplicateIds: duplicateInputIds } = deduplicateDemandByStudentId(loadedStudents);
  if (duplicateInputIds.length > 0) {
    console.error("[ACCOUNTING DUPLICATE INPUT STUDENTS]", {
      count: duplicateInputIds.length,
      ids: duplicateInputIds,
    });
    log(`Excluded ${duplicateInputIds.length} duplicate input row(s); Student ID is the canonical demand identity.`);
  }

  let labRows: LabRow[];
  let labSourceName = "";
  if (params.useDbLabs && params.labsJson && params.labsJson.length > 0) {
    labSourceName = `Database Active Labs (${params.labsJson.length} labs)`;
    labRows = params.labsJson.map((l: any) => ({
      "Lab ID": String(l["Lab ID"]).trim(),
      Area: String(l.Area).trim(),
      "Lab Capacity": Math.trunc(Number(l["Lab Capacity"])),
      ...(l["Lab Name"] || l.name ? { "Lab Name": l["Lab Name"] || l.name, name: l.name || l["Lab Name"] } : {}),
      ...(l.Gov || l.Governorate ? { Gov: l.Gov || l.Governorate, Governorate: l.Governorate || l.Gov } : {}),
      ...(l.nearby_labs || l.nearbyLabs ? { nearby_labs: l.nearby_labs || l.nearbyLabs, nearbyLabs: l.nearbyLabs || l.nearby_labs } : {}),
    }));
  } else if (params.labFile) {
    labSourceName = `Uploaded File "${params.labFile.name}"`;
    labRows = await loadLabCapacity(params.labFile, log);
  } else {
    throw new Error("Missing required lab file or database lab selection.");
  }

  labRows.sort((a, b) => a.Area.localeCompare(b.Area) || a["Lab ID"].localeCompare(b["Lab ID"]));

  const { students, consolidatedStudentCount, analysis: consolidationAnalysis } = consolidatePhysicalCohorts(originalStudents, labRows, params.program);

  const extraLabs: ExtraLabDefinition[] = prefs.extraLabs ?? [];
  const sessions = buildFullSessionGrid(labRows, extraLabs, slotInfo, prefs.blocked_days);

  // Compute deterministic dataset fingerprints
  const studentSample = originalStudents.map((s) => `${s.S_ID}:${s.Grade}:${s["Physical Area"]}`).sort().join("|");
  const studentChecksum = computeChecksum(`${originalStudents.length}|${studentSample}`);

  const labSample = labRows.map((l) => `${l["Lab ID"]}:${l.Area}:${l["Lab Capacity"]}`).sort().join("|");
  const labChecksum = computeChecksum(`${labRows.length}|${labSample}`);

  const scheduleFingerprint = slotInfo.map((s) => `${s.num}:${s.label}`).join("|");
  const scheduleChecksum = computeChecksum(`${slotInfo.length}|${scheduleFingerprint}`);
  const preferencesChecksum = computeChecksum(JSON.stringify({
    batchGroupType: prefs.batchGroupType,
    defaultRepeatCount: prefs.defaultRepeatCount,
    batchDates: [...(prefs.batchDates || [])].sort(),
    blockedDays: [...(prefs.blocked_days || [])].sort(),
    megaGroups: prefs.mega_groups || [],
    groupClassifications: [...(prefs.groupClassifications || [])].sort((a, b) => a.group_id.localeCompare(b.group_id)),
    onlineMigrationDecisions: prefs.onlineMigrationDecisions || {},
  }));
  const inputChecksum = computeChecksum(`${params.projectId || ""}|${studentChecksum}|${labChecksum}|${scheduleChecksum}|${preferencesChecksum}`);

  const areasWithLabs = new Set(sessions.map((s) => s.Area));
  const areasWithStudents = new Set(students.map((s) => s["Physical Area"]));
  const allGrades = new Set<number>();
  for (const s of students) allGrades.add(s.Grade);
  const sortedGrades = [...allGrades].sort((a, b) => a - b);

  const gradeCountsStr = sortedGrades
    .map((g) => `${formatGradeLevel(g, params.program, true)}: ${students.filter((s) => s.Grade === g).length.toLocaleString()}`)
    .join(" | ");

  const totalTrueCapacity = sessions.reduce((acc, s) => acc + s.True_Capacity, 0);
  const uniqueLabCount = new Set(sessions.map((s) => s["Lab ID"])).size;

  // Diagnostic Run Header
  log(`================================================================================`);
  log(`[LAB ALLOCATION PIPELINE RUN START]`);
  log(`• Job ID: ${jobId}`);
  log(`• Timestamp: ${timestamp}`);
  log(`--------------------------------------------------------------------------------`);
  log(`[INPUT DATASET VERIFICATION]`);
  log(`• Students: ${students.length.toLocaleString()} records [Checksum: #${studentChecksum}]`);
  log(`  - Physical Areas: ${areasWithStudents.size} unique areas`);
  log(`  - Consolidated Students: ${consolidatedStudentCount.toLocaleString()} solver-only location adjustment(s)`);
  log(`  - Grade Counts: ${gradeCountsStr}`);
  log(`• Labs: ${labRows.length.toLocaleString()} physical labs (Source: ${labSourceName}) [Checksum: #${labChecksum}]`);
  log(`  - Unique Lab Areas: ${areasWithLabs.size} areas with labs`);
  log(`  - Extra Requested Labs: ${extraLabs.length} lab(s)`);
  log(`• Schedule Grid: ${slotInfo.length} slot(s) per lab [Checksum: #${scheduleChecksum}]`);
  log(`  - Schedule Type: ${activeCustomSlots && activeCustomSlots.length > 0 ? `Batch Custom (${activeCustomSlots.length} slots: ${slotInfo.map((s) => s.label).join(", ")})` : "Default 7-Slot Weekly Grid (4 Thursday + 3 Friday)"}`);
  if (prefs.blocked_days && prefs.blocked_days.length > 0) {
    log(`  - Blocked Days Excluded: ${prefs.blocked_days.join(", ")}`);
  }
  if (prefs.mega_groups && prefs.mega_groups.length > 0) {
    log(`  - Mega Groups Configured: ${prefs.mega_groups.length} sub-batch(es) [${prefs.mega_groups.map((mg) => `${mg.name} (${mg.dates?.join(", ") || "All Dates"})`).join(" | ")}]`);
  }
  log(`  - Total Available Sessions: ${sessions.length.toLocaleString()} (${uniqueLabCount} labs × ${slotInfo.length} slots)`);
  log(`  - Total Available True Capacity: ${totalTrueCapacity.toLocaleString()} seats`);
  log(`• Preferences Applied:`);
  log(`  - Overfill Rules: ${prefs.overfillRules.length} rule(s) ${prefs.overfillRules.length > 0 ? `(Max +${Math.max(...prefs.overfillRules.map((r) => r.maxOverfillPerLab || 2))} per lab)` : "(None)"}`);
  log(`  - Preferred Lab Rules: ${prefs.preferredLabRules.length} rule(s)`);
  log(`================================================================================`);

  const orphanAreas = [...areasWithStudents].filter((a) => !areasWithLabs.has(a));
  if (orphanAreas.length > 0) {
    const nOrphan = students.filter((s) => orphanAreas.includes(s["Physical Area"])).length;
    log(`WARNING: ${orphanAreas.length} Physical Area(s) in the student file have NO labs at all: ${[...orphanAreas].sort().join(", ")}`);
    log(`         -> ${nOrphan.toLocaleString()} student(s) in those areas will be logged as unassigned (no labs exist there).`);
  }

  const isMultiBatch = prefs.batchGroupType === "multi_session";
  const batchRepeat = isMultiBatch ? Math.trunc(Number(prefs.defaultRepeatCount)) : 1;
  if (isMultiBatch && batchRepeat < 2) {
    throw new Error("Multi-Session allocation requires Sessions / Group from the selected Batch Settings.");
  }

  const classByAreaGradeMap = new Map<string, GroupClassificationPreference>();
  if (Array.isArray(prefs.groupClassifications)) {
    for (const c of prefs.groupClassifications) {
      if (c.area && c.grade !== undefined) {
        classByAreaGradeMap.set(`${c.area.trim().toLowerCase()}__${c.grade}`, c);
      }
    }
  }

  const groupIdPrefix = params.prefix || (params.program === "DEMI" ? "Physical-DEMI-G" : "Physical-DS-G");
  const slotLabelsByNum = new Map(slotInfo.map((s) => [s.num, s.label]));

  // ---------------------------------------------------------------------------
  // Mega Groups Sub-Batch Execution or Single Unified Batch Execution
  // ---------------------------------------------------------------------------
  const megaGroupDefs = prefs.mega_groups && prefs.mega_groups.length > 0 ? prefs.mega_groups : null;

  type PartitionItem = {
    megaGroup?: MegaGroupDefinition;
    students: StudentRow[];
    sessions: SessionRow[];
    activeDates?: string[];
  };

  const partitions: PartitionItem[] = [];

  const assignedStudentIds = new Set<string>();

  // If Mega Groups (Super Groups / Sub-Batches) are defined, partition students & sessions into isolated sub-batches
  if (prefs.mega_groups && prefs.mega_groups.length > 0) {
    log(`Partitioning cohort into ${prefs.mega_groups.length} Mega Group(s) with pre-allocation division:`);

    const { megaGroups: partitionedMegaGroups } = partitionGroupsEvenlyAcrossMegaGroups(students, prefs.mega_groups, { prefix: groupIdPrefix });
    const scheduleDates = prefs.batchDates?.length
      ? prefs.batchDates
      : sessions
          .map((session) => extractIsoDate(session.Date ?? session.Day ?? session.Slot_Label))
          .filter((date): date is string => Boolean(date));
    assertMegaGroupDateRanges(
      scheduleDates,
      prefs.mega_groups,
      prefs.blocked_days || [],
      batchRepeat,
    );

    for (const mg of partitionedMegaGroups) {
      const mgNameLower = String(mg.name || "").trim().toLowerCase();
      const mgIdLower = String(mg.id || "").trim().toLowerCase();

      const excludedGroupIds = new Set<string>(
        Array.isArray(mg.excluded_group_ids) ? mg.excluded_group_ids.map((g) => String(g).trim().toLowerCase()) : []
      );
      const excludedStudentIds = new Set<string>(
        Array.isArray(mg.excluded_student_ids) ? mg.excluded_student_ids.map((s) => String(s).trim().toLowerCase()) : []
      );

      const targetStudentIds = new Set<string>(
        Array.isArray(mg.student_ids) ? mg.student_ids.map((s) => String(s).trim().toLowerCase()) : []
      );

      const mgStudents = students.filter((s) => {
        if (assignedStudentIds.has(s.S_ID)) return false;
        const sIdLower = String(s.S_ID || "").trim().toLowerCase();
        if (excludedStudentIds.has(sIdLower)) return false;

        const sRecord = s as any;
        const sGroupId = String(sRecord.Group_ID ?? sRecord.GroupId ?? sRecord["Group ID"] ?? sRecord.group_id ?? sRecord.Cohort ?? sRecord.Class ?? sRecord.Section ?? "").trim().toLowerCase();
        if (sGroupId && excludedGroupIds.has(sGroupId)) return false;

        if (targetStudentIds.size > 0 && targetStudentIds.has(sIdLower)) return true;

        const mgTag = String(sRecord.Mega_Group ?? sRecord["Mega Group"] ?? sRecord.Sub_Batch ?? "").trim().toLowerCase();
        if (mgTag && (mgTag === mgNameLower || (mgIdLower && mgTag === mgIdLower))) return true;

        return false;
      });

      mgStudents.forEach((s) => assignedStudentIds.add(s.S_ID));

      // Filter sessions for this Mega Group's date range
      const activeDates = deriveMegaGroupActiveDates(scheduleDates, mg, prefs.blocked_days);
      const activeDateSet = new Set(activeDates);
      const mgTimeSlots = new Set(
        (mg.time_slots ?? [])
          .map(normalizeTimeSlot)
          .filter((time): time is string => Boolean(time)),
      );

      const mgSessions = sessions.filter((s) => {
        const sessionDate = extractIsoDate(s.Date ?? s.Day ?? s.Slot_Label);
        if (!sessionDate || !activeDateSet.has(sessionDate)) return false;
        const sessionTime = normalizeTimeSlot(s.Time_Slot ?? s.Slot_Label);
        if (mgTimeSlots.size > 0 && (!sessionTime || !mgTimeSlots.has(sessionTime))) return false;
        return true;
      });

      partitions.push({
        megaGroup: mg,
        students: mgStudents,
        sessions: mgSessions,
        activeDates,
      });
      log(`• Mega Group "${mg.name}": ${mgStudents.length} students, ${activeDates.length} active date(s), ${mgSessions.length} eligible lab slots.`);
    }

    // Default remaining students partition
    const remainingStudents = students.filter((s) => !assignedStudentIds.has(s.S_ID));
    if (remainingStudents.length > 0) {
      partitions.push({
        students: remainingStudents,
        sessions: [...sessions],
      });
      log(`• Default Batch Pool: ${remainingStudents.length} students across all ${sessions.length} sessions.`);
    }
  } else {
    partitions.push({
      students: [...students],
      sessions: [...sessions],
    });
  }

  const allMasterRows: MasterAllocationInternalRow[] = [];
  const allUnassignedRows: UnassignedInternalRow[] = [];
  const allSessionsAugmented: Array<SessionRow & { Grade: number }> = [];
  const allShortfallMathRows: Array<{ Area: string; Grade: number; Demand: number; Sessions_Assigned: number; Capacity_Assigned: number; Students_Short: number }> = [];
  const allShortfallReport: Array<{ Area: string; Grade: number; Students_Short: number; Reason: string }> = [];
  const allStudentsByAreaGrade = new Map<string, number>();
  const claimedSlotKeysAcrossPartitions = new Set<string>();

  for (let pIdx = 0; pIdx < partitions.length; pIdx++) {
    const part = partitions[pIdx];
    if (part.students.length === 0) continue;

    if (part.megaGroup && isMultiBatch && part.activeDates?.length === 0) {
      for (const student of part.students) {
        allUnassignedRows.push({
          S_ID: student.S_ID,
          Grade: student.Grade,
          "Physical Area": student["Physical Area"],
          Reason: "No active multi-session dates remain after applying the Mega Group window and blocked days.",
        });
      }
      continue;
    }

    const partStudents = part.students;
    // Mega Groups constrain the eligible schedule window; they never redefine
    // the canonical Sessions / Group value inherited from the batch.
    const partitionRepeatCount = batchRepeat;
    const partSessions = part.sessions.filter((s) => !claimedSlotKeysAcrossPartitions.has(s.Slot_Key));
    const partAreasWithLabs = new Set(partSessions.map((s) => s.Area));

    const partSessionsByArea = new Map<string, SessionRow[]>();
    for (const s of partSessions) {
      if (!partSessionsByArea.has(s.Area)) partSessionsByArea.set(s.Area, []);
      partSessionsByArea.get(s.Area)!.push(s);
    }

    const partDistinctDays = new Set(
      partSessions.map((s) => {
        const m = String(s.Day || "").match(/\d{4}-\d{2}-\d{2}/) || String(s.Slot_Label || "").match(/\d{4}-\d{2}-\d{2}/);
        return s.Date || (m ? m[0] : (s.Day || "").trim().toLowerCase());
      })
    ).size;

    const partEffectiveRepeat =
      prefs.defaultRepeatCount !== undefined && prefs.defaultRepeatCount > 0
        ? prefs.defaultRepeatCount
        : batchRepeat;

    const studentsByAreaGradeRaw = new Map<string, number>();
    for (const s of partStudents) {
      const key = `${s["Physical Area"]}__${s.Grade}`;
      studentsByAreaGradeRaw.set(key, (studentsByAreaGradeRaw.get(key) ?? 0) + 1);
    }

    const studentsByAreaGrade = new Map<string, number>();
    for (const [key, count] of studentsByAreaGradeRaw) {
      const [area, gradeStr] = key.split("__");
      const grade = Number(gradeStr);
      const areaGradeClass = classByAreaGradeMap.get(`${area.trim().toLowerCase()}__${grade}`);
      const repeatCount = areaGradeClass && areaGradeClass.visit_type === "multi_visit" && Number(areaGradeClass.repeat_count) > 1
        ? Math.max(2, Number(areaGradeClass.repeat_count))
        : areaGradeClass && areaGradeClass.visit_type === "single_visit"
        ? 1
        : partEffectiveRepeat;

      if (repeatCount > 1) {
        const areaSessions = partSessionsByArea.get(area) || [];
        const avgCap = areaSessions.length > 0
          ? Math.round(areaSessions.reduce((acc, s) => acc + s.True_Capacity, 0) / areaSessions.length)
          : 25;
        const numGroups = Math.max(1, Math.ceil(count / avgCap));
        const demand = numGroups * repeatCount * avgCap;
        studentsByAreaGrade.set(key, demand);
      } else {
        studentsByAreaGrade.set(key, count);
      }
    }

    for (const [key, demand] of studentsByAreaGrade) {
      allStudentsByAreaGrade.set(key, (allStudentsByAreaGrade.get(key) ?? 0) + demand);
    }

    const { sessionsAugmented: partAugmented, shortfallMathRows: partMath, shortfallReport: partShortfall } = await runIlpAllAreas(
      partSessions,
      studentsByAreaGrade,
      [...partAreasWithLabs].sort(),
      sortedGrades,
      log,
      prefs,
      params.onProgress,
      prefs.batchGroupType,
    );

    const { assignmentPlan } = runGroupOptimization(
      partStudents,
      partAugmented as AugmentedSession[],
      prefs,
      prefs.batchGroupType,
    );

    const slotLookup = new Map<string, AugmentedSession>();
    for (const s of partSessions) {
      slotLookup.set(s.Slot_Key, { ...s, Grade: 0 });
    }
    for (const s of partAugmented as AugmentedSession[]) {
      slotLookup.set(s.Slot_Key, s);
    }

    const partGroupIdPrefix = part.megaGroup ? `${groupIdPrefix}-${part.megaGroup.name.replace(/\s+/g, "")}-G` : groupIdPrefix;

    const { masterRows: partMaster, unassignedRows: partUnassigned } = await generateMasterAllocation(
      partStudents,
      assignmentPlan,
      slotLookup,
      partGroupIdPrefix,
      slotLabelsByNum,
      prefs.groupClassifications,
      prefs.batchGroupType,
      partEffectiveRepeat,
      prefs.overfillRules,
      params.onProgress,
    );

    const sourceById = new Map(partStudents.map((student) => [student.S_ID, student]));
    for (const row of [...partMaster, ...partUnassigned]) {
      const student = sourceById.get(row.S_ID);
      if (!student) continue;
      row.Original_Physical_Area = student.Original_Physical_Area || student["Physical Area"];
      row.Allocation_Area = student.Allocation_Area || student["Physical Area"];
      row.Governorate = student.Governorate || student.Gov || resolveStudentGovernorate(student);
    }

    if (part.megaGroup) {
      for (const r of partMaster) {
        (r as any).Mega_Group = part.megaGroup.name;
      }
      for (const r of partUnassigned) {
        (r as any).Mega_Group = part.megaGroup.name;
      }
      for (const m of partMath) {
        (m as any).Mega_Group = part.megaGroup.name;
      }
    }

    for (const r of partMaster) {
      claimedSlotKeysAcrossPartitions.add(r.Slot_Key);
    }

    for (let i = 0; i < partMaster.length; i++) {
      allMasterRows.push(partMaster[i]);
    }

    // Check if any unassigned leftover fragments from this partition can be merged into subsequent compatible partitions
    const unassignedToKeep: UnassignedInternalRow[] = [];
    if (pIdx < partitions.length - 1 && partUnassigned.length > 0) {
      for (const unassignedRow of partUnassigned) {
        let absorbed = false;
        const uArea = String(unassignedRow["Physical Area"] || "").trim().toLowerCase();
        const uGrade = Number(unassignedRow.Grade);
        const originalStudent = sourceById.get(unassignedRow.S_ID);

        if (originalStudent) {
          for (let nextPIdx = pIdx + 1; nextPIdx < partitions.length; nextPIdx++) {
            const nextPart = partitions[nextPIdx];
            const nextMg = nextPart.megaGroup;

            // Check exclusion
            if (nextMg) {
              const excludedStudents = new Set((nextMg.excluded_student_ids ?? []).map((id) => String(id).trim().toLowerCase()));
              if (excludedStudents.has(unassignedRow.S_ID.toLowerCase())) continue;

              const mgGrades = Array.isArray(nextMg.grades) ? nextMg.grades.map(Number) : [];
              if (mgGrades.length > 0 && !mgGrades.includes(uGrade)) continue;

              const mgAreas = Array.isArray(nextMg.areas) ? nextMg.areas.map((a) => a.trim().toLowerCase()) : [];
              if (mgAreas.length > 0 && !mgAreas.some((a) => uArea.includes(a) || a.includes(uArea))) continue;
            }

            // Check if nextPart has sessions in this Area
            const hasAreaSessions = nextPart.sessions.some((s) => s.Area.trim().toLowerCase() === uArea);
            if (hasAreaSessions) {
              nextPart.students.push(originalStudent);
              absorbed = true;
              break;
            }
          }
        }

        if (!absorbed) {
          unassignedToKeep.push(unassignedRow);
        }
      }
    } else {
      unassignedToKeep.push(...partUnassigned);
    }

    for (let i = 0; i < unassignedToKeep.length; i++) {
      allUnassignedRows.push(unassignedToKeep[i]);
    }
    for (let i = 0; i < partAugmented.length; i++) {
      allSessionsAugmented.push(partAugmented[i]);
    }
    for (let i = 0; i < partMath.length; i++) {
      allShortfallMathRows.push(partMath[i]);
    }
    for (let i = 0; i < partShortfall.length; i++) {
      allShortfallReport.push(partShortfall[i]);
    }
  }

  const masterRows = allMasterRows;
  const unassignedRows = allUnassignedRows;
  const sessionsAugmented = allSessionsAugmented;
  const shortfallMathRows = allShortfallMathRows;
  const shortfallReport = allShortfallReport;

  const uniqueGroupVisits = new Map<string, { visitType: string; repeatCount: number }>();
  for (const r of masterRows) {
    if (!uniqueGroupVisits.has(r.Group_ID)) {
      uniqueGroupVisits.set(r.Group_ID, {
        visitType: r.Visit_Type || "single_visit",
        repeatCount: r.Repeat_Count || 1,
      });
    }
  }
  let multiSessionGroupsCount = 0;
  let singleSessionGroupsCount = 0;
  for (const g of uniqueGroupVisits.values()) {
    if (g.visitType === "multi_visit" && g.repeatCount > 1) {
      multiSessionGroupsCount++;
    } else {
      singleSessionGroupsCount++;
    }
  }

  log(`Master allocation rows: ${masterRows.length}`);
  log(`Total unassigned students: ${unassignedRows.length}`);
  log(`• Group Allocation Mode: ${prefs.batchGroupType === "multi_session" ? `Multi-Session (Default ${prefs.defaultRepeatCount || 2}x repeat)` : "Single-Session Group (SG)"}`);
  log(`  - Total Groups: ${uniqueGroupVisits.size} (${singleSessionGroupsCount} Single-Visit, ${multiSessionGroupsCount} Multi-Session)`);
  log(`  - Total Seat-Visits: ${masterRows.length}`);

  // ---------------------------------------------------------------------------
  // Pipeline Integrity Invariant Verification: Every input student MUST be
  // accounted for as either Assigned or Unassigned in the final output.
  // ---------------------------------------------------------------------------
  const inputIds = new Set(students.map((student) => student.S_ID));
  const assignedSIds = new Set(masterRows.map((r) => r.S_ID));
  const unassignedSIds = new Set(unassignedRows.map((r) => r.S_ID));

  const missingFromBoth = [...inputIds].filter((id) => !assignedSIds.has(id) && !unassignedSIds.has(id));
  const inBoth: string[] = [];

  for (const id of inputIds) {
    const isAssigned = assignedSIds.has(id);
    const isUnassigned = unassignedSIds.has(id);
    if (isAssigned && isUnassigned) {
      inBoth.push(id);
    }
  }

  if (missingFromBoth.length > 0) {
    console.error("[ACCOUNTING MISSING STUDENTS]", {
      count: missingFromBoth.length,
      ids: missingFromBoth,
    });
  }

  const uniqueAssignedCount = assignedSIds.size;
  const uniqueUnassignedCount = unassignedSIds.size;
  const totalAccounted = uniqueAssignedCount + uniqueUnassignedCount;

  if (missingFromBoth.length > 0 || inBoth.length > 0 || totalAccounted !== inputIds.size) {
    const errorDetails = [
      `[PIPELINE INVARIANT VIOLATION] Student accounting mismatch:`,
      `  • Total Demand (unique input IDs): ${inputIds.size}`,
      `  • Unique Assigned: ${uniqueAssignedCount}`,
      `  • Unique Unassigned: ${uniqueUnassignedCount}`,
      `  • Total Accounted: ${totalAccounted}`,
      missingFromBoth.length > 0
        ? `  • CRITICAL: ${missingFromBoth.length} student(s) SILENTLY DROPPED from allocation output: [${missingFromBoth.slice(0, 10).join(", ")}${missingFromBoth.length > 10 ? "..." : ""}]`
        : null,
      inBoth.length > 0
        ? `  • CRITICAL: ${inBoth.length} student(s) flagged as BOTH Assigned and Unassigned: [${inBoth.slice(0, 10).join(", ")}${inBoth.length > 10 ? "..." : ""}]`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    log(errorDetails);
    throw new Error(errorDetails);
  }

  log(`[INTEGRITY INVARIANT VERIFIED] All ${inputIds.size} unique students accounted for: ${uniqueAssignedCount} Assigned, ${uniqueUnassignedCount} Unassigned (0 dropped, 0 duplicate status).`);

  const overfillCount = masterRows.filter((r) => r.Is_Overfill).length;
  const overfilledSlots = new Set(masterRows.filter((r) => r.Is_Overfill).map((r) => r.Slot_Key)).size;
  log(`Total Overfill Students accommodated: ${overfillCount} across ${overfilledSlots} slot(s)`);

  const dashboardStyleSummary = buildDashboardStyleSummary(masterRows, unassignedRows, params.program);
  const groupCountSummary = buildGroupCountSummary(masterRows, unassignedRows, params.program);
  const masterAllocationSorted = buildReadableMaster(masterRows, slotInfo, params.program);
  const areaTimePivot = buildAreaTimePivot(masterRows, slotInfo, params.program);
  const labAllocationTable = buildLabAllocationTable(sessionsAugmented as AugmentedSession[], params.program);

  const files: Record<string, GeneratedFileEntry> = {};
  const perSlotRosterFiles: Array<{ path: string; blob: Blob }> = [];

  files.dashboard_style_summary = { filename: "dashboard_style_summary.xlsx", blob: workbookToBlob([{ name: "Sheet1", rows: dashboardStyleSummary }]) };
  files.area_grade_group_summary = { filename: "area_grade_group_summary.xlsx", blob: workbookToBlob([{ name: "Sheet1", rows: groupCountSummary }]) };

  if (masterRows.length > 0) {
    const bySlot = new Map<string, typeof masterRows>();
    for (const r of masterRows) {
      const rosterKey = `${r.Slot_Key}__${r.Grade}`;
      if (!bySlot.has(rosterKey)) bySlot.set(rosterKey, []);
      bySlot.get(rosterKey)!.push(r);
    }
    for (const [, grp] of bySlot) {
      const row0 = grp[0];
      const dayTag = String(row0.Day || "Day").replace(/ /g, "_");
      const timeTag = String(row0.Time_Slot || "Slot").replace(/ /g, "_").replace(/:/g, "-");
      const fname = safeFileNamePart(`${row0["Physical Area"]}_${formatGradeLevel(row0.Grade, params.program, true)}_${row0.Lab_ID}_${dayTag}_${timeTag}.xlsx`);
      const rosterRows = grp.map((r) => ({ S_ID: r.S_ID, Group_ID: r.Group_ID }));
      const blob = workbookToBlob([{ name: "Sheet1", rows: rosterRows }]);
      perSlotRosterFiles.push({ path: `per_slot_rosters/${fname}`, blob });
    }
    log(`Exported ${bySlot.size} per-slot roster files.`);
  } else {
    log("No assignments to export as per-slot rosters.");
  }

  const consolidationAnalysisRows = consolidationAnalysis.flatMap((decision) => decision.sourceAreas.map((source) => ({
    Governorate: decision.governorate,
    Track: decision.track || "",
    Level: params.program === "DEMI" ? `G${decision.level}` : `L${decision.level}`,
    "Source Area": source.sourceArea,
    "Destination Area": decision.destinationArea,
    "Students Moved": source.studentsMoved,
    "Destination Existing Students": decision.destinationExistingStudents,
    "Final Cohort Size": decision.finalCohortSize,
    Reason: decision.reason,
  })));
  const masterSheets: SheetSpec[] = [{ name: "Master Allocation", rows: masterAllocationSorted }];
  if (areaTimePivot.length > 0) masterSheets.push({ name: "Pivot (by Lab)", rows: areaTimePivot });
  if (consolidationAnalysisRows.length > 0) masterSheets.push({ name: "Consolidation Analysis", rows: consolidationAnalysisRows });
  files.master_allocation = { filename: "master_allocation.xlsx", blob: workbookToBlob(masterSheets) };

  if (unassignedRows.length > 0) {
    const sortedUnassigned = [...unassignedRows].sort((a, b) => {
      if (a["Physical Area"] !== b["Physical Area"]) return a["Physical Area"] < b["Physical Area"] ? -1 : 1;
      return a.Grade - b.Grade;
    });
    files.unassigned_students = { filename: "unassigned_students.xlsx", blob: workbookToBlob([{ name: "Sheet1", rows: sortedUnassigned }]) };
  }

  const explanation = buildShortfallExplanation(sessionsAugmented as AugmentedSession[], allStudentsByAreaGrade, shortfallReport);
  let shortfallText = "";
  if (explanation) {
    shortfallText = explanation.text;
    log(shortfallText);
    files.shortfall_explanation_txt = { filename: "shortfall_math_explanation.txt", blob: textToBlob(shortfallText) };
    files.shortfall_explanation_xlsx = { filename: "shortfall_math_explanation.xlsx", blob: workbookToBlob([{ name: "Sheet1", rows: explanation.shortfallRows }]) };
  }

  const appDataSheets: SheetSpec[] = [
    { name: "Dashboard Summary", rows: dashboardStyleSummary },
    { name: "Master Allocation", rows: masterAllocationSorted },
  ];
  if (areaTimePivot.length > 0) appDataSheets.push({ name: "Pivot (by Lab)", rows: areaTimePivot });
  appDataSheets.push({ name: "Area Grade Summary", rows: groupCountSummary });
  if (unassignedRows.length > 0) appDataSheets.push({ name: "Unassigned", rows: unassignedRows });
  if (shortfallMathRows.length > 0) appDataSheets.push({ name: "Shortfall Math", rows: shortfallMathRows });
  if (labAllocationTable.length > 0) appDataSheets.push({ name: "Lab Allocation", rows: labAllocationTable });
  if (consolidationAnalysisRows.length > 0) appDataSheets.push({ name: "Consolidation Analysis", rows: consolidationAnalysisRows });
  files.app_data = { filename: "app_data.xlsx", blob: workbookToBlob(appDataSheets) };
  log(`Saved consolidated app data: app_data.xlsx`);

  let dashboardTemplate: { headers: string[]; rows: Array<Record<string, unknown>> } | null = null;
  if (params.dashboardFile) {
    dashboardTemplate = await loadDashboardTemplate(params.dashboardFile);
  }
  const dashboardOutput = buildDashboardOutput(masterRows, labRows, dashboardTemplate, slotInfo, log, params.program);
  files.dashboard_output = { filename: "dashboard_output.xlsx", blob: workbookToBlob([{ name: "Sheet1", rows: dashboardOutput }]) };
  log(`Saved: dashboard_output.xlsx`);

  if (perSlotRosterFiles.length > 0) {
    const perSlotZip = await zipFromFiles(perSlotRosterFiles.map((f) => ({ path: f.path.replace(/^per_slot_rosters\//, ""), blob: f.blob })));
    files.per_slot_rosters_zip = { filename: "per_slot_rosters.zip", blob: perSlotZip };
  }

  const allFilesForZip = [
    ...Object.entries(files)
      .filter(([key]) => key !== "per_slot_rosters_zip")
      .map(([, f]) => ({ path: f.filename, blob: f.blob })),
    ...perSlotRosterFiles,
  ];
  files.all_zip = { filename: "allocation_complete.zip", blob: await zipFromFiles(allFilesForZip) };

  const summary: AllocationResultPayload["summary"] = {
    total_students: inputIds.size,
    consolidated_students_count: consolidatedStudentCount,
    assigned_count: uniqueAssignedCount,
    unassigned_count: unassignedRows.length,
    total_seat_visits: masterRows.length,
    input_checksum: inputChecksum,
    overfill_count: overfillCount,
    overfilled_sessions_count: overfilledSlots,
    total_labs: uniqueLabCount,
    total_sessions_available: sessions.length,
    total_sessions_assigned: sessionsAugmented.length,
    areas_count: new Set(students.map((s) => s["Physical Area"])).size,
    batch_group_type: prefs.batchGroupType || "single_session",
    multi_session_groups_count: multiSessionGroupsCount,
    single_session_groups_count: singleSessionGroupsCount,
  };

  const overfillDetails: OverfillSlotDetail[] = [];
  const slotAssignedMap = new Map<string, { labId: string; area: string; grade: number; timeSlot: string; cap: number; count: number }>();
  for (const r of masterRows) {
    if (!slotAssignedMap.has(r.Slot_Key)) {
      slotAssignedMap.set(r.Slot_Key, {
        labId: r.Lab_ID,
        area: r["Physical Area"],
        grade: r.Grade,
        timeSlot: r.Time_Slot,
        cap: r.Lab_Capacity,
        count: 0,
      });
    }
    slotAssignedMap.get(r.Slot_Key)!.count++;
  }
  for (const [slotKey, info] of slotAssignedMap) {
    if (info.count > info.cap) {
      overfillDetails.push({
        slot_key: slotKey,
        lab_id: info.labId,
        area: info.area,
        grade: info.grade,
        time_slot: info.timeSlot,
        standard_capacity: info.cap,
        total_assigned: info.count,
        overfill_students: info.count - info.cap,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Online Migration Suggestion Detection:
  // Project + governorate + exact academic identity headcount rule.
  // ---------------------------------------------------------------------------
  const onlineMigrationSuggestions: OnlineMigrationSuggestion[] = [];
  const cohortStudentsMap = new Map<string, { governorate: string; students: StudentRow[] }>();
  const projectId = params.projectId || params.prefix || params.program;
  const projectName = params.projectName || params.projectCode || params.prefix || params.program;

  for (const s of originalStudents) {
    const govName = resolveStudentGovernorate(s);
    const identity = resolveVpAcademicIdentity(params.program, s.Grade, (s as any).Track || (s as any).Course);
    const cohortKey = `${projectId}\u0000${govName}\u0000${identity.key}`;
    const cohort = cohortStudentsMap.get(cohortKey) || { governorate: govName, students: [] };
    cohort.students.push(s);
    cohortStudentsMap.set(cohortKey, cohort);
  }

  for (const [, cohort] of cohortStudentsMap) {
    const govName = cohort.governorate;
    const govStudents = cohort.students;
    const studentIds = Array.from(new Set(govStudents.map((student) => student.S_ID)));
    const totalCohortStudentCount = studentIds.length;

    if (totalCohortStudentCount > 0 && totalCohortStudentCount < 8) {
      const gradeList = Array.from(new Set(govStudents.map((s) => s.Grade))).sort((a, b) => a - b);
      const affectedAreas = Array.from(new Set(govStudents.map((s) => s["Physical Area"]))).sort();
      const academic = resolveVpAcademicIdentity(params.program, govStudents[0].Grade, (govStudents[0] as any).Track || (govStudents[0] as any).Course);
      const decisionKey = `${projectId}|${govName}|${academic.key}`;

      const labsInGov = Array.from(
        new Set(
          labRows
            .filter((l) => affectedAreas.includes(l.Area) || resolveStudentGovernorate({ "Physical Area": l.Area }) === govName)
            .map((l) => l["Lab ID"])
        )
      );

      const savedDecision = prefs.onlineMigrationDecisions
        ? prefs.onlineMigrationDecisions[decisionKey] ??
          prefs.onlineMigrationDecisions[govName] ??
          affectedAreas.map((a) => prefs.onlineMigrationDecisions?.[a]).find((d) => d !== undefined)
        : undefined;

      // Resolve legacy string decisions vs new object decisions
      const decisionStatus: "pending" | "accepted" | "rejected" | "keep_physical" =
        savedDecision == null
          ? "pending"
          : typeof savedDecision === "string"
          ? savedDecision
          : savedDecision.status;
      const decisionGrades: number[] | undefined =
        savedDecision != null && typeof savedDecision !== "string"
          ? savedDecision.grades
          : undefined;

      const affectedGradeCounts: Record<string, number> = {};
      for (const s of govStudents) {
        const lbl = (s as any).GradeLabel || (s as any).Grade_Label || CANONICAL_GRADE_LABELS[s.Grade] || `Grade ${s.Grade}`;
        affectedGradeCounts[lbl] = (affectedGradeCounts[lbl] ?? 0) + 1;
      }

      // Compute acceptedStudentIds for partial decisions
      const acceptedStudentIds: string[] | undefined =
        decisionStatus === "accepted" && decisionGrades && decisionGrades.length > 0
          ? Array.from(new Set(govStudents.filter((s) => decisionGrades.includes(s.Grade)).map((s) => s.S_ID)))
          : decisionStatus === "accepted"
          ? studentIds
          : undefined;

      onlineMigrationSuggestions.push({
        id: decisionKey,
        decisionKey,
        projectId,
        projectName,
        program: params.program,
        academicIdentity: academic.key,
        academicLabel: academic.label,
        ...(academic.track ? { track: academic.track } : {}),
        level: academic.level,
        governorate: govName,
        gov: govName,
        area: govName, // for backward compatibility
        labId: labsInGov.length > 0 ? labsInGov.join(", ") : "N/A",
        labCapacity: 0,
        totalAssigned: totalCohortStudentCount,
        studentCount: totalCohortStudentCount,
        totalCapacity: 0,
        utilizationRate: 0,
        utilizationPercent: 0,
        qualificationReason: "governorate_academic_cohort_under_8",
        affectedAreas,
        affectedStudentIds: studentIds,
        affectedGrades: gradeList,
        affectedGradeCounts,
        status: decisionStatus,
        ...(decisionGrades ? { acceptedGrades: decisionGrades } : {}),
        ...(acceptedStudentIds ? { acceptedStudentIds } : {}),
      });
    }
  }

  // Per-grade VP online migration: mark rows for accepted decisions (with optional grade filter)
  if (prefs.onlineMigrationDecisions) {
    for (const [decisionKey, decision] of Object.entries(prefs.onlineMigrationDecisions)) {
      const decStatus = typeof decision === "string" ? decision : decision.status;
      const decGrades: number[] | undefined =
        typeof decision !== "string" && decision.grades && decision.grades.length > 0
          ? decision.grades
          : undefined;

      if (decStatus === "accepted") {
        for (const row of masterAllocationSorted) {
          const rowGov = resolveStudentGovernorate({
            Gov: (row as any).Gov,
            Governorate: (row as any).Governorate,
            "Physical Area": String(row["Physical Area"] || ""),
          });
          const govMatch = rowGov === decisionKey || row["Physical Area"] === decisionKey;
          if (!govMatch) continue;
          const gradeMatch = !decGrades || decGrades.includes(Number(row.Grade));
          if (gradeMatch) {
            (row as any).Is_Online = true;
            (row as any).is_online = true;
            (row as any).Assigned_Lab = "ONLINE";
            (row as any).online_group = `ONLINE-${decisionKey}-G${row.Grade}`;
          }
        }
      }
    }
  }

  const vpGrouping = applyAcceptedVpGrouping(
    masterAllocationSorted as unknown as AllocationResultPayload["master_allocation"],
    onlineMigrationSuggestions,
    {
      id: projectId,
      name: projectName,
      program: params.program,
    },
    unassignedRows,
  );
  const acceptedVpStudentIds = new Set(
    onlineMigrationSuggestions
      .filter((suggestion) => suggestion.status === "accepted")
      .flatMap((suggestion) => suggestion.affectedStudentIds),
  );
  const migratedUnassignedCount = new Set(
    unassignedRows.filter((row) => acceptedVpStudentIds.has(row.S_ID)).map((row) => row.S_ID),
  ).size;
  const remainingUnassignedRows = unassignedRows.filter((row) => !acceptedVpStudentIds.has(row.S_ID));

  const currentJobId = makeJobId();
  const decoratedRemainingUnassignedRows = remainingUnassignedRows.map((row) => decorateAcademicRow(row as any, params.program));
  const decoratedShortfallMathRows = shortfallMathRows.map((row) => decorateAcademicRow(row as any, params.program));

  // ---------------------------------------------------------------------------
  // Detect Consolidated Overflow Fragments for Ops Review & Overfill Surfacing
  // ---------------------------------------------------------------------------
  const overflowFragmentNotices: OverflowFragmentNotice[] = [];
  const cohortRowsMap = new Map<string, typeof allMasterRows>();

  for (const row of allMasterRows) {
    if (row.Visit_Num !== undefined && row.Visit_Num !== 1) continue;
    const key = `${row["Physical Area"]}__${row.Grade}`;
    if (!cohortRowsMap.has(key)) cohortRowsMap.set(key, []);
    cohortRowsMap.get(key)!.push(row);
  }

  for (const [key, rows] of cohortRowsMap) {
    const [area, gradeStr] = key.split("__");
    const grade = Number(gradeStr);

    const labStudentMap = new Map<string, { count: number; capacity: number; groupIds: Set<string>; megaGroups: Set<string> }>();
    for (const r of rows) {
      const lId = r.Lab_ID;
      if (!labStudentMap.has(lId)) {
        labStudentMap.set(lId, {
          count: 0,
          capacity: r.Lab_Capacity,
          groupIds: new Set(),
          megaGroups: new Set(),
        });
      }
      const entry = labStudentMap.get(lId)!;
      entry.count += 1;
      if (r.Group_ID) entry.groupIds.add(r.Group_ID);
      if ((r as any).Mega_Group) entry.megaGroups.add(String((r as any).Mega_Group));
    }

    if (labStudentMap.size > 1) {
      const sortedLabs = [...labStudentMap.entries()].sort((a, b) => b[1].count - a[1].count);
      const [primaryLabId, primaryInfo] = sortedLabs[0];

      let totalOverflowStudents = 0;
      const overflowLabIds: string[] = [];
      const overflowGroupIds: string[] = [];
      const overflowMgNames: string[] = [];

      for (let i = 1; i < sortedLabs.length; i++) {
        const [overflowLabId, overflowInfo] = sortedLabs[i];
        if (overflowInfo.count < primaryInfo.capacity) {
          totalOverflowStudents += overflowInfo.count;
          overflowLabIds.push(overflowLabId);
          overflowGroupIds.push(...overflowInfo.groupIds);
          overflowMgNames.push(...overflowInfo.megaGroups);
        }
      }

      if (totalOverflowStudents > 0) {
        overflowFragmentNotices.push({
          area,
          grade,
          group_id: overflowGroupIds[0] || primaryLabId,
          primary_lab_id: primaryLabId,
          overflow_lab_id: overflowLabIds.join(", "),
          primary_students: primaryInfo.count,
          overflow_students: totalOverflowStudents,
          primary_capacity: primaryInfo.capacity,
          has_overfill_option: true,
          overfill_budget: 2,
          mega_group: overflowMgNames.length > 0 ? [...new Set(overflowMgNames)].join(", ") : undefined,
        });
      }
    }
  }

  // Also include unassigned leftover fragments (< 8 or capacity overflow) that can be solved with overfill
  const unassignedCohortMap = new Map<string, typeof remainingUnassignedRows>();
  for (const u of remainingUnassignedRows) {
    const key = `${u["Physical Area"]}__${u.Grade}`;
    if (!unassignedCohortMap.has(key)) unassignedCohortMap.set(key, []);
    unassignedCohortMap.get(key)!.push(u);
  }

  for (const [key, uRows] of unassignedCohortMap) {
    const [area, gradeStr] = key.split("__");
    const grade = Number(gradeStr);
    const existingNotice = overflowFragmentNotices.find((n) => n.area === area && n.grade === grade);

    const mRows = cohortRowsMap.get(key);
    if (mRows && mRows.length > 0) {
      const labCounts = new Map<string, { count: number; capacity: number; groupIds: Set<string>; megaGroups: Set<string> }>();
      for (const r of mRows) {
        if (!labCounts.has(r.Lab_ID)) {
          labCounts.set(r.Lab_ID, { count: 0, capacity: r.Lab_Capacity, groupIds: new Set(), megaGroups: new Set() });
        }
        const info = labCounts.get(r.Lab_ID)!;
        info.count++;
        if (r.Group_ID) info.groupIds.add(r.Group_ID);
        if ((r as any).Mega_Group) info.megaGroups.add(String((r as any).Mega_Group));
      }
      const [primaryLabId, primaryInfo] = [...labCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];

      const unassignedCount = uRows.length;
      if (existingNotice) {
        existingNotice.overflow_students += unassignedCount;
        if (!existingNotice.overflow_lab_id.includes("Unassigned")) {
          existingNotice.overflow_lab_id = existingNotice.overflow_lab_id
            ? `${existingNotice.overflow_lab_id}, Unassigned (Special Overfill)`
            : "Unassigned (Special Overfill)";
        }
      } else if (unassignedCount > 0) {
        const uMgNames = uRows.map((r: any) => r.Mega_Group).filter(Boolean);
        overflowFragmentNotices.push({
          area,
          grade,
          group_id: [...primaryInfo.groupIds][0] || primaryLabId,
          primary_lab_id: primaryLabId,
          overflow_lab_id: "Unassigned (Special Overfill)",
          primary_students: primaryInfo.count,
          overflow_students: unassignedCount,
          primary_capacity: primaryInfo.capacity,
          has_overfill_option: true,
          overfill_budget: 2,
          mega_group: uMgNames.length > 0 ? [...new Set(uMgNames)].join(", ") : primaryInfo.megaGroups.size > 0 ? [...primaryInfo.megaGroups].join(", ") : undefined,
        });
      }
    }
  }

  const finalAccounting = calculateAllocationAccounting(vpGrouping.rows, remainingUnassignedRows);
  const physicalSessionsCount = new Set(
    vpGrouping.rows
      .filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE" && r.Group_ID)
      .map((r) => r.Group_ID),
  ).size;

  const payload: AllocationResultPayload = {
    jobId: currentJobId,
    job_id: currentJobId,
    summary: {
      ...summary,
      assigned_count: finalAccounting.physicalAssignedCount + finalAccounting.vpAssignedCount,
      unassigned_count: finalAccounting.unassignedCount,
      total_seat_visits: finalAccounting.totalSeatVisits,
      total_sessions_assigned: physicalSessionsCount || summary.total_sessions_assigned,
    },
    logs,
    shortfall_text: shortfallText,
    overfill_details: overfillDetails,
    preferences_applied: prefs,
    online_migration_suggestions: onlineMigrationSuggestions,
    vp_sessions: vpGrouping.sessions,
    consolidation_analysis: consolidationAnalysis,
    dashboard_summary: dashboardStyleSummary as AllocationResultPayload["dashboard_summary"],
    area_grade_summary: groupCountSummary as AllocationResultPayload["area_grade_summary"],
    master_allocation: vpGrouping.rows as unknown as AllocationResultPayload["master_allocation"],
    physical_master_allocation: masterAllocationSorted as unknown as AllocationResultPayload["master_allocation"],
    lab_pivot: areaTimePivot as unknown as AllocationResultPayload["lab_pivot"],
    vp_pivot: buildVpPivotSummary(vpGrouping.sessions, vpGrouping.rows as any, slotInfo, params.program) as unknown as AllocationResultPayload["vp_pivot"],
    lab_allocation: labAllocationTable as unknown as AllocationResultPayload["lab_allocation"],
    unassigned_students: decoratedRemainingUnassignedRows as AllocationResultPayload["unassigned_students"],
    physical_unassigned_students: unassignedRows.map((row) => decorateAcademicRow(row as any, params.program)) as AllocationResultPayload["unassigned_students"],
    shortfall_math: decoratedShortfallMathRows as AllocationResultPayload["shortfall_math"],
    overflow_fragment_notices: overflowFragmentNotices,
    generated_files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, f.filename])),
  };

  return { payload, files };
}
