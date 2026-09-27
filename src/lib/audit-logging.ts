import { supabase } from "@/integrations/supabase/client";
import {
  updateStudentDetailsInBatch,
  updateStudentStatusInBatch,
  addStudentToBatchRecord,
  removeStudentFromBatchRecord,
  getProjectUnassignedBatchId,
  type StudentStatus,
  type StudentRecord,
} from "@/lib/batch-allocation-storage";

export type AuditActionType =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STATUS_CHANGE"
  | "ALLOCATION_RUN"
  | "RESTORE"
  | "APPROVE"
  | "REJECT"
  | "RESOLVE"
  | "OUTREACH";

export type AuditEntityType =
  | "student"
  | "resolution_request"
  | "batch"
  | "project"
  | "lab"
  | "incident"
  | "survey"
  | "allocation_run"
  | "vendor"
  | "user_role"
  | "navigation_permission";

export interface AuditLogEntry {
  id: string;
  created_at: string;
  user_id?: string | null;
  user_name: string;
  user_email?: string | null;
  user_role: string;
  tab: string; // e.g. "Projects", "Lab Allocation", "Operation Requests", "Lab Data", "Quality", "Catering"
  section: string; // e.g. "Edit Student Modal", "Batch Student Roster", "Operation Requests Table"
  action_type: AuditActionType;
  action_title: string;
  entity_type: AuditEntityType;
  entity_id: string;
  project_id?: string | null;
  batch_id?: string | null;
  old_value: any;
  new_value: any;
  metadata?: Record<string, any>;
  is_restorable: boolean;
}

export interface LogAuditActionParams {
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  tab: string;
  section: string;
  actionType: AuditActionType;
  actionTitle: string;
  entityType: AuditEntityType;
  entityId: string;
  projectId?: string | null;
  batchId?: string | null;
  oldValue: any;
  newValue: any;
  metadata?: Record<string, any>;
  isRestorable?: boolean;
}

// ---------------------------------------------------------------------------
// UUID Helpers (Guarantees valid RFC4122 UUID v4 for PostgreSQL UUID types)
// ---------------------------------------------------------------------------
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback to manual RFC4122
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sanitizeUuid(val?: string | null): string | null {
  if (!val) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  return isUuid ? val : null;
}

// ---------------------------------------------------------------------------
// IndexedDB Local Store (Offline & Refresh Resilience)
// ---------------------------------------------------------------------------
const AUDIT_DB_NAME = "ischool_audit_logs_db_v1";
const AUDIT_STORE = "audit_logs";
const memoryAuditLogs = new Map<string, AuditLogEntry>();

function openAuditDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB is not available"));
    }
    const request = indexedDB.open(AUDIT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIT_STORE)) {
        db.createObjectStore(AUDIT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPutAuditLog(entry: AuditLogEntry): Promise<void> {
  if (entry.id) {
    memoryAuditLogs.set(entry.id, entry);
  }
  try {
    const db = await openAuditDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(AUDIT_STORE, "readwrite");
      const store = tx.objectStore(AUDIT_STORE);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {
    // memory store active
  }
}

async function idbGetAllAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    const db = await openAuditDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(AUDIT_STORE, "readonly");
      const store = tx.objectStore(AUDIT_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const results = (req.result as AuditLogEntry[]) || [];
        for (const r of results) {
          memoryAuditLogs.set(r.id, r);
        }
        resolve(results);
      };
      req.onerror = () => resolve(Array.from(memoryAuditLogs.values()));
    });
  } catch {
    return Array.from(memoryAuditLogs.values());
  }
}

/**
 * Log an audit trail entry with dual-tier database & local persistence
 */
export async function logAuditAction(params: LogAuditActionParams): Promise<AuditLogEntry | null> {
  const entry: AuditLogEntry = {
    id: generateUuid(),
    created_at: new Date().toISOString(),
    user_id: sanitizeUuid(params.userId),
    user_name: params.userName || "Admin User",
    user_email: params.userEmail || null,
    user_role: params.userRole || "Administrator",
    tab: params.tab,
    section: params.section,
    action_type: params.actionType,
    action_title: params.actionTitle,
    entity_type: params.entityType,
    entity_id: params.entityId,
    project_id: params.projectId || null,
    batch_id: params.batchId || null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    metadata: params.metadata || {},
    is_restorable: params.isRestorable !== undefined ? params.isRestorable : true,
  };

  // 1. Immediate local persistence (guarantees instantaneous data availability across refreshes)
  await idbPutAuditLog(entry);

  // 2. Primary cloud database persistence
  try {
    const { data, error } = await supabase.from("audit_logs" as any).insert({
      id: entry.id,
      created_at: entry.created_at,
      user_id: entry.user_id,
      user_name: entry.user_name,
      user_email: entry.user_email,
      user_role: entry.user_role,
      tab: entry.tab,
      section: entry.section,
      action_type: entry.action_type,
      action_title: entry.action_title,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      project_id: entry.project_id,
      batch_id: entry.batch_id,
      old_value: entry.old_value,
      new_value: entry.new_value,
      metadata: entry.metadata,
      is_restorable: entry.is_restorable,
    }).select().maybeSingle();

    if (error) {
      console.warn("Notice: Cloud audit_logs write pending server migration. Log saved to local persistence store:", error.message);
    } else if (data) {
      await idbPutAuditLog(data as unknown as AuditLogEntry);
    }
  } catch (err: any) {
    console.warn("Audit log DB insert error (stored in local persistence):", err.message);
  }

  return entry;
}

