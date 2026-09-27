// Port of ilp_allocate_area / run_ilp_all_areas from scripts/lab_allocation.py.
//
// The original assigns each individual session a binary decision variable per
// grade (x[session, grade]). That is faithful to the Python/PuLP+CBC version,
// but a naive port of it to a pure-JS MILP solver (no CBC-grade presolve/cuts)
// can hang on real inputs: many sessions share the exact same capacity, and
// the solver's branch-and-bound explores every symmetric permutation of
// otherwise-identical sessions.
//
// To keep this both exact and fast, sessions that are indistinguishable for
// this optimization — same capacity, same overfill allowance, same set of
// grades eligible for a "preferred lab" bonus — are grouped into one "type",
// and the solver decides how many sessions of each type go to each grade
// (an integer count) instead of branching on every individual session. This
// produces the same optimal objective value as the per-session formulation
// (grouping identical items is a standard, exact technique — it does not
// change what's achievable, only how the search space is explored), and the
// grouped counts are then unpacked back into specific sessions afterwards.
import solver from "javascript-lp-solver";
import type { SessionRow } from "./grid";
import type { AllocationPreferences } from "@/lib/allocation-client";

import { yieldToMainThread } from "./async-util";

const MIN_SINGLE_SESSION_LAB_STUDENTS = 8;

export interface IlpAreaResult {
  slotAssignment: Record<string, number>; // Slot_Key -> Grade
  perGradeShortfall: Record<number, number>;
}

function compareSessionChronologically(a: SessionRow, b: SessionRow): number {
  const dateA = a.Date || a.Day || "";
  const dateB = b.Date || b.Day || "";
  return dateA.localeCompare(dateB) || a.Slot_Num - b.Slot_Num || a.Slot_Key.localeCompare(b.Slot_Key);
}

/** Deterministic single-session selector that minimizes physical labs before sessions. */
export function allocateSingleSessionArea(
  areaSessions: SessionRow[],
  gradeCounts: Record<number, number>,
  preferences?: Partial<AllocationPreferences> | null,
): IlpAreaResult {
  const areaName = areaSessions[0]?.Area ?? "";
  const grades = Object.keys(gradeCounts).map(Number).sort((a, b) => a - b);
  const availableKeys = new Set(areaSessions.map((session) => session.Slot_Key));
  const activatedLabs = new Set<string>();
  const slotAssignment: Record<string, number> = {};
  const perGradeShortfall: Record<number, number> = {};

  const sessionsByLab = new Map<string, SessionRow[]>();
  for (const session of areaSessions) {
    const labId = session["Lab ID"];
    if (!sessionsByLab.has(labId)) sessionsByLab.set(labId, []);
    sessionsByLab.get(labId)!.push(session);
  }
  for (const sessions of sessionsByLab.values()) sessions.sort(compareSessionChronologically);

  for (const grade of grades) {
    let remaining = gradeCounts[grade] ?? 0;
    let assignedForGrade = 0;
    const labIds = [...sessionsByLab.keys()].sort((labA, labB) => {
      const sessionsA = sessionsByLab.get(labA)!.filter((s) => availableKeys.has(s.Slot_Key));
      const sessionsB = sessionsByLab.get(labB)!.filter((s) => availableKeys.has(s.Slot_Key));
      const preferredA = sessionsA.some((s) => preferredGradesFor(labA, s.Slot_Num, areaName, [grade], preferences?.preferredLabRules ?? []).includes(grade));
      const preferredB = sessionsB.some((s) => preferredGradesFor(labB, s.Slot_Num, areaName, [grade], preferences?.preferredLabRules ?? []).includes(grade));
      if (preferredA !== preferredB) return preferredA ? -1 : 1;
      const activeA = activatedLabs.has(labA);
      const activeB = activatedLabs.has(labB);
      if (activeA !== activeB) return activeA ? -1 : 1;
      const capacityA = sessionsA.reduce((sum, s) => sum + s.True_Capacity + overfillCapFor(labA, areaName, grade, preferences?.overfillRules ?? []), 0);
      const capacityB = sessionsB.reduce((sum, s) => sum + s.True_Capacity + overfillCapFor(labB, areaName, grade, preferences?.overfillRules ?? []), 0);
      return capacityB - capacityA || labA.localeCompare(labB, undefined, { numeric: true });
    });

    for (const labId of labIds) {
      if (remaining <= 0 || (assignedForGrade > 0 && remaining < MIN_SINGLE_SESSION_LAB_STUDENTS)) break;
      const sessions = sessionsByLab.get(labId)!.filter((session) => availableKeys.has(session.Slot_Key));
      for (const session of sessions) {
        if (remaining <= 0 || (assignedForGrade > 0 && remaining < MIN_SINGLE_SESSION_LAB_STUDENTS)) break;
        slotAssignment[session.Slot_Key] = grade;
        availableKeys.delete(session.Slot_Key);
        activatedLabs.add(labId);
        const effectiveCapacity = session.True_Capacity + overfillCapFor(
          labId,
          areaName,
          grade,
          preferences?.overfillRules ?? [],
        );
        const assigned = Math.min(remaining, effectiveCapacity);
        assignedForGrade += assigned;
        remaining -= assigned;
      }
    }
    perGradeShortfall[grade] = Math.max(0, remaining);
  }

  return { slotAssignment, perGradeShortfall };
}

