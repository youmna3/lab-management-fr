import type {
  GroupAllocation,
  AllocationLab,
  AllocationIssue,
} from "./types";

export function validateAllocationSafety(
  allocations: GroupAllocation[],
  labs: AllocationLab[],
): AllocationIssue[] {
  const issues: AllocationIssue[] = [];

  const seenGroupIds = new Set<string>();
  const seenStudentIds = new Set<string>();
  const occupiedLabSlots = new Map<string, string>(); // 'labId__slotKey' -> groupCode

  allocations.forEach((alloc) => {
    const { group, lab, slotKey, status } = alloc;

    // Check duplicate group allocation
    if (seenGroupIds.has(group.id)) {
      issues.push({
        id: `val-dup-group-${group.id}`,
        type: "SCHEDULE_CONFLICT",
        level: "error",
        message: `Group "${group.groupCode}" was allocated more than once`,
        groupId: group.id,
        groupCode: group.groupCode,
      });
    }
    seenGroupIds.add(group.id);

    // If allocated, verify constraints
    if (status === "Allocated" && lab && slotKey) {
      const slotUniqueKey = `${lab.id}__${slotKey}`;

      // 1. Check double-booked lab slot
      if (occupiedLabSlots.has(slotUniqueKey)) {
        const otherGroup = occupiedLabSlots.get(slotUniqueKey)!;
        issues.push({
          id: `val-conflict-slot-${slotUniqueKey}`,
          type: "SCHEDULE_CONFLICT",
          level: "error",
          message: `Schedule conflict: Lab "${lab.name}" (${lab.labCode}) at slot "${slotKey}" is assigned to both ${otherGroup} and ${group.groupCode}`,
          labCode: lab.labCode,
          slotKey,
          groupId: group.id,
          groupCode: group.groupCode,
        });
      } else {
        occupiedLabSlots.set(slotUniqueKey, group.groupCode);
      }

      // 2. Check lab capacity violation
      if (group.studentCount > lab.capacity) {
        const overage = group.studentCount - lab.capacity;
        const isSlightOverage = overage <= 2;
        issues.push({
          id: `val-cap-violation-${group.id}`,
          type: "INSUFFICIENT_CAPACITY",
          level: isSlightOverage ? "warning" : "error",
          message: isSlightOverage
            ? `Capacity advisory: Group ${group.groupCode} (${group.studentCount} students) exceeds lab ${lab.labCode} nominal capacity (${lab.capacity}) by +${overage} student(s)`
            : `Capacity violation: Group ${group.groupCode} (${group.studentCount} students) exceeds lab ${lab.labCode} capacity (${lab.capacity})`,
          labCode: lab.labCode,
          groupId: group.id,
          groupCode: group.groupCode,
        });
      }

      // 3. Check duplicate student IDs
      group.studentIds.forEach((sId) => {
        if (seenStudentIds.has(sId)) {
          issues.push({
            id: `val-dup-student-${sId}`,
            type: "DUPLICATE_STUDENT",
            level: "error",
            message: `Student "${sId}" is allocated to multiple groups`,
            sId,
            groupCode: group.groupCode,
          });
        }
        seenStudentIds.add(sId);
      });

      // 4. Check slot grade restriction
      const slot = lab.slots.get(slotKey);
      if (
        slot?.targetGrade &&
        slot.targetGrade.toUpperCase() !== group.grade.toUpperCase()
      ) {
        issues.push({
          id: `val-grade-mismatch-${group.id}`,
          type: "GRADE_RESTRICTION_MISMATCH",
          level: "warning",
          message: `Grade restriction warning: Group ${group.groupCode} (${group.grade}) was placed in slot "${slotKey}" designated for "${slot.targetGrade}" in lab ${lab.labCode}`,
          labCode: lab.labCode,
          slotKey,
          groupId: group.id,
          groupCode: group.groupCode,
        });
      }
    }
  });

  return issues;
}
