import { cleanArabicString, getGovForArea } from "@/lib/arabic";
import {
  type AllocationConfig,
  type AllocationIssue,
  type AllocationLab,
  type AllocationResult,
  type AreaGradeSummary,
  type AllocatedStudentDetail,
  type UnallocatedStudentDetail,
  type GroupAllocation,
  type StudentGroup,
  type AllocationIssueType,
  DEFAULT_ALLOCATION_CONFIG,
  STANDARD_TIME_SLOTS,
} from "./types";
import { validateAllocationSafety } from "./allocation-validator";

function cloneLabs(labs: AllocationLab[]): AllocationLab[] {
  return labs.map((lab) => {
    const slots = new Map(
      Array.from(lab.slots.entries()).map(([k, s]) => [k, { ...s }]),
    );
    return {
      ...lab,
      slots,
    };
  });
}

export function runAllocation(
  groups: StudentGroup[],
  rawLabs: AllocationLab[],
  rawConfig: Partial<AllocationConfig> = {},
  preAllocationIssues: AllocationIssue[] = [],
  preUnallocatedStudents: UnallocatedStudentDetail[] = [],
): AllocationResult {
  const config: AllocationConfig = {
    ...DEFAULT_ALLOCATION_CONFIG,
    ...rawConfig,
    defaultSlots: rawConfig.defaultSlots || DEFAULT_ALLOCATION_CONFIG.defaultSlots || [],
  };

  const labs = cloneLabs(rawLabs);
  const issues: AllocationIssue[] = [...preAllocationIssues];
  const allocations: GroupAllocation[] = [];
  const unallocatedGroups: GroupAllocation[] = [];
  const allocatedStudents: AllocatedStudentDetail[] = [];
  const unallocatedStudents: UnallocatedStudentDetail[] = [...preUnallocatedStudents];

  // Sort groups: largest first, then by area and grade for determinism
  const sortedGroups = [...groups].sort((a, b) => {
    if (b.studentCount !== a.studentCount) {
      return b.studentCount - a.studentCount;
    }
    const areaCmp = a.area.localeCompare(b.area);
    if (areaCmp !== 0) return areaCmp;
    return a.groupCode.localeCompare(b.groupCode);
  });

  sortedGroups.forEach((group) => {
    const groupAreaNorm = cleanArabicString(group.area);
    const groupGov = getGovForArea(group.area);
    const groupGovNorm = cleanArabicString(groupGov);

    // Step 0: Check if group has an explicit slot match in the schedule matrix (e.g. Physical-DS-G31)
    let explicitLab: AllocationLab | null = null;
    let explicitSlotKey: string | null = null;

    for (const lab of labs) {
      for (const [slotKey, slot] of lab.slots.entries()) {
        if (
          !slot.isOccupied &&
          slot.assignedGroupCode &&
          (slot.assignedGroupCode.toLowerCase() === group.groupCode.toLowerCase() ||
            slot.assignedGroupCode.replace(/[\s\-_]/g, "").toLowerCase() ===
              group.groupCode.replace(/[\s\-_]/g, "").toLowerCase())
        ) {
          explicitLab = lab;
          explicitSlotKey = slotKey;
          break;
        }
      }
      if (explicitLab) break;
    }

    if (explicitLab && explicitSlotKey) {
      const slot = explicitLab.slots.get(explicitSlotKey)!;
      slot.isOccupied = true;
      slot.assignedGroupId = group.id;
      slot.assignedGroupCode = group.groupCode;
      slot.assignedGrade = group.grade;
      slot.assignedStudentCount = group.studentCount;

      const slotDef = STANDARD_TIME_SLOTS.find((s) => s.key === explicitSlotKey);

      const allocation: GroupAllocation = {
        group,
        status: "Allocated",
        lab: explicitLab,
        slotKey: explicitSlotKey,
        issue: null,
      };
      allocations.push(allocation);

      group.students.forEach((student) => {
        allocatedStudents.push({
          sId: student.sId,
          area: student.physicalArea,
          gov: student.gov || explicitLab!.gov || groupGov,
          grade: student.grade,
          groupCode: group.groupCode,
          labCode: explicitLab!.labCode,
          labName: explicitLab!.name,
          centerName: explicitLab!.centerName || undefined,
          vendorName: explicitLab!.vendorName || undefined,
          address: explicitLab!.address || undefined,
          locationUrl: explicitLab!.locationUrl || undefined,
          supervisorName: explicitLab!.supervisorName || undefined,
          supervisorPhone: explicitLab!.supervisorPhone || undefined,
          facilitatorName: explicitLab!.facilitatorName || undefined,
          facilitatorPhone: explicitLab!.facilitatorPhone || undefined,
          slotKey: explicitSlotKey!,
          day: slotDef?.day,
          time: slotDef?.time,
        });
      });
      return;
    }

    // Step 1: Find candidate labs in Area, then Governorate if fallback allowed
    let areaLabs = labs.filter(
      (lab) => cleanArabicString(lab.area) === groupAreaNorm,
    );

    let govLabs = config.allowFallbackToGov
      ? labs.filter(
          (lab) =>
            cleanArabicString(lab.gov) === groupGovNorm ||
            cleanArabicString(lab.area) === groupAreaNorm,
        )
      : areaLabs;

    if (areaLabs.length === 0 && govLabs.length === 0) {
      const issue: AllocationIssue = {
        id: `issue-no-lab-${group.id}`,
        type: "NO_AVAILABLE_LAB",
        level: "error",
        message: `No active labs found in area "${group.area}" for group ${group.groupCode}`,
        area: group.area,
        grade: group.grade,
        groupId: group.id,
        groupCode: group.groupCode,
      };
      issues.push(issue);

      const allocation: GroupAllocation = {
        group,
        status: "Unallocated",
        lab: null,
        slotKey: null,
        issue,
      };
      allocations.push(allocation);
      unallocatedGroups.push(allocation);

      group.students.forEach((student) => {
        unallocatedStudents.push({
          sId: student.sId,
          area: student.physicalArea,
          gov: student.gov || groupGov,
          grade: student.grade,
          groupCode: group.groupCode,
          reason: `No labs found in area "${group.area}"`,
          issueType: "NO_AVAILABLE_LAB",
          rowNumber: student.rowNumber,
        });
      });
      return;
    }

    // Helper: Find available candidate slots in a set of labs
    type SlotCandidate = {
      lab: AllocationLab;
      slotKey: string;
      gradeMatchScore: number; // 2 = exact grade slot, 1 = open slot
      wastedCapacity: number;
    };

    const targetSlotKeys =
      config.defaultSlots.length > 0
        ? config.defaultSlots
        : Array.from(new Set(labs.flatMap((l) => Array.from(l.slots.keys()))));

    let sawGradeMismatch = false;

    const findSlotsInLabs = (labPool: AllocationLab[]) => {
      const candidates: SlotCandidate[] = [];
      const compatibleLabs = labPool.filter((l) => l.capacity >= group.studentCount);

      compatibleLabs.forEach((lab) => {
        targetSlotKeys.forEach((slotKey) => {
          const slot = lab.slots.get(slotKey);
          if (!slot || slot.isOccupied) return;

          if (slot.targetGrade) {
            if (slot.targetGrade.toUpperCase() === group.grade.toUpperCase()) {
              candidates.push({
                lab,
                slotKey,
                gradeMatchScore: 2,
                wastedCapacity: lab.capacity - group.studentCount,
              });
            } else if (config.respectGradeSlots) {
              sawGradeMismatch = true;
            }
          } else {
            // Open slot
            candidates.push({
              lab,
              slotKey,
              gradeMatchScore: 1,
              wastedCapacity: lab.capacity - group.studentCount,
            });
          }
        });
      });

      candidates.sort((a, b) => {
        if (b.gradeMatchScore !== a.gradeMatchScore) {
          return b.gradeMatchScore - a.gradeMatchScore;
        }
        return a.wastedCapacity - b.wastedCapacity;
      });

      return candidates;
    };

    // Try Area labs first
    let slotCandidates = findSlotsInLabs(areaLabs);

    // If no slots in exact Area labs, try Governorate labs if fallback allowed
    if (slotCandidates.length === 0 && config.allowFallbackToGov && govLabs.length > 0) {
      slotCandidates = findSlotsInLabs(govLabs);
    }

    if (slotCandidates.length > 0) {
      const selected = slotCandidates[0];
      const slot = selected.lab.slots.get(selected.slotKey)!;

      // Use scheduled session group code from dashboard if available
      const finalGroupCode = slot.assignedGroupCode || group.groupCode;
      group.groupCode = finalGroupCode;

      slot.isOccupied = true;
      slot.assignedGroupId = group.id;
      slot.assignedGroupCode = finalGroupCode;
      slot.assignedGrade = group.grade;
      slot.assignedStudentCount = group.studentCount;

      const slotDef = STANDARD_TIME_SLOTS.find((s) => s.key === selected.slotKey);

      const allocation: GroupAllocation = {
        group,
        status: "Allocated",
        lab: selected.lab,
        slotKey: selected.slotKey,
        issue: null,
      };
      allocations.push(allocation);

      group.students.forEach((student) => {
        allocatedStudents.push({
          sId: student.sId,
          area: student.physicalArea,
          gov: student.gov || selected.lab.gov || groupGov,
          grade: student.grade,
          groupCode: finalGroupCode,
          labCode: selected.lab.labCode,
          labName: selected.lab.name,
          centerName: selected.lab.centerName || undefined,
          vendorName: selected.lab.vendorName || undefined,
          address: selected.lab.address || undefined,
          locationUrl: selected.lab.locationUrl || undefined,
          supervisorName: selected.lab.supervisorName || undefined,
          supervisorPhone: selected.lab.supervisorPhone || undefined,
          facilitatorName: selected.lab.facilitatorName || undefined,
          facilitatorPhone: selected.lab.facilitatorPhone || undefined,
          slotKey: selected.slotKey,
          day: slotDef?.day,
          time: slotDef?.time,
        });
      });
    } else {
      // Check specific failure reason
      const maxCapInPool = Math.max(
        ...((govLabs.length > 0 ? govLabs : areaLabs).map((l) => l.capacity)),
        0,
      );

      let issueType: AllocationIssueType = "NO_AVAILABLE_SLOT";
      let issueMsg = `All compatible slots in area "${group.area}" are fully booked`;

      if (maxCapInPool > 0 && maxCapInPool < group.studentCount) {
        issueType = "INSUFFICIENT_CAPACITY";
        issueMsg = `Labs in area "${group.area}" have max capacity of ${maxCapInPool}, which is less than group size (${group.studentCount})`;
      } else if (sawGradeMismatch) {
        issueType = "GRADE_RESTRICTION_MISMATCH";
        issueMsg = `All compatible slots in area "${group.area}" are designated for other grades`;
      }

      const issue: AllocationIssue = {
        id: `issue-slot-${group.id}`,
        type: issueType,
        level: "error",
        message: `${issueMsg} (group: ${group.groupCode}, size: ${group.studentCount})`,
        area: group.area,
        grade: group.grade,
        groupId: group.id,
        groupCode: group.groupCode,
      };
      issues.push(issue);

      const allocation: GroupAllocation = {
        group,
        status: "Unallocated",
        lab: null,
        slotKey: null,
        issue,
      };
      allocations.push(allocation);
      unallocatedGroups.push(allocation);

      group.students.forEach((student) => {
        unallocatedStudents.push({
          sId: student.sId,
          area: student.physicalArea,
          gov: student.gov || groupGov,
          grade: student.grade,
          groupCode: group.groupCode,
          reason: issueMsg,
          issueType,
          rowNumber: student.rowNumber,
        });
      });
    }
  });

  // Post-allocation safety verification
  const validationIssues = validateAllocationSafety(allocations, labs);
  issues.push(...validationIssues);

  // Compute Area + Grade Summary
  const summaryMap = new Map<string, AreaGradeSummary>();

  groups.forEach((g) => {
    const key = `${g.area}__${g.grade}`;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        area: g.area,
        grade: g.grade,
        studentCount: 0,
        groupCount: 0,
        allocatedStudents: 0,
        unallocatedStudents: 0,
        allocatedGroups: 0,
        unallocatedGroups: 0,
        status: "Unallocated",
      });
    }
    const sum = summaryMap.get(key)!;
    sum.studentCount += g.studentCount;
    sum.groupCount += 1;
  });

  allocations.forEach((alloc) => {
    const key = `${alloc.group.area}__${alloc.group.grade}`;
    const sum = summaryMap.get(key);
    if (!sum) return;

    if (alloc.status === "Allocated") {
      sum.allocatedGroups += 1;
      sum.allocatedStudents += alloc.group.studentCount;
    } else {
      sum.unallocatedGroups += 1;
      sum.unallocatedStudents += alloc.group.studentCount;
    }
  });

  const summaryList: AreaGradeSummary[] = Array.from(summaryMap.values()).map(
    (sum) => {
      let status: AreaGradeSummary["status"] = "Unallocated";
      if (sum.allocatedStudents === sum.studentCount && sum.studentCount > 0) {
        status = "Fully Allocated";
      } else if (sum.allocatedStudents > 0) {
        status = "Partially Allocated";
      }
      return { ...sum, status };
    },
  );

  summaryList.sort((a, b) => {
    const areaCmp = a.area.localeCompare(b.area);
    if (areaCmp !== 0) return areaCmp;
    return a.grade.localeCompare(b.grade);
  });

  // Compute high-level statistics
  const totalStudents = allocatedStudents.length + unallocatedStudents.length;
  const validStudents = groups.reduce((acc, g) => acc + g.studentCount, 0);
  const invalidStudents = totalStudents - validStudents;
  const totalAllocatedStudents = allocatedStudents.length;
  const totalUnallocatedStudents = unallocatedStudents.length;
  const totalGroups = groups.length;
  const allocatedGroupsCount = allocations.filter((a) => a.status === "Allocated").length;
  const unallocatedGroupsCount = unallocatedGroups.length;

  const usedLabIds = new Set<string>();
  let totalSlotsUsed = 0;
  let usedLabCapacity = 0;
  let totalLabCapacity = 0;

  labs.forEach((lab) => {
    totalLabCapacity += lab.capacity * config.defaultSlots.length;
    let labUsed = false;
    lab.slots.forEach((slot) => {
      if (slot.isOccupied && slot.assignedStudentCount) {
        labUsed = true;
        totalSlotsUsed += 1;
        usedLabCapacity += slot.assignedStudentCount;
      }
    });
    if (labUsed) usedLabIds.add(lab.id);
  });

  const successRate =
    totalStudents > 0
      ? Math.round((totalAllocatedStudents / totalStudents) * 100)
      : 0;

  return {
    summary: summaryList,
    allocations,
    unallocatedGroups,
    allocatedStudents,
    unallocatedStudents,
    issues,
    labs,
    stats: {
      totalStudents,
      validStudents,
      invalidStudents,
      allocatedStudents: totalAllocatedStudents,
      unallocatedStudents: totalUnallocatedStudents,
      totalGroups,
      allocatedGroups: allocatedGroupsCount,
      unallocatedGroups: unallocatedGroupsCount,
      totalLabsUsed: usedLabIds.size,
      totalSlotsUsed,
      totalLabCapacity,
      usedLabCapacity,
      successRate,
    },
    config,
    createdAt: new Date().toISOString(),
  };
}
