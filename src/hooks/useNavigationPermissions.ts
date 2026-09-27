import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type AppRole, ROLE_LABELS } from "@/hooks/useAuth";
import { type BrandIconName } from "@/components/BrandIcon";
import { logAuditAction } from "@/lib/audit-logging";

export interface NavTabDefinition {
  key: string;
  label: string;
  description: string;
  icon: BrandIconName;
  adminOnly?: boolean;
}

export const ALL_NAV_TABS: NavTabDefinition[] = [
  { key: "/dashboard", label: "Dashboard", description: "Executive KPI metrics, program status, and real-time operations summary", icon: "home" },
  { key: "/lab-data", label: "Lab Data", description: "Physical lab registry, capacities, governorates, pricing, and quality specifications", icon: "module" },
  { key: "/lab-allocation", label: "Lab Allocation", description: "Nationwide integer linear programming solver and session allocation engine", icon: "process_on" },
  { key: "/operation-requests", label: "Operation Requests", description: "Capacity shortfall resolution, overfill authorization, and CS student outreach", icon: "flags" },
  { key: "/quality", label: "Quality", description: "Field quality auditing, lab inspection surveys, and incident response tracking", icon: "quiz" },
  { key: "/projects", label: "Projects", description: "Project workspace, batch lifecycle rosters, student records, and status management", icon: "project" },
  { key: "/exports", label: "Exports", description: "Ministry-compliant master workbooks, attendance rosters, and migration exports", icon: "upload" },
  { key: "/timeline", label: "Timeline", description: "Operational calendar, milestone tracking, and batch execution schedules", icon: "meeting" },
  { key: "/catering", label: "Catering", description: "Meal distribution logs, vendor management, and catering cost tracking", icon: "meeting" },
  { key: "/budget", label: "Budget", description: "Financial grand totals, lab session billing, and caterer expense calculations", icon: "checkmark" },
  { key: "/users", label: "Admin Control Panel", description: "Centralized admin management: User roles, dynamic tab access control, and audit logs", icon: "users", adminOnly: true },
];

export const ALL_APP_ROLES: AppRole[] = ["administration", "operations", "lab_manager", "finance"];

export type RolePermissionsMatrix = Record<AppRole, Record<string, boolean>>;

// ---------------------------------------------------------------------------
// Authoritative Baseline Defaults
// (Lab Manager is STRICTLY DISABLED from Lab Allocation by default)
// ---------------------------------------------------------------------------
export const DEFAULT_ROLE_PERMISSIONS: RolePermissionsMatrix = {
  administration: {
    "/dashboard": true,
    "/lab-data": true,
    "/lab-allocation": true,
    "/operation-requests": true,
    "/quality": true,
    "/projects": true,
    "/exports": true,
    "/timeline": true,
    "/catering": true,
    "/budget": true,
    "/users": true,
  },
  operations: {
    "/dashboard": true,
    "/lab-data": false,
    "/lab-allocation": true,
    "/operation-requests": true,
    "/quality": true,
    "/projects": true,
    "/exports": true,
    "/timeline": true,
    "/catering": true,
    "/budget": false,
    "/users": false,
  },
  lab_manager: {
    "/dashboard": true,
    "/lab-data": true,
    "/lab-allocation": false, // STRICTLY RESTRICTED BY DEFAULT
    "/operation-requests": true,
    "/quality": true,
    "/projects": true,
    "/exports": true,
    "/timeline": true,
    "/catering": false,
    "/budget": false,
    "/users": false,
  },
  finance: {
    "/dashboard": true,
    "/lab-data": false,
    "/lab-allocation": false,
    "/operation-requests": false,
    "/quality": true,
    "/projects": false,
    "/exports": true,
    "/timeline": true,
    "/catering": true,
    "/budget": true,
    "/users": false,
  },
};

const RUNTIME_CACHE_KEY = "ischool_runtime_permissions_matrix_v2";
let globalMatrixState: RolePermissionsMatrix = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));
const matrixListeners = new Set<(matrix: RolePermissionsMatrix) => void>();

function notifyMatrixListeners() {
  const clone = JSON.parse(JSON.stringify(globalMatrixState));
  matrixListeners.forEach((listener) => {
    try {
      listener(clone);
    } catch {
      // ignore
    }
  });
}

