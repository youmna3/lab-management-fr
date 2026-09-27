export interface OverfillRule {
  area: string;
  grades: number[];
  labIds: string[]; // ["ALL"] or specific lab IDs
  maxOverfillPerLab: number; // 1 or 2 (max 2)
}

export interface PreferredLabRule {
  area: string;
  grades: number[];
  labId: string;
  slotNum?: number;
}

export interface ExtraLabDefinition {
  area: string;
  labId: string;
  capacity: number;
  slots?: number[];
}

export interface GroupClassificationPreference {
  group_id: string;
  visit_type: "single_visit" | "multi_visit";
  repeat_count: number;
  area?: string;
  grade?: number | string;
  lab_id?: string;
}

export interface MegaGroupDefinition {
  id?: string;
  name: string;
  start_date?: string;
  end_date?: string;
  dates?: string[];
  time_slots?: string[];
  grades?: Array<number | string>;
  areas?: string[];
  student_ids?: string[];
  group_ids?: string[];
  excluded_group_ids?: string[];
  excluded_student_ids?: string[];
}

export type SessionType = "physical" | "vp";

export function isVpStudent(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  if (r.Session_Type === "vp" || r.session_type === "vp") return true;
  if (r.Session_Type === "physical" || r.session_type === "physical") {
    if (
      r.Lab_ID === "ONLINE" ||
      r["Lab ID"] === "ONLINE" ||
      r.Assigned_Lab === "ONLINE" ||
      Boolean(r.VP_Session_ID || r.vp_session_id)
    ) {
      return true;
    }
    return false;
  }
  return (
    r.Is_Online === true ||
    r.is_online === true ||
    r.assigned_online === true ||
    r.Lab_ID === "ONLINE" ||
    r["Lab ID"] === "ONLINE" ||
    r.Assigned_Lab === "ONLINE" ||
    Boolean(r.VP_Session_ID || r.vp_session_id) ||
    (typeof r.Group_ID === "string" && r.Group_ID.startsWith("VP-")) ||
    (typeof r.online_group === "string" && r.online_group.startsWith("VP-"))
  );
}

function allocationStudentId(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const value = (row as Record<string, unknown>).S_ID ?? (row as Record<string, unknown>).student_id;
  return String(value ?? "").trim();
}

export function calculateAllocationAccounting(
  masterRows: readonly unknown[] = [],
  unassignedRows: readonly unknown[] = [],
) {
  const physicalAssignedIds = new Set<string>();
  const vpAssignedIds = new Set<string>();
  let physicalSeatVisits = 0;

  for (const row of masterRows) {
    const id = allocationStudentId(row);
    if (!id) continue;
    if (isVpStudent(row)) {
      vpAssignedIds.add(id);
    } else {
      physicalAssignedIds.add(id);
      physicalSeatVisits += 1;
    }
  }

  // A final student can belong to only one assigned category. VP wins when a
  // stale physical visit row and a VP assignment coexist during reconciliation.
  for (const id of vpAssignedIds) physicalAssignedIds.delete(id);

  const unassignedIds = new Set<string>();
  for (const row of unassignedRows) {
    const id = allocationStudentId(row);
    if (id && !physicalAssignedIds.has(id) && !vpAssignedIds.has(id)) unassignedIds.add(id);
  }

  return {
    physicalAssignedIds,
    vpAssignedIds,
    unassignedIds,
    physicalAssignedCount: physicalAssignedIds.size,
    vpAssignedCount: vpAssignedIds.size,
    unassignedCount: unassignedIds.size,
    totalSeatVisits: physicalSeatVisits,
  };
}

export type SlotIdTemplate = "template_a" | "template_b" | "original";

export interface VpSessionSummary {
  id: string;
  projectId: string;
  projectName: string;
  program: "DECI" | "DEMI" | "CUSTOM";
  academicIdentity: string;
  academicLabel: string;
  track?: string;
  level: number;
  studentIds: string[];
  studentCount: number;
  capacity: number;
  governorates: string[];
  status?: "active" | "completed" | "cancelled";
  slotNum?: number;
  timeSlot?: string;
  day?: string;
}

