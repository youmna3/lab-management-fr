/**
 * Storage and Persistence Layer for Batch Student Uploads & Allocation Outputs
 *
 * Primary Authority: Supabase Shared Database (`batch_student_uploads`, `batch_allocation_outputs`, `batch_resolution_requests`)
 * Client Cache & Offline Fallback: IndexedDB
 */

import { supabase } from "@/integrations/supabase/client";
import {
  type AllocationResultPayload,
  type AllocationPreferences,
  type AllocationSummary,
  type MasterAllocationRow,
  type DashboardSummaryRow,
  type AreaGradeSummaryRow,
  type OverfillSlotDetail,
  type LabPivotRow,
  type UnassignedStudentRow,
  type ShortfallMathRow,
  calculateAllocationAccounting,
} from "@/lib/allocation-client";
import { resolveSlotSchedule, type SlotInfo } from "@/lib/lab-allocation-runner/schedule";
import { buildDashboardStyleSummary } from "@/lib/lab-allocation-runner/summaries";
import { CANONICAL_GRADE_LABELS } from "@/lib/lab-allocation-runner/parse";
import { getDayTimeSlots, flattenDayTimeSlots } from "@/lib/time-slots";
import { formatGradeLevel, getAcademicLevel, getAcademicTrack } from "@/lib/project-grade-levels";
import { applyAcceptedVpGrouping } from "@/lib/vp-session-grouping";
import { Upload as TusUpload } from "tus-js-client";

export type { AllocationResultPayload };

export type StudentStatus = "Enrolled" | "Dropped Out" | "Failed";

export interface StudentRecord {
  S_ID: string;
  Grade: string | number;
  "Physical Area": string;
  Status?: StudentStatus;
  status?: StudentStatus;
  revoked_at?: string | null;
  "Revoked At"?: string | null;
  [key: string]: unknown;
}

/**
 * Robust date-time formatter for student revocation tracking:
 * - display: YYYY-MM-DD hh:mm AM/PM (e.g. 2026-09-06 11:20 AM)
 * - full: YYYY-MM-DD HH:MM:SS (e.g. 2026-09-06 11:20:00)
 */
export function formatRevocationDateTime(isoOrDateStr?: string | null): {
  display: string;
  full: string;
} {
  if (!isoOrDateStr) {
    return { display: "N/A", full: "N/A" };
  }
  try {
    const d = new Date(isoOrDateStr);
    if (isNaN(d.getTime())) {
      return { display: String(isoOrDateStr), full: String(isoOrDateStr) };
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours24 = d.getHours();
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());

    const hours12 = hours24 % 12 || 12;
    const ampm = hours24 >= 12 ? "PM" : "AM";

    return {
      display: `${year}-${month}-${day} ${pad(hours12)}:${minutes} ${ampm}`,
      full: `${year}-${month}-${day} ${pad(hours24)}:${minutes}:${seconds}`,
    };
  } catch {
    return { display: String(isoOrDateStr), full: String(isoOrDateStr) };
  }
}

export interface BatchStudentUploadRecord {
  id?: string;
  project_id?: string | null;
  batch_id: string;
  file_name: string;
  file_size: number;
  student_count: number;
  students: StudentRecord[];
  raw_data?: string | null;
  storage_path?: string | null;
  checksum?: string | null;
  roster_version?: number | null;
  uploaded_by?: string | null;
  roster_summary?: { total: number; active: number; revoked: number; physical_areas: number } | null;
  roster_grades?: number[] | null;
  roster_areas?: string[] | null;
  roster_preview?: StudentRecord[] | null;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectRosterPage {
  rows: StudentRecord[];
  total: number;
  summary: { total: number; active: number; revoked: number; physicalAreas: number };
  grades: number[];
  areas: string[];
  metadata: Pick<BatchStudentUploadRecord, "batch_id" | "project_id" | "file_name" | "file_size" | "student_count" | "updated_at" | "storage_path" | "checksum"> | null;
}

export interface BatchAllocationOutputRecord {
  id?: string;
  project_id?: string | null;
  batch_id: string;
  allocation_storage_path?: string | null;
  summary: AllocationSummary;
  dashboard_summary: DashboardSummaryRow[];
  area_grade_summary?: AreaGradeSummaryRow[];
  master_allocation: MasterAllocationRow[];
  lab_pivot: LabPivotRow[];
  lab_allocation: AllocationResultPayload["lab_allocation"];
  unassigned_students: UnassignedStudentRow[];
  consolidation_analysis?: AllocationResultPayload["consolidation_analysis"];
  shortfall_math: ShortfallMathRow[];
  overfill_details?: OverfillSlotDetail[];
  shortfall_text?: string;
  preferences_applied?: AllocationPreferences;
  logs?: string[];
  generated_files?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
  run_id?: string;
  revision?: number;
  updated_by?: string | null;
  allocation_owner?: string | null;
  allocation_owner_email?: string | null;
  created_by?: string | null;
}

// ---------------------------------------------------------------------------
// IndexedDB Local Store (Secondary Read Cache & Offline Resilience)
// ---------------------------------------------------------------------------
const DB_NAME = "ischool_batch_allocation_v2";
const UPLOADS_STORE = "batch_student_uploads";
const OUTPUTS_STORE = "batch_allocation_outputs";
const REQUESTS_STORE = "batch_resolution_requests";

const memoryStore: Record<string, Map<string, any>> = {
  [UPLOADS_STORE]: new Map(),
  [OUTPUTS_STORE]: new Map(),
  [REQUESTS_STORE]: new Map(),
};
const fullRosterCache = new Map<string, BatchStudentUploadRecord>();
const PROJECT_ROSTER_BUCKET = "project-student-rosters";
const ALLOCATION_STANDARD_UPLOAD_LIMIT = 6 * 1024 * 1024;
const allocationSaveInFlight = new Map<string, Promise<BatchAllocationOutputRecord>>();

function rosterCacheKey(projectId: string | null | undefined, checksum: string | null | undefined) {
  return `${projectId || "unknown"}:${checksum || "legacy"}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildRosterMetadata(students: StudentRecord[]) {
  const areas = new Set<string>();
  const grades = new Set<number>();
  let active = 0;
  for (const student of students) {
    if (isStudentActive(student)) active++;
    const area = String(student["Physical Area"] || "Unspecified Area").trim() || "Unspecified Area";
    areas.add(area);
    const grade = Number(student.Grade);
    if (Number.isFinite(grade)) grades.add(grade);
  }
  return {
    summary: { total: students.length, active, revoked: students.length - active, physical_areas: areas.size },
    grades: [...grades].sort((a, b) => a - b),
    areas: [...areas].sort((a, b) => a.localeCompare(b)),
  };
}

async function downloadRoster(record: BatchStudentUploadRecord): Promise<BatchStudentUploadRecord> {
  if (!record.storage_path) return record;
  const key = rosterCacheKey(record.project_id, record.checksum);
  const cached = fullRosterCache.get(key);
  if (cached) return cached;
  const { data: signed, error: signedError } = await supabase.storage
    .from(PROJECT_ROSTER_BUCKET)
    .createSignedUrl(record.storage_path, 60);
  if (signedError || !signed?.signedUrl) throw signedError ?? new Error("Could not create project roster signed URL.");
  const response = await fetch(signed.signedUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Project roster download failed: ${response.status} ${response.statusText}`);
  const stored = await response.json() as { students?: StudentRecord[] } | StudentRecord[];
  const students = Array.isArray(stored) ? stored : stored.students;
  if (!Array.isArray(students)) throw new Error("Project roster Storage JSON is missing students.");
  const hydrated = { ...record, students };
  fullRosterCache.set(key, hydrated);
  await idbPut(UPLOADS_STORE, hydrated);
  return hydrated;
}

function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB is not available in this environment"));
    }
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOADS_STORE)) {
        db.createObjectStore(UPLOADS_STORE, { keyPath: "batch_id" });
      }
      if (!db.objectStoreNames.contains(OUTPUTS_STORE)) {
        db.createObjectStore(OUTPUTS_STORE, { keyPath: "batch_id" });
      }
      if (!db.objectStoreNames.contains(REQUESTS_STORE)) {
        db.createObjectStore(REQUESTS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openLocalDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(memoryStore[storeName]?.get(key) || null);
    });
  } catch {
    return memoryStore[storeName]?.get(key) || null;
  }
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  try {
    const db = await openLocalDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve(Array.from(memoryStore[storeName]?.values() || []));
    });
  } catch {
    return Array.from(memoryStore[storeName]?.values() || []);
  }
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const key = (value as any)?.id || (value as any)?.batch_id;
  if (key && memoryStore[storeName]) {
    memoryStore[storeName].set(key, value);
  }

  try {
    const db = await openLocalDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // handled by memoryStore
  }
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  if (memoryStore[storeName]) {
    memoryStore[storeName].delete(key);
  }

  try {
    const db = await openLocalDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // handled by memoryStore
  }
}

// ---------------------------------------------------------------------------
// 1. Student Upload Persistence (Cloud Authoritative)
// ---------------------------------------------------------------------------

export async function fetchBatchStudentUpload(batchId: string): Promise<BatchStudentUploadRecord | null> {
  if (!batchId || batchId === "ALL") return null;

  try {
    const { data, error } = await supabase
      .from("batch_student_uploads" as any)
      .select("*")
      .eq("batch_id", batchId)
      .maybeSingle();

    if (!error) {
      if (data) {
        const record = data as unknown as BatchStudentUploadRecord;
        return await downloadRoster(record);
      }
      // If Supabase returned clean null, check local cache fallback just in case
      const localCached = await idbGet<BatchStudentUploadRecord>(UPLOADS_STORE, batchId);
      return localCached || null;
    }

    console.warn("[Storage] Supabase fetchBatchStudentUpload warning:", error);
    // Resilience fallback: retrieve from local store
    const cached = await idbGet<BatchStudentUploadRecord>(UPLOADS_STORE, batchId);
    if (cached) return cached;

    return null;
  } catch (err: any) {
    console.warn("[Storage] fetchBatchStudentUpload catch fallback:", err);
    const cached = await idbGet<BatchStudentUploadRecord>(UPLOADS_STORE, batchId);
    return cached || null;
  }
}

export async function saveBatchStudentUpload(
  batchId: string,
  projectId: string | null | undefined,
  fileName: string,
  fileSize: number,
  students: StudentRecord[],
  rawData?: string,
): Promise<BatchStudentUploadRecord> {
  if (!projectId) throw new Error("A project ID is required to save the canonical project roster.");
  const updatedAt = new Date().toISOString();
  const serialized = JSON.stringify({ version: 1, project_id: projectId, batch_id: batchId, students });
  const checksum = await sha256(serialized);
  const uploadId = crypto.randomUUID();
  const storagePath = `${projectId}/${uploadId}.json`;
  const metadata = buildRosterMetadata(students);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("Session expired - please sign in again.");
  const { data: previousMetadata, error: previousError } = await supabase
    .from("batch_student_uploads" as any)
    .select("roster_version")
    .eq("batch_id", batchId)
    .maybeSingle();
  if (previousError) throw previousError;
  const rosterVersion = Number((previousMetadata as any)?.roster_version || 0) + 1;

  const { data: uploaded, error: uploadError } = await supabase.storage
    .from(PROJECT_ROSTER_BUCKET)
    .upload(storagePath, new Blob([serialized], { type: "application/json" }), {
      contentType: "application/json",
      upsert: false,
    });
  if (uploadError) throw uploadError;
  if (uploaded?.path !== storagePath) throw new Error("Project roster Storage upload verification failed.");

  const lightweight = {
    project_id: projectId,
    batch_id: batchId,
    file_name: fileName,
    file_size: fileSize,
    student_count: students.length,
    students: [],
    raw_data: null,
    storage_path: storagePath,
    checksum,
    roster_version: rosterVersion,
    uploaded_by: authData.user.email || authData.user.id,
    roster_summary: metadata.summary,
    roster_grades: metadata.grades,
    roster_areas: metadata.areas,
    roster_preview: students.slice(0, 50),
    updated_at: updatedAt,
  };
  const { error: upsertError } = await supabase
    .from("batch_student_uploads" as any)
    .upsert(lightweight as any, { onConflict: "batch_id" });
  if (upsertError) throw upsertError;
  const { data: verified, error: verifyError } = await supabase
    .from("batch_student_uploads" as any)
    .select("batch_id,project_id,storage_path,student_count,checksum,roster_version,updated_at")
    .eq("batch_id", batchId)
    .single();
  if (verifyError) throw verifyError;
  if (!verified || (verified as any).batch_id !== batchId || (verified as any).storage_path !== storagePath
      || (verified as any).checksum !== checksum || Number((verified as any).student_count) !== students.length
      || Number((verified as any).roster_version) !== rosterVersion) {
    throw new Error("Project roster database pointer verification failed.");
  }

  const record: BatchStudentUploadRecord = {
    project_id: projectId || null,
    batch_id: batchId,
    file_name: fileName,
    file_size: fileSize,
    student_count: students.length,
    students,
    raw_data: null,
    storage_path: storagePath,
    checksum,
    roster_version: rosterVersion,
    uploaded_by: authData.user.email || authData.user.id,
    roster_summary: metadata.summary,
    roster_grades: metadata.grades,
    roster_areas: metadata.areas,
    roster_preview: students.slice(0, 50),
    updated_at: updatedAt,
  };
  fullRosterCache.clear();
  fullRosterCache.set(rosterCacheKey(projectId, checksum), record);
  await idbPut(UPLOADS_STORE, record);
  return record;
}