function getLocalRuntimeMatrix(): RolePermissionsMatrix | null {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const saved = localStorage.getItem(RUNTIME_CACHE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function saveLocalRuntimeMatrix(matrix: RolePermissionsMatrix): void {
  globalMatrixState = JSON.parse(JSON.stringify(matrix));
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(RUNTIME_CACHE_KEY, JSON.stringify(matrix));
    } catch {
      // ignore
    }
  }
  notifyMatrixListeners();
}

/**
 * Fetch all role-based navigation permissions directly from Supabase (authoritative source of truth)
 */
export async function fetchRoleNavigationPermissions(): Promise<RolePermissionsMatrix> {
  const localCached = getLocalRuntimeMatrix();
  const matrix: RolePermissionsMatrix = localCached
    ? JSON.parse(JSON.stringify(localCached))
    : JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));

  try {
    const { data, error } = await supabase
      .from("role_navigation_permissions" as any)
      .select("role, tab_key, is_enabled");

    if (!error && Array.isArray(data) && data.length > 0) {
      const records = data as unknown as Array<{ role: string; tab_key: string; is_enabled: boolean }>;
      for (const row of records) {
        const role = row.role as AppRole;
        const tabKey = row.tab_key as string;
        const isEnabled = Boolean(row.is_enabled);

        if (matrix[role]) {
          matrix[role][tabKey] = isEnabled;
        }
      }
      saveLocalRuntimeMatrix(matrix);
    }
  } catch (err) {
    console.warn("Notice: fetchRoleNavigationPermissions DB query returned:", err);
  }

  return matrix;
}

/**
 * Update a specific role-to-tab permission in Supabase and log the change to audit_logs
 */
export async function updateRoleTabPermission(
  role: AppRole,
  tabKey: string,
  isEnabled: boolean,
  actor: { id?: string | null; name: string; email?: string | null; role: string },
): Promise<boolean> {
  // 1. Optimistic update: Update global matrix state immediately
  if (globalMatrixState[role]) {
    globalMatrixState[role][tabKey] = isEnabled;
    saveLocalRuntimeMatrix(globalMatrixState);
  }

  // 2. Authoritative cloud database update
  try {
    const { error } = await supabase
      .from("role_navigation_permissions" as any)
      .upsert(
        {
          role,
          tab_key: tabKey,
          is_enabled: isEnabled,
          updated_at: new Date().toISOString(),
          updated_by: `${actor.name} (${actor.role})`,
        },
        { onConflict: "role,tab_key" },
      );

    if (error && error.code !== "PGRST205") {
      console.error("Database update error:", error);
      // Rollback on server error
      if (globalMatrixState[role]) {
        globalMatrixState[role][tabKey] = !isEnabled;
        saveLocalRuntimeMatrix(globalMatrixState);
      }
      return false;
    }
  } catch (err) {
    console.warn("Notice: Database role_navigation_permissions upsert notice:", err);
  }

  // 3. Log the permission change in Audit Logs
  const tabDef = ALL_NAV_TABS.find((t) => t.key === tabKey);
  void logAuditAction({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    userRole: actor.role,
    tab: "Admin Control Panel",
    section: "Role-Based Tab Access Control Matrix",
    actionType: "UPDATE",
    actionTitle: `${isEnabled ? "Granted" : "Revoked"} access to "${tabDef?.label || tabKey}" for ${ROLE_LABELS[role]}`,
    entityType: "navigation_permission",
    entityId: `${role}:${tabKey}`,
    oldValue: { role, tab_key: tabKey, is_enabled: !isEnabled },
    newValue: { role, tab_key: tabKey, is_enabled: isEnabled },
    metadata: { role, role_label: ROLE_LABELS[role], tab_key: tabKey, tab_label: tabDef?.label },
    isRestorable: true,
  });

  return true;
}

/**
 * Reset all permissions to system defaults in Supabase
 */
