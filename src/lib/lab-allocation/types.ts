export type StudentRawRow = Record<string, unknown>;

export type Student = {
  sId: string;
  grade: string; // Normalized, e.g., 'G4', 'G5', 'G6'
  physicalArea: string; // Normalized Area in clean Arabic, e.g., 'أسيوط', 'المعادي'
  gov?: string; // Governorate in clean Arabic, e.g., 'أسيوط', 'القاهرة'
  groupId?: string; // Pre-assigned Group ID if specified in CSV
  locationId?: string;
  rowNumber: number;
  rawGrade: string;
  rawArea: string;
};

export type StudentGroup = {
  id: string;
  groupCode: string; // e.g. 'Physical-DS-G31' or 'ASY-G5-01'
  area: string;
  grade: string;
  studentCount: number;
  studentIds: string[];
  students: Student[];
};

export type SlotDefinition = {
  key: string; // e.g. 'Thu 9 AM'
  day: string; // e.g. 'Thu'
  time: string; // e.g. '9 AM'
  canonicalTime: string; // e.g. '09:00'
  gradeKey: string; // e.g. 'Thu 9 AM Grade'
};

export const STANDARD_TIME_SLOTS: SlotDefinition[] = [
  { key: "Thu 9 AM", day: "Thu", time: "9 AM", canonicalTime: "09:00", gradeKey: "Thu 9 AM Grade" },
  { key: "Thu 12 PM", day: "Thu", time: "12 PM", canonicalTime: "12:00", gradeKey: "Thu 12 PM Grade" },
  { key: "Thu 3 PM", day: "Thu", time: "3 PM", canonicalTime: "15:00", gradeKey: "Thu 3 PM Grade" },
  { key: "Thu 6 PM", day: "Thu", time: "6 PM", canonicalTime: "18:00", gradeKey: "Thu 6 PM Grade" },
  { key: "Fri 9 AM", day: "Fri", time: "9 AM", canonicalTime: "09:00", gradeKey: "Fri 9 AM Grade" },
  { key: "Fri 3 PM", day: "Fri", time: "3 PM", canonicalTime: "15:00", gradeKey: "Fri 3 PM Grade" },
  { key: "Fri 6 PM", day: "Fri", time: "6 PM", canonicalTime: "18:00", gradeKey: "Fri 6 PM Grade" },
];

export type LabSlotState = {
  slotKey: string;
  day: string;
  time: string;
  targetGrade?: string | null; // e.g. 'G4' if slot is designated specifically for G4
  isOccupied: boolean;
  assignedGroupId?: string | null;
  assignedGroupCode?: string | null;
  assignedGrade?: string | null;
  assignedStudentCount?: number | null;
};

export type AllocationLab = {
  id: string;
  labCode: string;
  name: string;
  gov: string;
  area: string;
  capacity: number;
  vendorName?: string | null;
  centerName?: string | null;
  address?: string | null;
  locationUrl?: string | null;
  supervisorName?: string | null;
  supervisorPhone?: string | null;
  facilitatorName?: string | null;
  facilitatorPhone?: string | null;
  slots: Map<string, LabSlotState>;
};

export type AllocationConfig = {
  organization: "DECI" | "DEMI";
  projectId?: string;
  projectName?: string;
  batchId?: string;
  batchName?: string;
  groupCapacity: number; // default: 20
  defaultSlots: string[]; // default: standard 7 slots
  respectGradeSlots: boolean; // default: true (if slot specifies Grade, enforce it)
  allowFallbackToGov: boolean; // default: true (fallback to labs in same governorate if area lab is full)
  preserveExistingAllocations: boolean; // default: false
};

export const DEFAULT_ALLOCATION_CONFIG: AllocationConfig = {
  organization: "DEMI",
  projectId: "",
  projectName: "",
  batchId: "",
  batchName: "",
  groupCapacity: 20,
  defaultSlots: STANDARD_TIME_SLOTS.map((s) => s.key),
  respectGradeSlots: true,
  allowFallbackToGov: true,
  preserveExistingAllocations: false,
};

export type AllocationIssueType =
  | "INSUFFICIENT_CAPACITY"
  | "NO_AVAILABLE_LAB"
  | "NO_AVAILABLE_SLOT"
  | "GRADE_RESTRICTION_MISMATCH"
  | "INVALID_STUDENT_DATA"
  | "MISSING_AREA"
  | "MISSING_GRADE"
  | "MISSING_S_ID"
  | "DUPLICATE_STUDENT"
  | "SCHEDULE_CONFLICT";

export type AllocationIssue = {
  id: string;
  type: AllocationIssueType;
  level: "error" | "warning";
  message: string;
  area?: string;
  grade?: string;
  groupId?: string;
  groupCode?: string;
  sId?: string;
  labCode?: string;
  slotKey?: string;
  rowNumber?: number;
};

export type GroupAllocation = {
  group: StudentGroup;
  status: "Allocated" | "Unallocated";
  lab: AllocationLab | null;
  slotKey: string | null;
  issue?: AllocationIssue | null;
};

export type AreaGradeSummary = {
  area: string;
  grade: string;
  studentCount: number;
  groupCount: number;
  allocatedStudents: number;
  unallocatedStudents: number;
  allocatedGroups: number;
  unallocatedGroups: number;
  status: "Fully Allocated" | "Partially Allocated" | "Unallocated";
};

export type AllocatedStudentDetail = {
  sId: string;
  area: string;
  gov?: string;
  grade: string;
  groupCode: string;
  labCode: string;
  labName: string;
  centerName?: string;
  vendorName?: string;
  address?: string;
  locationUrl?: string;
  supervisorName?: string;
  supervisorPhone?: string;
  facilitatorName?: string;
  facilitatorPhone?: string;
  slotKey: string;
  day?: string;
  time?: string;
};

export type UnallocatedStudentDetail = {
  sId: string;
  area: string;
  gov?: string;
  grade: string;
  groupCode?: string;
  reason: string;
  issueType: AllocationIssueType;
  rowNumber?: number;
};

export type AllocationResult = {
  summary: AreaGradeSummary[];
  allocations: GroupAllocation[];
  unallocatedGroups: GroupAllocation[];
  allocatedStudents: AllocatedStudentDetail[];
  unallocatedStudents: UnallocatedStudentDetail[];
  issues: AllocationIssue[];
  labs: AllocationLab[];
  stats: {
    totalStudents: number;
    validStudents: number;
    invalidStudents: number;
    allocatedStudents: number;
    unallocatedStudents: number;
    totalGroups: number;
    allocatedGroups: number;
    unallocatedGroups: number;
    totalLabsUsed: number;
    totalSlotsUsed: number;
    totalLabCapacity: number;
    usedLabCapacity: number;
    successRate: number;
  };
  config: AllocationConfig;
  createdAt: string;
};

export type AllocationRunRecord = {
  id: string;
  name: string;
  createdAt: string;
  fileName?: string;
  stats: AllocationResult["stats"];
  result: AllocationResult;
};