export interface OnlineMigrationSuggestion {
  id?: string;
  decisionKey?: string;
  projectId?: string;
  projectName?: string;
  program?: "DECI" | "DEMI" | "CUSTOM";
  academicIdentity?: string;
  academicLabel?: string;
  track?: string;
  level?: number;
  governorate?: string;
  gov?: string;
  area: string; // for backward compatibility, contains governorate or primary area name
  labId: string;
  labCapacity: number;
  totalAssigned: number;
  studentCount?: number;
  totalCapacity: number;
  utilizationRate: number;
  utilizationPercent: number;
  aggregateOccupancyRate?: number;
  aggregateOccupancyPercent?: number;
  qualificationReason?: string;
  affectedAreas?: string[];
  affectedGrades?: number[];
  affectedStudentIds: string[];
  affectedGradeCounts?: Record<string, number>;
  status: "pending" | "accepted" | "rejected" | "keep_physical";
  /** Subset of affectedGrades that were actually migrated online (undefined = all grades accepted) */
  acceptedGrades?: number[];
  /** Subset of affectedStudentIds that were actually migrated (matches acceptedGrades filter) */
  acceptedStudentIds?: string[];
  acceptedAt?: string;
  acceptedBy?: string;
}

export interface AllocationPreferences {
  overfillRules: OverfillRule[];
  preferredLabRules: PreferredLabRule[];
  extraLabs: ExtraLabDefinition[];
  customSlots?: string[];
  batchDates?: string[];
  batchGroupType?: "single_session" | "multi_session";
  defaultRepeatCount?: number;
  groupClassifications?: GroupClassificationPreference[];
  blocked_days?: string[];
  mega_groups?: MegaGroupDefinition[];
  slotIdTemplate?: SlotIdTemplate;
  slotIdStartInteger?: number;
  /** Maps govName → decision. Value is either a simple status string (legacy) or an object with status + optional accepted grade list. */
  onlineMigrationDecisions?: Record<string, "accepted" | "rejected" | "keep_physical" | { status: "accepted" | "rejected" | "keep_physical"; grades?: number[] }>;
  vpWorkflow?: {
    version: 1;
    projectId: string;
    batchId: string;
    recommendations: OnlineMigrationSuggestion[];
    sessions: VpSessionSummary[];
    updatedAt: string;
  };
}

export interface OverfillSlotDetail {
  slot_key: string;
  lab_id: string;
  area: string;
  grade: number;
  time_slot: string;
  standard_capacity: number;
  total_assigned: number;
  overfill_students: number;
}

export interface AllocationSummary {
  total_students: number;
  consolidated_students_count?: number;
  assigned_count: number;
  unassigned_count: number;
  total_seat_visits?: number;
  input_checksum?: string;
  overfill_count?: number;
  overfilled_sessions_count?: number;
  total_labs: number;
  total_sessions_available: number;
  total_sessions_assigned: number;
  areas_count: number;
  batch_group_type?: "single_session" | "multi_session";
  multi_session_groups_count?: number;
  single_session_groups_count?: number;
}

export interface ConsolidationAnalysisDecision {
  decisionStatus?: "pending" | "accepted" | "rejected";
  governorate: string;
  track?: string;
  level: number;
  academicLabel: string;
  destinationArea: string;
  destinationExistingStudents: number;
  studentsMoved: number;
  finalCohortSize: number;
  sourceAreas: Array<{ sourceArea: string; studentsMoved: number }>;
  selectionReason: string;
  reason: string;
}

export interface MasterAllocationRow {
  Group_ID: string;
  S_ID: string;
  Grade: number;
  Academic_Label?: string;
  Track?: string;
  Level?: string | number;
  "Physical Area": string;
  Day: string;
  Session: string;
  Time_Slot: string;
  Lab_ID: string;
  "Lab ID"?: string;
  Slot_Key: string;
  Slot_Num: number;
  Slot_Label?: string;
  Lab_Capacity: number;
  Assigned_Count_Per_Lab?: number;
  Is_Overfill?: boolean;
  Class_Type?: string;
  Repeat_Count?: number;
  Visit_Num?: number;
  Total_Visits?: number;
  Visit_Type?: "single_visit" | "multi_visit";
  Mega_Group?: string;
  Original_Physical_Area?: string;
  Allocation_Area?: string;
  Governorate?: string;
  Session_Type?: SessionType;
  session_type?: SessionType;
  Is_Online?: boolean;
  is_online?: boolean;
  assigned_online?: boolean;
  VP_Session_ID?: string;
  vp_session_id?: string;
  online_group?: string;
  Original_Lab_ID?: string;
}

