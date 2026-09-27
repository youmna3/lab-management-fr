import { downloadCsv } from "@/lib/sheet";
import type { AllocationResult } from "./types";
import { STANDARD_TIME_SLOTS } from "./types";

export function exportAllocationsCsv(
  result: AllocationResult,
  filename = `lab-allocations-${new Date().toISOString().slice(0, 10)}.csv`,
): void {
  const rows = result.allocations.map((alloc) => ({
    "Group Code": alloc.group.groupCode,
    Area: alloc.group.area,
    Grade: alloc.group.grade,
    "Student Count": alloc.group.studentCount,
    Status: alloc.status,
    "Lab Code": alloc.lab?.labCode ?? "—",
    "Lab Name": alloc.lab?.name ?? "—",
    "Center Name": alloc.lab?.centerName ?? "—",
    Gov: alloc.lab?.gov ?? "—",
    "Time Slot": alloc.slotKey ?? "—",
    "Lab Capacity": alloc.lab?.capacity ?? "—",
    Address: alloc.lab?.address ?? "—",
    "Maps Location": alloc.lab?.locationUrl ?? "—",
    "Supervisor Name": alloc.lab?.supervisorName ?? "—",
    "Supervisor Phone": alloc.lab?.supervisorPhone ?? "—",
    "Facilitator Name": alloc.lab?.facilitatorName ?? "—",
    "Facilitator Phone": alloc.lab?.facilitatorPhone ?? "—",
    "Vendor Name": alloc.lab?.vendorName ?? "—",
    "Issue / Reason": alloc.issue?.message ?? "—",
  }));

  downloadCsv(filename, rows);
}

export function exportStudentAllocationsCsv(
  result: AllocationResult,
  filename = `student-allocations-${new Date().toISOString().slice(0, 10)}.csv`,
): void {
  const allocatedRows = result.allocatedStudents.map((s) => ({
    "S_ID": s.sId,
    Grade: s.grade,
    Area: s.area,
    Gov: s.gov ?? "—",
    "Group Code": s.groupCode,
    Status: "Allocated",
    "Lab Code": s.labCode,
    "Lab Name": s.labName,
    "Center Name": s.centerName ?? "—",
    "Time Slot": s.slotKey,
    Day: s.day ?? "—",
    Time: s.time ?? "—",
    Address: s.address ?? "—",
    "Maps Location": s.locationUrl ?? "—",
    "Supervisor Name": s.supervisorName ?? "—",
    "Supervisor Phone": s.supervisorPhone ?? "—",
    "Facilitator Name": s.facilitatorName ?? "—",
    "Facilitator Phone": s.facilitatorPhone ?? "—",
    "Vendor Name": s.vendorName ?? "—",
    "Failure Reason": "",
  }));

  const unallocatedRows = result.unallocatedStudents.map((s) => ({
    "S_ID": s.sId,
    Grade: s.grade,
    Area: s.area,
    Gov: s.gov ?? "—",
    "Group Code": s.groupCode ?? "—",
    Status: "Unallocated",
    "Lab Code": "—",
    "Lab Name": "—",
    "Center Name": "—",
    "Time Slot": "—",
    Day: "—",
    Time: "—",
    Address: "—",
    "Maps Location": "—",
    "Supervisor Name": "—",
    "Supervisor Phone": "—",
    "Facilitator Name": "—",
    "Facilitator Phone": "—",
    "Vendor Name": "—",
    "Failure Reason": s.reason,
  }));

  downloadCsv(filename, [...allocatedRows, ...unallocatedRows]);
}

export function exportSummaryCsv(
  result: AllocationResult,
  filename = `allocation-summary-${new Date().toISOString().slice(0, 10)}.csv`,
): void {
  const rows = result.summary.map((sum) => ({
    Area: sum.area,
    Grade: sum.grade,
    "Total Students": sum.studentCount,
    "Total Groups": sum.groupCount,
    "Allocated Students": sum.allocatedStudents,
    "Unallocated Students": sum.unallocatedStudents,
    "Allocated Groups": sum.allocatedGroups,
    "Unallocated Groups": sum.unallocatedGroups,
    Status: sum.status,
  }));

  downloadCsv(filename, rows);
}