export interface FetchAuditLogsFilters {
  tab?: string;
  actionType?: string;
  entityType?: string;
  search?: string;
  userRole?: string;
  dateRange?: "today" | "7days" | "30days" | "all";
}

/**
 * Fetch audit logs from database with fallback to local persistent store
 */
export async function fetchAuditLogs(
  filters?: FetchAuditLogsFilters,
  limit = 200,
  offset = 0,
): Promise<{ logs: AuditLogEntry[]; total: number }> {
  let dbLogs: AuditLogEntry[] = [];
  let dbTotal = 0;
  let dbSuccess = false;

  try {
    let query = supabase
      .from("audit_logs" as any)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (filters?.tab && filters.tab !== "ALL") {
      query = query.eq("tab", filters.tab);
    }
    if (filters?.actionType && filters.actionType !== "ALL") {
      query = query.eq("action_type", filters.actionType);
    }
    if (filters?.entityType && filters.entityType !== "ALL") {
      query = query.eq("entity_type", filters.entityType);
    }
    if (filters?.dateRange && filters.dateRange !== "all") {
      const now = new Date();
      if (filters.dateRange === "today") {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        query = query.gte("created_at", startOfDay);
      } else if (filters.dateRange === "7days") {
        const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte("created_at", d);
      } else if (filters.dateRange === "30days") {
        const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte("created_at", d);
      }
    }

    if (filters?.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      query = query.or(`action_title.ilike.${term},user_name.ilike.${term},entity_id.ilike.${term},section.ilike.${term}`);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (!error && Array.isArray(data)) {
      dbLogs = data as unknown as AuditLogEntry[];
      dbTotal = count || data.length;
      dbSuccess = true;
      // Rehydrate local storage cache
      for (const item of dbLogs) {
        void idbPutAuditLog(item);
      }
    }
  } catch {
    dbSuccess = false;
  }

  // Fallback to local persistent IndexedDB if DB is not yet available or offline
  if (!dbSuccess || (dbLogs.length === 0 && offset === 0)) {
    const local = await idbGetAllAuditLogs();
    if (local.length > 0) {
      let filtered = [...local];

      if (filters?.tab && filters.tab !== "ALL") {
        filtered = filtered.filter((l) => l.tab === filters.tab);
      }
      if (filters?.actionType && filters.actionType !== "ALL") {
        filtered = filtered.filter((l) => l.action_type === filters.actionType);
      }
      if (filters?.entityType && filters.entityType !== "ALL") {
        filtered = filtered.filter((l) => l.entity_type === filters.entityType);
      }
      if (filters?.dateRange && filters.dateRange !== "all") {
        const now = new Date().getTime();
        if (filters.dateRange === "today") {
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          filtered = filtered.filter((l) => new Date(l.created_at).getTime() >= startOfDay.getTime());
        } else if (filters.dateRange === "7days") {
          const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
          filtered = filtered.filter((l) => new Date(l.created_at).getTime() >= sevenDaysAgo);
        } else if (filters.dateRange === "30days") {
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
          filtered = filtered.filter((l) => new Date(l.created_at).getTime() >= thirtyDaysAgo);
        }
      }
      if (filters?.search && filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        filtered = filtered.filter(
          (l) =>
            (l.action_title || "").toLowerCase().includes(q) ||
            (l.user_name || "").toLowerCase().includes(q) ||
            (l.entity_id || "").toLowerCase().includes(q) ||
            (l.section || "").toLowerCase().includes(q),
        );
      }

      filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (filtered.length > 0 || !dbSuccess) {
        dbLogs = filtered.slice(offset, offset + limit);
        dbTotal = filtered.length;
      }
    }
  }

  return { logs: dbLogs, total: dbTotal };
}

export interface RestoreResult {
  success: boolean;
  message: string;
  restoreLog?: AuditLogEntry;
}

/**
 * Execute a Restore operation on a log entry
 */
export async function restoreAuditEntry(
  log: AuditLogEntry,
  currentUser: { id?: string | null; name: string; email?: string | null; role: string },
): Promise<RestoreResult> {
  if (!log.is_restorable) {
    return {
      success: false,
      message: "This action type does not support automatic restoration.",
    };
  }

  if (log.old_value === null || log.old_value === undefined) {
    return {
      success: false,
      message: "Cannot restore: No previous old value recorded in this log entry.",
    };
  }

  try {
    // ------------------------------------------------------------------------
    // 1. Student Restore
    // ------------------------------------------------------------------------
    if (log.entity_type === "student") {
      const studentId = log.entity_id;
      const targetBatchId = log.project_id
        ? getProjectUnassignedBatchId(log.project_id)
        : log.batch_id || log.old_value?.batch_id || log.new_value?.batch_id;

      if (!targetBatchId) {
        return {
          success: false,
          message: "Student restore failed: Missing batch identifier.",
        };
      }

      // Historical move logs restore details into the canonical project roster.
      if (log.old_value?.batch_id && log.new_value?.batch_id && log.old_value.batch_id !== log.new_value.batch_id) {
        const studentObj: StudentRecord = {
          S_ID: studentId,
          Grade: log.old_value.Grade || 4,
          "Physical Area": log.old_value["Physical Area"] || "Area",
          Status: (log.old_value.Status || "Enrolled") as StudentStatus,
        };
        await addStudentToBatchRecord(targetBatchId, log.project_id || "", studentObj);
      } else if (log.action_type === "DELETE" && log.old_value) {
        // Was deleted -> re-add student
        const studentObj: StudentRecord = {
          S_ID: studentId,
          Grade: log.old_value.Grade || 4,
          "Physical Area": log.old_value["Physical Area"] || "Area",
          Status: (log.old_value.Status || "Enrolled") as StudentStatus,
          ...log.old_value,
        };
        await addStudentToBatchRecord(targetBatchId, log.project_id || "", studentObj);
      } else if (log.action_type === "CREATE") {
        // Was created -> remove student
        await removeStudentFromBatchRecord(targetBatchId, studentId);
      } else {
        // Standard field update or status change
        const updates: Partial<StudentRecord> = {};
        if (log.old_value.Status || log.old_value.status) {
          updates.Status = (log.old_value.Status || log.old_value.status) as StudentStatus;
          updates.status = updates.Status;
        }
        if (log.old_value.Grade !== undefined) {
          updates.Grade = log.old_value.Grade;
        }
        if (log.old_value["Physical Area"] !== undefined) {
          updates["Physical Area"] = log.old_value["Physical Area"];
        }

        await updateStudentDetailsInBatch(targetBatchId, studentId, updates);
      }

      // Create new audit log for the Restore action
      const restoreLog = await logAuditAction({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        tab: log.tab,
        section: log.section,
        actionType: "RESTORE",
        actionTitle: `Restored student ${studentId} back to previous state (${JSON.stringify(log.old_value)})`,
        entityType: "student",
        entityId: studentId,
        projectId: log.project_id,
        batchId: targetBatchId,
        oldValue: log.new_value,
        newValue: log.old_value,
        metadata: {
          restored_from_log_id: log.id,
          original_timestamp: log.created_at,
        },
        isRestorable: true,
      });

      return {
        success: true,
        message: `Student ${studentId} successfully reverted to previous state.`,
        restoreLog: restoreLog || undefined,
      };
    }

    // ------------------------------------------------------------------------
    // 2. Operation Request Restore
    // ------------------------------------------------------------------------
    if (log.entity_type === "resolution_request") {
      const requestId = log.entity_id;
      const oldStatus = log.old_value?.status || "pending";
      const oldComment = log.old_value?.reviewer_comment || null;
      const oldOverrides = log.old_value?.overrides || null;

      const { error } = await supabase
        .from("batch_resolution_requests" as any)
        .update({
          status: oldStatus,
          reviewer_comment: oldComment,
          overrides: oldOverrides,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) {
        throw new Error(`Failed to restore operation request in DB: ${error.message}`);
      }

      const restoreLog = await logAuditAction({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        tab: "Operation Requests",
        section: log.section,
        actionType: "RESTORE",
        actionTitle: `Restored operation request ${requestId} to status "${oldStatus}"`,
        entityType: "resolution_request",
        entityId: requestId,
        projectId: log.project_id,
        batchId: log.batch_id,
        oldValue: log.new_value,
        newValue: log.old_value,
        metadata: {
          restored_from_log_id: log.id,
        },
        isRestorable: true,
      });

      return {
        success: true,
        message: `Operation request ${requestId} reverted to status "${oldStatus}".`,
        restoreLog: restoreLog || undefined,
      };
    }

    // ------------------------------------------------------------------------
    // 3. Lab Data Restore
    // ------------------------------------------------------------------------
    if (log.entity_type === "lab") {
      const labId = log.entity_id;
      if (log.action_type === "DELETE") {
        await supabase.from("labs" as any).insert(log.old_value);
      } else if (log.action_type === "CREATE") {
        await supabase.from("labs" as any).delete().eq("id", labId);
      } else {
        await supabase.from("labs" as any).update(log.old_value).eq("id", labId);
      }

      const restoreLog = await logAuditAction({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        tab: "Lab Data",
        section: log.section,
        actionType: "RESTORE",
        actionTitle: `Restored lab ${labId} to previous configuration`,
        entityType: "lab",
        entityId: labId,
        oldValue: log.new_value,
        newValue: log.old_value,
        metadata: { restored_from_log_id: log.id },
        isRestorable: true,
      });

      return {
        success: true,
        message: `Lab ${labId} reverted to previous configuration.`,
        restoreLog: restoreLog || undefined,
      };
    }

    // ------------------------------------------------------------------------
    // 4. Project / Batch Restore
    // ------------------------------------------------------------------------
    if (log.entity_type === "project") {
      return await restoreSoftDeletedProject({
        logId: log.id,
        projectId: log.entity_id,
        actor: currentUser,
      });
    }

    if (log.entity_type === "batch") {
      const bId = log.entity_id;
      await supabase.from("batches" as any).update(log.old_value).eq("id", bId);

      const restoreLog = await logAuditAction({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        tab: "Projects",
        section: log.section,
        actionType: "RESTORE",
        actionTitle: `Restored batch ${bId} details`,
        entityType: "batch",
        entityId: bId,
        projectId: log.project_id,
        oldValue: log.new_value,
        newValue: log.old_value,
        metadata: { restored_from_log_id: log.id },
        isRestorable: true,
      });

      return {
        success: true,
        message: `Batch ${bId} restored.`,
        restoreLog: restoreLog || undefined,
      };
    }

    // ------------------------------------------------------------------------
    // 5. User Role Assignment Restore
    // ------------------------------------------------------------------------
    if (log.entity_type === "user_role") {
      const parts = (log.entity_id || "").split(":");
      const targetUserId = parts[0];
      const targetRole = (parts[1] || log.metadata?.role || log.old_value?.role || log.new_value?.role) as string;

      if (!targetUserId || !targetRole) {
        return {
          success: false,
          message: "Cannot restore user role: missing user ID or role identifier.",
        };
      }

      // If the action was CREATE (role was granted), restore means revoking the role
      const validUuid = sanitizeUuid(targetUserId);
      if (validUuid) {
        if (log.action_type === "CREATE") {
          const { error } = await supabase
            .from("user_roles" as any)
            .delete()
            .eq("user_id", validUuid)
            .eq("role", targetRole);
          if (error) throw new Error(`Failed to revoke restored role: ${error.message}`);
        } else if (log.action_type === "DELETE") {
          // If the action was DELETE (role was revoked), restore means re-granting the role
          const { error } = await supabase
            .from("user_roles" as any)
            .insert({ user_id: validUuid, role: targetRole });
          if (error) throw new Error(`Failed to re-grant restored role: ${error.message}`);
        }
      }

      const targetUserName = log.metadata?.user_name || log.metadata?.user_email || targetUserId;
      const restoreLog = await logAuditAction({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        tab: "Admin Control Panel",
        section: "User Accounts & Roles Management",
        actionType: "RESTORE",
        actionTitle: `Reverted role "${targetRole}" for user ${targetUserName}`,
        entityType: "user_role",
        entityId: log.entity_id,
        oldValue: log.new_value,
        newValue: log.old_value,
        metadata: { restored_from_log_id: log.id, user_id: targetUserId, role: targetRole },
        isRestorable: true,
      });

      return {
        success: true,
        message: `Role assignment for user ${targetUserName} successfully reverted.`,
        restoreLog: restoreLog || undefined,
      };
    }

    // ------------------------------------------------------------------------
    // 6. Role-Based Navigation Permission Restore
    // ------------------------------------------------------------------------
    if (log.entity_type === "navigation_permission") {
      const role = (log.metadata?.role || log.old_value?.role) as string;
      const tabKey = (log.metadata?.tab_key || log.old_value?.tab_key) as string;
      const targetEnabled = Boolean(log.old_value?.is_enabled);

      if (!role || !tabKey) {
        return {
          success: false,
          message: "Cannot restore navigation permission: missing role or tab key.",
        };
      }

      await supabase
        .from("role_navigation_permissions" as any)
        .upsert(
          {
            role,
            tab_key: tabKey,
            is_enabled: targetEnabled,
            updated_at: new Date().toISOString(),
            updated_by: `${currentUser.name} (${currentUser.role}) [Restore]`,
          },
          { onConflict: "role,tab_key" },
        );

      const restoreLog = await logAuditAction({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        tab: "Admin Control Panel",
        section: "Role-Based Tab Access Control Matrix",
        actionType: "RESTORE",
        actionTitle: `Reverted "${tabKey}" permission for ${role} back to ${targetEnabled ? "ENABLED" : "DISABLED"}`,
        entityType: "navigation_permission",
        entityId: `${role}:${tabKey}`,
        oldValue: log.new_value,
        newValue: log.old_value,
        metadata: { restored_from_log_id: log.id, role, tab_key: tabKey },
        isRestorable: true,
      });

      return {
        success: true,
        message: `Permission for "${tabKey}" (${role}) reverted to ${targetEnabled ? "ENABLED" : "DISABLED"}.`,
        restoreLog: restoreLog || undefined,
      };
    }

    return {
      success: false,
      message: `Automatic restore for entity type "${log.entity_type}" is not supported.`,
    };
  } catch (err: any) {
    console.error("Restore failed:", err);
    return {
      success: false,
      message: `Restore failed: ${err.message || "Unknown error"}`,
    };
  }
}

/**
 * Subscribe to realtime updates on audit logs
 */
export function subscribeToAuditLogs(onUpdate: () => void): () => void {
  const channelId = `audit_logs_realtime_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
  let channel: any = null;

  try {
    channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "audit_logs",
        },
        () => {
          onUpdate();
        },
      )
      .subscribe();
  } catch (err) {
    console.warn("Failed to subscribe to audit logs channel:", err);
  }

  return () => {
    if (channel) {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    }
  };
}

// ============================================================================
// PROJECT SOFT DELETE, RESTORE & PERMANENT DELETE INFRASTRUCTURE
// ============================================================================

export interface SoftDeletedProjectItem {
  id: string;
  name: string;
  code?: string | null;
  program?: string | null;
  deleted_at: string;
  deleted_by: string;
  deleted_by_id?: string | null;
  batches_count: number;
  students_count: number;
  log_id?: string | null;
  is_purged: boolean;
  snapshot?: any;
}

/**
 * Checks if a project is soft-deleted / archived
 */
export function isProjectSoftDeleted(project: any): boolean {
  if (!project) return false;
  const notes = String(project.notes || "");
  if (
    notes.includes("__DELETED__") ||
    notes.includes("__DELETED_META__:") ||
    notes.includes("__DELETED_AT__:")
  ) {
    return true;
  }
  return false;
}

/**
 * Cleans soft-deletion metadata markers from project notes string
 */
export function cleanProjectNotes(notes?: string | null): string {
  if (!notes) return "";
  return notes.replace(/__DELETED_META__:[\s\S]*?__END_DELETED_META__/, "").trim();
}

/**
 * Soft deletes a project:
 * 1. Takes a complete recursive snapshot of the project and all child records
 * 2. Marks the project as soft-deleted in the database
 * 3. Creates an audit log entry with full restoration capabilities
 */
export async function softDeleteProject(params: {
  projectId: string;
  actor: { id?: string | null; name: string; email?: string | null; role: string };
}): Promise<{ success: boolean; entry?: AuditLogEntry; error?: string }> {
  try {
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", params.projectId)
      .maybeSingle();

    if (pErr || !project) {
      throw new Error(pErr?.message || `Project with id ${params.projectId} not found.`);
    }

    // 1. Fetch all associated child records across the database
    const { data: batches } = await supabase.from("batches").select("*").eq("project_id", params.projectId);
    const batchList = batches || [];
    const batchIds = batchList.map((b) => b.id);

    let needs: any[] = [];
    let assignments: any[] = [];
    let sessions: any[] = [];
    let studentUploads: any[] = [];
    let allocationOutputs: any[] = [];
    let groupClassifications: any[] = [];
    let projectSessions: any[] = [];
    let operationRequests: any[] = [];

    if (batchIds.length > 0) {
      const [needsRes, asgRes, uploadsRes, outputsRes, groupRes, opReqRes] = await Promise.all([
        supabase.from("batch_needs").select("*").in("batch_id", batchIds),
        supabase.from("assignments").select("*").in("batch_id", batchIds),
        supabase.from("batch_student_uploads").select("*").or(`project_id.eq.${params.projectId},batch_id.in.(${batchIds.join(",")})`),
        supabase.from("batch_allocation_outputs").select("*").or(`project_id.eq.${params.projectId},batch_id.in.(${batchIds.join(",")})`),
        supabase.from("batch_group_classifications").select("*").in("batch_id", batchIds),
        (supabase as any).from("batch_resolution_requests").select("*").or(`project_id.eq.${params.projectId},batch_id.in.(${batchIds.join(",")})`),
      ]);

      needs = needsRes.data || [];
      assignments = asgRes.data || [];
      studentUploads = uploadsRes.data || [];
      allocationOutputs = outputsRes.data || [];
      groupClassifications = groupRes.data || [];
      operationRequests = opReqRes.data || [];

      const asgIds = assignments.map((a) => a.id);
      if (asgIds.length > 0) {
        const { data: sessData } = await supabase.from("assignment_sessions").select("*").in("assignment_id", asgIds);
        sessions = sessData || [];
      }
    } else {
      const [uploadsRes, outputsRes, opReqRes] = await Promise.all([
        supabase.from("batch_student_uploads").select("*").eq("project_id", params.projectId),
        supabase.from("batch_allocation_outputs").select("*").eq("project_id", params.projectId),
        (supabase as any).from("batch_resolution_requests").select("*").eq("project_id", params.projectId),
      ]);
      studentUploads = uploadsRes.data || [];
      allocationOutputs = outputsRes.data || [];
      operationRequests = opReqRes.data || [];
    }

    const { data: projSess } = await supabase.from("project_sessions").select("*").eq("project_id", params.projectId);
    projectSessions = projSess || [];

    const totalStudents = studentUploads.reduce(
      (sum, u) => sum + (u.student_count || (u.students as any[])?.length || 0),
      0,
    );

    const snapshot = {
      project,
      batches: batchList,
      batch_needs: needs,
      assignments,
      assignment_sessions: sessions,
      batch_student_uploads: studentUploads,
      batch_allocation_outputs: allocationOutputs,
      batch_group_classifications: groupClassifications,
      project_sessions: projectSessions,
      operation_requests: operationRequests,
    };

    const deletedAt = new Date().toISOString();
    const deletedMeta = {
      is_deleted: true,
      deleted_at: deletedAt,
      deleted_by_id: params.actor.id || null,
      deleted_by_name: params.actor.name,
      deleted_by_role: params.actor.role,
      original_status: project.status || "draft",
      batches_count: batchList.length,
      students_count: totalStudents,
    };

    const cleanNotes = (project.notes || "").replace(/__DELETED_META__:[\s\S]*?__END_DELETED_META__/, "").trim();
    const updatedNotes = `__DELETED_META__:${JSON.stringify(deletedMeta)}__END_DELETED_META__\n${cleanNotes}`.trim();

    // 2. Mark project as soft-deleted in projects table
    const { error: updateErr } = await supabase
      .from("projects")
      .update({
        notes: updatedNotes,
        status: "cancelled",
        updated_at: deletedAt,
      })
      .eq("id", params.projectId);

    if (updateErr) {
      throw new Error(`Failed to update project status: ${updateErr.message}`);
    }

    // 3. Create persistent audit log entry with complete snapshot
    const entry = await logAuditAction({
      userId: params.actor.id,
      userName: params.actor.name,
      userEmail: params.actor.email,
      userRole: params.actor.role,
      tab: "Projects",
      section: "Projects & Program Intakes",
      actionType: "DELETE",
      actionTitle: `Soft-deleted project "${project.name}" (${project.code || project.id}) and archived ${batchList.length} batches and ${totalStudents} students`,
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
      oldValue: snapshot,
      newValue: {
        is_deleted: true,
        deleted_at: deletedAt,
        deleted_by: params.actor.name,
        original_status: project.status,
      },
      metadata: {
        project_id: project.id,
        project_name: project.name,
        project_code: project.code,
        program: project.program,
        batches_count: batchList.length,
        students_count: totalStudents,
        is_soft_deleted: true,
        deleted_at: deletedAt,
        deleted_by_name: params.actor.name,
      },
      isRestorable: true,
    });

    return { success: true, entry: entry || undefined };
  } catch (err: any) {
    console.error("Soft delete project error:", err);
    return { success: false, error: err.message || "Failed to soft delete project" };
  }
}

/**
 * Restores a soft-deleted project and all its cascaded data
 */
export async function restoreSoftDeletedProject(params: {
  projectId?: string;
  logId?: string;
  actor: { id?: string | null; name: string; email?: string | null; role: string };
}): Promise<{ success: boolean; message: string; restoreLog?: AuditLogEntry }> {
  try {
    // 1. Locate audit log with the snapshot
    let targetLog: AuditLogEntry | null = null;
    if (params.logId) {
      const { data: dbLog } = await supabase.from("audit_logs" as any).select("*").eq("id", params.logId).maybeSingle();
      if (dbLog) targetLog = dbLog as unknown as AuditLogEntry;
      else {
        const idbLogs = await idbGetAllAuditLogs();
        targetLog = idbLogs.find((l) => l.id === params.logId) || null;
      }
    } else if (params.projectId) {
      const { data: dbLogs } = await supabase
        .from("audit_logs" as any)
        .select("*")
        .eq("entity_id", params.projectId)
        .eq("action_type", "DELETE")
        .order("created_at", { ascending: false })
        .limit(1);
      if (dbLogs && dbLogs[0]) targetLog = dbLogs[0] as unknown as AuditLogEntry;
      else {
        const idbLogs = await idbGetAllAuditLogs();
        targetLog = idbLogs.find((l) => l.entity_id === params.projectId && l.action_type === "DELETE") || null;
      }
    }

    const snapshot = targetLog?.old_value;
    const projData = snapshot?.project || null;
    const projId = params.projectId || targetLog?.entity_id || projData?.id;

    if (!projId) {
      throw new Error("Unable to identify project to restore.");
    }

    // 2. Fetch current DB record of project
    const { data: existingProject } = await supabase.from("projects").select("*").eq("id", projId).maybeSingle();

    const originalStatus = projData?.status || "draft";
    const cleanNotes = ((existingProject?.notes || projData?.notes || "") as string)
      .replace(/__DELETED_META__:[\s\S]*?__END_DELETED_META__/, "")
      .trim();

    if (existingProject) {
      // Re-activate existing project
      const { error: projUpdateErr } = await supabase
        .from("projects")
        .update({
          notes: cleanNotes || null,
          status: originalStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", projId);
      if (projUpdateErr) throw new Error(`Failed to restore project record: ${projUpdateErr.message}`);
    } else if (projData) {
      // If project was somehow removed, re-insert
      const { error: projInsertErr } = await supabase.from("projects").insert({
        ...projData,
        notes: cleanNotes || null,
        status: originalStatus,
        updated_at: new Date().toISOString(),
      });
      if (projInsertErr) throw new Error(`Failed to recreate project record: ${projInsertErr.message}`);
    }

    // 3. Restore all child batches and records if snapshot contains them
    if (snapshot) {
      if (Array.isArray(snapshot.batches) && snapshot.batches.length > 0) {
        for (const b of snapshot.batches) {
          await supabase.from("batches").upsert(b, { onConflict: "id" });
        }
      }
      if (Array.isArray(snapshot.batch_needs) && snapshot.batch_needs.length > 0) {
        for (const n of snapshot.batch_needs) {
          await supabase.from("batch_needs").upsert(n, { onConflict: "id" });
        }
      }
      if (Array.isArray(snapshot.assignments) && snapshot.assignments.length > 0) {
        for (const a of snapshot.assignments) {
          await supabase.from("assignments").upsert(a, { onConflict: "id" });
        }
      }
      if (Array.isArray(snapshot.assignment_sessions) && snapshot.assignment_sessions.length > 0) {
        for (const s of snapshot.assignment_sessions) {
          await supabase.from("assignment_sessions").upsert(s, { onConflict: "id" });
        }
      }
      if (Array.isArray(snapshot.batch_student_uploads) && snapshot.batch_student_uploads.length > 0) {
        for (const u of snapshot.batch_student_uploads) {
          await supabase.from("batch_student_uploads").upsert(u, { onConflict: "id" });
        }
      }
      if (Array.isArray(snapshot.batch_allocation_outputs) && snapshot.batch_allocation_outputs.length > 0) {
        for (const o of snapshot.batch_allocation_outputs) {
          await supabase.from("batch_allocation_outputs").upsert(o, { onConflict: "id" });
        }
      }
      if (Array.isArray(snapshot.batch_group_classifications) && snapshot.batch_group_classifications.length > 0) {
        for (const g of snapshot.batch_group_classifications) {
          await supabase.from("batch_group_classifications").upsert(g, { onConflict: "id" });
        }
      }
      if (Array.isArray(snapshot.project_sessions) && snapshot.project_sessions.length > 0) {
        for (const ps of snapshot.project_sessions) {
          await supabase.from("project_sessions").upsert(ps, { onConflict: "id" });
        }
      }
      if (Array.isArray(snapshot.operation_requests) && snapshot.operation_requests.length > 0) {
        for (const r of snapshot.operation_requests) {
          await (supabase as any).from("batch_resolution_requests").upsert(r, { onConflict: "id" });
        }
      }
    }

    const projectName = projData?.name || existingProject?.name || projId;
    const projectCode = projData?.code || existingProject?.code || "";

    // 4. Log the RESTORE action in audit logs
    const restoreLog = await logAuditAction({
      userId: params.actor.id,
      userName: params.actor.name,
      userEmail: params.actor.email,
      userRole: params.actor.role,
      tab: "Projects",
      section: "Admin Deleted Projects",
      actionType: "RESTORE",
      actionTitle: `Restored project "${projectName}" (${projectCode}) and all associated batches, student rosters, and lab allocations`,
      entityType: "project",
      entityId: projId,
      projectId: projId,
      oldValue: { is_deleted: true },
      newValue: { is_deleted: false, restored_at: new Date().toISOString() },
      metadata: {
        restored_from_log_id: targetLog?.id || null,
        project_name: projectName,
        project_code: projectCode,
        batches_restored: snapshot?.batches?.length || 0,
      },
      isRestorable: true,
    });

    return {
      success: true,
      message: `Project "${projectName}" and all associated data have been fully restored!`,
      restoreLog: restoreLog || undefined,
    };
  } catch (err: any) {
    console.error("Restore project error:", err);
    return {
      success: false,
      message: `Failed to restore project: ${err.message || "Unknown error"}`,
    };
  }
}

/**
 * Permanently hard-deletes a project and all its cascaded records from the database
 */
export async function permanentlyDeleteProject(params: {
  projectId: string;
  logId?: string;
  actor: { id?: string | null; name: string; email?: string | null; role: string };
}): Promise<{ success: boolean; message: string; purgeLog?: AuditLogEntry }> {
  try {
    const { data: project } = await supabase.from("projects").select("*").eq("id", params.projectId).maybeSingle();
    const projectName = project?.name || `Project ${params.projectId}`;
    const projectCode = project?.code || "";

    // 1. Log permanent purge in audit logs BEFORE deleting data so the audit trail survives
    const purgeLog = await logAuditAction({
      userId: params.actor.id,
      userName: params.actor.name,
      userEmail: params.actor.email,
      userRole: params.actor.role,
      tab: "Admin Control Panel",
      section: "Deleted Projects Management",
      actionType: "DELETE",
      actionTitle: `PERMANENTLY purged project "${projectName}" (${projectCode}) and all associated database records`,
      entityType: "project",
      entityId: params.projectId,
      projectId: params.projectId,
      oldValue: null,
      newValue: { permanently_deleted: true, purged_at: new Date().toISOString(), purged_by: params.actor.name },
      metadata: {
        project_name: projectName,
        project_code: projectCode,
        permanently_purged: true,
        original_log_id: params.logId || null,
        purged_at: new Date().toISOString(),
      },
      isRestorable: false,
    });

    // 2. Cascade hard delete all database tables
    const { data: batches } = await supabase.from("batches").select("id").eq("project_id", params.projectId);
    const batchIds = (batches || []).map((b) => b.id);

    if (batchIds.length > 0) {
      const { data: assignments } = await supabase.from("assignments").select("id").in("batch_id", batchIds);
      const asgIds = (assignments || []).map((a) => a.id);

      if (asgIds.length > 0) {
        await supabase.from("assignment_sessions").delete().in("assignment_id", asgIds);
      }
      await supabase.from("assignments").delete().in("batch_id", batchIds);
      await supabase.from("batch_needs").delete().in("batch_id", batchIds);
      await supabase.from("batch_group_classifications").delete().in("batch_id", batchIds);
      await supabase.from("batch_student_uploads").delete().in("batch_id", batchIds);
      await supabase.from("batch_allocation_outputs").delete().in("batch_id", batchIds);
      await (supabase as any).from("batch_resolution_requests").delete().in("batch_id", batchIds);
    }

    await supabase.from("batch_student_uploads").delete().eq("project_id", params.projectId);
    await supabase.from("batch_allocation_outputs").delete().eq("project_id", params.projectId);
    await supabase.from("project_sessions").delete().eq("project_id", params.projectId);
    await (supabase as any).from("batch_resolution_requests").delete().eq("project_id", params.projectId);
    await supabase.from("batches").delete().eq("project_id", params.projectId);
    await supabase.from("projects").delete().eq("id", params.projectId);

    // 3. Mark original log as permanently purged in DB & IDB
    if (params.logId) {
      try {
        await supabase
          .from("audit_logs" as any)
          .update({
            is_restorable: false,
            metadata: { permanently_purged: true, purged_at: new Date().toISOString() },
          })
          .eq("id", params.logId);
      } catch (_) {}
    }

    return {
      success: true,
      message: `Project "${projectName}" and all child records permanently deleted from the database.`,
      purgeLog: purgeLog || undefined,
    };
  } catch (err: any) {
    console.error("Permanent delete error:", err);
    return {
      success: false,
      message: `Failed to permanently delete project: ${err.message || "Unknown error"}`,
    };
  }
}

/**
 * Fetches all soft-deleted projects for the Admin Deleted Projects view
 */
export async function fetchSoftDeletedProjects(): Promise<SoftDeletedProjectItem[]> {
  const itemsMap = new Map<string, SoftDeletedProjectItem>();

  try {
    // 1. Check projects table with soft delete marker
    const { data: projects } = await supabase.from("projects").select("*");
    for (const p of projects || []) {
      if (isProjectSoftDeleted(p)) {
        let meta: any = {};
        try {
          const match = (p.notes || "").match(/__DELETED_META__:([\s\S]*?)__END_DELETED_META__/);
          if (match && match[1]) meta = JSON.parse(match[1]);
        } catch (_) {}

        itemsMap.set(p.id, {
          id: p.id,
          name: p.name,
          code: p.code,
          program: p.program,
          deleted_at: meta.deleted_at || p.updated_at || p.created_at,
          deleted_by: meta.deleted_by_name || "Administrator",
          deleted_by_id: meta.deleted_by_id || null,
          batches_count: meta.batches_count || 0,
          students_count: meta.students_count || 0,
          is_purged: false,
          snapshot: null,
        });
      }
    }

    // 2. Cross-reference with audit logs for entity_type = 'project' and action_type = 'DELETE'
    const { data: auditLogs } = await supabase
      .from("audit_logs" as any)
      .select("*")
      .eq("entity_type", "project")
      .eq("action_type", "DELETE")
      .order("created_at", { ascending: false });

    const logsList: any[] =
      (auditLogs as any[]) ||
      (await idbGetAllAuditLogs()).filter((l) => l.entity_type === "project" && l.action_type === "DELETE");

    for (const log of logsList) {
      const projId = log.entity_id;
      const isPurged = log.metadata?.permanently_purged === true || log.action_title?.includes("PERMANENTLY");
      const existing = itemsMap.get(projId);

      if (existing) {
        existing.log_id = log.id;
        existing.snapshot = log.old_value;
        if (log.metadata?.students_count && !existing.students_count) {
          existing.students_count = log.metadata.students_count;
        }
        if (log.metadata?.batches_count && !existing.batches_count) {
          existing.batches_count = log.metadata.batches_count;
        }
        if (isPurged) existing.is_purged = true;
      } else if (!isPurged && log.old_value?.project) {
        const snapProj = log.old_value.project;
        itemsMap.set(projId, {
          id: projId,
          name: snapProj.name || log.metadata?.project_name || `Project ${projId}`,
          code: snapProj.code || log.metadata?.project_code || null,
          program: snapProj.program || log.metadata?.program || null,
          deleted_at: log.created_at,
          deleted_by: log.user_name || "Administrator",
          deleted_by_id: log.user_id || null,
          batches_count: log.metadata?.batches_count || log.old_value?.batches?.length || 0,
          students_count: log.metadata?.students_count || 0,
          log_id: log.id,
          is_purged: false,
          snapshot: log.old_value,
        });
      }
    }
  } catch (err) {
    console.warn("Error fetching soft-deleted projects:", err);
  }

  return Array.from(itemsMap.values()).sort(
    (a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime(),
  );
}