export async function resetRoleNavigationPermissions(
  actor: { id?: string | null; name: string; email?: string | null; role: string },
): Promise<boolean> {
  const resetMatrix = JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));
  saveLocalRuntimeMatrix(resetMatrix);

  try {
    const rowsToUpsert: Array<{ role: string; tab_key: string; is_enabled: boolean; updated_at: string; updated_by: string }> = [];
    const now = new Date().toISOString();
    const updatedBy = `${actor.name} (${actor.role})`;

    for (const [role, tabs] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const [tabKey, isEnabled] of Object.entries(tabs)) {
        rowsToUpsert.push({
          role,
          tab_key: tabKey,
          is_enabled: isEnabled,
          updated_at: now,
          updated_by: updatedBy,
        });
      }
    }

    await supabase
      .from("role_navigation_permissions" as any)
      .upsert(rowsToUpsert, { onConflict: "role,tab_key" });
  } catch (err) {
    console.warn("Notice: Database role_navigation_permissions reset notice:", err);
  }

  void logAuditAction({
    userId: actor.id,
    userName: actor.name,
    userEmail: actor.email,
    userRole: actor.role,
    tab: "Admin Control Panel",
    section: "Role-Based Tab Access Control Matrix",
    actionType: "UPDATE",
    actionTitle: "Reset all role-based tab access permissions to default baseline matrix",
    entityType: "navigation_permission",
    entityId: "system_permissions_matrix",
    oldValue: null,
    newValue: DEFAULT_ROLE_PERMISSIONS,
    isRestorable: true,
  });

  return true;
}

/**
 * Realtime hook for role-based navigation permissions
 */
export function useNavigationPermissions() {
  const [permissions, setPermissions] = useState<RolePermissionsMatrix>(() => {
    return JSON.parse(JSON.stringify(globalMatrixState));
  });
  const [loading, setLoading] = useState(true);

  const loadPermissions = useCallback(async () => {
    try {
      const data = await fetchRoleNavigationPermissions();
      setPermissions(data);
    } catch (err) {
      console.warn("Failed to load navigation permissions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync with global matrix updates
  useEffect(() => {
    const listener = (newMatrix: RolePermissionsMatrix) => {
      setPermissions(newMatrix);
    };
    matrixListeners.add(listener);
    return () => {
      matrixListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  // Realtime subscription on role_navigation_permissions table
  useEffect(() => {
    const channelId = `role_nav_perms_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
    let channel: any = null;

    try {
      channel = supabase
        .channel(channelId)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "role_navigation_permissions",
          },
          () => {
            loadPermissions();
          },
        )
        .subscribe();
    } catch (err) {
      console.warn("Failed to subscribe to role_navigation_permissions realtime:", err);
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
  }, [loadPermissions]);

  /**
   * Optimistic permission update method
   */
  const handleUpdatePermission = useCallback(
    async (
      role: AppRole,
      tabKey: string,
      isEnabled: boolean,
      actor: { id?: string | null; name: string; email?: string | null; role: string },
    ): Promise<boolean> => {
      // 1. Instant local state update across all active subscribers
      if (globalMatrixState[role]) {
        globalMatrixState[role][tabKey] = isEnabled;
        setPermissions({ ...globalMatrixState, [role]: { ...globalMatrixState[role], [tabKey]: isEnabled } });
        notifyMatrixListeners();
      }

      // 2. Perform backend persistence and audit logging
      return updateRoleTabPermission(role, tabKey, isEnabled, actor);
    },
    [],
  );

  /**
   * Check if a specific tab is allowed for a user given their roles
   */
  const isTabAllowed = useCallback(
    (tabKey: string, userRoles: AppRole[]): boolean => {
      // 1. Admin always has full access to all tabs
      if (userRoles.includes("administration")) {
        return true;
      }

      // 2. Admin-only tabs (e.g. /users) cannot be accessed by non-admins
      const tabDef = ALL_NAV_TABS.find((t) => t.key === tabKey);
      if (tabDef?.adminOnly) {
        return false;
      }

      // 3. Check dynamic permissions matrix for any matching role
      if (userRoles.length === 0) {
        return tabKey === "/dashboard";
      }

      for (const role of userRoles) {
        if (permissions[role]?.[tabKey] === true) {
          return true;
        }
      }

      return false;
    },
    [permissions],
  );

  return {
    permissions,
    isTabAllowed,
    updatePermission: handleUpdatePermission,
    resetDefaults: resetRoleNavigationPermissions,
    reload: loadPermissions,
    loading,
  };
}