export function exportIssuesCsv(
  result: AllocationResult,
  filename = `allocation-issues-${new Date().toISOString().slice(0, 10)}.csv`,
): void {
  const rows = result.issues.map((issue) => ({
    "Issue Type": issue.type,
    Level: issue.level.toUpperCase(),
    Message: issue.message,
    Area: issue.area ?? "—",
    Grade: issue.grade ?? "—",
    "Group Code": issue.groupCode ?? "—",
    "Student ID": issue.sId ?? "—",
    "Lab Code": issue.labCode ?? "—",
    "Time Slot": issue.slotKey ?? "—",
    "Row Number": issue.rowNumber ?? "—",
  }));

  downloadCsv(filename, rows);
}

export function exportLabScheduleMatrixCsv(
  result: AllocationResult,
  filename = `lab-schedule-matrix-${new Date().toISOString().slice(0, 10)}.csv`,
): void {
  const rows = result.labs.map((lab) => {
    const rowObj: Record<string, unknown> = {
      "Lab ID": lab.labCode,
      "Lab Name": lab.name,
      "Center Name": lab.centerName ?? "",
      Gov: lab.gov,
      Area: lab.area,
      Capacity: lab.capacity,
      Supervisor: lab.supervisorName ?? "",
      Phone: lab.supervisorPhone ?? "",
    };

    STANDARD_TIME_SLOTS.forEach((slotDef) => {
      const slot = lab.slots.get(slotDef.key);
      let cellValue = "—";
      if (slot?.isOccupied) {
        cellValue = `${slot.assignedGroupCode || "Occupied"} (${slot.assignedStudentCount || 0} students)`;
      } else if (slot?.assignedGroupCode) {
        cellValue = `[${slot.assignedGroupCode}]`;
      } else if (slot?.targetGrade) {
        cellValue = `[For ${slot.targetGrade}]`;
      }
      rowObj[slotDef.key] = cellValue;
    });

    return rowObj;
  });

  downloadCsv(filename, rows);
}

export function downloadStudentTemplateCsv(): void {
  const sampleRows = [
    { "{{S_ID}}": "DEMIS-S-527129", "Grade(25-26)": "G5", "Physical Area": "أسيوط" },
    { "{{S_ID}}": "DEMIS-S-527130", "Grade(25-26)": "G5", "Physical Area": "المعادي" },
    { "{{S_ID}}": "DEMIS-S-527131", "Grade(25-26)": "G5", "Physical Area": "سوهاج" },
    { "{{S_ID}}": "DEMIS-S-527132", "Grade(25-26)": "G4", "Physical Area": "شبرا" },
    { "{{S_ID}}": "DEMIS-S-527133", "Grade(25-26)": "G6", "Physical Area": "قنا" },
  ];
  downloadCsv("student-import-template.csv", sampleRows);
}

export function downloadLabTemplateCsv(): void {
  const sampleRows = [
    {
      "Lab ID": "L1",
      Gov: "أسوان",
      Area: "أسوان",
      "Lab Capacity": "20",
      "Vendor Name": "Ischool",
      "Center Name": "الاكاديمية الأمريكية للتدريب",
      "Lab Name": "الاكاديمية الأمريكية للتدريب 1",
      Address: "اسوان كورنيش النيل عمارة المسجد الجامع",
      Location: "https://maps.app.goo.gl/BCb5ZTEawAvGLyyH9",
      "اسم المشرف": "شروق يوسف",
      "رقم المشرف": "01128872472",
      "اسم الميسر": "شروق يوسف",
      "رقم الميسر": "01128872472",
      "Thu 9 AM Grade": "G5",
      "Thu 12 PM Grade": "G5",
      "Thu 3 PM Grade": "G4",
      "Thu 6 PM Grade": "G4",
      "Fri 9 AM Grade": "",
      "Fri 3 PM Grade": "G4",
      "Fri 6 PM Grade": "G4",
      "Thu 9 AM": "Physical-DS-G6",
      "Thu 12 PM": "Physical-DS-G5",
      "Thu 3 PM": "Physical-DS-G4",
      "Thu 6 PM": "Physical-DS-G3",
      "Fri 9 AM": "",
      "Fri 3 PM": "Physical-DS-G2",
      "Fri 6 PM": "Physical-DS-G1",
    },
  ];
  downloadCsv("lab-import-template.csv", sampleRows);
}