export async function deleteBatchStudentUpload(batchId: string): Promise<void> {
  try {
    const { error } = await supabase.from("batch_student_uploads" as any).delete().eq("batch_id", batchId);
    if (error && (error as any).code !== "22P02") {
      console.warn("[Storage] Supabase deleteBatchStudentUpload cloud notice:", error);
    }
  } catch (cloudErr) {
    console.warn("[Storage] Supabase deleteBatchStudentUpload network notice:", cloudErr);
  }
  await idbDelete(UPLOADS_STORE, batchId);
}

// ---------------------------------------------------------------------------
// Active Student Filtering Predicate (Enforced for Solver Allocation Demand)
// ---------------------------------------------------------------------------

export function isStudentActive(student: { Status?: string; status?: string }): boolean {
  const s = String(student?.Status || student?.status || "Enrolled").trim().toLowerCase();
  if (
    s.includes("drop") ||
    s.includes("revok") ||
    s.includes("fail") ||
    s.includes("inactive") ||
    s.includes("withdrawn") ||
    s.includes("cancel")
  ) {
    return false;
  }
  return true;
}

export function getProjectUnassignedBatchId(projectId: string): string {
  if (!projectId) return "00000000-0000-4000-8000-000000000000";
  const clean = projectId.trim().toLowerCase();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(clean)) {
    return `00000000-${clean.slice(9)}`;
  }
  const hexOnly = clean.replace(/[^0-9a-f]/gi, "").padEnd(12, "0").slice(0, 12);
  return `00000000-0000-4000-8000-${hexOnly}`;
}

/**
 * Returns the single canonical student master dataset for a project.
 *
 * The existing schema requires a batch_id key, so project rosters are stored
 * under the deterministic synthetic ID returned by getProjectUnassignedBatchId.
 * Real batch IDs must never be used as an alternate student source.
 */
export async function fetchProjectStudentRoster(
  projectId: string,
): Promise<BatchStudentUploadRecord | null> {
  if (!projectId) return null;
  return fetchBatchStudentUpload(getProjectUnassignedBatchId(projectId));
}

/** Lightweight project-page roster query. Allocation continues to use fetchProjectStudentRoster(). */
export async function fetchProjectRosterPage(params: {
  projectId: string;
  page: number;
  pageSize: number;
  search?: string;
  grade?: string;
  status?: string;
  area?: string;
}): Promise<ProjectRosterPage> {
  const { data, error } = await supabase.rpc("get_project_roster_page" as any, {
    p_project_id: params.projectId,
    p_offset: Math.max(0, (params.page - 1) * params.pageSize),
    p_limit: params.pageSize,
    p_search: params.search?.trim() || null,
    p_grade: params.grade && params.grade !== "ALL" ? Number(params.grade) : null,
    p_status: params.status && params.status !== "ALL" ? params.status : null,
    p_area: params.area && params.area !== "ALL" ? params.area : null,
  });
  if (error) throw error;
  const payload = (data ?? {}) as any;
  const metadata = payload.metadata as ProjectRosterPage["metadata"];
  const needsFullRoster = Boolean(metadata?.storage_path) && (
    params.page > 1 || Boolean(params.search?.trim()) ||
    Boolean(params.grade && params.grade !== "ALL") ||
    Boolean(params.status && params.status !== "ALL") ||
    Boolean(params.area && params.area !== "ALL")
  );
  if (needsFullRoster) {
    const roster = await fetchProjectStudentRoster(params.projectId);
    const search = params.search?.trim().toLowerCase() || "";
    const filtered = (roster?.students || []).filter((student) => {
      const grade = Number(student.Grade);
      const status = String(student.Status || student.status || "Enrolled");
      const area = String(student["Physical Area"] || "Unspecified Area");
      const name = String(student.Name || student["Student Name"] || "");
      return (!search || String(student.S_ID).toLowerCase().includes(search) || name.toLowerCase().includes(search))
        && (!params.grade || params.grade === "ALL" || grade === Number(params.grade))
        && (!params.status || params.status === "ALL" || status === params.status)
        && (!params.area || params.area === "ALL" || area === params.area);
    });
    const offset = Math.max(0, (params.page - 1) * params.pageSize);
    return {
      rows: filtered.slice(offset, offset + params.pageSize),
      total: filtered.length,
      summary: {
        total: Number(payload.summary?.total ?? roster?.student_count ?? 0),
        active: Number(payload.summary?.active ?? 0),
        revoked: Number(payload.summary?.revoked ?? 0),
        physicalAreas: Number(payload.summary?.physical_areas ?? 0),
      },
      grades: Array.isArray(payload.grades) ? payload.grades.map(Number).filter(Number.isFinite) : [],
      areas: Array.isArray(payload.areas) ? payload.areas.map(String) : [],
      metadata,
    };
  }
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    total: Number(payload.total ?? 0),
    summary: {
      total: Number(payload.summary?.total ?? 0),
      active: Number(payload.summary?.active ?? 0),
      revoked: Number(payload.summary?.revoked ?? 0),
      physicalAreas: Number(payload.summary?.physical_areas ?? 0),
    },
    grades: Array.isArray(payload.grades) ? payload.grades.map(Number).filter(Number.isFinite) : [],
    areas: Array.isArray(payload.areas) ? payload.areas.map(String) : [],
    metadata,
  };
}

export async function fetchProjectStudentUploads(
  projectId: string,
  _batchIds: string[] = [],
  _includeUnassigned = true,
): Promise<BatchStudentUploadRecord[]> {
  const roster = await fetchProjectStudentRoster(projectId);
  return roster ? [roster] : [];
}

export async function updateStudentStatusInBatch(
  batchId: string,
  studentId: string,
  status: StudentStatus,
  existingRecord?: BatchStudentUploadRecord | null,
  revocationTimestamp?: string | null,
): Promise<BatchStudentUploadRecord | null> {
  const isRevoked = status === "Dropped Out";
  const revokedAtVal = isRevoked ? (revocationTimestamp || new Date().toISOString()) : null;

  const authoritative = existingRecord?.storage_path ? await fetchBatchStudentUpload(batchId) : null;
  if (authoritative?.storage_path) {
    let found = false;
    const students = authoritative.students.map((student) => {
      if (String(student.S_ID) !== studentId) return student;
      found = true;
      return { ...student, Status: status, status, revoked_at: revokedAtVal, "Revoked At": revokedAtVal };
    });
    return found
      ? saveBatchStudentUpload(batchId, authoritative.project_id, authoritative.file_name, authoritative.file_size, students)
      : null;
  }

  // 1. Attempt high-performance RPC if available in database
  try {
    const { error: rpcErr } = await supabase.rpc("update_student_in_batch" as any, {
      p_batch_id: batchId,
      p_student_id: studentId,
      p_grade: null,
      p_area: null,
      p_status: status,
      p_revoked_at: revokedAtVal,
    });

    if (!rpcErr) {
      const existing = existingRecord || (await idbGet<BatchStudentUploadRecord>(UPLOADS_STORE, batchId));
      if (existing && Array.isArray(existing.students)) {
        const updatedStudents = existing.students.map((s) =>
          s.S_ID === studentId ? { ...s, Status: status, status, revoked_at: revokedAtVal, "Revoked At": revokedAtVal } : s
        );
        const updatedRec: BatchStudentUploadRecord = {
          ...existing,
          students: updatedStudents,
          updated_at: new Date().toISOString(),
        };
        await idbPut(UPLOADS_STORE, updatedRec);
        return updatedRec;
      }
    }
  } catch {
    // Fall back to standard upsert
  }

  // 2. Client-side update
  const existing = existingRecord || (await fetchBatchStudentUpload(batchId));
  if (!existing || !Array.isArray(existing.students)) return null;

  let found = false;
  const updatedStudents = existing.students.map((s) => {
    if (s.S_ID === studentId) {
      found = true;
      return { ...s, Status: status, status, revoked_at: revokedAtVal, "Revoked At": revokedAtVal };
    }
    return s;
  });

  if (!found) return null;

  // Omit raw_data to prevent sending huge base64/CSV strings over HTTP on 1-row updates
  return await saveBatchStudentUpload(
    batchId,
    existing.project_id,
    existing.file_name,
    existing.file_size,
    updatedStudents,
    undefined,
  );
}

export async function bulkUpdateStudentStatuses(
  updates: Array<{ batchId: string; studentId: string; status: StudentStatus }>,
  _existingRecordsMap?: Map<string, BatchStudentUploadRecord>,
): Promise<BatchStudentUploadRecord[]> {
  if (!updates || updates.length === 0) return [];

  const rpcGroups = new Map<string, Array<{ student_id: string; status: StudentStatus; revoked_at: string | null }>>();
  const rpcNow = new Date().toISOString();
  for (const update of updates) {
    const group = rpcGroups.get(update.batchId) ?? [];
    group.push({ student_id: update.studentId, status: update.status, revoked_at: update.status === "Dropped Out" ? rpcNow : null });
    rpcGroups.set(update.batchId, group);
  }
  for (const [batchId, batchUpdates] of rpcGroups) {
    const current = await fetchBatchStudentUpload(batchId);
    if (current?.storage_path) {
      const updatesById = new Map(batchUpdates.map((update) => [update.student_id, update]));
      const nextStudents = current.students.map((student) => {
        const update = updatesById.get(String(student.S_ID));
        return update ? { ...student, Status: update.status, status: update.status, revoked_at: update.revoked_at, "Revoked At": update.revoked_at } : student;
      });
      await saveBatchStudentUpload(batchId, current.project_id, current.file_name, current.file_size, nextStudents);
      continue;
    }
    const { error } = await supabase.rpc("bulk_update_roster_student_statuses" as any, {
      p_batch_id: batchId,
      p_updates: batchUpdates,
    });
    if (error) throw error;
  }
  return [];
}