export interface DashboardSummaryRow {
  "Physical Area": string;
  Total_Students?: number;
  Students_Assigned?: number;
  Unique_Groups?: number;
  Labs_Used?: number;
  Unassigned?: number;
  Capacity_Assigned?: number;
  True_Capacity?: number;
  Utilization_Pct?: number;
  Overfill_Students?: number;
  Overfilled_Labs?: number;
  Overfilled_Sessions?: number;
  "Total Demand"?: number;
  "Total Assigned"?: number;
  "Total Unassigned"?: number;
  "Grand Total"?: number;
  "Total Groups"?: number;
  [gradeOrGroup: string]: string | number | undefined;
}

export interface AreaGradeSummaryRow {
  "Physical Area": string;
  Grade: number;
  Academic_Label?: string;
  Track?: string;
  Level?: string;
  Students_Assigned: number;
  Unique_Groups: number;
  Groups_Used?: number;
  Labs_Used: number;
  Unassigned: number;
  Total_Students: number;
}

export interface LabPivotRow {
  "Physical Area": string;
  Grade: number;
  Academic_Label?: string;
  Track?: string;
  Level?: string;
  Lab_ID: string;
  [timeSlot: string]: string | number | undefined;
}

export interface UnassignedStudentRow {
  S_ID: string;
  Grade: number;
  Academic_Label?: string;
  Track?: string;
  Level?: string;
  "Physical Area": string;
  Reason: string;
  Session_Type?: SessionType;
  session_type?: SessionType;
  [key: string]: unknown;
}

export interface ShortfallMathRow {
  Area: string;
  Grade: number;
  Academic_Label?: string;
  Track?: string;
  Level?: string;
  Demand: number;
  Sessions_Assigned: number;
  Capacity_Assigned: number;
  Students_Short: number;
  Mega_Group?: string;
}

export interface ShortfallReportRow {
  Area: string;
  Grade: number;
  Students_Short: number;
  Reason: string;
}

export interface OverflowFragmentNotice {
  area: string;
  grade: number;
  group_id: string;
  primary_lab_id: string;
  overflow_lab_id: string;
  primary_students: number;
  overflow_students: number;
  primary_capacity: number;
  has_overfill_option: boolean;
  overfill_budget: number;
  mega_group?: string;
}

export interface AllocationResultPayload {
  jobId: string;
  batch_id?: string;
  project_id?: string;
  job_id?: string;
  run_id?: string;
  revision?: number;
  updated_at?: string;
  updated_by?: string;
  allocation_owner?: string;
  allocation_owner_email?: string;
  created_by?: string;
  sync_status?: "synced" | "syncing" | "offline" | "not_synced";
  timestamp?: string;
  summary: AllocationSummary;
  logs: string[];
  shortfall_text: string;
  overfill_details?: OverfillSlotDetail[];
  preferences_applied?: AllocationPreferences;
  dashboard_summary: DashboardSummaryRow[];
  area_grade_summary: AreaGradeSummaryRow[];
  master_allocation: MasterAllocationRow[];
  physical_master_allocation?: MasterAllocationRow[];
  lab_pivot: LabPivotRow[];
  vp_pivot?: LabPivotRow[];
  lab_allocation: Array<{ Area: string; Grade: number; Lab_ID: string; Time_Slot: string; Capacity: number; [key: string]: any }>;
  unassigned_students: UnassignedStudentRow[];
  physical_unassigned_students?: UnassignedStudentRow[];
  shortfall_math: ShortfallMathRow[];
  shortfall_math_rows?: ShortfallMathRow[];
  shortfall_report?: ShortfallReportRow[];
  total_true_shortfall?: number;
  online_migration_suggestions?: OnlineMigrationSuggestion[];
  vp_sessions?: VpSessionSummary[];
  overflow_fragment_notices?: OverflowFragmentNotice[];
  consolidation_analysis?: ConsolidationAnalysisDecision[];
  generated_files: Record<string, string>;
  download_urls?: Record<string, string>;
}

export interface RunAllocationParams {
  studentFile: File | null;
  labFile: File | null;
  dashboardFile?: File | null;
  program: "DECI" | "DEMI" | "CUSTOM";
  projectId?: string;
  projectName?: string;
  projectCode?: string;
  prefix: string;
  useDbLabs?: boolean;
  labsJson?: Array<{ "Lab ID": string; Area: string; "Lab Capacity": number; "Lab Name"?: string; name?: string }>;
  preferences?: Partial<AllocationPreferences> | null;
  onProgress?: (progress: { stage: string; current: number; total: number; percent: number; message: string }) => void;
}

