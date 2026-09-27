import type { MasterAllocationInternalRow, UnassignedInternalRow } from "./master";
import type { AugmentedSession } from "./distribute";
import { formatGradeLabel, type LabRow } from "./parse";
import type { SlotInfo } from "./schedule";
import { DEFAULT_SLOT_INFO } from "./schedule";
import { formatGradeLevel, getAcademicLevel, getAcademicTrack, type ProjectProgram } from "../project-grade-levels";
import { isVpStudent } from "../allocation-client";

function sortAreas(areas: Iterable<string>): string[] {
  return [...new Set(areas)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Port of build_dashboard_style_summary. Field/key insertion order matters
 * here — the UI renders this table's columns via `Object.keys(row)`. */
export function buildDashboardStyleSummary(
  masterRows: MasterAllocationInternalRow[],
  unassignedRows: UnassignedInternalRow[],
  program?: ProjectProgram | "CUSTOM",
): Array<Record<string, string | number>> {
  const physicalMaster = masterRows.filter((r) => !isVpStudent(r));
  const physicalUnassigned = unassignedRows.filter((u) => !isVpStudent(u));
  if (physicalMaster.length === 0 && physicalUnassigned.length === 0) return [];

  const grades = [...new Set([...physicalMaster.map((r) => r.Grade), ...physicalUnassigned.map((u) => u.Grade)])].sort((a, b) => a - b);
  const areas = sortAreas([...physicalMaster.map((r) => r["Physical Area"]), ...physicalUnassigned.map((u) => u["Physical Area"])]);

  const studentSets = new Map<string, Set<string>>(); // `${area}__${grade}` -> Set<S_ID>
  const groupSets = new Map<string, Set<string>>(); // `${area}__${grade}` -> Set<Group_ID>
  for (const r of physicalMaster) {
    const key = `${r["Physical Area"]}__${r.Grade}`;
    if (!studentSets.has(key)) studentSets.set(key, new Set());
    studentSets.get(key)!.add(r.S_ID);
    if (!groupSets.has(key)) groupSets.set(key, new Set());
    groupSets.get(key)!.add(r.Group_ID);
  }

  const unassignedSets = new Map<string, Set<string>>(); // `${area}__${grade}` -> Set<S_ID>
  for (const u of physicalUnassigned) {
    const key = `${u["Physical Area"]}__${u.Grade}`;
    if (!unassignedSets.has(key)) unassignedSets.set(key, new Set());
    unassignedSets.get(key)!.add(u.S_ID);
  }

  const out: Array<Record<string, string | number>> = [];
  for (const area of areas) {
    const row: Record<string, string | number> = { "Physical Area": area };

    const demandCounts: Record<number, number> = {};
    const assignedCounts: Record<number, number> = {};
    const unassignedCounts: Record<number, number> = {};
    const groupCounts: Record<number, number> = {};

    let totalDemand = 0;
    let totalAssigned = 0;
    let totalUnassigned = 0;
    let totalGroups = 0;

    for (const g of grades) {
      const key = `${area}__${g}`;
      const assigned = studentSets.get(key)?.size ?? 0;
      const unassigned = unassignedSets.get(key)?.size ?? 0;
      const demand = assigned + unassigned;
      const groups = groupSets.get(key)?.size ?? 0;

      demandCounts[g] = demand;
      assignedCounts[g] = assigned;
      unassignedCounts[g] = unassigned;
      groupCounts[g] = groups;

      totalDemand += demand;
      totalAssigned += assigned;
      totalUnassigned += unassigned;
      totalGroups += groups;
    }

    // 1. Demand Section (Source Student Demand per Grade & Row Grand Total)
    for (const g of grades) {
      row[`${formatGradeLevel(g, program, true)} Demand`] = demandCounts[g];
    }
    row["Total Demand"] = totalDemand;

    // 2. Assigned Section (Placed Students per Grade & Total Assigned)
    for (const g of grades) {
      row[`${formatGradeLevel(g, program, true)} Assigned`] = assignedCounts[g];
    }
    row["Total Assigned"] = totalAssigned;

    // 3. Unassigned Section (Shortfall per Grade & Dedicated Total Unassigned)
    for (const g of grades) {
      row[`${formatGradeLevel(g, program, true)} Unassigned`] = unassignedCounts[g];
    }
    row["Total Unassigned"] = totalUnassigned;

    // 4. Groups Section (Groups Formed)
    for (const g of grades) {
      row[`${formatGradeLevel(g, program, true)} Groups`] = groupCounts[g];
    }
    row["Total Groups"] = totalGroups;

    // Non-enumerable aliases for full backward-compatibility with existing tests and readers
    Object.defineProperty(row, "Grand Total", {
      get() {
        return totalAssigned;
      },
      set(v) {
        totalAssigned = v;
      },
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(row, "Unassigned", {
      get() {
        return totalUnassigned;
      },
      set(v) {
        totalUnassigned = v;
      },
      enumerable: false,
      configurable: true,
    });
    for (const g of grades) {
      Object.defineProperty(row, `G${g}`, {
        get() {
          return assignedCounts[g];
        },
        set(v) {
          assignedCounts[g] = v;
        },
        enumerable: false,
        configurable: true,
      });
    }

    out.push(row);
  }
  return out;
}

/** Port of build_readable_master (sorted, reordered column subset). */
export function buildReadableMaster(masterRows: MasterAllocationInternalRow[], slotInfo: SlotInfo[] = DEFAULT_SLOT_INFO, program?: ProjectProgram | "CUSTOM"): Array<Record<string, unknown>> {
  if (masterRows.length === 0) return [];
  const slotOrderLookup = new Map(slotInfo.map((s, idx) => [s.num, idx]));
  const sorted = [...masterRows].sort((a, b) => {
    if (a["Physical Area"] !== b["Physical Area"]) return a["Physical Area"] < b["Physical Area"] ? -1 : 1;
    if (a.Grade !== b.Grade) return a.Grade - b.Grade;
    const orderA = slotOrderLookup.get(a.Slot_Num) ?? 99;
    const orderB = slotOrderLookup.get(b.Slot_Num) ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    if (a.Lab_ID !== b.Lab_ID) return a.Lab_ID < b.Lab_ID ? -1 : 1;
    return a.S_ID < b.S_ID ? -1 : a.S_ID > b.S_ID ? 1 : 0;
  });
  return sorted.map((r) => ({
    "Physical Area": r["Physical Area"],
    Original_Physical_Area: r.Original_Physical_Area ?? r["Physical Area"],
    Allocation_Area: r.Allocation_Area ?? r["Physical Area"],
    Governorate: r.Governorate,
    Grade: r.Grade,
    Academic_Label: formatGradeLevel(r.Grade, program, true),
    Track: getAcademicTrack(r.Grade, program),
    Level: getAcademicLevel(r.Grade, program),
    Day: r.Day,
    Time_Slot: r.Time_Slot,
    Lab_ID: r.Lab_ID,
    Group_ID: r.Group_ID,
    Slot_Key: r.Slot_Key,
    Slot_Num: r.Slot_Num,
    S_ID: r.S_ID,
    Lab_Capacity: r.Lab_Capacity,
    Assigned_Count_Per_Lab: r.Assigned_Count_Per_Lab,
    Is_Overfill: r.Is_Overfill,
    Visit_Num: r.Visit_Num,
    Visit_Type: r.Visit_Type,
    Repeat_Count: r.Repeat_Count,
    Mega_Group: (r as any).Mega_Group,
  }));
}

/** Port of build_area_time_pivot. */
export function getLabPivotColumns(
  program: ProjectProgram | "CUSTOM" | undefined,
  slotInfo: SlotInfo[],
): string[] {
  const metadata = program === "DECI"
    ? ["Physical Area", "Track", "Level", "Lab_ID"]
    : ["Physical Area", "Grade", "Lab_ID"];
  return [...metadata, ...slotInfo.map((slot) => slot.label)];
}

export function buildAreaTimePivot(
  masterRows: MasterAllocationInternalRow[],
  slotInfo: SlotInfo[] = DEFAULT_SLOT_INFO,
  program?: ProjectProgram | "CUSTOM",
): Array<Record<string, unknown>> {
  const physicalRows = masterRows.filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE");
  if (physicalRows.length === 0) return [];
  type CellGroup = { area: string; grade: number; labId: string; slotNum: number; students: number; capacity: number };
  const groups = new Map<string, CellGroup>();
  for (const r of physicalRows) {
    const key = `${r["Physical Area"]}__${r.Grade}__${r.Lab_ID}__${r.Slot_Num}`;
    if (!groups.has(key)) {
      groups.set(key, { area: r["Physical Area"], grade: r.Grade, labId: r.Lab_ID, slotNum: r.Slot_Num, students: 0, capacity: r.Lab_Capacity });
    }
    groups.get(key)!.students += 1;
  }

  type PivotRow = { area: string; grade: number; labId: string; cells: Map<number, string> };
  const pivotRows = new Map<string, PivotRow>();
  for (const g of groups.values()) {
    const rowKey = `${g.area}__${g.grade}__${g.labId}`;
    if (!pivotRows.has(rowKey)) pivotRows.set(rowKey, { area: g.area, grade: g.grade, labId: g.labId, cells: new Map() });
    pivotRows.get(rowKey)!.cells.set(g.slotNum, `${g.students}/${g.capacity}`);
  }

  const rows = [...pivotRows.values()].sort((a, b) => {
    if (a.area !== b.area) return a.area < b.area ? -1 : 1;
    if (a.grade !== b.grade) return a.grade - b.grade;
    return a.labId < b.labId ? -1 : a.labId > b.labId ? 1 : 0;
  });

  return rows.map((r) => {
    const out: Record<string, unknown> = {
      "Physical Area": r.area,
      Grade: r.grade,
      Lab_ID: r.labId,
    };
    for (const slot of slotInfo) {
      out[slot.label] = r.cells.get(slot.num) ?? "-";
    }
    return out;
  });
}

export interface SingleSessionLabPivotCell {
  groupId: string;
  grade: number;
  academicLabel: string;
  studentCount: number;
  capacity: number;
  slotNum: number;
  slotLabel: string;
  date?: string;
  day: string;
  time?: string;
  governorate: string;
  physicalArea: string;
  integrityIssue?: string;
}

export interface SingleSessionLabPivotRow {
  rowKey: string;
  governorate: string;
  physicalArea: string;
  labId: string;
  capacity: number;
  cells: Map<number, SingleSessionLabPivotCell>;
}

/** Lab-centric pivot used only by the single-session Lab Grid Matrix. */
export function buildSingleSessionLabPivot(
  masterRows: MasterAllocationInternalRow[],
  slotInfo: SlotInfo[] = DEFAULT_SLOT_INFO,
  program?: ProjectProgram | "CUSTOM",
): SingleSessionLabPivotRow[] {
  const physicalRows = masterRows.filter((row) => !isVpStudent(row) && row.Lab_ID !== "ONLINE");
  const slotsByNumber = new Map(slotInfo.map((slot) => [slot.num, slot]));
  type CellAccumulator = {
    row: MasterAllocationInternalRow;
    studentIds: Set<string>;
    groupIds: Set<string>;
    grades: Set<number>;
  };
  type RowAccumulator = Omit<SingleSessionLabPivotRow, "cells"> & { cells: Map<number, CellAccumulator> };
  const rows = new Map<string, RowAccumulator>();

  for (const row of physicalRows) {
    const governorate = String(row.Governorate ?? "").trim() || "—";
    const physicalArea = String(row["Physical Area"] ?? "").replace(/\s+/g, " ").trim();
    const labId = String(row.Lab_ID ?? "").replace(/\s+/g, " ").trim();
    const slotNum = Number(row.Slot_Num);
    if (!labId || !Number.isFinite(slotNum)) continue;

    const rowKey = labId;
    if (!rows.has(rowKey)) {
      rows.set(rowKey, {
        rowKey,
        governorate,
        physicalArea,
        labId,
        capacity: Number(row.Lab_Capacity) || 0,
        cells: new Map(),
      });
    }
    const lab = rows.get(rowKey)!;
    if (lab.governorate === "—" && governorate !== "—") lab.governorate = governorate;
    if (!lab.physicalArea && physicalArea) lab.physicalArea = physicalArea;
    lab.capacity = Math.max(lab.capacity, Number(row.Lab_Capacity) || 0);
    if (!lab.cells.has(slotNum)) {
      lab.cells.set(slotNum, {
        row,
        studentIds: new Set(),
        groupIds: new Set(),
        grades: new Set(),
      });
    }
    const cell = lab.cells.get(slotNum)!;
    cell.studentIds.add(String(row.S_ID));
    cell.groupIds.add(String(row.Group_ID ?? "").trim());
    cell.grades.add(Number(row.Grade));
  }

  return [...rows.values()]
    .sort((a, b) => a.governorate.localeCompare(b.governorate)
      || a.physicalArea.localeCompare(b.physicalArea)
      || a.labId.localeCompare(b.labId, undefined, { numeric: true }))
    .map((lab) => ({
      rowKey: lab.rowKey,
      governorate: lab.governorate,
      physicalArea: lab.physicalArea,
      labId: lab.labId,
      capacity: lab.capacity,
      cells: new Map([...lab.cells.entries()].map(([slotNum, accumulated]) => {
        const slot = slotsByNumber.get(slotNum);
        const groupIds = [...accumulated.groupIds].filter(Boolean).sort();
        const grades = [...accumulated.grades].filter(Number.isFinite).sort((a, b) => a - b);
        const integrityIssue = groupIds.length > 1 || grades.length > 1
          ? `Integrity issue: ${groupIds.length} groups / ${grades.length} academic identities share this lab and slot.`
          : undefined;
        const grade = grades[0] ?? Number(accumulated.row.Grade);
        return [slotNum, {
          groupId: groupIds[0] ?? "",
          grade,
          academicLabel: formatGradeLevel(grade, program, true),
          studentCount: accumulated.studentIds.size,
          capacity: Number(accumulated.row.Lab_Capacity) || lab.capacity,
          slotNum,
          slotLabel: slot?.label ?? String(accumulated.row.Time_Slot ?? ""),
          date: slot?.date,
          day: slot?.day ?? String(accumulated.row.Day ?? ""),
          time: slot?.time ?? String(accumulated.row.Time_Slot ?? ""),
          governorate: lab.governorate,
          physicalArea: lab.physicalArea,
          integrityIssue,
        } satisfies SingleSessionLabPivotCell];
      })),
    }));
}

/** Builds dedicated matrix pivot rows for VP Sessions. */
export function buildVpPivotSummary(
  vpSessions: Array<{
    id: string;
    projectId?: string;
    projectName?: string;
    track?: string;
    level: number;
    studentCount: number;
    capacity: number;
    governorates?: string[];
    slotNum?: number;
  }>,
  masterRows: Array<Record<string, any>> = [],
  slotInfo: SlotInfo[] = DEFAULT_SLOT_INFO,
  program?: ProjectProgram | "CUSTOM",
): Array<Record<string, unknown>> {
  if (!vpSessions || vpSessions.length === 0) return [];

  const vpSlotMap = new Map<string, number>();
  for (const r of masterRows) {
    if (isVpStudent(r) && r.Slot_Num && (r.Group_ID || r.VP_Session_ID)) {
      const gid = String(r.VP_Session_ID || r.Group_ID);
      vpSlotMap.set(gid, Number(r.Slot_Num));
    }
  }

  return vpSessions.map((session, index) => {
    const govLabel = (session.governorates && session.governorates.length > 0)
      ? session.governorates.join(", ")
      : "Virtual Portal";
    const trackLabel = session.track || (program === "DEMI" ? `Grade ${session.level}` : "General");
    const levelLabel = program === "DEMI" ? `G${session.level}` : `L${session.level}`;

    const out: Record<string, unknown> = {
      "Session ID": session.id,
      "Physical Area": govLabel,
      Governorate: govLabel,
      Track: trackLabel,
      Level: levelLabel,
      Grade: session.level,
      Lab_ID: session.id,
      Capacity: session.capacity,
      Assigned: session.studentCount,
    };

    const maxSlots = Math.max(1, slotInfo.length);
    const fallbackSlot = slotInfo[index % maxSlots]?.num ?? 1;
    const assignedSlotNum =
      vpSlotMap.get(session.id) ||
      session.slotNum ||
      fallbackSlot;

    for (const slot of slotInfo) {
      out[slot.label] =
        slot.num === assignedSlotNum
          ? `${session.studentCount}/${session.capacity}`
          : "-";
    }
    return out;
  });
}

/** Port of build_group_count_summary. */
export function buildGroupCountSummary(
  masterRows: MasterAllocationInternalRow[],
  unassignedRows: UnassignedInternalRow[],
  program?: ProjectProgram | "CUSTOM",
): Array<{ "Physical Area": string; Grade: number; Academic_Label: string; Track?: string; Level: string; Students_Assigned: number; Unique_Groups: number; Labs_Used: number; Unassigned: number; Total_Students: number }> {
  const physicalMaster = masterRows.filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE");
  const physicalUnassigned = unassignedRows.filter((u) => !isVpStudent(u));
  if (physicalMaster.length === 0 && physicalUnassigned.length === 0) return [];

  type Agg = { studentIds: Set<string>; groupIds: Set<string>; labIds: Set<string> };
  const agg = new Map<string, Agg>();
  for (const r of physicalMaster) {
    const key = `${r["Physical Area"]}__${r.Grade}`;
    if (!agg.has(key)) agg.set(key, { studentIds: new Set(), groupIds: new Set(), labIds: new Set() });
    const a = agg.get(key)!;
    a.studentIds.add(r.S_ID);
    a.groupIds.add(r.Group_ID);
    a.labIds.add(r.Lab_ID);
  }
  const unassignedAgg = new Map<string, number>();
  for (const u of physicalUnassigned) {
    const key = `${u["Physical Area"]}__${u.Grade}`;
    unassignedAgg.set(key, (unassignedAgg.get(key) ?? 0) + 1);
  }

  const allKeys = new Set([...agg.keys(), ...unassignedAgg.keys()]);
  const rows = [...allKeys].map((key) => {
    const [area, gradeStr] = key.split("__");
    const grade = Number(gradeStr);
    const a = agg.get(key);
    const studentsAssigned = a?.studentIds.size ?? 0;
    const unassigned = unassignedAgg.get(key) ?? 0;
    return {
      "Physical Area": area,
      Grade: grade,
      Academic_Label: formatGradeLevel(grade, program, true),
      Track: getAcademicTrack(grade, program),
      Level: getAcademicLevel(grade, program),
      Total_Students: studentsAssigned + unassigned,
      Students_Assigned: studentsAssigned,
      Unassigned: unassigned,
      Unique_Groups: a?.groupIds.size ?? 0,
      Groups_Used: a?.groupIds.size ?? 0,
      Labs_Used: a?.labIds.size ?? 0,
    };
  });

  return rows.sort((a, b) => {
    if (a["Physical Area"] !== b["Physical Area"]) return a["Physical Area"] < b["Physical Area"] ? -1 : 1;
    return a.Grade - b.Grade;
  });
}

/** Port of build_lab_allocation_table. */
export function buildLabAllocationTable(
  sessionsAugmented: AugmentedSession[],
  program?: ProjectProgram | "CUSTOM",
): Array<{ Area: string; Grade: number; Lab_ID: string; Time_Slot: string; Capacity: number }> {
  if (sessionsAugmented.length === 0) return [];
  const rows = sessionsAugmented.map((s) => ({
    Area: s.Area,
    Grade: s.Grade,
    Academic_Label: formatGradeLevel(s.Grade, program, true),
    Track: getAcademicTrack(s.Grade, program),
    Level: getAcademicLevel(s.Grade, program),
    Lab_ID: s["Lab ID"],
    Time_Slot: s.Slot_Label,
    Capacity: s.True_Capacity,
  }));
  return rows.sort((a, b) => {
    if (a.Area !== b.Area) return a.Area < b.Area ? -1 : 1;
    if (a.Grade !== b.Grade) return a.Grade - b.Grade;
    return a.Lab_ID < b.Lab_ID ? -1 : a.Lab_ID > b.Lab_ID ? 1 : 0;
  });
}

/** Port of explain_shortfall. */
export function explainShortfall(
  area: string,
  areaSessions: AugmentedSession[] | Array<{ Lab_ID: string; Lab_Capacity: number }>,
  gradeCounts: Record<number, number>,
  perGradeShortfall: Record<number, number>,
): string {
  const labCaps = new Map<string, number>();
  for (const s of areaSessions as Array<{ Lab_ID?: string; "Lab ID"?: string; Lab_Capacity?: number; True_Capacity?: number }>) {
    const labId = (s as any).Lab_ID ?? (s as any)["Lab ID"];
    const cap = (s as any).Lab_Capacity ?? (s as any).True_Capacity;
    if (!labCaps.has(labId)) labCaps.set(labId, cap);
  }
  const totalSessions = (areaSessions as unknown[]).length;
  const capsObj = Object.fromEntries(labCaps);

  if (labCaps.size === 0) {
    const lines: string[] = [
      `AREA: ${area}`,
      `  Labs: 0  |  True capacities: {}`,
      `  Total sessions available: 0`,
      "",
    ];
    let totalNeeded = 0;
    for (const [gStr, demand] of Object.entries(gradeCounts)) {
      const grade = Number(gStr);
      const minSessions = Math.ceil(demand / 25);
      totalNeeded += minSessions;
      lines.push(`  ${formatGradeLevel(grade, undefined, true)}: ${demand} students / best-case 25 cap -> needs >= ${minSessions} sessions  <-- SHORT`);
    }
    lines.push("");
    lines.push(`  TOTAL sessions needed (best case): ${totalNeeded}  |  available: 0`);
    const totalShort = Object.values(perGradeShortfall).reduce((a, b) => a + b, 0);
    lines.push(`  GAP: short by ${totalNeeded} session(s) area-wide -> ${totalShort} student(s) can't be seated (No physical labs exist in this area).`);
    lines.push("-".repeat(70));
    return lines.join("\n");
  }

  const lines: string[] = [
    `AREA: ${area}`,
    `  Labs: ${labCaps.size}  |  True capacities: ${JSON.stringify(capsObj)}`,
    `  Total sessions available: ${totalSessions}`,
    "",
  ];
  let totalNeeded = 0;
  const maxCap = Math.max(...[...labCaps.values()], 25);
  for (const [gStr, demand] of Object.entries(gradeCounts)) {
    const grade = Number(gStr);
    const minSessions = Math.ceil(demand / maxCap);
    totalNeeded += minSessions;
    const short = perGradeShortfall[grade] ?? 0;
    const flag = short > 0 ? "  <-- SHORT" : "";
    lines.push(`  ${formatGradeLevel(grade, undefined, true)}: ${demand} students / best-case ${maxCap} cap -> needs >= ${minSessions} sessions${flag}`);
  }
  lines.push("");
  lines.push(`  TOTAL sessions needed (best case): ${totalNeeded}  |  available: ${totalSessions}`);
  const gap = totalNeeded - totalSessions;
  if (gap > 0) {
    const totalShort = Object.values(perGradeShortfall).reduce((a, b) => a + b, 0);
    lines.push(`  GAP: short by ${gap} session(s) area-wide -> ${totalShort} student(s) can't be seated`);
  } else {
    lines.push("  No structural session-count gap (ILP found a tighter combinatorial reason).");
  }
  lines.push("-".repeat(70));
  return lines.join("\n");
}

/** Port of build_shortfall_explanation. */
export function buildShortfallExplanation(
  sessions: AugmentedSession[],
  studentsByAreaGrade: Map<string, number>,
  shortfallReport: Array<{ Area: string; Grade: number; Students_Short: number }>,
): { shortfallRows: Array<{ Area: string; Grade: number; Students_Short: number }>; text: string } | null {
  if (shortfallReport.length === 0) return null;

  const areas = [...new Set(shortfallReport.map((r) => r.Area))].sort();
  const blocks: string[] = [];
  for (const area of areas) {
    const areaSessions = sessions.filter((s) => s.Area === area);
    const gradeCounts: Record<number, number> = {};
    for (const [key, count] of studentsByAreaGrade) {
      const [a, gStr] = key.split("__");
      if (a === area) gradeCounts[Number(gStr)] = count;
    }
    const perGradeShortfall: Record<number, number> = {};
    for (const r of shortfallReport) {
      if (r.Area === area) perGradeShortfall[r.Grade] = r.Students_Short;
    }
    blocks.push(explainShortfall(area, areaSessions, gradeCounts, perGradeShortfall));
  }
  return { shortfallRows: shortfallReport, text: blocks.join("\n\n") };
}

/** Port of build_dashboard_output. Only used to produce the downloadable
 * dashboard_output.xlsx file — it isn't part of the JSON summary payload. */
export function buildDashboardOutput(
  masterRows: MasterAllocationInternalRow[],
  labRows: LabRow[],
  dashboardTemplate: { headers: string[]; rows: Array<Record<string, unknown>> } | null,
  slotInfo: SlotInfo[] = DEFAULT_SLOT_INFO,
  log: (msg: string) => void = () => {},
  program?: ProjectProgram | "CUSTOM",
): Array<Record<string, unknown>> {
  const slotGradeCols = slotInfo.map((s) => `${s.label} Grade`);
  const slotIdCols = slotInfo.map((s) => s.label);
  const slotLabelByNum = new Map(slotInfo.map((s) => [s.num, s.label]));

  const labSlotLookup = new Map<string, Map<string, { grade: number; groupId: string }>>();
  const slotEntries = new Map<string, MasterAllocationInternalRow>();
  for (const r of masterRows) {
    const existing = slotEntries.get(r.Slot_Key);
    if (!existing) {
      slotEntries.set(r.Slot_Key, r);
    } else if ((existing.Visit_Num ?? 1) > 1 && (r.Visit_Num ?? 1) === 1) {
      // Primary allocation takes precedence over repeat visit so primary cohorts are never dropped
      slotEntries.set(r.Slot_Key, r);
    }
  }
  for (const r of slotEntries.values()) {
    const label = slotLabelByNum.get(r.Slot_Num);
    if (!label) continue;
    if (!labSlotLookup.has(r.Lab_ID)) labSlotLookup.set(r.Lab_ID, new Map());
    labSlotLookup.get(r.Lab_ID)!.set(label, { grade: r.Grade, groupId: r.Group_ID });
  }

  const sessionsUsedPerLab = new Map<string, number>();
  for (const r of slotEntries.values()) {
    sessionsUsedPerLab.set(r.Lab_ID, (sessionsUsedPerLab.get(r.Lab_ID) ?? 0) + 1);
  }

  const fillDashboardRow = (labId: string): Record<string, unknown> => {
    const slotMap = labSlotLookup.get(labId) ?? new Map();
    const out: Record<string, unknown> = { "Number of Sessions": sessionsUsedPerLab.get(labId) ?? 0 };
    for (const slot of slotInfo) {
      const entry = slotMap.get(slot.label);
      out[`${slot.label} Grade`] = entry ? formatGradeLevel(entry.grade, program, true) : null;
      out[slot.label] = entry ? entry.groupId : null;
    }
    return out;
  };

  if (dashboardTemplate) {
    const templateRows = dashboardTemplate.rows.map((r) => ({ ...r }));
    const columns = new Set(dashboardTemplate.headers);
    for (const col of ["Number of Sessions", ...slotGradeCols, ...slotIdCols]) {
      if (!columns.has(col)) columns.add(col);
    }
    for (const row of templateRows) {
      const labId = row["Lab ID"];
      if (labId != null && labRows.some((l) => l["Lab ID"] === labId)) {
        Object.assign(row, fillDashboardRow(String(labId)));
      }
    }
    const templateLabIds = new Set(templateRows.map((r) => r["Lab ID"]));
    const missingLabs = labRows.filter((l) => !templateLabIds.has(l["Lab ID"]));
    if (missingLabs.length > 0) {
      for (const l of missingLabs) {
        const row: Record<string, unknown> = {};
        for (const col of columns) row[col] = null;
        row["Lab ID"] = l["Lab ID"];
        row["Area"] = l.Area;
        row["Lab Capacity"] = l["Lab Capacity"];
        Object.assign(row, fillDashboardRow(l["Lab ID"]));
        templateRows.push(row);
      }
      log(`Appended ${missingLabs.length} lab(s) present in the Lab file but not in the Dashboard template.`);
    }
    log(`Filled existing Dashboard template -- ${templateRows.length} lab rows.`);
    return templateRows;
  }

  const rows = labRows.map((l) => ({
    "Lab ID": l["Lab ID"],
    Area: l.Area,
    "Lab Capacity": l["Lab Capacity"],
    ...fillDashboardRow(l["Lab ID"]),
  }));
  log(`Constructed Dashboard output with ${slotInfo.length} configured time slots across ${rows.length} labs.`);
  return rows;
}