export async function updateStudentDetailsInBatch(
  batchId: string,
  studentId: string,
  updates: Partial<StudentRecord>,
  existingRecord?: BatchStudentUploadRecord | null,
): Promise<BatchStudentUploadRecord | null> {
  const authoritative = existingRecord?.storage_path ? await fetchBatchStudentUpload(batchId) : null;
  if (authoritative?.storage_path) {
    let found = false;
    const students = authoritative.students.map((student) => {
      if (String(student.S_ID) !== studentId) return student;
      found = true;
      return { ...student, ...updates };
    });
    return found
      ? saveBatchStudentUpload(batchId, authoritative.project_id, authoritative.file_name, authoritative.file_size, students)
      : null;
  }
  // 1. Attempt high-performance RPC if available in database
  try {
    const { error: rpcErr } = await supabase.rpc("update_student_in_batch" as any, {
      p_batch_id: batchId,
      p_student_id: studentId,
      p_grade: updates.Grade ? Number(updates.Grade) : null,
      p_area: updates["Physical Area"] || null,
      p_status: updates.Status || updates.status || null,
      p_revoked_at: updates.revoked_at ?? null,
    });

    if (!rpcErr) {
      const existing = existingRecord || (await idbGet<BatchStudentUploadRecord>(UPLOADS_STORE, batchId));
      if (existing && Array.isArray(existing.students)) {
        const updatedStudents = existing.students.map((s) =>
          s.S_ID === studentId ? { ...s, ...updates } : s
        );
        const updatedRec: BatchStudentUploadRecord = {
          ...existing,
          students: updatedStudents,
          updated_at: new Date().toISOString(),
        };
        await idbPut(UPLOADS_STORE, updatedRec);
        return updatedRec;
      }
    }
  } catch {
    // Fall back to standard upsert
  }

  // 2. Client-side update
  const existing = existingRecord || (await fetchBatchStudentUpload(batchId));
  if (!existing || !Array.isArray(existing.students)) return null;

  let found = false;
  const updatedStudents = existing.students.map((s) => {
    if (s.S_ID === studentId) {
      found = true;
      return { ...s, ...updates };
    }
    return s;
  });

  if (!found) return null;

  // Omit raw_data to prevent sending huge base64/CSV strings over HTTP on 1-row updates
  const savedRecord = await saveBatchStudentUpload(
    batchId,
    existing.project_id,
    existing.file_name,
    existing.file_size,
    updatedStudents,
    undefined,
  );

  const updatedTarget = updatedStudents.find((s) => s.S_ID === studentId);
  if (updatedTarget) {
    void syncBatchStudentWithAllocationOutput(batchId, existing.project_id, updatedTarget, "status_change");
  }

  return savedRecord;
}

/**
 * Automatically reconciles and syncs a batch's allocation output when student roster changes.
 * Ensures newly added students in Projects immediately increment Total Demand & appear in the unassigned roster!
 */
export async function syncBatchStudentWithAllocationOutput(
  batchId: string,
  projectId: string | null | undefined,
  student: StudentRecord,
  action: "add" | "remove" | "status_change",
): Promise<void> {
  try {
    const output = await fetchBatchAllocationOutput(batchId);
    if (!output || !output.summary) return;

    const sId = String(student.S_ID || "").trim();
    if (!sId) return;

    const active = isStudentActive(student);
    const assignedIndex = (output.master_allocation || []).findIndex((m) => m.S_ID === sId);
    const isAssigned = assignedIndex >= 0;
    const unassignedIndex = (output.unassigned_students || []).findIndex((u) => u.S_ID === sId);

    let modified = false;

    if (action === "add" || action === "status_change") {
      if (active) {
        if (!isAssigned && unassignedIndex < 0) {
          // Add to unassigned list awaiting placement
          const unassignedRow: UnassignedStudentRow = {
            S_ID: sId,
            Grade: Number(student.Grade) || 4,
            "Physical Area": String(student["Physical Area"] || "").trim(),
            Reason: "Newly added student — pending lab assignment",
          };
          output.unassigned_students = [unassignedRow, ...(output.unassigned_students || [])];
          modified = true;
        }
      } else {
        // Student dropped out or revoked: remove from unassigned if present
        if (unassignedIndex >= 0) {
          output.unassigned_students.splice(unassignedIndex, 1);
          modified = true;
        }
      }
    } else if (action === "remove") {
      // Student removed completely from batch
      if (unassignedIndex >= 0) {
        output.unassigned_students.splice(unassignedIndex, 1);
        modified = true;
      }
    }

    if (modified) {
      output.summary.unassigned_count = (output.unassigned_students || []).length;
      output.summary.total_students = (output.summary.assigned_count || 0) + output.summary.unassigned_count;
      await saveBatchAllocationOutput(batchId, projectId || null, output);
    }
  } catch (err) {
    console.warn("[Storage] syncBatchStudentWithAllocationOutput notice:", err);
  }
}

export async function addStudentToBatchRecord(
  batchId: string,
  projectId: string | null | undefined,
  student: StudentRecord,
): Promise<BatchStudentUploadRecord> {
  const studentToInsert: StudentRecord = {
    ...student,
    Status: student.Status ?? student.status ?? "Enrolled",
    status: student.Status ?? student.status ?? "Enrolled",
  };
  const authoritative = await fetchBatchStudentUpload(batchId);
  if (authoritative?.storage_path) {
    const index = authoritative.students.findIndex((item) => String(item.S_ID) === String(student.S_ID));
    const students = [...authoritative.students];
    if (index >= 0) students[index] = { ...students[index], ...studentToInsert };
    else students.unshift(studentToInsert);
    const saved = await saveBatchStudentUpload(
      batchId, projectId || authoritative.project_id, authoritative.file_name, authoritative.file_size, students,
    );
    void syncBatchStudentWithAllocationOutput(batchId, projectId || authoritative.project_id, studentToInsert, "add");
    return saved;
  }
  const { data: rpcUpdated, error: rpcError } = await supabase.rpc("add_project_roster_student" as any, {
    p_batch_id: batchId,
    p_project_id: projectId,
    p_student: studentToInsert,
  });
  if (!rpcError && rpcUpdated === true) {
    void syncBatchStudentWithAllocationOutput(batchId, projectId, studentToInsert, "add");
    return { batch_id: batchId, project_id: projectId, file_name: "project_roster", file_size: 0, student_count: 1, students: [studentToInsert] };
  }
  const existing = authoritative;

  let savedRecord: BatchStudentUploadRecord;
  if (!existing) {
    savedRecord = await saveBatchStudentUpload(
      batchId,
      projectId,
      `batch_${batchId}_students.csv`,
      100,
      [studentToInsert],
    );
  } else {
    const idx = existing.students.findIndex((s) => s.S_ID === student.S_ID);
    let updatedList: StudentRecord[];
    if (idx >= 0) {
      updatedList = [...existing.students];
      updatedList[idx] = { ...updatedList[idx], ...studentToInsert };
    } else {
      updatedList = [studentToInsert, ...existing.students];
    }

    savedRecord = await saveBatchStudentUpload(
      batchId,
      projectId || existing.project_id,
      existing.file_name,
      existing.file_size,
      updatedList,
      existing.raw_data ?? undefined,
    );
  }

  // Instantly keep Lab Allocation demand and unassigned roster in sync
  void syncBatchStudentWithAllocationOutput(batchId, projectId || existing?.project_id, studentToInsert, "add");

  return savedRecord;
}

export async function removeStudentFromBatchRecord(
  batchId: string,
  studentId: string,
): Promise<BatchStudentUploadRecord | null> {
  const authoritative = await fetchBatchStudentUpload(batchId);
  if (authoritative?.storage_path) {
    const students = authoritative.students.filter((student) => String(student.S_ID) !== studentId);
    if (students.length === authoritative.students.length) return authoritative;
    const saved = await saveBatchStudentUpload(
      batchId, authoritative.project_id, authoritative.file_name, authoritative.file_size, students,
    );
    void syncBatchStudentWithAllocationOutput(batchId, authoritative.project_id, { S_ID: studentId } as StudentRecord, "remove");
    return saved;
  }
  const { data: rpcUpdated, error: rpcError } = await supabase.rpc("remove_project_roster_student" as any, {
    p_batch_id: batchId,
    p_student_id: studentId,
  });
  if (!rpcError && rpcUpdated === true) return null;
  const existing = authoritative;
  if (!existing) return null;

  const filtered = existing.students.filter((s) => s.S_ID !== studentId);
  if (filtered.length === existing.students.length) return existing;

  const savedRecord = await saveBatchStudentUpload(
    batchId,
    existing.project_id,
    existing.file_name,
    existing.file_size,
    filtered,
    existing.raw_data ?? undefined,
  );

  // Instantly keep Lab Allocation demand and unassigned roster in sync
  void syncBatchStudentWithAllocationOutput(batchId, existing.project_id, { S_ID: studentId } as any, "remove");

  return savedRecord;
}

// ---------------------------------------------------------------------------
// 2. Merge Strategies (Replace vs Merge)
// ---------------------------------------------------------------------------

export type StudentMergeStrategy = "replace" | "merge_overwrite" | "merge_skip";

export interface MergeResult {
  merged: StudentRecord[];
  strategy: StudentMergeStrategy;
  addedCount: number;
  replacedCount: number;
  duplicateCount: number;
}

export function mergeStudentDatasets(
  existingStudents: StudentRecord[],
  incomingStudents: StudentRecord[],
  strategy: StudentMergeStrategy,
): MergeResult {
  if (strategy === "replace" || existingStudents.length === 0) {
    return {
      merged: incomingStudents,
      strategy: "replace",
      addedCount: incomingStudents.length,
      replacedCount: existingStudents.length,
      duplicateCount: 0,
    };
  }

  const existingMap = new Map<string, StudentRecord>();
  const order: string[] = [];

  for (const s of existingStudents) {
    const key = String(s.S_ID || "").trim();
    if (key) {
      existingMap.set(key, s);
      order.push(key);
    }
  }

  let duplicateCount = 0;
  let addedCount = 0;
  let replacedCount = 0;

  for (const incoming of incomingStudents) {
    const key = String(incoming.S_ID || "").trim();
    if (!key) continue;

    if (existingMap.has(key)) {
      duplicateCount++;
      if (strategy === "merge_overwrite") {
        const existingRec = existingMap.get(key)!;
        const incomingHasExplicitNonDefaultStatus =
          incoming.Status === "Dropped Out" || incoming.Status === "Failed" ||
          incoming.status === "Dropped Out" || incoming.status === "Failed";
        const preservedStatus = incomingHasExplicitNonDefaultStatus
          ? (incoming.Status ?? incoming.status)
          : (existingRec.Status ?? existingRec.status ?? incoming.Status ?? incoming.status ?? "Enrolled");

        let revokedAt: string | null = null;
        if (preservedStatus === "Dropped Out") {
          revokedAt = incoming.revoked_at || (incoming as any)["Revoked At"] || existingRec.revoked_at || (existingRec as any)["Revoked At"] || new Date().toISOString();
        }

        existingMap.set(key, {
          ...existingRec,
          ...incoming,
          Status: preservedStatus as StudentStatus,
          status: preservedStatus as StudentStatus,
          revoked_at: revokedAt,
          "Revoked At": revokedAt,
        });
        replacedCount++;
      }
      // if "merge_skip", keep original existing record
    } else {
      const statusVal = (incoming.Status ?? incoming.status ?? "Enrolled") as StudentStatus;
      let revokedAt: string | null = null;
      if (statusVal === "Dropped Out") {
        revokedAt = incoming.revoked_at || (incoming as any)["Revoked At"] || new Date().toISOString();
      }
      const formattedIncoming: StudentRecord = {
        ...incoming,
        Status: statusVal,
        status: statusVal,
        revoked_at: revokedAt,
        "Revoked At": revokedAt,
      };
      existingMap.set(key, formattedIncoming);
      order.push(key);
      addedCount++;
    }
  }

  const merged = order.map((key) => existingMap.get(key)!);

  return {
    merged,
    strategy,
    addedCount,
    replacedCount,
    duplicateCount,
  };
}

export async function saveProjectUnassignedUpload(
  projectId: string,
  fileName: string,
  fileSize: number,
  students: StudentRecord[],
  rawData?: string,
  strategy: StudentMergeStrategy = "merge_overwrite",
): Promise<BatchStudentUploadRecord> {
  const unassignedBatchId = getProjectUnassignedBatchId(projectId);
  const existing = await fetchBatchStudentUpload(unassignedBatchId);
  let finalStudents: StudentRecord[] = students;

  if (existing && existing.students && existing.students.length > 0 && strategy !== "replace") {
    const mergeResult = mergeStudentDatasets(existing.students, students, strategy);
    finalStudents = mergeResult.merged;
  }

  return await saveBatchStudentUpload(
    unassignedBatchId,
    projectId,
    fileName,
    fileSize,
    finalStudents,
    rawData,
  );
}