export interface GeneratedFileEntry {
  filename: string;
  blob: Blob;
}

interface StoredJob {
  files: Record<string, { filename: string; url: string }>;
}

const jobStore = new Map<string, StoredJob>();
const JOB_HISTORY_LIMIT = 3;

function rememberJob(jobId: string, files: Record<string, GeneratedFileEntry>) {
  const stored: StoredJob = { files: {} };
  for (const [key, entry] of Object.entries(files)) {
    stored.files[key] = { filename: entry.filename, url: URL.createObjectURL(entry.blob) };
  }
  jobStore.set(jobId, stored);

  if (jobStore.size > JOB_HISTORY_LIMIT) {
    const oldestKey = jobStore.keys().next().value;
    if (oldestKey) {
      const old = jobStore.get(oldestKey);
      old?.files && Object.values(old.files).forEach((f) => URL.revokeObjectURL(f.url));
      jobStore.delete(oldestKey);
    }
  }
}

/** Sanitizes preferences coming from UI state (which can, in edge cases, carry
 * non-serializable values like a stray React event) into plain typed data
 * before handing it to the allocation engine. */
function sanitizePreferences(preferences: Partial<AllocationPreferences> | null | undefined): AllocationPreferences | undefined {
  if (!preferences || typeof preferences !== "object" || "nativeEvent" in (preferences as any)) {
    return undefined;
  }
  const parseGrades = (g: unknown): number[] => {
    if (Array.isArray(g)) {
      return g
        .flatMap((item) => {
          if (typeof item === "number" && !isNaN(item)) return [item];
          if (typeof item === "string") {
            const matched = item.match(/\d+/g);
            return matched ? matched.map(Number) : [];
          }
          return [];
        })
        .filter((n) => !isNaN(n));
    }
    if (typeof g === "string") {
      const matched = g.match(/\d+/g);
      return matched ? matched.map(Number).filter((n) => !isNaN(n)) : [];
    }
    if (typeof g === "number" && !isNaN(g)) return [g];
    return [];
  };

  return {
    overfillRules: Array.isArray(preferences.overfillRules)
      ? preferences.overfillRules.map((r) => ({
          area: String(r.area ?? "").trim(),
          grades: parseGrades(r.grades),
          labIds: Array.isArray(r.labIds)
            ? r.labIds.map(String)
            : typeof r.labIds === "string"
            ? [r.labIds]
            : ["ALL"],
          maxOverfillPerLab: Number(r.maxOverfillPerLab || 2),
        }))
      : [],
    preferredLabRules: Array.isArray(preferences.preferredLabRules)
      ? preferences.preferredLabRules.map((p) => ({
          area: String(p.area ?? "").trim(),
          grades: parseGrades(p.grades),
          labId: String(p.labId),
          slotNum: p.slotNum !== undefined ? Number(p.slotNum) : undefined,
        }))
      : [],
    extraLabs: Array.isArray(preferences.extraLabs)
      ? preferences.extraLabs.map((e) => ({
          area: String(e.area ?? "").trim(),
          labId: String(e.labId),
          capacity: Number(e.capacity || 25),
          slots: Array.isArray(e.slots) ? e.slots.map(Number) : [1, 2, 3, 4, 5, 6, 7],
        }))
      : [],
    customSlots: Array.isArray(preferences.customSlots) ? preferences.customSlots.map(String) : undefined,
    batchDates: Array.isArray(preferences.batchDates) ? preferences.batchDates.map(String) : undefined,
    batchGroupType: preferences.batchGroupType === "multi_session" ? "multi_session" : preferences.batchGroupType === "single_session" ? "single_session" : undefined,
    defaultRepeatCount: preferences.defaultRepeatCount !== undefined ? Math.max(1, Number(preferences.defaultRepeatCount)) : undefined,
    groupClassifications: Array.isArray(preferences.groupClassifications)
      ? preferences.groupClassifications.map((c) => ({
          group_id: String(c.group_id ?? "").trim(),
          visit_type: c.visit_type === "multi_visit" ? "multi_visit" : "single_visit",
          repeat_count: Math.max(1, Number(c.repeat_count || 1)),
          area: c.area ? String(c.area).trim() : undefined,
          grade: c.grade !== undefined ? Number(c.grade) : undefined,
          lab_id: c.lab_id ? String(c.lab_id).trim() : undefined,
        }))
      : [],
    blocked_days: Array.isArray(preferences.blocked_days) ? preferences.blocked_days.map(String) : [],
    mega_groups: Array.isArray(preferences.mega_groups) ? preferences.mega_groups : [],
    slotIdTemplate: preferences.slotIdTemplate === "template_a" || preferences.slotIdTemplate === "template_b" || preferences.slotIdTemplate === "original" ? preferences.slotIdTemplate : "original",
    slotIdStartInteger: typeof preferences.slotIdStartInteger === "number" ? preferences.slotIdStartInteger : 14000,
    onlineMigrationDecisions: preferences.onlineMigrationDecisions && typeof preferences.onlineMigrationDecisions === "object" ? preferences.onlineMigrationDecisions : undefined,
  };
}