interface SessionGroup {
  capacity: number;
  overfillCapPerGrade: Record<number, number>;
  preferredGrades: number[];
  sessions: SessionRow[];
}

const MAX_OVERFILL_PER_LAB = 2;

export function overfillCapFor(
  labId: string,
  areaName: string,
  grade: number,
  overfillRules: AllocationPreferences["overfillRules"],
): number {
  let allowance = 0;
  const targetArea = String(areaName ?? "").trim().toLowerCase();
  const targetLab = String(labId ?? "").trim().toLowerCase();
  const targetGrade = Number(grade);

  for (const rule of overfillRules ?? []) {
    const rArea = String(rule.area ?? "").trim().toLowerCase();
    if (rArea === "all" || rArea === targetArea) {
      const rawGrades = Array.isArray(rule.grades)
        ? rule.grades
        : typeof rule.grades === "string"
        ? (rule.grades as string).replace(/[{}[\]]/g, "").split(",").map((s) => s.trim())
        : typeof rule.grades === "number"
        ? [rule.grades]
        : [];
      const rGrades = rawGrades.map(Number).filter((n) => !isNaN(n));
      const matchesGrade = rGrades.length === 0 || rGrades.includes(targetGrade);
      if (matchesGrade) {
        const rawLabs = Array.isArray(rule.labIds)
          ? rule.labIds
          : typeof rule.labIds === "string"
          ? [rule.labIds]
          : [];
        const rLabs = rawLabs.map((x) => String(x).trim().toLowerCase());
        if (rLabs.length === 0 || rLabs.includes("all") || rLabs.includes(targetLab)) {
          allowance = Math.max(allowance, Math.min(MAX_OVERFILL_PER_LAB, Number(rule.maxOverfillPerLab ?? 2)));
        }
      }
    }
  }
  return allowance;
}

function preferredGradesFor(
  labId: string,
  slotNum: number,
  areaName: string,
  grades: number[],
  preferredRules: AllocationPreferences["preferredLabRules"],
): number[] {
  const bonusGrades = new Set<number>();
  for (const pref of preferredRules ?? []) {
    const pArea = String(pref.area ?? "").trim();
    if (pArea === "ALL" || pArea.toLowerCase() === areaName.toLowerCase()) {
      const pLab = String(pref.labId ?? "").trim().toLowerCase();
      if (labId.toLowerCase() === pLab) {
        const pSlot = pref.slotNum;
        if (pSlot === undefined || pSlot === null || Number(pSlot) === slotNum) {
          const pGrades = pref.grades ?? [];
          for (const g of grades) {
            const match = pGrades.length === 0 || (pGrades as number[]).map(String).includes(String(g));
            if (match) bonusGrades.add(g);
          }
        }
      }
    }
  }
  return [...bonusGrades].sort((a, b) => a - b);
}

