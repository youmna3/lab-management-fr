/**
 * Storage and Persistence Layer for Batch Group ID Classifications (Single-Visit vs Multi-Visit)
 * and Multi-Session Weekly Distribution Batch Settings.
 *
 * Primary Authority: Supabase Shared Database (`batch_group_classifications` and `batches.group_distribution_mode`)
 * Client Cache & Offline Resilience: IndexedDB / Memory
 */

import { supabase } from "@/integrations/supabase/client";
import type { MegaGroupDefinition } from "@/lib/allocation-client";

export type GroupVisitType = "single_visit" | "multi_visit";
export type BatchGroupType = "single_session" | "multi_session";

export interface GroupClassificationRecord {
  id?: string;
  batch_id: string;
  project_id?: string | null;
  group_id: string;
  visit_type: GroupVisitType;
  repeat_count: number; // 1 for single_visit, >=2 for multi_visit
  area?: string;
  grade?: number | string;
  student_count?: number;
  lab_id?: string;
  notes?: string;
  updated_at?: string;
  updated_by_name?: string;
}

export interface BatchGroupClassificationSettings {
  batch_id: string;
  project_id?: string | null;
  batch_group_type: BatchGroupType;
  default_repeat_count: number;
  classifications: GroupClassificationRecord[];
  blocked_days?: string[];
  mega_groups?: MegaGroupDefinition[];
  updated_at?: string;
}

const DB_NAME = "ischool_batch_allocation_v2";
const STORE_NAME = "batch_group_classifications";
const BATCH_SETTINGS_STORE = "batch_group_settings";

const memoryStore = new Map<string, GroupClassificationRecord[]>();
const batchSettingsMemoryStore = new Map<string, BatchGroupClassificationSettings>();

function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB is not available in this environment"));
    }
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "batch_id" });
      }
      if (!db.objectStoreNames.contains(BATCH_SETTINGS_STORE)) {
        db.createObjectStore(BATCH_SETTINGS_STORE, { keyPath: "batch_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedClassifications(batchId: string): Promise<GroupClassificationRecord[]> {
  try {
    const db = await openLocalDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(batchId);
      req.onsuccess = () => resolve(req.result?.records || memoryStore.get(batchId) || []);
      req.onerror = () => resolve(memoryStore.get(batchId) || []);
    });
  } catch {
    return memoryStore.get(batchId) || [];
  }
}

async function setCachedClassifications(batchId: string, records: GroupClassificationRecord[]): Promise<void> {
  memoryStore.set(batchId, records);
  try {
    const db = await openLocalDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ batch_id: batchId, records, updated_at: new Date().toISOString() });
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // Memory store fallback
  }
}

async function getCachedBatchSettings(batchId: string): Promise<BatchGroupClassificationSettings | null> {
  try {
    const db = await openLocalDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(BATCH_SETTINGS_STORE, "readonly");
      const store = tx.objectStore(BATCH_SETTINGS_STORE);
      const req = store.get(batchId);
      req.onsuccess = () => resolve(req.result?.settings || batchSettingsMemoryStore.get(batchId) || null);
      req.onerror = () => resolve(batchSettingsMemoryStore.get(batchId) || null);
    });
  } catch {
    return batchSettingsMemoryStore.get(batchId) || null;
  }
}

async function setCachedBatchSettings(batchId: string, settings: BatchGroupClassificationSettings): Promise<void> {
  batchSettingsMemoryStore.set(batchId, settings);
  try {
    const db = await openLocalDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(BATCH_SETTINGS_STORE, "readwrite");
      const store = tx.objectStore(BATCH_SETTINGS_STORE);
      const req = store.put({ batch_id: batchId, settings, updated_at: new Date().toISOString() });
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // Memory fallback
  }
}

/**
 * Fetch complete batch group settings (Batch-level default + all per-group classifications).
 */