export function convertStudentsToCsv(students: StudentRecord[], activeOnly = false, program?: unknown): string {
  const list = activeOnly ? (students || []).filter(isStudentActive) : (students || []);
  if (list.length === 0) return "S_ID,Grade,Physical Area,Status,Revoked At\n";

  const headers = ["S_ID", "Grade", "Physical Area", "Status", "Revoked At"];

  const escapeCsv = (val: unknown) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = [headers.join(",")];
  for (const s of list) {
    const sId = escapeCsv(s.S_ID || "");
    const rawGrade = s.Grade;
    let gradeStr: string;
    if (program) {
      gradeStr = formatGradeLevel(rawGrade, program);
    } else if (typeof rawGrade === "number" && CANONICAL_GRADE_LABELS[rawGrade]) {
      gradeStr = CANONICAL_GRADE_LABELS[rawGrade];
    } else if (typeof rawGrade === "string") {
      const asNum = Number(rawGrade);
      gradeStr = !isNaN(asNum) && CANONICAL_GRADE_LABELS[asNum] ? CANONICAL_GRADE_LABELS[asNum] : rawGrade;
    } else {
      gradeStr = String(rawGrade || "");
    }
    const grade = escapeCsv(gradeStr);
    const area = escapeCsv(s["Physical Area"] || "");
    const status = escapeCsv(s.Status || s.status || "Enrolled");
    const rawRevoked = s.revoked_at || (s as any)["Revoked At"] || "";
    const formattedRevoked = rawRevoked ? formatRevocationDateTime(String(rawRevoked)).full : "";
    const revokedAt = escapeCsv(formattedRevoked);
    rows.push(`${sId},${grade},${area},${status},${revokedAt}`);
  }
  return rows.join("\n");
}