export async function runLabAllocationApi(params: RunAllocationParams): Promise<AllocationResultPayload> {
  const safeParams: RunAllocationParams = {
    ...params,
    preferences: sanitizePreferences(params.preferences),
    onProgress: params.onProgress,
  };

  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    const worker = new Worker(new URL("./lab-allocation.worker.ts", import.meta.url), { type: "module" });
    try {
      const { payload, files } = await new Promise<{ payload: AllocationResultPayload; files: Record<string, any> }>((resolve, reject) => {
        worker.onmessage = (event) => {
          if (event.data?.type === "progress") safeParams.onProgress?.(event.data.progress);
          else if (event.data?.type === "complete") resolve(event.data.output);
          else if (event.data?.type === "error") reject(new Error(event.data.message));
        };
        worker.onerror = (event) => reject(new Error(event.message || "Allocation worker failed."));
        const { onProgress: _onProgress, ...workerParams } = safeParams;
        worker.postMessage(workerParams);
      });
      rememberJob(payload.jobId, files);
      return payload;
    } finally {
      worker.terminate();
    }
  }

  const { runAllocation } = await import("./lab-allocation-runner/run");
  const { payload, files } = await runAllocation(safeParams);
  rememberJob(payload.jobId, files);
  return payload;
}

export function getDownloadFileUrl(jobId: string, fileKey: string): string {
  return jobStore.get(jobId)?.files[fileKey]?.url ?? "#";
}

export const getAllocationDownloadUrl = getDownloadFileUrl;

const sampleTemplateCache = new Map<string, string>();

function buildSampleTemplateCsv(type: "students" | "labs" | "dashboard"): string {
  if (type === "students") {
    return [
      "S_ID,Grade,Physical Area",
      "STU-001,Grade 4,Nasr City",
      "STU-002,Grade 4,Nasr City",
      "STU-003,Grade 5,Nasr City",
      "STU-004,Grade 5,Nasr City",
      "STU-005,Grade 6,Nasr City",
      "STU-006,Grade 4,Dokki",
      "STU-007,Grade 4,Dokki",
      "STU-008,Grade 5,Dokki",
      "STU-009,Grade 6,Dokki",
      "STU-010,Grade 6,Dokki",
    ].join("\n");
  }
  if (type === "labs") {
    return ["Lab ID,Area,Lab Capacity", "LAB-NC-01,Nasr City,25", "LAB-NC-02,Nasr City,20", "LAB-DOK-01,Dokki,25", "LAB-DOK-02,Dokki,15"].join("\n");
  }
  return [
    "Gov,Vendor Name,Center Name,Lab ID,Area,Lab Capacity,Number of Sessions",
    "Cairo,Vendor Alpha,Nasr City Center,LAB-NC-01,Nasr City,25,",
    "Cairo,Vendor Beta,Heliopolis Hub,LAB-NC-02,Nasr City,20,",
    "Giza,Vendor Gamma,Dokki IT Hub,LAB-DOK-01,Dokki,25,",
  ].join("\n");
}

export function getSampleTemplateUrl(type: "students" | "labs" | "dashboard"): string {
  const cached = sampleTemplateCache.get(type);
  if (cached) return cached;
  const csv = buildSampleTemplateCsv(type);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  sampleTemplateCache.set(type, url);
  return url;
}