export async function fetchBatchGroupSettings(
  batchId: string
): Promise<BatchGroupClassificationSettings> {
  const defaultSettings: BatchGroupClassificationSettings = {
    batch_id: batchId,
    batch_group_type: "single_session",
    default_repeat_count: 1,
    classifications: [],
    blocked_days: [],
    mega_groups: [],
  };

  if (!batchId || batchId === "ALL") return defaultSettings;

  try {
    let batchGroupType: BatchGroupType = "single_session";
    let defaultRepeatCount = 1;
    let blockedDays: string[] = [];
    let megaGroups: MegaGroupDefinition[] = [];

    // 1. Check cached batch settings first
    const cached = await getCachedBatchSettings(batchId);
    if (cached) {
      batchGroupType = cached.batch_group_type || "single_session";
      defaultRepeatCount = cached.default_repeat_count || 1;
      blockedDays = cached.blocked_days || [];
      megaGroups = cached.mega_groups || [];
    }

    // 2. Check batch_group_classifications in Supabase for both metadata records and student group records
    try {
      const { data: bgcRows, error: bgcErr } = await supabase
        .from("batch_group_classifications" as any)
        .select("*")
        .eq("batch_id", batchId);

      if (!bgcErr && Array.isArray(bgcRows) && bgcRows.length > 0) {
        for (const row of (bgcRows as any[])) {
          if (row.group_id === "__BATCH_MEGA_GROUPS__" && row.notes) {
            try {
              const parsed = JSON.parse(row.notes);
              if (Array.isArray(parsed) && parsed.length > 0) megaGroups = parsed;
            } catch {}
          } else if (row.group_id === "__BATCH_BLOCKED_DAYS__" && row.notes) {
            try {
              const parsed = JSON.parse(row.notes);
              if (Array.isArray(parsed) && parsed.length > 0) blockedDays = parsed;
            } catch {}
          } else if (row.group_id === "__BATCH_DISTRIBUTION_MODE__") {
            if (row.visit_type === "multi_visit") {
              batchGroupType = "multi_session";
              defaultRepeatCount = Math.max(2, Number(row.repeat_count) || 2);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Classification Storage] bgc fetch notice:", e);
    }

    // 3. Also check batches table fields in Supabase
    let batchData: any = null;
    let batchErr: any = null;

    const resWithCols = await supabase
      .from("batches")
      .select("id, project_id, group_distribution_mode, expected_sessions_per_group, blocked_days, mega_groups")
      .eq("id", batchId)
      .maybeSingle();

    if (resWithCols.error && (resWithCols.error.code === "42703" || (resWithCols.error as any).code === "PGRST204")) {
      const resBase = await supabase
        .from("batches")
        .select("id, project_id, expected_sessions_per_group")
        .eq("id", batchId)
        .maybeSingle();
      batchData = resBase.data;
      batchErr = resBase.error;
    } else {
      batchData = resWithCols.data;
      batchErr = resWithCols.error;
    }

    if (!batchErr && batchData) {
      if ((batchData as any).group_distribution_mode === "multi_session") {
        batchGroupType = "multi_session";
      } else if ((batchData as any).group_distribution_mode === "single_session") {
        batchGroupType = "single_session";
      }
      const expectedSessions = (batchData as any).expected_sessions_per_group;
      if (batchGroupType === "multi_session" && expectedSessions && Number(expectedSessions) > 1) {
        batchGroupType = "multi_session";
        defaultRepeatCount = Math.max(2, Number(expectedSessions) || 2);
      }
      if (Array.isArray((batchData as any).blocked_days) && (batchData as any).blocked_days.length > 0) {
        blockedDays = (batchData as any).blocked_days;
      }
      if (Array.isArray((batchData as any).mega_groups) && (batchData as any).mega_groups.length > 0) {
        megaGroups = (batchData as any).mega_groups;
      }
    }

    // 4. Fetch per-group classifications (excluding system metadata rows)
    const classifications = await fetchBatchGroupClassifications(batchId);

    // Legacy per-group values are retained in storage but cannot override the batch.
    const canonicalClassifications = classifications.map((classification) => ({
      ...classification,
      visit_type: batchGroupType === "multi_session" ? "multi_visit" as const : "single_visit" as const,
      repeat_count: batchGroupType === "multi_session" ? defaultRepeatCount : 1,
    }));

    const settings: BatchGroupClassificationSettings = {
      batch_id: batchId,
      project_id: (batchData as any)?.project_id || cached?.project_id || null,
      batch_group_type: batchGroupType,
      default_repeat_count: defaultRepeatCount,
      classifications: canonicalClassifications,
      blocked_days: blockedDays,
      mega_groups: megaGroups,
      updated_at: new Date().toISOString(),
    };

    void setCachedBatchSettings(batchId, settings);
    return settings;
  } catch (err) {
    console.warn("[Classification Storage] fetchBatchGroupSettings fallback to cache:", err);
    const cached = await getCachedBatchSettings(batchId);
    if (cached) return cached;
    const classifications = await getCachedClassifications(batchId);
    return {
      ...defaultSettings,
      classifications,
    };
  }
}

/**
 * Persist batch group settings (Batch-level default + all per-group classifications + blocked days + mega groups).
 */
export async function saveBatchGroupSettings(
  batchId: string,
  projectId: string | null | undefined,
  settings: {
    batch_group_type?: BatchGroupType;
    default_repeat_count?: number;
    classifications?: GroupClassificationRecord[];
    blocked_days?: string[];
    mega_groups?: MegaGroupDefinition[];
  }
): Promise<BatchGroupClassificationSettings> {
  const now = new Date().toISOString();
  const existingSettings = await getCachedBatchSettings(batchId);
  const resolvedType = settings.batch_group_type || existingSettings?.batch_group_type || "single_session";
  const requestedRepeat = Number(settings.default_repeat_count ?? existingSettings?.default_repeat_count);
  if (resolvedType === "multi_session" && (!Number.isFinite(requestedRepeat) || requestedRepeat < 2)) {
    throw new Error("Multi-Session batches require Sessions / Group from Batch Settings.");
  }
  const safeRepeat = resolvedType === "multi_session" ? Math.trunc(requestedRepeat) : 1;

  // 1. Persist batch-level expected_sessions_per_group, blocked_days, and mega_groups to batches table
  try {
    const updatePayload: Record<string, unknown> = {
      group_distribution_mode: resolvedType,
      expected_sessions_per_group: safeRepeat,
      updated_at: now,
    };
    if (settings.blocked_days !== undefined) {
      updatePayload.blocked_days = settings.blocked_days;
    }
    if (settings.mega_groups !== undefined) {
      updatePayload.mega_groups = settings.mega_groups as any;
    }

    let { error: updateErr } = await supabase
      .from("batches")
      .update(updatePayload as any)
      .eq("id", batchId);

    if (updateErr && (updateErr.code === "42703" || (updateErr as any).code === "PGRST204")) {
      const { blocked_days, mega_groups, group_distribution_mode, ...basePayload } = updatePayload;
      const fallbackRes = await supabase
        .from("batches")
        .update(basePayload as any)
        .eq("id", batchId);
      updateErr = fallbackRes.error;
    }

    if (updateErr) {
      console.warn("[Classification Storage] Could not update batch-level fields in batches table:", updateErr.message);
    }
  } catch (e) {
    console.warn("[Classification Storage] Could not update batch-level mode in batches table:", e);
  }

  // 2. Persist metadata rows to batch_group_classifications (ensures 100% remote persistence in real DB even if batches columns are pending migration)
  try {
    const metaRowsToUpsert: any[] = [];
    if (settings.mega_groups !== undefined) {
      metaRowsToUpsert.push({
        batch_id: batchId,
        project_id: projectId || null,
        group_id: "__BATCH_MEGA_GROUPS__",
        visit_type: "single_visit",
        repeat_count: 1,
        notes: JSON.stringify(settings.mega_groups),
        updated_at: now,
        updated_by_name: "System Settings",
      });
    }
    if (settings.blocked_days !== undefined) {
      metaRowsToUpsert.push({
        batch_id: batchId,
        project_id: projectId || null,
        group_id: "__BATCH_BLOCKED_DAYS__",
        visit_type: "single_visit",
        repeat_count: 1,
        notes: JSON.stringify(settings.blocked_days),
        updated_at: now,
        updated_by_name: "System Settings",
      });
    }
    if (settings.batch_group_type !== undefined) {
      metaRowsToUpsert.push({
        batch_id: batchId,
        project_id: projectId || null,
        group_id: "__BATCH_DISTRIBUTION_MODE__",
        visit_type: resolvedType,
        repeat_count: safeRepeat,
        notes: JSON.stringify({ batch_group_type: resolvedType, default_repeat_count: safeRepeat }),
        updated_at: now,
        updated_by_name: "System Settings",
      });
    }

    if (metaRowsToUpsert.length > 0) {
      await supabase
        .from("batch_group_classifications" as any)
        .upsert(metaRowsToUpsert as any, { onConflict: "batch_id,group_id" });
    }
  } catch (metaErr) {
    console.warn("[Classification Storage] Error saving batch metadata to batch_group_classifications:", metaErr);
  }

  // 3. Persist per-group classifications if provided
  let savedClassifications = existingSettings?.classifications || [];
  if (settings.classifications !== undefined) {
    savedClassifications = await saveBatchGroupClassifications(
      batchId,
      projectId,
      settings.classifications,
      safeRepeat,
    );
  }

  const fullSettings: BatchGroupClassificationSettings = {
    batch_id: batchId,
    project_id: projectId || null,
    batch_group_type: resolvedType,
    default_repeat_count: safeRepeat,
    classifications: savedClassifications,
    blocked_days: settings.blocked_days !== undefined ? settings.blocked_days : (existingSettings?.blocked_days || []),
    mega_groups: settings.mega_groups !== undefined ? settings.mega_groups : (existingSettings?.mega_groups || []),
    updated_at: now,
  };

  void setCachedBatchSettings(batchId, fullSettings);
  return fullSettings;
}

/**
 * Fetch all group classifications for a given batch.
 * Supabase is the primary authoritative source of truth;
 * client cache is updated and only used if offline.
 */
export async function fetchBatchGroupClassifications(
  batchId: string
): Promise<GroupClassificationRecord[]> {
  if (!batchId || batchId === "ALL") return [];

  try {
    const { data, error } = await supabase
      .from("batch_group_classifications" as any)
      .select("*")
      .eq("batch_id", batchId)
      .order("group_id", { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      // Filter out system metadata rows prefixed with "__BATCH_"
      const studentRows = data.filter((d: any) => !String(d.group_id || "").startsWith("__BATCH_"));
      const records: GroupClassificationRecord[] = studentRows.map((d: any) => ({
        id: d.id,
        batch_id: d.batch_id,
        project_id: d.project_id,
        group_id: d.group_id,
        visit_type: d.visit_type === "multi_visit" ? "multi_visit" : "single_visit",
        repeat_count: Math.max(1, Number(d.repeat_count) || (d.visit_type === "multi_visit" ? 2 : 1)),
        area: d.area || undefined,
        grade: d.grade || undefined,
        student_count: d.student_count !== undefined ? Number(d.student_count) : undefined,
        lab_id: d.lab_id || undefined,
        notes: d.notes || undefined,
        updated_at: d.updated_at,
        updated_by_name: d.updated_by_name || undefined,
      }));

      void setCachedClassifications(batchId, records);
      return records;
    }

    return await getCachedClassifications(batchId);
  } catch (err) {
    console.warn("[Classification Storage] Fetch catch fallback:", err);
    return await getCachedClassifications(batchId);
  }
}

/**
 * Persist group classifications for a batch to Supabase authoritative database.
 */
export async function saveBatchGroupClassifications(
  batchId: string,
  projectId: string | null | undefined,
  classifications: GroupClassificationRecord[],
  inheritedRepeatCount?: number,
): Promise<GroupClassificationRecord[]> {
  if (!batchId || batchId === "ALL") return classifications;

  const now = new Date().toISOString();
  const hasInheritedRepeat = Number.isFinite(inheritedRepeatCount) && Number(inheritedRepeatCount) >= 1;
  const rowsToSave = classifications.map((c) => ({
    batch_id: batchId,
    project_id: projectId || c.project_id || null,
    group_id: c.group_id.trim(),
    visit_type: hasInheritedRepeat
      ? Number(inheritedRepeatCount) > 1 ? "multi_visit" : "single_visit"
      : c.visit_type === "multi_visit" ? "multi_visit" : "single_visit",
    repeat_count: hasInheritedRepeat
      ? Math.trunc(Number(inheritedRepeatCount))
      : c.visit_type === "multi_visit" ? Math.max(2, Number(c.repeat_count) || 2) : 1,
    area: c.area || null,
    grade: c.grade !== undefined && c.grade !== null ? String(c.grade) : null,
    student_count: Number(c.student_count) || 0,
    lab_id: c.lab_id || null,
    notes: c.notes?.trim() || null,
    updated_at: now,
    updated_by_name: c.updated_by_name || "Operations User",
  }));

  try {
    const { data, error } = await supabase
      .from("batch_group_classifications" as any)
      .upsert(rowsToSave as any, { onConflict: "batch_id,group_id" })
      .select("*");

    if (!error && Array.isArray(data)) {
      const saved: GroupClassificationRecord[] = data.map((d: any) => ({
        id: d.id,
        batch_id: d.batch_id,
        project_id: d.project_id,
        group_id: d.group_id,
        visit_type: d.visit_type === "multi_visit" ? "multi_visit" : "single_visit",
        repeat_count: Math.max(1, Number(d.repeat_count) || 1),
        area: d.area || undefined,
        grade: d.grade || undefined,
        student_count: Number(d.student_count) || 0,
        lab_id: d.lab_id || undefined,
        notes: d.notes || undefined,
        updated_at: d.updated_at,
        updated_by_name: d.updated_by_name || undefined,
      }));
      void setCachedClassifications(batchId, saved);
      return saved;
    }

    console.warn("[Classification Storage] Supabase upsert notice, updating cache:", error);
    void setCachedClassifications(batchId, rowsToSave as any);
    return rowsToSave as any;
  } catch (err) {
    console.warn("[Classification Storage] Save catch fallback:", err);
    void setCachedClassifications(batchId, rowsToSave as any);
    return rowsToSave as any;
  }
}

/**
 * Auto-detect / Pre-fill Group ID classifications from available schedule & master allocation signals.
 */
export function autoDetectBatchGroupClassifications(
  batchId: string,
  params: {
    batchGroupType?: BatchGroupType;
    expectedSessionsPerGroup?: number | null;
    masterAllocation?: Array<{
      Group_ID?: string;
      group_id?: string;
      "Physical Area"?: string;
      area?: string;
      Grade?: number | string;
      grade?: number | string;
      Lab_ID?: string;
      lab_id?: string;
      S_ID?: string;
      student_id?: string;
    }>;
    studentRecords?: Array<{
      "Group ID"?: string;
      group_id?: string;
      groupId?: string;
      "Physical Area"?: string;
      Grade?: number | string;
      S_ID?: string;
    }>;
    scheduleSessions?: Array<{
      session_group_id?: string | null;
      session_date?: string;
      session_time?: string;
    }>;
  }
): GroupClassificationRecord[] {
  const groupMap = new Map<
    string,
    {
      area?: string;
      grade?: number | string;
      lab_id?: string;
      studentIds: Set<string>;
      sessionOccurrences: number;
    }
  >();

  const isBatchMulti = params.batchGroupType === "multi_session" || (Number(params.expectedSessionsPerGroup) > 1);
  const defaultRepeat = isBatchMulti ? Math.max(2, Number(params.expectedSessionsPerGroup) || 2) : 1;

  // 1. Ingest master allocation rows
  if (Array.isArray(params.masterAllocation)) {
    params.masterAllocation.forEach((r) => {
      const gid = (r.Group_ID || r.group_id || "").trim();
      if (!gid) return;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, {
          area: r["Physical Area"] || r.area,
          grade: r.Grade ?? r.grade,
          lab_id: r.Lab_ID || r.lab_id,
          studentIds: new Set(),
          sessionOccurrences: 0,
        });
      }
      const entry = groupMap.get(gid)!;
      const sid = r.S_ID || r.student_id;
      if (sid) entry.studentIds.add(sid);
      if (!entry.area && (r["Physical Area"] || r.area)) entry.area = r["Physical Area"] || r.area;
      if (entry.grade === undefined && (r.Grade ?? r.grade) !== undefined) entry.grade = r.Grade ?? r.grade;
      if (!entry.lab_id && (r.Lab_ID || r.lab_id)) entry.lab_id = r.Lab_ID || r.lab_id;
    });
  }

  // 2. Ingest student records with pre-assigned Group IDs
  if (Array.isArray(params.studentRecords)) {
    params.studentRecords.forEach((s) => {
      const gid = (s["Group ID"] || s.group_id || s.groupId || "").trim();
      if (!gid) return;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, {
          area: s["Physical Area"],
          grade: s.Grade,
          studentIds: new Set(),
          sessionOccurrences: 0,
        });
      }
      const entry = groupMap.get(gid)!;
      if (s.S_ID) entry.studentIds.add(s.S_ID);
      if (!entry.area && s["Physical Area"]) entry.area = s["Physical Area"];
      if (entry.grade === undefined && s.Grade !== undefined) entry.grade = s.Grade;
    });
  }

  // 3. Count occurrences in schedule sessions
  if (Array.isArray(params.scheduleSessions)) {
    params.scheduleSessions.forEach((s) => {
      const gid = (s.session_group_id || "").trim();
      if (!gid) return;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, {
          studentIds: new Set(),
          sessionOccurrences: 0,
        });
      }
      groupMap.get(gid)!.sessionOccurrences += 1;
    });
  }

  const results: GroupClassificationRecord[] = [];
  groupMap.forEach((meta, gid) => {
    const visit_type: GroupVisitType = isBatchMulti ? "multi_visit" : "single_visit";
    const repeat_count = isBatchMulti ? defaultRepeat : 1;

    results.push({
      batch_id: batchId,
      group_id: gid,
      visit_type,
      repeat_count,
      area: meta.area,
      grade: meta.grade,
      student_count: meta.studentIds.size > 0 ? meta.studentIds.size : undefined,
      lab_id: meta.lab_id,
    });
  });

  return results.sort((a, b) => a.group_id.localeCompare(b.group_id, undefined, { numeric: true }));
}