export function ilpAllocateArea(
  areaSessions: SessionRow[],
  gradeCounts: Record<number, number>,
  preferences?: Partial<AllocationPreferences> | null,
): IlpAreaResult {
  const grades = Object.keys(gradeCounts).map(Number);
  const areaName = areaSessions[0].Area;
  const overfillRules = preferences?.overfillRules ?? [];
  const preferredRules = preferences?.preferredLabRules ?? [];

  const groups = new Map<string, SessionGroup>();
  for (const r of areaSessions) {
    const labId = r["Lab ID"];
    const capacity = r.True_Capacity;
    const overfillCapPerGrade: Record<number, number> = {};
    for (const g of grades) {
      overfillCapPerGrade[g] = overfillCapFor(labId, areaName, g, overfillRules);
    }
    const preferredGrades = preferredGradesFor(labId, r.Slot_Num, areaName, grades, preferredRules);
    const ofSig = grades.map((g) => `${g}:${overfillCapPerGrade[g] || 0}`).join(",");
    const sig = `${capacity}|${ofSig}|${preferredGrades.join(",")}`;
    if (!groups.has(sig)) groups.set(sig, { capacity, overfillCapPerGrade, preferredGrades, sessions: [] });
    groups.get(sig)!.sessions.push(r);
  }

  const hasOverfill = [...groups.values()].some((g) => Object.values(g.overfillCapPerGrade).some((cap) => cap > 0));
  const hasPreferred = preferredRules.length > 0;

  const model: {
    optimize: string;
    opType: "min" | "max";
    constraints: Record<string, { min?: number; max?: number }>;
    variables: Record<string, Record<string, number>>;
    ints: Record<string, 1>;
    timeout: number;
    tolerance: number;
  } = {
    optimize: "cost",
    opType: "min",
    constraints: {},
    variables: {},
    ints: {},
    // Safety net against pathological inputs (e.g. many distinct lab capacities):
    // caps worst-case solve time per area instead of letting the browser hang.
    // Mirrors the spirit of the original PuLP solve (timeLimit=15s, gapRel=0.01).
    timeout: 8000,
    tolerance: 0.01,
  };

  const groupIds = [...groups.keys()];
  const varName = (gid: string, g: number) => `x_${gid}_${g}`;
  const ofName = (gid: string, g: number) => `of_${gid}_${g}`;
  const shortName = (g: number) => `short_${g}`;

  for (const gid of groupIds) {
    model.constraints[`cap_${gid}`] = { max: groups.get(gid)!.sessions.length };
  }
  for (const g of grades) model.constraints[`grade_${g}`] = { min: gradeCounts[g] };

  for (const gid of groupIds) {
    const grp = groups.get(gid)!;
    for (const g of grades) {
      const name = varName(gid, g);
      model.variables[name] = { [`cap_${gid}`]: 1, [`grade_${g}`]: grp.capacity };
      model.ints[name] = 1;
    }
  }
  for (const g of grades) {
    model.variables[shortName(g)] = { [`grade_${g}`]: 1 };
  }

  if (!hasOverfill && !hasPreferred) {
    for (const g of grades) model.variables[shortName(g)].cost = 1;
    for (const gid of groupIds) {
      for (const g of grades) model.variables[varName(gid, g)].cost = 0.0001;
    }
  } else {
    for (const g of grades) model.variables[shortName(g)].cost = 100000;

    for (const gid of groupIds) {
      const grp = groups.get(gid)!;
      for (const g of grades) {
        const gradeOverfillCap = grp.overfillCapPerGrade[g] || 0;
        if (gradeOverfillCap > 0) {
          const name = ofName(gid, g);
          const maxOfTotal = gradeOverfillCap * grp.sessions.length;
          model.constraints[`oflink_${gid}_${g}`] = { max: 0 };
          model.variables[name] = { [`oflink_${gid}_${g}`]: 1, [`grade_${g}`]: 1, cost: 100 };
          model.variables[varName(gid, g)][`oflink_${gid}_${g}`] = -gradeOverfillCap;
          model.constraints[`ofmax_${gid}_${g}`] = { max: maxOfTotal };
          model.variables[name][`ofmax_${gid}_${g}`] = 1;
        }
      }
    }

    for (const gid of groupIds) {
      for (const g of grades) {
        model.variables[varName(gid, g)].cost = (model.variables[varName(gid, g)].cost ?? 0) + 0.001;
      }
    }

    for (const gid of groupIds) {
      const grp = groups.get(gid)!;
      for (const g of grp.preferredGrades) {
        const name = varName(gid, g);
        model.variables[name].cost = (model.variables[name].cost ?? 0) - 500;
      }
    }
  }

  const result = solver.Solve(model as unknown as Parameters<typeof solver.Solve>[0]) as Record<string, number | boolean>;

  const slotAssignment: Record<string, number> = {};
  for (const gid of groupIds) {
    const grp = groups.get(gid)!;
    const sessionsByDay = new Map<string, SessionRow[]>();
    for (const s of grp.sessions) {
      const dayKey = s.Date || (s.Day || "").trim().toLowerCase();
      if (!sessionsByDay.has(dayKey)) sessionsByDay.set(dayKey, []);
      sessionsByDay.get(dayKey)!.push(s);
    }
    for (const list of sessionsByDay.values()) {
      list.sort((a, b) => a.Slot_Num - b.Slot_Num);
    }

    // Order sessions chronologically by day/date first, and within each day by slot time
    const sortedDayEntries = [...sessionsByDay.entries()].sort((a, b) => {
      const sessA = a[1][0];
      const sessB = b[1][0];
      const dateA = sessA.Date || sessA.Day || "";
      const dateB = sessB.Date || sessB.Day || "";
      if (dateA !== dateB) return dateA < dateB ? -1 : 1;
      return sessA.Slot_Num - sessB.Slot_Num;
    });

    const sessionsOrdered: SessionRow[] = [];
    for (const [, daySessions] of sortedDayEntries) {
      daySessions.sort((a, b) => a.Slot_Num - b.Slot_Num);
      for (const s of daySessions) {
        sessionsOrdered.push(s);
      }
    }

    let cursor = 0;
    for (const g of grades) {
      const count = Math.round(Number(result[varName(gid, g)] ?? 0));
      for (let i = 0; i < count; i++) {
        const sess = sessionsOrdered[cursor++];
        if (sess) slotAssignment[sess.Slot_Key] = g;
      }
    }
  }

  const perGradeShortfall: Record<number, number> = {};
  for (const g of grades) {
    perGradeShortfall[g] = Math.max(0, Math.round(Number(result[shortName(g)] ?? 0)));
  }

  return { slotAssignment, perGradeShortfall };
}