export function createStudentFileFromRecords(
  students: StudentRecord[],
  fileName = "students.csv",
  activeOnly = true,
): File {
  const csvContent = convertStudentsToCsv(students, activeOnly);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  return new File([blob], fileName.endsWith(".csv") ? fileName : `${fileName}.csv`, {
    type: "text/csv",
    lastModified: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// 3. Allocation Output Persistence (Cloud Authoritative)
// ---------------------------------------------------------------------------

export function reconcileFinalAllocationSummary(payload: AllocationResultPayload): AllocationResultPayload {
  const totalStudents = Math.max(0, Number(payload.summary?.total_students) || 0);
  const physicalRows = payload.physical_master_allocation;
  const masterRows = payload.master_allocation || [];
  const unassignedRows = payload.unassigned_students || [];
  const hasAllocationDetails = masterRows.length > 0 || unassignedRows.length > 0
    || (physicalRows?.length || 0) > 0 || (payload.physical_unassigned_students?.length || 0) > 0;

  let assignedCount = Math.max(0, Number(payload.summary?.assigned_count) || 0);
  let totalSeatVisits = Number(payload.summary?.total_seat_visits) || 0;
  if (hasAllocationDetails) {
    const accounting = calculateAllocationAccounting(masterRows.length > 0 ? masterRows : physicalRows || [], unassignedRows);
    const finalAssignedIds = new Set([...accounting.physicalAssignedIds, ...accounting.vpAssignedIds]);
    for (const recommendation of payload.online_migration_suggestions || []) {
      if (recommendation.status !== "accepted") continue;
      for (const studentId of recommendation.affectedStudentIds || []) {
        const normalizedId = String(studentId || "").trim();
        if (normalizedId) finalAssignedIds.add(normalizedId);
      }
    }
    assignedCount = finalAssignedIds.size;
    totalSeatVisits = accounting.totalSeatVisits;
  }

  assignedCount = Math.min(totalStudents, assignedCount);
  return {
    ...payload,
    summary: {
      ...payload.summary,
      assigned_count: assignedCount,
      unassigned_count: Math.max(0, totalStudents - assignedCount),
      total_seat_visits: totalSeatVisits,
    },
  };
}

async function hydrateVpState(payload: AllocationResultPayload, batchId: string): Promise<AllocationResultPayload> {
  const { data, error } = await (supabase.rpc as any)("get_batch_vp_state", { p_batch_id: batchId });
  if (error || !data || !Array.isArray(data.recommendations)) {
    return reconcileFinalAllocationSummary({ ...payload, sync_status: "synced" });
  }
  const recommendations = data.recommendations.length > 0 ? data.recommendations : (payload.online_migration_suggestions || []);
  const storedSessions = Array.isArray(data.sessions) && data.sessions.length > 0 ? data.sessions : (payload.vp_sessions || []);
  const first = recommendations[0];
  const grouping = payload.master_allocation.length > 0 ? applyAcceptedVpGrouping(
    payload.master_allocation || [],
    recommendations,
    {
      id: first?.projectId || "project",
      name: first?.projectName || "Project",
      program: first?.program || "DECI",
    },
    payload.unassigned_students || [],
  ) : { rows: payload.master_allocation, sessions: storedSessions };
  const statusBySession = new Map<string, "active" | "completed" | "cancelled">(
    storedSessions.map((session: any) => [session.id, session.status] as [string, "active" | "completed" | "cancelled"]),
  );
  const acceptedIds = new Set(recommendations.filter((item: any) => item.status === "accepted").flatMap((item: any) => item.affectedStudentIds || []));
  const remainingUnassigned = (payload.unassigned_students || []).filter((student) => !acceptedIds.has(student.S_ID));
  return reconcileFinalAllocationSummary({
    ...payload,
    sync_status: "synced",
    online_migration_suggestions: recommendations,
    vp_sessions: grouping.sessions.map((session: any) => ({ ...session, status: statusBySession.get(session.id) || session.status })),
    master_allocation: grouping.rows,
    unassigned_students: remainingUnassigned,
    summary: data.summary && typeof data.summary === "object" ? { ...payload.summary, ...data.summary } : payload.summary,
    preferences_applied: {
      ...(payload.preferences_applied || { overfillRules: [], preferredLabRules: [], extraLabs: [] }),
      onlineMigrationDecisions: data.decisions || payload.preferences_applied?.onlineMigrationDecisions,
    },
  });
}

export async function fetchBatchAllocationSummary(batchId: string): Promise<AllocationResultPayload | null> {
  return fetchBatchAllocationOutput(batchId);
}

const allocationStorageDownloads = new Map<string, Promise<unknown>>();

async function downloadAllocationStorageJson(batchId: string, runId: string | undefined, path: string): Promise<unknown> {
  const cacheKey = `${batchId}:${runId || path}`;
  const existing = allocationStorageDownloads.get(cacheKey);
  if (existing) return existing;
  const request = (async () => {
    const { data: signedData, error: signedError } = await supabase.storage
      .from("allocation-results")
      .createSignedUrl(path, 60);
    if (signedError || !signedData?.signedUrl) throw signedError ?? new Error("Could not create allocation signed URL");
    const response = await fetch(signedData.signedUrl, { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error(`Allocation file download failed: ${response.status} ${response.statusText}`);
    if (import.meta.env.DEV) {
      console.log("[Allocation Storage] signed download", {
        batchId, path, status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
      });
    }
    const parsed = JSON.parse(await response.text()) as unknown;
    return typeof parsed === "string" ? JSON.parse(parsed) as unknown : parsed;
  })();
  allocationStorageDownloads.set(cacheKey, request);
  request.catch(() => allocationStorageDownloads.delete(cacheKey));
  return request;
}

export async function invalidateBatchAllocationCache(batchId: string): Promise<void> {
  if (batchId) {
    for (const key of allocationStorageDownloads.keys()) {
      if (key.startsWith(`${batchId}:`)) allocationStorageDownloads.delete(key);
    }
    await idbDelete(OUTPUTS_STORE, batchId);
  }
}

export async function fetchBatchAllocationOutput(batchId: string): Promise<AllocationResultPayload | null> {
  if (!batchId || batchId === "ALL") return null;

  // Supabase is authoritative. IndexedDB is consulted only when the cloud cannot be reached.
  let loadingFromStorage = false;
  try {
    const { data, error } = await supabase
      .from("batch_allocation_outputs" as any)
      .select("batch_id,project_id,summary,preferences_applied,allocation_storage_path,created_at,updated_at,run_id,revision,updated_by,allocation_owner,allocation_owner_email,created_by")
      .eq("batch_id", batchId)
      .maybeSingle();

    if (!error && data) {
      const metadata = data as unknown as BatchAllocationOutputRecord;
      let record: BatchAllocationOutputRecord;
      if (metadata.allocation_storage_path) {
        loadingFromStorage = true;
        const allocationStoragePath = metadata.allocation_storage_path;
        const parsedObject = await downloadAllocationStorageJson(batchId, metadata.run_id, allocationStoragePath);
        if (!parsedObject || typeof parsedObject !== "object" || Array.isArray(parsedObject)) {
          throw new Error("Allocation Storage JSON does not contain an allocation object.");
        }
        const parsedRecord = parsedObject as Record<string, unknown>;
        const wrappedRecord = parsedRecord.payload && typeof parsedRecord.payload === "object"
          ? parsedRecord.payload as Record<string, unknown>
          : parsedRecord.result && typeof parsedRecord.result === "object"
            ? parsedRecord.result as Record<string, unknown>
            : parsedRecord;
        const storedRecord = {
          ...wrappedRecord,
          summary: wrappedRecord.summary,
          master_allocation: wrappedRecord.master_allocation ?? wrappedRecord.physical_master_allocation ?? wrappedRecord.masterAllocation,
          lab_allocation: wrappedRecord.lab_allocation ?? wrappedRecord.labAllocation,
          lab_pivot: wrappedRecord.lab_pivot ?? wrappedRecord.labPivot,
          unassigned_students: wrappedRecord.unassigned_students ?? wrappedRecord.physical_unassigned_students ?? wrappedRecord.unassignedStudents,
          dashboard_summary: wrappedRecord.dashboard_summary ?? wrappedRecord.dashboardSummary,
          area_grade_summary: wrappedRecord.area_grade_summary ?? wrappedRecord.areaGradeSummary,
          consolidation_analysis: wrappedRecord.consolidation_analysis ?? wrappedRecord.consolidationAnalysis ?? [],
          preferences_applied: wrappedRecord.preferences_applied ?? wrappedRecord.preferences,
        } as unknown as BatchAllocationOutputRecord;
        if (import.meta.env.DEV) {
          console.log("[Allocation Storage] parsed", {
            total: storedRecord.summary?.total_students,
            assigned: storedRecord.summary?.assigned_count,
            masterRows: storedRecord.master_allocation?.length,
            unassignedRows: storedRecord.unassigned_students?.length,
          });
        }
        const requiredArrays: Array<keyof BatchAllocationOutputRecord> = [
          "master_allocation",
          "lab_allocation",
          "lab_pivot",
          "unassigned_students",
          "dashboard_summary",
          "area_grade_summary",
        ];
        if (!storedRecord.summary || typeof storedRecord.summary !== "object") {
          throw new Error("Allocation Storage JSON is missing summary.");
        }
        for (const field of requiredArrays) {
          if (!Array.isArray(storedRecord[field])) {
            throw new Error(`Allocation Storage JSON is missing ${field}.`);
          }
        }
        if (import.meta.env.DEV) {
          console.log("[Allocation Storage] loaded", {
            batchId,
            path: metadata.allocation_storage_path,
            keys: Object.keys(wrappedRecord),
            summary: storedRecord.summary,
            masterCount: storedRecord.master_allocation.length,
            unassignedCount: storedRecord.unassigned_students.length,
          });
        }
        if (storedRecord.batch_id !== batchId) {
          throw new Error(`Allocation file belongs to batch ${storedRecord.batch_id}, not ${batchId}.`);
        }
        record = {
          ...storedRecord,
          ...metadata,
          preferences_applied: {
            ...(storedRecord.preferences_applied || {}),
            ...(metadata.preferences_applied || {}),
          } as AllocationPreferences,
        };
      } else {
        // Compatibility for allocations saved before Storage-backed persistence.
        const { data: legacyData, error: legacyError } = await supabase
          .from("batch_allocation_outputs" as any)
          .select("*")
          .eq("batch_id", batchId)
          .single();
        if (legacyError) throw legacyError;
        record = legacyData as unknown as BatchAllocationOutputRecord;
      }
      await idbPut(OUTPUTS_STORE, record);
      return await hydrateVpState(recordToPayload(record), batchId);
    }

    if (error) {
      throw error;
    }
    await idbDelete(OUTPUTS_STORE, batchId);
    return null;
  } catch (err: any) {
    if (loadingFromStorage) {
      console.error("[Storage] Authoritative allocation file load failed:", err);
      throw err;
    }
    console.warn("[Storage] Cloud unavailable; using offline allocation cache:", err);
    const localCached = await idbGet<BatchAllocationOutputRecord>(OUTPUTS_STORE, batchId);
    return localCached ? { ...recordToPayload(localCached), sync_status: "offline" } as AllocationResultPayload : null;
  }
}

export async function saveBatchAllocationOutput(
  batchId: string,
  projectId: string | null | undefined,
  payload: AllocationResultPayload,
  options: { requireCloud?: boolean; cloudFirst?: boolean; updatedBy?: string; onUploadProgress?: (percent: number) => void } = {},
): Promise<BatchAllocationOutputRecord> {
  const record = serializeBatchAllocationOutput(batchId, projectId, payload);
  const runId = record.run_id || crypto.randomUUID();
  record.run_id = runId;
  const saveKey = `${batchId}:${runId}`;
  const existingSave = allocationSaveInFlight.get(saveKey);
  if (existingSave) return existingSave;
  const savePromise = saveBatchAllocationOutputInternal(batchId, record, options);
  allocationSaveInFlight.set(saveKey, savePromise);
  try {
    return await savePromise;
  } finally {
    if (allocationSaveInFlight.get(saveKey) === savePromise) allocationSaveInFlight.delete(saveKey);
  }
}

async function uploadLargeAllocationWithTus(
  file: Blob,
  storagePath: string,
  accessToken: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  const baseUrl = env?.VITE_SUPABASE_URL || (typeof process !== "undefined" ? process.env?.SUPABASE_URL : undefined);
  if (!baseUrl) throw new Error("Missing Supabase URL for resumable allocation upload.");
  const projectRef = new URL(baseUrl).hostname.split(".")[0];
  const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  await new Promise<void>((resolve, reject) => {
    const upload = new TusUpload(file, {
      endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${accessToken}` },
      metadata: { bucketName: "allocation-results", objectName: storagePath, contentType: "application/json" },
      uploadSize: file.size,
      removeFingerprintOnSuccess: true,
      onError: reject,
      onProgress: (uploaded, total) => onProgress?.(total > 0 ? Math.round((uploaded / total) * 100) : 0),
      onSuccess: () => { onProgress?.(100); resolve(); },
    });
    upload.findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });
}

async function saveBatchAllocationOutputInternal(
  batchId: string,
  record: BatchAllocationOutputRecord,
  options: { requireCloud?: boolean; cloudFirst?: boolean; updatedBy?: string; onUploadProgress?: (percent: number) => void },
): Promise<BatchAllocationOutputRecord> {
  try {
    const runId = record.run_id!;
    const json = JSON.stringify(record);
    const allocationFile = new Blob([json], { type: "application/json" });
    const checksumRecord = {
      ...record,
      updated_at: null,
      preferences_applied: record.preferences_applied ? {
        ...record.preferences_applied,
        vpWorkflow: (record.preferences_applied as any).vpWorkflow ? {
          ...(record.preferences_applied as any).vpWorkflow,
          updatedAt: null,
        } : undefined,
      } : undefined,
    };
    const payloadChecksum = await sha256(JSON.stringify(checksumRecord));
    const objectName = `${runId}-${payloadChecksum.slice(0, 24)}.json`;
    const storagePath = `${batchId}/${objectName}`;
    console.log("[Allocation Save] payload", {
      bytes: allocationFile.size,
      mb: (allocationFile.size / 1024 / 1024).toFixed(2),
      batchId,
      runId,
    });
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session?.access_token) throw new Error("Session expired - please sign in again.");
    const { data: existingObjects, error: listError } = await supabase.storage
      .from("allocation-results")
      .list(batchId, { search: objectName, limit: 1 });
    if (listError) throw listError;
    const alreadyUploaded = existingObjects?.some((object) => object.name === objectName) ?? false;
    if (alreadyUploaded) {
      options.onUploadProgress?.(100);
    } else if (allocationFile.size > ALLOCATION_STANDARD_UPLOAD_LIMIT) {
      await uploadLargeAllocationWithTus(allocationFile, storagePath, sessionData.session.access_token, options.onUploadProgress);
    } else {
      options.onUploadProgress?.(0);
      const { data: uploadedFile, error: uploadError } = await supabase.storage
        .from("allocation-results")
        .upload(storagePath, allocationFile, { contentType: "application/json", upsert: false });
      if (uploadError) throw uploadError;
      if (!uploadedFile?.path || uploadedFile.path !== storagePath) {
        throw new Error("Allocation Storage upload verification failed.");
      }
      options.onUploadProgress?.(100);
    }

    const lightweightPreferences = { ...(record.preferences_applied || {}) } as AllocationPreferences & { vpWorkflow?: unknown };
    delete lightweightPreferences.vpWorkflow;
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error("Session expired - please sign in again.");

    const { error: upsertError } = await supabase
      .from("batch_allocation_outputs" as any)
      .upsert({
        batch_id: batchId,
        project_id: record.project_id,
        summary: record.summary,
        preferences_applied: lightweightPreferences,
        allocation_storage_path: storagePath,
        run_id: runId,
        updated_by: options.updatedBy || authData.user.email || null,
        updated_at: record.updated_at,
        allocation_owner: record.allocation_owner || authData.user.id,
        allocation_owner_email: record.allocation_owner_email || authData.user.email || null,
        created_by: record.created_by || authData.user.id,
      } as any, { onConflict: "batch_id" });
    if (upsertError) throw upsertError;

    const { data: savedMetadata, error: readBackError } = await supabase
      .from("batch_allocation_outputs" as any)
      .select("batch_id,project_id,allocation_storage_path,run_id,revision,updated_by,updated_at,summary")
      .eq("batch_id", batchId)
      .single();
    if (readBackError) throw readBackError;
    if (!savedMetadata) throw new Error("Allocation save verification returned no record.");
    const verifiedMetadata = savedMetadata as unknown as Pick<
      BatchAllocationOutputRecord,
      "batch_id" | "project_id" | "allocation_storage_path" | "run_id" | "revision" | "updated_by" | "updated_at" | "summary"
    >;
    if (verifiedMetadata.batch_id !== batchId) {
      throw new Error(`Allocation save verification returned batch ${verifiedMetadata.batch_id} instead of ${batchId}.`);
    }
    if (verifiedMetadata.allocation_storage_path !== storagePath) {
      throw new Error("Allocation save verification returned a different Storage path.");
    }
    if (verifiedMetadata.run_id !== runId) {
      throw new Error("Allocation save verification returned a different run ID.");
    }

    const expectedSummary = record.summary as unknown as Record<string, unknown>;
    const savedSummary = verifiedMetadata.summary as unknown as Record<string, unknown> | null;
    const summaryTotalFields = [
      "total_students",
      "consolidated_students_count",
      "assigned_count",
      "unassigned_count",
      "total_seat_visits",
      "overfill_count",
      "overfilled_sessions_count",
      "total_labs",
      "total_sessions_available",
      "total_sessions_assigned",
      "areas_count",
      "multi_session_groups_count",
      "single_session_groups_count",
    ];
    if (!savedSummary) throw new Error("Allocation save verification returned no summary.");
    for (const field of summaryTotalFields) {
      if (expectedSummary[field] !== undefined && savedSummary[field] !== expectedSummary[field]) {
        throw new Error(
          `Allocation save verification failed for summary.${field}: expected ${expectedSummary[field]}, received ${savedSummary[field]}.`,
        );
      }
    }

    Object.assign(record, verifiedMetadata, { allocation_storage_path: storagePath, sync_status: "synced" });
  } catch (cloudErr) {
    console.error("[Storage] Supabase saveBatchAllocationOutput failed:", cloudErr);
    throw cloudErr;
  }
  await idbPut(OUTPUTS_STORE, record);
  return record;
}

async function ensureValidSupabaseSession(forceRefresh = false): Promise<void> {
  const { data, error } = forceRefresh
    ? await supabase.auth.refreshSession()
    : await supabase.auth.getSession();
  let session = data.session;
  if (!error && session && !forceRefresh && session.expires_at && session.expires_at * 1000 <= Date.now() + 30_000) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session;
    if (refreshed.error) throw new Error("Session expired - please sign in again.");
  }
  if (error || !session?.access_token) throw new Error("Session expired - please sign in again.");
}

function isAuthenticationError(error: any): boolean {
  const message = String(error?.message || "").toLowerCase();
  return error?.status === 401 || error?.code === "PGRST301" || error?.code === "28000"
    || message.includes("jwt") || message.includes("session expired");
}

/** Persists a complete VP decision/grouping update as one atomic database row upsert. */
export async function bulkUpdateVpRecommendations(
  batchId: string,
  projectId: string | null | undefined,
  payload: AllocationResultPayload,
  updatedBy?: string,
): Promise<AllocationResultPayload> {
  const cloudProjectId = projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
    ? projectId
    : null;
  const reconciledPayload = reconcileFinalAllocationSummary(payload);
  const recommendations = reconciledPayload.online_migration_suggestions || [];
  const sessions = reconciledPayload.vp_sessions || [];
  const sessionStudents = sessions.flatMap((session) => session.studentIds.map((studentId) => ({
    session_id: session.id,
    student_id: studentId,
  })));
  const rpcParams = {
    p_batch_id: batchId, p_project_id: cloudProjectId, p_recommendations: recommendations,
    p_sessions: sessions, p_session_students: sessionStudents, p_summary: reconciledPayload.summary,
    p_decisions: reconciledPayload.preferences_applied?.onlineMigrationDecisions || {}, p_updated_by: updatedBy || null,
  };
  await ensureValidSupabaseSession();
  let { error } = await (supabase.rpc as any)("bulk_update_batch_vp_state", rpcParams);
  if (error && isAuthenticationError(error)) {
    await ensureValidSupabaseSession(true);
    ({ error } = await (supabase.rpc as any)("bulk_update_batch_vp_state", rpcParams));
  }
  if (error) throw error;
  const refreshed = await fetchBatchAllocationOutput(batchId);
  if (!refreshed) throw new Error("VP state saved, but the authoritative allocation could not be reloaded.");
  return refreshed;
}

export function serializeBatchAllocationOutput(
  batchId: string,
  projectId: string | null | undefined,
  payload: AllocationResultPayload,
): BatchAllocationOutputRecord {
  const cleanProjId =
    projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId.trim())
      ? projectId.trim()
      : null;

  const reconciledPayload = reconcileFinalAllocationSummary(payload);
  const preferences = reconciledPayload.preferences_applied || { overfillRules: [], preferredLabRules: [], extraLabs: [] };
  const record: BatchAllocationOutputRecord = {
    project_id: cleanProjId,
    batch_id: batchId,
    summary: reconciledPayload.summary,
    dashboard_summary: reconciledPayload.dashboard_summary || [],
    area_grade_summary: reconciledPayload.area_grade_summary || [],
    consolidation_analysis: reconciledPayload.consolidation_analysis || [],
    master_allocation: reconciledPayload.physical_master_allocation || reconciledPayload.master_allocation || [],
    lab_pivot: reconciledPayload.lab_pivot || [],
    lab_allocation: reconciledPayload.lab_allocation || [],
    unassigned_students: reconciledPayload.physical_unassigned_students || reconciledPayload.unassigned_students || [],
    shortfall_math: reconciledPayload.shortfall_math || [],
    overfill_details: reconciledPayload.overfill_details || [],
    shortfall_text: reconciledPayload.shortfall_text || "",
    preferences_applied: {
      ...preferences,
      ...(reconciledPayload.online_migration_suggestions || reconciledPayload.vp_sessions ? {
        vpWorkflow: {
          version: 1,
          projectId: cleanProjId || projectId || "",
          batchId,
          recommendations: reconciledPayload.online_migration_suggestions || [],
          sessions: reconciledPayload.vp_sessions || [],
          updatedAt: new Date().toISOString(),
        },
      } : {}),
    },
    logs: reconciledPayload.logs || [],
    generated_files: reconciledPayload.generated_files || {},
    updated_at: new Date().toISOString(),
    run_id: reconciledPayload.run_id || reconciledPayload.job_id || reconciledPayload.jobId,
  };

  return record;
}

export async function deleteBatchAllocationOutput(batchId: string): Promise<void> {
  try {
    const { error } = await supabase.from("batch_allocation_outputs" as any).delete().eq("batch_id", batchId);
    if (error && (error as any).code !== "22P02") {
      console.warn("[Storage] Supabase deleteBatchAllocationOutput cloud notice:", error);
    }
  } catch (cloudErr) {
    console.warn("[Storage] Supabase deleteBatchAllocationOutput network notice:", cloudErr);
  }
  await idbDelete(OUTPUTS_STORE, batchId);
}

function deriveAreaGradeSummary(
  masterAllocation: MasterAllocationRow[] = [],
  unassignedStudents: UnassignedStudentRow[] = [],
  program?: string,
): AreaGradeSummaryRow[] {
  const map = new Map<
    string,
    {
      area: string;
      grade: number;
      uniqueStudents: Set<string>;
      uniqueGroups: Set<string>;
      uniqueLabs: Set<string>;
      unassignedCount: number;
    }
  >();

  const getKey = (area: string, grade: number) => `${area}__G${grade}`;

  // 1. Process assigned students from master_allocation
  masterAllocation.forEach((row) => {
    const area = row["Physical Area"] || "Unknown";
    const grade = Number(row.Grade) || 0;
    const key = getKey(area, grade);

    if (!map.has(key)) {
      map.set(key, {
        area,
        grade,
        uniqueStudents: new Set(),
        uniqueGroups: new Set(),
        uniqueLabs: new Set(),
        unassignedCount: 0,
      });
    }
    const entry = map.get(key)!;
    if (row.S_ID) entry.uniqueStudents.add(row.S_ID);
    if (row.Group_ID) entry.uniqueGroups.add(row.Group_ID);
    else if (row.Slot_Key) entry.uniqueGroups.add(row.Slot_Key);
    const labId = String(row.Lab_ID || (row as any)["Lab ID"] || "");
    if (labId) entry.uniqueLabs.add(labId);
  });

  // 2. Process unassigned students
  unassignedStudents.forEach((row) => {
    const area = row["Physical Area"] || "Unknown";
    const grade = Number(row.Grade) || 0;
    const key = getKey(area, grade);

    if (!map.has(key)) {
      map.set(key, {
        area,
        grade,
        uniqueStudents: new Set(),
        uniqueGroups: new Set(),
        uniqueLabs: new Set(),
        unassignedCount: 0,
      });
    }
    const entry = map.get(key)!;
    entry.unassignedCount += 1;
  });

  return Array.from(map.values()).map((entry) => ({
    "Physical Area": entry.area,
    Grade: entry.grade,
    Academic_Label: formatGradeLevel(entry.grade, program, true),
    Track: getAcademicTrack(entry.grade, program),
    Level: getAcademicLevel(entry.grade, program),
    Students_Assigned: entry.uniqueStudents.size,
    Unique_Groups: entry.uniqueGroups.size,
    Groups_Used: entry.uniqueGroups.size,
    Labs_Used: entry.uniqueLabs.size,
    Unassigned: entry.unassignedCount,
    Total_Students: entry.uniqueStudents.size + entry.unassignedCount,
  }));
}

export function recordToPayload(record: BatchAllocationOutputRecord): AllocationResultPayload {
  const rawSummary = (record.summary && typeof record.summary === "object" ? record.summary : {}) as Record<string, unknown>;
  const totalStudents = Number(rawSummary.total_students) || 0;
  const assignedCount = Number(rawSummary.assigned_count) || 0;
  const unassignedCount = Number(rawSummary.unassigned_count) || 0;
  const totalSessionsAssigned = Number(rawSummary.total_sessions_assigned) || 0;
  const totalSessionsAvailable = Number(rawSummary.total_sessions_available) || 0;
  const totalLabs = Number(rawSummary.total_labs) || 0;
  const overfillCount = Number(rawSummary.overfill_count) || 0;

  const safeSummary: AllocationResultPayload["summary"] = {
    total_students: totalStudents,
    assigned_count: assignedCount,
    unassigned_count: unassignedCount,
    total_sessions_assigned: totalSessionsAssigned,
    total_sessions_available: totalSessionsAvailable,
    total_labs: totalLabs,
    overfill_count: overfillCount,
    areas_count: Number(rawSummary.areas_count || rawSummary.area_count) || 0,
    ...(rawSummary as any),
  };

  let areaGradeSummary = Array.isArray(record.area_grade_summary) && record.area_grade_summary.length > 0
    ? record.area_grade_summary
    : [];

  // Fallback: If area_grade_summary was not saved in older record, reconstruct it from master & unassigned
  const storedProgram = (record.preferences_applied as any)?.program || (record.summary as any)?.program;
  if (areaGradeSummary.length === 0 && Array.isArray(record.master_allocation) && record.master_allocation.length > 0) {
    areaGradeSummary = deriveAreaGradeSummary(record.master_allocation, record.unassigned_students, storedProgram);
  }

  const jId = `saved-${record.batch_id || "batch"}-${Date.parse(record.updated_at || record.created_at || "") || Date.now()}`;
  const vpWorkflow = record.preferences_applied?.vpWorkflow;
  return reconcileFinalAllocationSummary({
    jobId: jId,
    job_id: jId,
    batch_id: record.batch_id,
    project_id: record.project_id || undefined,
    run_id: record.run_id || jId,
    revision: Number(record.revision || 1),
    updated_at: record.updated_at || record.created_at,
    updated_by: record.updated_by || undefined,
    allocation_owner: record.allocation_owner || undefined,
    allocation_owner_email: record.allocation_owner_email || undefined,
    created_by: record.created_by || undefined,
    summary: safeSummary,
    logs: Array.isArray(record.logs) ? record.logs : [],
    shortfall_text: typeof record.shortfall_text === "string" ? record.shortfall_text : "",
    overfill_details: Array.isArray(record.overfill_details) ? record.overfill_details : [],
    preferences_applied: record.preferences_applied && typeof record.preferences_applied === "object"
      ? record.preferences_applied
      : { overfillRules: [], preferredLabRules: [], extraLabs: [] },
    dashboard_summary: Array.isArray(record.dashboard_summary) ? record.dashboard_summary : [],
    area_grade_summary: areaGradeSummary,
    master_allocation: Array.isArray(record.master_allocation) ? record.master_allocation : [],
    physical_master_allocation: Array.isArray(record.master_allocation) ? record.master_allocation : [],
    lab_pivot: Array.isArray(record.lab_pivot) ? record.lab_pivot : [],
    lab_allocation: Array.isArray(record.lab_allocation) ? record.lab_allocation : [],
    unassigned_students: Array.isArray(record.unassigned_students) ? record.unassigned_students : [],
    physical_unassigned_students: Array.isArray(record.unassigned_students) ? record.unassigned_students : [],
    consolidation_analysis: Array.isArray(record.consolidation_analysis) ? record.consolidation_analysis : [],
    shortfall_math: Array.isArray(record.shortfall_math) ? record.shortfall_math : [],
    online_migration_suggestions: Array.isArray(vpWorkflow?.recommendations)
      ? vpWorkflow.recommendations.map((item) => ({ ...item, status: (item.status as string) === "rejected" ? "keep_physical" : item.status }))
      : [],
    vp_sessions: Array.isArray(vpWorkflow?.sessions) ? vpWorkflow.sessions : [],
    generated_files: record.generated_files && typeof record.generated_files === "object" ? record.generated_files : {},
  });
}

// ---------------------------------------------------------------------------
// 4. Batch Resolution Requests (Event Team & CS Team Workflow - Cloud Authoritative)
// ---------------------------------------------------------------------------

export type ResolutionRequestType = "overfill" | "nearby_lab" | "new_lab" | "cs_outreach" | "cs_reallocation";
export type ResolutionRequestStatus = "pending" | "approved" | "rejected" | "in_progress" | "contacted" | "resolved" | "partially_approved";
export type ResolutionTargetTeam = "Event Team" | "CS Team";

export interface ReallocationStudentItem {
  student_id: string;
  original_lab: string;
  new_lab: string;
  new_lab_name?: string;
  old_area: string;
  new_area: string;
  grade?: number;
  reason?: string;
  status: "pending" | "approved" | "declined";
  decided_at?: string;
  decided_by_name?: string;
  decided_by_role?: string;
  decline_reason?: string;
}

export interface ResolutionRequestAction {
  action: ResolutionRequestStatus;
  by_name: string;
  by_role: string;
  timestamp: string;
  comment?: string;
  is_override?: boolean;
}

export interface NearbyLabRequestMetadata {
  lab_uuid: string;
  lab_code?: string;
  lab_name: string;
  source_area: string;
  source_governorate: string;
  destination_area: string;
  destination_governorate: string;
  capacity: number;
  free_capacity: number;
  distance_km?: number | null;
  quality_rating?: number | null;
  price_per_session?: number | null;
  required_sessions: Array<{ date: string; time: string; slot_num?: number }>;
  selected_student_ids?: string[];
  reservation_assignment_id?: string | null;
}

export interface ResolutionRequest {
  id: string;
  batch_id: string;
  project_id?: string | null;
  type: ResolutionRequestType;
  target_team: ResolutionTargetTeam;
  status: ResolutionRequestStatus;
  area: string;
  grades: number[];
  unassigned_count?: number;
  lab_id?: string;
  destination_lab_capacity?: Record<number, number>;
  destination_lab_total_capacity?: number;
  max_overfill_per_lab?: number;
  requested_capacity?: number;
  time_slot_num?: number;
  reason?: string;
  suggested_nearest_lab?: string;
  suggested_nearest_area?: string;
  notes?: string;
  submitted_by_name?: string;
  submitted_by_role?: string;
  reviewed_by_name?: string;
  reviewed_by_role?: string;
  solver_rerun_at?: string | null;
  reviewer_comment?: string | null;
  history?: ResolutionRequestAction[];
  reallocation_students?: ReallocationStudentItem[];
  forwarded_to_cs?: boolean;
  nearby_lab_metadata?: NearbyLabRequestMetadata | null;
  created_at?: string;
  updated_at?: string;
}

function isValidUUID(id?: string | null): boolean {
  return Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (_) {}
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function toSupabaseUUID(str?: string | null): string | null {
  if (!str) return null;
  if (isValidUUID(str)) return str;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(12, "0").slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

function parseReallocationMetadata(rawNotes?: string | null): {
  type?: ResolutionRequestType;
  batch_id?: string;
  project_id?: string | null;
  realloc?: ReallocationStudentItem[];
  forwarded?: boolean;
  destCap?: Record<number, number>;
  destTotalCap?: number;
  userNotes?: string;
} | null {
  if (!rawNotes) return null;
  try {
    if (rawNotes.startsWith("__REALLOC_META__:")) {
      return JSON.parse(rawNotes.slice("__REALLOC_META__:".length));
    }
    if (rawNotes.startsWith('{"realloc":') || rawNotes.startsWith('{"type":')) {
      return JSON.parse(rawNotes);
    }
  } catch {
    // not JSON
  }
  return null;
}

function hydrateResolutionRequest(r: ResolutionRequest, cached?: ResolutionRequest): ResolutionRequest {
  const hydrated: ResolutionRequest = { ...r };

  if (!hydrated.reviewer_comment && cached?.reviewer_comment) {
    hydrated.reviewer_comment = cached.reviewer_comment;
  }
  if ((!hydrated.history || hydrated.history.length === 0) && cached?.history && cached.history.length > 0) {
    hydrated.history = cached.history;
  }
  if (!hydrated.reallocation_students && cached?.reallocation_students) {
    hydrated.reallocation_students = cached.reallocation_students;
  }
  if (hydrated.forwarded_to_cs === undefined && cached?.forwarded_to_cs !== undefined) {
    hydrated.forwarded_to_cs = cached.forwarded_to_cs;
  }
  if (hydrated.destination_lab_capacity === undefined && cached?.destination_lab_capacity !== undefined) {
    hydrated.destination_lab_capacity = cached.destination_lab_capacity;
  }
  if (hydrated.destination_lab_total_capacity === undefined && cached?.destination_lab_total_capacity !== undefined) {
    hydrated.destination_lab_total_capacity = cached.destination_lab_total_capacity;
  }

  // Hydrate from metadata if serialized inside notes
  if (hydrated.notes) {
    const parsed = parseReallocationMetadata(hydrated.notes);
    if (parsed) {
      if (parsed.realloc && (!hydrated.reallocation_students || hydrated.reallocation_students.length === 0)) {
        hydrated.reallocation_students = parsed.realloc;
      }
      if (parsed.forwarded !== undefined && hydrated.forwarded_to_cs === undefined) {
        hydrated.forwarded_to_cs = parsed.forwarded;
      }
      if (parsed.destCap && !hydrated.destination_lab_capacity) {
        hydrated.destination_lab_capacity = parsed.destCap;
      }
      if (parsed.destTotalCap !== undefined && hydrated.destination_lab_total_capacity === undefined) {
        hydrated.destination_lab_total_capacity = parsed.destTotalCap;
      }
      if (parsed.type) {
        hydrated.type = parsed.type;
      }
      if (parsed.batch_id && hydrated.batch_id && hydrated.batch_id.startsWith("00000000-0000-4000-8000-")) {
        hydrated.batch_id = parsed.batch_id;
      }
      if (parsed.project_id !== undefined && !hydrated.project_id) {
        hydrated.project_id = parsed.project_id;
      }
    }
  }

  if (hydrated.reallocation_students && hydrated.reallocation_students.length > 0 && hydrated.type !== "cs_reallocation") {
    hydrated.type = "cs_reallocation";
  }

  if ((!hydrated.history || hydrated.history.length === 0) && (hydrated.status === "approved" || hydrated.status === "rejected" || hydrated.status === "resolved")) {
    hydrated.history = [
      {
        action: hydrated.status,
        by_name: hydrated.reviewed_by_name || "Reviewer",
        by_role: hydrated.reviewed_by_role || "Event Team",
        timestamp: hydrated.updated_at || hydrated.created_at || new Date().toISOString(),
        comment: hydrated.reviewer_comment || undefined,
        is_override: false,
      },
    ];
  }
  if (!hydrated.reviewer_comment && hydrated.history && hydrated.history.length > 0) {
    hydrated.reviewer_comment = hydrated.history[hydrated.history.length - 1].comment || null;
  }

  return hydrated;
}

export async function fetchBatchResolutionRequests(batchId: string): Promise<ResolutionRequest[]> {
  const localList = await idbGetAll<ResolutionRequest>(REQUESTS_STORE);
  const map = new Map<string, ResolutionRequest>();
  const supabaseBatchUUID = toSupabaseUUID(batchId);

  for (const r of localList) {
    if ((r.batch_id === batchId || (supabaseBatchUUID && r.batch_id === supabaseBatchUUID)) && r.id) {
      map.set(r.id, hydrateResolutionRequest(r));
    }
  }

  try {
    const query = supabase.from("batch_resolution_requests" as any).select("*");
    const { data, error } = supabaseBatchUUID && supabaseBatchUUID !== batchId
      ? await query.or(`batch_id.eq.${batchId},batch_id.eq.${supabaseBatchUUID}`).order("created_at", { ascending: false })
      : await query.eq("batch_id", batchId).order("created_at", { ascending: false });

    if (!error && data) {
      for (const r of (data as unknown as ResolutionRequest[])) {
        const cached = map.get(r.id);
        const hydrated = hydrateResolutionRequest(r, cached);
        map.set(hydrated.id, hydrated);
        await idbPut(REQUESTS_STORE, hydrated);
      }
    }
  } catch (err) {
    console.warn("[Storage] fetchBatchResolutionRequests cloud notice:", err);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime()
  );
}

export async function fetchAllResolutionRequests(): Promise<ResolutionRequest[]> {
  const localList = await idbGetAll<ResolutionRequest>(REQUESTS_STORE);
  const map = new Map<string, ResolutionRequest>();

  for (const r of localList) {
    if (r.id) {
      map.set(r.id, hydrateResolutionRequest(r));
    }
  }

  try {
    const { data, error } = await supabase
      .from("batch_resolution_requests" as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      for (const r of (data as unknown as ResolutionRequest[])) {
        const cached = map.get(r.id);
        const hydrated = hydrateResolutionRequest(r, cached);
        map.set(hydrated.id, hydrated);
        await idbPut(REQUESTS_STORE, hydrated);
      }
    }
  } catch (err) {
    console.warn("[Storage] fetchAllResolutionRequests cloud notice:", err);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime()
  );
}

export async function saveBatchResolutionRequest(req: Partial<ResolutionRequest> & { batch_id: string; type: ResolutionRequestType; target_team: ResolutionTargetTeam; area: string; grades: number[] }): Promise<ResolutionRequest> {
  const initialHistory: ResolutionRequestAction[] = req.history || [];
  if (initialHistory.length === 0 && (req.status === "approved" || req.status === "rejected")) {
    initialHistory.push({
      action: req.status,
      by_name: req.reviewed_by_name || req.submitted_by_name || "Reviewer",
      by_role: req.reviewed_by_role || "Lab Manager",
      timestamp: new Date().toISOString(),
      comment: req.reviewer_comment || undefined,
      is_override: false,
    });
  }

  // Ensure reallocation metadata is serialized into notes if present
  let notesValue = req.notes || "";
  if (req.type === "cs_reallocation" || (req.reallocation_students && req.reallocation_students.length > 0)) {
    const metaPayload = JSON.stringify({
      type: req.type || "cs_reallocation",
      batch_id: req.batch_id,
      project_id: req.project_id || null,
      realloc: req.reallocation_students || [],
      forwarded: req.forwarded_to_cs ?? false,
      destCap: req.destination_lab_capacity,
      destTotalCap: req.destination_lab_total_capacity,
      userNotes: req.notes && !req.notes.startsWith("__REALLOC_META__:") ? req.notes : "",
    });
    notesValue = `__REALLOC_META__:${metaPayload}`;
  }

  const generatedId = req.id && isValidUUID(req.id) ? req.id : generateUUID();

  const record: ResolutionRequest = {
    id: generatedId,
    batch_id: req.batch_id,
    project_id: req.project_id || null,
    type: req.type,
    target_team: req.target_team,
    status: req.status || "pending",
    area: req.area,
    grades: req.grades,
    unassigned_count: req.unassigned_count ?? (req.reallocation_students ? req.reallocation_students.length : 0),
    lab_id: req.lab_id,
    destination_lab_capacity: req.destination_lab_capacity,
    destination_lab_total_capacity: req.destination_lab_total_capacity,
    max_overfill_per_lab: req.max_overfill_per_lab ?? 2,
    requested_capacity: req.requested_capacity,
    time_slot_num: req.time_slot_num,
    reason: req.reason,
    suggested_nearest_lab: req.suggested_nearest_lab,
    suggested_nearest_area: req.suggested_nearest_area,
    notes: notesValue || req.notes || undefined,
    submitted_by_name: req.submitted_by_name,
    submitted_by_role: req.submitted_by_role,
    reviewed_by_name: req.reviewed_by_name,
    reviewed_by_role: req.reviewed_by_role,
    solver_rerun_at: req.solver_rerun_at ?? null,
    reviewer_comment: req.reviewer_comment ?? null,
    history: initialHistory,
    reallocation_students: req.reallocation_students,
    forwarded_to_cs: req.forwarded_to_cs,
    nearby_lab_metadata: req.nearby_lab_metadata ?? null,
    created_at: req.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 1. Authoritative write to Supabase
  try {
    const {
      history,
      reviewer_comment,
      reallocation_students,
      forwarded_to_cs,
      destination_lab_capacity,
      destination_lab_total_capacity,
      ...supabaseBase
    } = record;

    const supabaseBatchId = toSupabaseUUID(record.batch_id) || generateUUID();
    const supabaseProjectId = record.project_id && isValidUUID(record.project_id) ? record.project_id : null;

    const supabasePayload = {
      ...supabaseBase,
      batch_id: supabaseBatchId,
      project_id: supabaseProjectId,
      history,
    };

    let { error } = await supabase
      .from("batch_resolution_requests" as any)
      .upsert(supabasePayload as any, { onConflict: "id" });

    // Legacy request types remain compatible with older environments. A nearby-lab
    // request must never be silently reclassified because its approval is transactional.
    if (record.type !== "nearby_lab" && error && ((error as any).code === "23514" || (error as any).message?.includes("batch_resolution_requests_type_check") || (error as any).message?.includes("check constraint"))) {
      const fallbackPayload = { ...supabasePayload, type: "cs_outreach" };
      const res = await supabase
        .from("batch_resolution_requests" as any)
        .upsert(fallbackPayload as any, { onConflict: "id" });
      error = res.error;
    }

    // Fallback: If history or other optional column not in cached schema (PGRST204)
    if (error && (error as any).code === "PGRST204") {
      let baseRecord = {
        ...supabaseBase,
        batch_id: supabaseBatchId,
        project_id: supabaseProjectId,
      };
      let res = await supabase
        .from("batch_resolution_requests" as any)
        .upsert(baseRecord as any, { onConflict: "id" });
      if (record.type !== "nearby_lab" && res.error && ((res.error as any).code === "23514" || (res.error as any).message?.includes("check constraint"))) {
        baseRecord = { ...baseRecord, type: "cs_outreach" as any };
        res = await supabase
          .from("batch_resolution_requests" as any)
          .upsert(baseRecord as any, { onConflict: "id" });
      }
      error = res.error;
    }

    if (error) throw error;
  } catch (cloudErr) {
    console.warn("[Storage] Supabase saveBatchResolutionRequest network notice:", cloudErr);
    if (record.type === "nearby_lab") throw cloudErr;
  }

  // 2. Secondary read cache (with full rich object)
  await idbPut(REQUESTS_STORE, record);

  return record;
}

/**
 * Applies an approved reallocation to the selected batch output only.
 * The canonical project roster is immutable allocation input and is never overwritten here.
 */
export async function applyStudentReallocations(
  batchId: string,
  projectId: string | null | undefined,
  studentItems: ReallocationStudentItem[],
  _reviewer?: { name?: string; role?: string }
): Promise<{ success: boolean; movedCount: number }> {
  if (!batchId || !studentItems || studentItems.length === 0) {
    return { success: false, movedCount: 0 };
  }

  // Update batch_allocation_outputs without mutating project student master data.
  const output = await fetchBatchAllocationOutput(batchId);
  if (output) {
    const unassignedList = [...(output.unassigned_students || [])];
    const masterList = [...(output.master_allocation || [])];

    for (const item of studentItems) {
      // If student was in unassigned list, remove them
      const uIdx = unassignedList.findIndex((u) => u.S_ID === item.student_id);
      if (uIdx >= 0) {
        const uStudent = unassignedList[uIdx];
        unassignedList.splice(uIdx, 1);

        // Add to master_allocation assigned to new lab & new area
        const newRow: MasterAllocationRow = {
          S_ID: item.student_id,
          Grade: Number(item.grade || uStudent.Grade) || 4,
          "Physical Area": item.new_area,
          Lab_ID: item.new_lab,
          Group_ID: `Group_${item.new_lab}_G${item.grade || uStudent.Grade || 4}`,
          Slot_Key: `Assigned_${item.new_lab}`,
          Day: "Assigned",
          Session: "Assigned",
          Time_Slot: "Assigned",
          Slot_Num: 1,
          Lab_Capacity: 25,
        };
        masterList.push(newRow);
      } else {
        // If student was already in master_allocation, update assignment to new lab & new area
        const mIdx = masterList.findIndex((m) => m.S_ID === item.student_id);
        if (mIdx >= 0) {
          masterList[mIdx] = {
            ...masterList[mIdx],
            "Physical Area": item.new_area,
            Lab_ID: item.new_lab,
          };
        }
      }
    }

    output.unassigned_students = unassignedList;
    output.master_allocation = masterList;

    // Recalculate summary totals
    if (output.summary) {
      const accounting = calculateAllocationAccounting(masterList, unassignedList);
      output.summary.unassigned_count = accounting.unassignedCount;
      output.summary.assigned_count = accounting.physicalAssignedCount + accounting.vpAssignedCount;
      output.summary.total_seat_visits = accounting.totalSeatVisits;
      output.summary.total_students = output.summary.assigned_count + output.summary.unassigned_count;
    }

    // Recompute area_grade_summary
    output.area_grade_summary = deriveAreaGradeSummary(output.master_allocation, output.unassigned_students);

    // Update shortfall_math if present
    if (Array.isArray(output.shortfall_math)) {
      studentItems.forEach((item) => {
        const mathRow = output.shortfall_math.find((m) => m.Area === item.old_area && Number(m.Grade) === Number(item.grade));
        if (mathRow && mathRow.Students_Short > 0) {
          mathRow.Students_Short = Math.max(0, mathRow.Students_Short - 1);
          mathRow.Demand = Math.max(0, mathRow.Demand - 1);
        }
      });
    }

    // Update dashboard_summary
    if (Array.isArray(output.dashboard_summary)) {
      output.dashboard_summary = output.dashboard_summary.map((row) => {
        const matchingItemsOld = studentItems.filter((it) => it.old_area === row.Area);
        const matchingItemsNew = studentItems.filter((it) => it.new_area === row.Area);

        const updated = { ...row };
        if (matchingItemsOld.length > 0) {
          updated.Unassigned_Shortfall = Math.max(0, (Number(updated.Unassigned_Shortfall) || 0) - matchingItemsOld.length);
        }
        if (matchingItemsNew.length > 0) {
          updated.Assigned_Students = (Number(updated.Assigned_Students) || 0) + matchingItemsNew.length;
        }
        return updated;
      });
    }

    await saveBatchAllocationOutput(batchId, projectId, output);
  }

  return { success: true, movedCount: studentItems.length };
}

/**
 * Updates an individual student item's decision status (approved/declined) within a CS reallocation request.
 * If approved, immediately applies the student move to the new lab and area.
 */
export async function updateReallocationStudentItemStatus(
  requestId: string,
  batchId: string,
  studentId: string,
  newStatus: "approved" | "declined",
  reviewer: { name: string; role: string },
  declineReason?: string
): Promise<ResolutionRequest> {
  const allReqs = await fetchBatchResolutionRequests(batchId);
  let targetReq = allReqs.find((r) => r.id === requestId);
  if (!targetReq) {
    const cached = await idbGet<ResolutionRequest>(REQUESTS_STORE, requestId);
    targetReq = cached ? hydrateResolutionRequest(cached) : undefined;
  }
  if (!targetReq) {
    const all = await fetchAllResolutionRequests();
    targetReq = all.find((r) => r.id === requestId);
  }
  if (!targetReq) throw new Error(`Request ${requestId} not found`);

  targetReq = hydrateResolutionRequest(targetReq);
  const students = targetReq.reallocation_students ? [...targetReq.reallocation_students] : [];
  const itemIdx = students.findIndex((s) => s.student_id === studentId);
  if (itemIdx < 0) throw new Error(`Student ${studentId} not found in request ${requestId}`);

  const now = new Date().toISOString();
  const updatedItem: ReallocationStudentItem = {
    ...students[itemIdx],
    status: newStatus,
    decided_at: now,
    decided_by_name: reviewer.name,
    decided_by_role: reviewer.role,
    decline_reason: newStatus === "declined" ? declineReason : undefined,
  };
  students[itemIdx] = updatedItem;

  // If approved, apply the move immediately!
  if (newStatus === "approved") {
    await applyStudentReallocations(batchId, targetReq.project_id, [updatedItem], reviewer);
  }

  // Calculate overall request status based on student item statuses
  const pendingCount = students.filter((s) => s.status === "pending").length;
  const approvedCount = students.filter((s) => s.status === "approved").length;
  const declinedCount = students.filter((s) => s.status === "declined").length;

  let overallStatus: ResolutionRequestStatus = targetReq.status;
  if (pendingCount === 0) {
    if (declinedCount === students.length) {
      overallStatus = "rejected";
    } else if (approvedCount === students.length) {
      overallStatus = "approved";
    } else {
      overallStatus = "resolved";
    }
  } else if (approvedCount > 0 || declinedCount > 0) {
    overallStatus = "in_progress";
  }

  const updatedReq: ResolutionRequest = {
    ...targetReq,
    reallocation_students: students,
    status: overallStatus,
    reviewed_by_name: reviewer.name,
    reviewed_by_role: reviewer.role,
    updated_at: now,
    history: [
      ...(targetReq.history || []),
      {
        action: newStatus === "approved" ? "approved" : "rejected",
        by_name: reviewer.name,
        by_role: reviewer.role,
        timestamp: now,
        comment: `${newStatus === "approved" ? "Approved move" : "Declined move"} for Student ${studentId} (${updatedItem.old_area} -> ${updatedItem.new_lab_name || updatedItem.new_lab})${declineReason ? ` - Reason: ${declineReason}` : ""}`,
      },
    ],
  };

  await saveBatchResolutionRequest(updatedReq);
  return updatedReq;
}

/**
 * Forwards a request from Event Team to CS Team
 */
export async function forwardRequestToCSTeam(
  requestId: string,
  batchId: string,
  forwarder: { name: string; role: string },
  comment?: string
): Promise<ResolutionRequest> {
  const allReqs = await fetchBatchResolutionRequests(batchId);
  let targetReq = allReqs.find((r) => r.id === requestId);
  if (!targetReq) {
    const cached = await idbGet<ResolutionRequest>(REQUESTS_STORE, requestId);
    targetReq = cached || undefined;
  }
  if (!targetReq) throw new Error(`Request ${requestId} not found`);

  const now = new Date().toISOString();
  const updatedReq: ResolutionRequest = {
    ...targetReq,
    target_team: "CS Team",
    forwarded_to_cs: true,
    updated_at: now,
    history: [
      ...(targetReq.history || []),
      {
        action: "in_progress",
        by_name: forwarder.name,
        by_role: forwarder.role,
        timestamp: now,
        comment: comment || "Forwarded to CS Team for student outreach and placement approval.",
      },
    ],
  };

  await saveBatchResolutionRequest(updatedReq);
  return updatedReq;
}

export async function markBatchRequestsSolverRerun(batchId: string): Promise<ResolutionRequest[]> {
  const now = new Date().toISOString();
  const existing = await fetchBatchResolutionRequests(batchId);
  const eligible = existing.filter((t) => (t.type === "overfill" || t.type === "nearby_lab" || t.type === "new_lab") && t.status === "approved");

  if (eligible.length > 0) {
    const ids = eligible.map((t) => t.id);
    try {
      const { error } = await supabase
        .from("batch_resolution_requests" as any)
        .update({ solver_rerun_at: now, updated_at: now })
        .in("id", ids);

      if (error) {
        console.warn("[Storage] Supabase markBatchRequestsSolverRerun cloud notice:", error);
      }
    } catch (cloudErr) {
      console.warn("[Storage] Supabase markBatchRequestsSolverRerun network notice:", cloudErr);
    }

    for (const t of eligible) {
      t.solver_rerun_at = now;
      t.updated_at = now;
      void idbPut(REQUESTS_STORE, t);
    }
  }

  return fetchBatchResolutionRequests(batchId);
}

export async function updateBatchResolutionRequestStatus(
  id: string,
  batchId: string,
  status: ResolutionRequestStatus,
  reviewer?: { name?: string; role?: string },
  comment?: string | null
): Promise<ResolutionRequest> {
  const now = new Date().toISOString();

  // 1. Retrieve existing record to construct audit history & detect overrides
  let existing: ResolutionRequest | null = null;
  try {
    const { data: dbData } = await supabase
      .from("batch_resolution_requests" as any)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (dbData) {
      existing = dbData as unknown as ResolutionRequest;
    }
  } catch (cloudErr) {
    console.warn("[Storage] Supabase fetch on status update network notice:", cloudErr);
  }

  if (!existing) {
    existing = await idbGet<ResolutionRequest>(REQUESTS_STORE, id);
  }

  if (existing?.type === "nearby_lab" && (status === "approved" || status === "rejected")) {
    const { data, error } = await supabase.rpc("decide_nearby_lab_request" as any, {
      p_request_id: id,
      p_status: status,
      p_reviewer_name: reviewer?.name || "Reviewer",
      p_reviewer_role: reviewer?.role || "Event Team",
      p_comment: comment?.trim() || null,
    } as any);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Nearby lab decision did not return the updated request.");
    const updated = hydrateResolutionRequest(row as ResolutionRequest, existing);
    await idbPut(REQUESTS_STORE, updated);
    return updated;
  }

  const prevStatus = existing?.status || "pending";
  const isOverride = prevStatus !== "pending" && prevStatus !== status;

  // 2. Create the new action log entry
  const actionEntry: ResolutionRequestAction = {
    action: status,
    by_name: reviewer?.name || "Reviewer",
    by_role: reviewer?.role || "Reviewer",
    timestamp: now,
    comment: comment && comment.trim() ? comment.trim() : undefined,
    is_override: isOverride,
  };

  const cached = await idbGet<ResolutionRequest>(REQUESTS_STORE, id);

  let existingHistory: ResolutionRequestAction[] = [];
  if (Array.isArray(existing?.history) && existing!.history.length > 0) {
    existingHistory = existing!.history;
  } else if (Array.isArray(cached?.history) && cached!.history.length > 0) {
    existingHistory = cached!.history;
  } else if (existing && (existing.status === "approved" || existing.status === "rejected" || existing.status === "resolved" || existing.status === "contacted")) {
    existingHistory = [
      {
        action: existing.status,
        by_name: existing.reviewed_by_name || "Previous Reviewer",
        by_role: existing.reviewed_by_role || "Reviewer",
        timestamp: existing.updated_at || existing.created_at || now,
        comment: existing.reviewer_comment || undefined,
        is_override: false,
      },
    ];
  }

  const updatedHistory = [...existingHistory, actionEntry];

  const updatePayload: Record<string, any> = {
    status,
    updated_at: now,
    history: updatedHistory,
    reviewer_comment: comment && comment.trim() ? comment.trim() : (existing?.reviewer_comment || null),
  };

  if (reviewer?.name) updatePayload.reviewed_by_name = reviewer.name;
  if (reviewer?.role) updatePayload.reviewed_by_role = reviewer.role;

  // 3. Persist update to Supabase
  try {
    let { error } = await supabase
      .from("batch_resolution_requests" as any)
      .update(updatePayload)
      .eq("id", id);

    // If column history/reviewer_comment not yet in remote schema cache (PGRST204), fallback to base columns
    if (error && (error as any).code === "PGRST204") {
      const { history, reviewer_comment, ...fallbackPayload } = updatePayload;
      const res = await supabase
        .from("batch_resolution_requests" as any)
        .update(fallbackPayload)
        .eq("id", id);
      error = res.error;
    }

    if (error) {
      console.warn("[Storage] Supabase updateBatchResolutionRequestStatus cloud notice:", error);
    }
  } catch (cloudErr) {
    console.warn("[Storage] Supabase updateBatchResolutionRequestStatus network notice:", cloudErr);
  }

  // 4. Update secondary local cache
  const updatedRecord: ResolutionRequest = {
    ...(existing || {
      id,
      batch_id: batchId,
      type: "overfill",
      target_team: "Event Team",
      status,
      area: "",
      grades: [],
    }),
    ...updatePayload,
  };

  await idbPut(REQUESTS_STORE, updatedRecord);
  return updatedRecord;
}

export async function deleteBatchResolutionRequest(id: string, batchId: string): Promise<void> {
  try {
    const { error } = await supabase.from("batch_resolution_requests" as any).delete().eq("id", id);
    if (error && (error as any).code !== "22P02") {
      console.warn("[Storage] Supabase deleteBatchResolutionRequest cloud notice:", error);
    }
  } catch (cloudErr) {
    console.warn("[Storage] Supabase deleteBatchResolutionRequest network notice:", cloudErr);
  }
  await idbDelete(REQUESTS_STORE, id);
}