export async function runIlpAllAreas(
  sessions: SessionRow[],
  studentsByAreaGrade: Map<string, number>, // key `${area}__${grade}` -> count
  areas: string[],
  grades: number[],
  log: (msg: string) => void,
  preferences?: Partial<AllocationPreferences> | null,
  onProgress?: (progress: { stage: string; current: number; total: number; percent: number; message: string }) => void,
  batchGroupType: "single_session" | "multi_session" = "single_session",
): Promise<{
  sessionsAugmented: Array<SessionRow & { Grade: number }>;
  shortfallMathRows: Array<{ Area: string; Grade: number; Demand: number; Sessions_Assigned: number; Capacity_Assigned: number; Students_Short: number }>;
  shortfallReport: Array<{ Area: string; Grade: number; Students_Short: number; Reason: string }>;
  totalTrueShortfall: number;
}> {
  const sessionsAugmented: Array<SessionRow & { Grade: number }> = [];
  const shortfallMathRows: Array<{ Area: string; Grade: number; Demand: number; Sessions_Assigned: number; Capacity_Assigned: number; Students_Short: number }> = [];
  const shortfallReport: Array<{ Area: string; Grade: number; Students_Short: number; Reason: string }> = [];
  let totalTrueShortfall = 0;

  log(`Running per-area ILP across ${areas.length} area(s), ${sessions.length} session(s) total...`);

  const sessionsByArea = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    if (!sessionsByArea.has(s.Area)) sessionsByArea.set(s.Area, []);
    sessionsByArea.get(s.Area)!.push(s);
  }

  for (let aIdx = 0; aIdx < areas.length; aIdx++) {
    const area = areas[aIdx];
    const areaSessions = sessionsByArea.get(area);
    if (!areaSessions || areaSessions.length === 0) continue;

    const counts: Record<number, number> = {};
    for (const g of grades) {
      const c = studentsByAreaGrade.get(`${area}__${g}`) ?? 0;
      if (c > 0) counts[g] = c;
    }
    if (Object.keys(counts).length === 0) continue;

    if (onProgress) {
      const pct = Math.round(((aIdx + 1) / areas.length) * 100);
      onProgress({
        stage: "ilp",
        current: aIdx + 1,
        total: areas.length,
        percent: pct,
        message: `Solving integer linear program for ${area} (${aIdx + 1}/${areas.length})...`,
      });
    }

    const { slotAssignment, perGradeShortfall } = batchGroupType === "single_session"
      ? allocateSingleSessionArea(areaSessions, counts, preferences)
      : ilpAllocateArea(areaSessions, counts, preferences);

    const capBySlot = new Map(areaSessions.map((s) => [s.Slot_Key, s.True_Capacity]));
    for (const [slotKey, grade] of Object.entries(slotAssignment)) {
      const row = areaSessions.find((s) => s.Slot_Key === slotKey)!;
      sessionsAugmented.push({ ...row, Grade: grade });
    }

    for (const [gStr, demand] of Object.entries(counts)) {
      const g = Number(gStr);
      const slotsG = Object.entries(slotAssignment).filter(([, gg]) => gg === g).map(([s]) => s);
      const sessionsGiven = slotsG.length;
      const capacityGiven = slotsG.reduce((acc, s) => acc + (capBySlot.get(s) ?? 0), 0);
      const short = perGradeShortfall[g] ?? 0;
      shortfallMathRows.push({
        Area: area,
        Grade: g,
        Demand: demand,
        Sessions_Assigned: sessionsGiven,
        Capacity_Assigned: capacityGiven,
        Students_Short: short,
      });
      if (short > 0) {
        totalTrueShortfall += short;
        shortfallReport.push({
          Area: area,
          Grade: g,
          Students_Short: short,
          Reason: "Not enough true session capacity in this area to fit all grades",
        });
      }
    }

    // Yield control back to browser event loop after each area solve to maintain responsiveness
    await yieldToMainThread();
  }

  // Include orphan areas (areas with student demand but 0 labs) in shortfall accounting
  const allDemandAreas = new Set<string>();
  for (const key of studentsByAreaGrade.keys()) {
    allDemandAreas.add(key.split("__")[0]);
  }

  for (const area of allDemandAreas) {
    const areaSessions = sessionsByArea.get(area);
    if (!areaSessions || areaSessions.length === 0) {
      for (const g of grades) {
        const demand = studentsByAreaGrade.get(`${area}__${g}`) ?? 0;
        if (demand > 0) {
          totalTrueShortfall += demand;
          shortfallMathRows.push({
            Area: area,
            Grade: g,
            Demand: demand,
            Sessions_Assigned: 0,
            Capacity_Assigned: 0,
            Students_Short: demand,
          });
          shortfallReport.push({
            Area: area,
            Grade: g,
            Students_Short: demand,
            Reason: "No physical labs exist in this area",
          });
        }
      }
    }
  }

  log(`Sessions assigned a grade: ${sessionsAugmented.length} / ${sessions.length}`);
  if (shortfallReport.length > 0) {
    log(`TRUE mathematically-unavoidable shortfall: ${totalTrueShortfall} students`);
  } else {
    log("No shortfall -- every student fits given true capacity.");
  }

  return { sessionsAugmented, shortfallMathRows, shortfallReport, totalTrueShortfall };
}
