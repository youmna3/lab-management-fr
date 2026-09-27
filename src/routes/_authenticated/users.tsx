import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage, withAuthTimeout } from "@/integrations/supabase/auth-timeout";
import { useAuth, ROLE_LABELS, type AppRole } from "@/hooks/useAuth";
import {
  useNavigationPermissions,
  ALL_NAV_TABS,
  ALL_APP_ROLES,
  type RolePermissionsMatrix,
} from "@/hooks/useNavigationPermissions";
import { AuditLogsView } from "@/components/AuditLogsView";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  logAuditAction,
  fetchSoftDeletedProjects,
  restoreSoftDeletedProject,
  permanentlyDeleteProject,
  type SoftDeletedProjectItem,
} from "@/lib/audit-logging";
import {
  X,
  KeyRound,
  Shield,
  Check,
  Lock,
  Eye,
  DollarSign,
  Sliders,
  UserCheck,
  ChevronDown,
  ChevronUp,
  History,
  Users,
  RotateCcw,
  Sparkles,
  ShieldAlert,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  Archive,
  Trash2,
  RefreshCw,
  Search,
  Building2,
  Layers,
  FolderKanban,
  FileCode,
  CalendarRange,
} from "lucide-react";
import { BrandIcon } from "@/components/BrandIcon";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Admin Control Panel – iSchool" }] }),
  component: AdminControlPanelPage,
});

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  roles: AppRole[];
};

type PermissionRule = {
  key: string;
  label: string;
  description: string;
  allowedRoles: AppRole[];
  badgeColor: string;
};

const PERMISSION_RULES: PermissionRule[] = [
  {
    key: "budget",
    label: "View Budget & Financials",
    description: "Access /budget route, view EGP grand totals and financial breakdowns",
    allowedRoles: ["finance", "administration"],
    badgeColor: "bg-[#056FEC]/10 text-[#056FEC] border-[#056FEC]/30 dark:text-[#05ACFF]",
  },
  {
    key: "prices",
    label: "Edit Session & Meal Prices",
    description: "Modify session prices in Lab Data and unit prices in Catering",
    allowedRoles: ["lab_manager", "finance", "administration"],
    badgeColor: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  },
  {
    key: "labs",
    label: "Add & Edit Labs",
    description: "Create labs, edit lab specifications, manage quality audits and status",
    allowedRoles: ["lab_manager", "administration"],
    badgeColor: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300",
  },
  {
    key: "assign",
    label: "Assign Sessions & Batches",
    description: "Run auto-assignment, confirm/deny lab assignments in Projects workspace",
    allowedRoles: ["operations", "administration"],
    badgeColor: "bg-purple-500/10 text-purple-700 border-purple-500/30 dark:text-purple-300",
  },
];

const SECTION_STORAGE_KEY = "ischool_admin_panel_sections_state_v1";

function AdminControlPanelPage() {
  const { isAdmin, loading: authLoading, user, roles } = useAuth();
  const {
    permissions,
    updatePermission,
    resetDefaults,
    loading: permsLoading,
  } = useNavigationPermissions();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [sendingResetFor, setSendingResetFor] = useState<string | null>(null);
  const [resettingDefaults, setResettingDefaults] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<"permissions" | "users" | "deleted_projects" | "logs">("permissions");

  // Soft-deleted projects state
  const [deletedProjects, setDeletedProjects] = useState<SoftDeletedProjectItem[]>([]);
  const [loadingDeletedProjects, setLoadingDeletedProjects] = useState(false);
  const [deletedProjectSearch, setDeletedProjectSearch] = useState("");
  const [selectedProjectForRestore, setSelectedProjectForRestore] = useState<SoftDeletedProjectItem | null>(null);
  const [selectedProjectForPurge, setSelectedProjectForPurge] = useState<SoftDeletedProjectItem | null>(null);
  const [selectedProjectForSnapshot, setSelectedProjectForSnapshot] = useState<SoftDeletedProjectItem | null>(null);
  const [restoringProject, setRestoringProject] = useState(false);
  const [purgingProject, setPurgingProject] = useState(false);

  const actorInfo = useMemo(() => {
    return {
      id: user?.id || null,
      name: (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "Administrator",
      email: user?.email || null,
      role: roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "Administrator",
    };
  }, [user, roles]);

  const loadDeletedProjects = useCallback(async () => {
    setLoadingDeletedProjects(true);
    try {
      const items = await fetchSoftDeletedProjects();
      setDeletedProjects(items);
    } catch (err) {
      console.error("Failed to load deleted projects:", err);
    } finally {
      setLoadingDeletedProjects(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) return;
    void loadUsers();
    void loadDeletedProjects();
  }, [authLoading, isAdmin, loadDeletedProjects]);

  const filteredDeletedProjects = useMemo(() => {
    if (!deletedProjectSearch.trim()) return deletedProjects;
    const q = deletedProjectSearch.toLowerCase().trim();
    return deletedProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code && p.code.toLowerCase().includes(q)) ||
        p.deleted_by.toLowerCase().includes(q) ||
        (p.program && p.program.toLowerCase().includes(q)),
    );
  }, [deletedProjects, deletedProjectSearch]);

  const handleRestoreProject = async () => {
    if (!selectedProjectForRestore) return;
    setRestoringProject(true);
    try {
      const res = await restoreSoftDeletedProject({
        projectId: selectedProjectForRestore.id,
        logId: selectedProjectForRestore.log_id || undefined,
        actor: actorInfo,
      });
      if (res.success) {
        toast.success(res.message);
        setSelectedProjectForRestore(null);
        await loadDeletedProjects();
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(`Failed to restore project: ${err.message || "Unknown error"}`);
    } finally {
      setRestoringProject(false);
    }
  };

  const handlePermanentPurgeProject = async () => {
    if (!selectedProjectForPurge) return;
    setPurgingProject(true);
    try {
      const res = await permanentlyDeleteProject({
        projectId: selectedProjectForPurge.id,
        logId: selectedProjectForPurge.log_id || undefined,
        actor: actorInfo,
      });
      if (res.success) {
        toast.success(res.message);
        setSelectedProjectForPurge(null);
        await loadDeletedProjects();
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(`Permanent delete failed: ${err.message || "Unknown error"}`);
    } finally {
      setPurgingProject(false);
    }
  };

  async function loadUsers() {
    setLoadingUsers(true);
    const [profilesRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name").order("created_at", { ascending: true }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (profilesRes.error) toast.error(profilesRes.error.message);
    if (rolesRes.error) toast.error(rolesRes.error.message);
    const rolesByUser = new Map<string, AppRole[]>();
    for (const r of rolesRes.data ?? []) {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r.role as AppRole);
      rolesByUser.set(r.user_id, list);
    }
    setUsers(
      (profilesRes.data ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        roles: rolesByUser.get(p.id) ?? [],
      })),
    );
    setLoadingUsers(false);
  }

  async function addRole(userId: string, role: AppRole) {
    const targetUser = users.find((u) => u.id === userId);
    const prevRoles = targetUser?.roles || [];
    const nextRoles = [...prevRoles, role];

    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) return toast.error(error.message);
    toast.success(`Granted ${ROLE_LABELS[role]} role`);

    const targetDisplayName = targetUser?.full_name || targetUser?.email || userId;
    void logAuditAction({
      userId: actorInfo.id,
      userName: actorInfo.name,
      userEmail: actorInfo.email,
      userRole: actorInfo.role,
      tab: "Admin Control Panel",
      section: "User Accounts & Roles Management",
      actionType: "CREATE",
      actionTitle: `Granted role "${ROLE_LABELS[role]}" to ${targetDisplayName}`,
      entityType: "user_role",
      entityId: `${userId}:${role}`,
      oldValue: { user_id: userId, roles: prevRoles, email: targetUser?.email, full_name: targetUser?.full_name, role },
      newValue: { user_id: userId, roles: nextRoles, email: targetUser?.email, full_name: targetUser?.full_name, role },
      metadata: {
        target_user_id: userId,
        target_user_email: targetUser?.email,
        target_user_name: targetUser?.full_name,
        role,
        role_label: ROLE_LABELS[role],
      },
      isRestorable: true,
    });

    void loadUsers();
  }

  async function removeRole(userId: string, role: AppRole) {
    if (userId === user?.id && role === "administration") {
      return toast.error("You can't revoke your own administration role.");
    }
    const targetUser = users.find((u) => u.id === userId);
    const prevRoles = targetUser?.roles || [];
    const nextRoles = prevRoles.filter((r) => r !== role);

    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role);
    if (error) return toast.error(error.message);
    toast.success(`Revoked ${ROLE_LABELS[role]} role`);

    const targetDisplayName = targetUser?.full_name || targetUser?.email || userId;
    void logAuditAction({
      userId: actorInfo.id,
      userName: actorInfo.name,
      userEmail: actorInfo.email,
      userRole: actorInfo.role,
      tab: "Admin Control Panel",
      section: "User Accounts & Roles Management",
      actionType: "DELETE",
      actionTitle: `Revoked role "${ROLE_LABELS[role]}" from ${targetDisplayName}`,
      entityType: "user_role",
      entityId: `${userId}:${role}`,
      oldValue: { user_id: userId, roles: prevRoles, email: targetUser?.email, full_name: targetUser?.full_name, role },
      newValue: { user_id: userId, roles: nextRoles, email: targetUser?.email, full_name: targetUser?.full_name, role },
      metadata: {
        target_user_id: userId,
        target_user_email: targetUser?.email,
        target_user_name: targetUser?.full_name,
        role,
        role_label: ROLE_LABELS[role],
      },
      isRestorable: true,
    });

    void loadUsers();
  }

  async function handleSendResetPassword(targetEmail: string | null, userId: string) {
    if (!targetEmail) {
      return toast.error("User does not have a valid email address.");
    }
    setSendingResetFor(userId);
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.resetPasswordForEmail(targetEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        }),
        "Admin password reset request",
      );
      if (error) return toast.error(error.message);
      toast.success(`Password reset email sent to ${targetEmail}`);
    } catch (error) {
      console.error("[Auth] ADMIN PASSWORD RESET FAILURE", error);
      toast.error(authErrorMessage());
    } finally {
      setSendingResetFor(null);
    }
  }

  const handleToggleTabPermission = async (role: AppRole, tabKey: string, nextVal: boolean) => {
    const tabDef = ALL_NAV_TABS.find((t) => t.key === tabKey);
    const ok = await updatePermission(role, tabKey, nextVal, actorInfo);
    if (ok) {
      toast.success(
        `${nextVal ? "Enabled" : "Disabled"} "${tabDef?.label || tabKey}" for ${ROLE_LABELS[role]}`,
      );
    } else {
      toast.error("Failed to update tab permission.");
    }
  };

  const handleResetPermissions = async () => {
    setResettingDefaults(true);
    try {
      const ok = await resetDefaults(actorInfo);
      if (ok) {
        toast.success("Navigation access permissions reset to baseline system defaults.");
      } else {
        toast.error("Failed to reset permissions.");
      }
    } finally {
      setResettingDefaults(false);
    }
  };

  if (authLoading) return null;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-4xl p-8 text-center">
        <Card className="border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 shadow-xs">
          <CardHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 mb-2">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl text-rose-700 dark:text-rose-300">Access Restricted</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Only Administration users can access the Admin Control Panel, manage user roles, and configure dynamic tab access permissions.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1F2A55] dark:text-[#F7FAFF] flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-xs">
              <Shield className="h-5 w-5" />
            </div>
            Admin Control Panel
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Centralized administration workspace: Dynamic role-based navigation access control matrix, user accounts &amp; privileges, and centralized audit trail.
          </p>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-purple-500/20 bg-linear-to-br from-purple-500/5 via-transparent to-transparent shadow-xs">
          <CardContent className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Registered Users</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400">
                  {users.length}
                </span>
                <span className="text-[11px] text-muted-foreground">accounts</span>
              </div>
            </div>
            <Users className="h-6 w-6 text-purple-500/40" />
          </CardContent>
        </Card>

        <Card className="border-[#056FEC]/20 bg-linear-to-br from-[#056FEC]/5 via-transparent to-transparent shadow-xs">
          <CardContent className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">App Roles</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-bold tracking-tight text-[#056FEC] dark:text-[#05ACFF]">
                  {ALL_APP_ROLES.length}
                </span>
                <span className="text-[11px] text-muted-foreground">roles active</span>
              </div>
            </div>
            <SlidersHorizontal className="h-6 w-6 text-[#056FEC]/40" />
          </CardContent>
        </Card>

        <Card className="border-[#0EAA3A]/20 bg-linear-to-br from-[#0EAA3A]/5 via-transparent to-transparent shadow-xs">
          <CardContent className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Protected Tabs</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-bold tracking-tight text-[#0EAA3A]">
                  {ALL_NAV_TABS.length}
                </span>
                <span className="text-[11px] text-muted-foreground">navigation routes</span>
              </div>
            </div>
            <CheckCircle2 className="h-6 w-6 text-[#0EAA3A]/40" />
          </CardContent>
        </Card>

        <Card className="border-[#FF7F1C]/20 bg-linear-to-br from-[#FF7F1C]/5 via-transparent to-transparent shadow-xs">
          <CardContent className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Audit Logging</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-bold tracking-tight text-[#FF7F1C]">
                  Live
                </span>
                <span className="text-[11px] text-muted-foreground">real-time trail</span>
              </div>
            </div>
            <History className="h-6 w-6 text-[#FF7F1C]/40" />
          </CardContent>
        </Card>
      </div>

      {/* Main 3-Tab Navigation Bar */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-muted/60 border border-border/60 shadow-2xs w-fit">
        <button
          type="button"
          onClick={() => setActiveAdminTab("permissions")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeAdminTab === "permissions"
              ? "bg-[#056FEC] text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Tab Access Permissions</span>
          <Badge
            variant="secondary"
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
              activeAdminTab === "permissions"
                ? "bg-white/20 text-white font-bold"
                : "bg-background text-foreground border border-border/50"
            }`}
          >
            {ALL_NAV_TABS.length} Tabs
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setActiveAdminTab("users")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeAdminTab === "users"
              ? "bg-[#056FEC] text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Users className="h-4 w-4" />
          <span>User Accounts &amp; Roles</span>
          <Badge
            variant="secondary"
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
              activeAdminTab === "users"
                ? "bg-white/20 text-white font-bold"
                : "bg-background text-foreground border border-border/50"
            }`}
          >
            {users.length} Users
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setActiveAdminTab("deleted_projects")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeAdminTab === "deleted_projects"
              ? "bg-[#056FEC] text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Archive className="h-4 w-4" />
          <span>Deleted Projects</span>
          <Badge
            variant="secondary"
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
              activeAdminTab === "deleted_projects"
                ? "bg-white/20 text-white font-bold"
                : deletedProjects.length > 0
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                : "bg-background text-foreground border border-border/50"
            }`}
          >
            {deletedProjects.length} Archived
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setActiveAdminTab("logs")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeAdminTab === "logs"
              ? "bg-[#056FEC] text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <History className="h-4 w-4" />
          <span>System Audit Trail</span>
          <Badge
            variant="secondary"
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
              activeAdminTab === "logs"
                ? "bg-white/20 text-white font-bold"
                : "bg-background text-foreground border border-border/50"
            }`}
          >
            Live Trail
          </Badge>
        </button>
      </div>

      {/* ================================================================== */}
      {/* TAB 1: Dynamic Role-Based Tab Access Control Matrix */}
      {/* ================================================================== */}
      {activeAdminTab === "permissions" && (
        <Card className="border-border/70 shadow-xs">
          <CardHeader className="p-5 border-b border-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#056FEC]/10 text-[#056FEC]">
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold text-foreground">
                      Role-Based Tab &amp; Page Access Control
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] bg-[#056FEC]/10 text-[#056FEC] border-[#056FEC]/30">
                      Live System Matrix
                    </Badge>
                  </div>
                  <CardDescription className="text-xs mt-0.5">
                    Configure which top-level navigation tabs each role can view and access. Changes take effect in real time for all users.
                  </CardDescription>
                </div>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resettingDefaults}
                    className="h-8 text-xs font-semibold gap-1.5 text-muted-foreground hover:text-foreground self-start sm:self-auto"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset to Defaults
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <RotateCcw className="h-5 w-5 text-amber-600" /> Reset All Navigation Permissions?
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-xs space-y-2">
                      <p>
                        This will restore the standard default matrix across all roles (including restricting Lab Manager from Lab Allocation).
                      </p>
                      <p className="font-semibold text-foreground">
                        This change will be saved to the database and take effect immediately.
                      </p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleResetPermissions}
                      className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold"
                    >
                      Yes, Reset Permissions
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardHeader>

          <CardContent className="p-5 space-y-4">
            {/* Lab Manager Restriction Policy Callout */}
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs">
              <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold block">Default Policy Notice: Lab Manager Allocation Restriction</span>
                <p className="text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                  By default, <strong>Lab Manager (Event Team)</strong> is restricted from accessing the <strong>Lab Allocation</strong> page. Lab Managers manage physical lab specifications and approve capacity overfill requests, while solver pipeline execution is scoped to Operations and Administration.
                </p>
              </div>
            </div>

            {/* Matrix Table */}
            <div className="rounded-xl border border-border/60 overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40 text-xs">
                  <TableRow>
                    <TableHead className="w-[280px] font-bold">Navigation Tab / Page</TableHead>
                    <TableHead className="text-center font-bold">
                      <div className="flex flex-col items-center">
                        <span className="text-purple-700 dark:text-purple-300 font-bold">Administration</span>
                        <span className="text-[10px] text-muted-foreground font-normal">Full System Access</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-bold">
                      <div className="flex flex-col items-center">
                        <span className="text-amber-700 dark:text-amber-300 font-bold">Operations</span>
                        <span className="text-[10px] text-muted-foreground font-normal">Execution &amp; Logistics</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-bold">
                      <div className="flex flex-col items-center">
                        <span className="text-blue-700 dark:text-blue-300 font-bold">Lab Manager</span>
                        <span className="text-[10px] text-muted-foreground font-normal">Labs &amp; Events</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-bold">
                      <div className="flex flex-col items-center">
                        <span className="text-emerald-700 dark:text-emerald-300 font-bold">Finance</span>
                        <span className="text-[10px] text-muted-foreground font-normal">Budgets &amp; Invoices</span>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ALL_NAV_TABS.map((tab) => {
                    return (
                      <TableRow key={tab.key} className="hover:bg-muted/20 text-xs">
                        {/* Tab Info */}
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">{tab.label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">({tab.key})</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{tab.description}</div>
                        </TableCell>

                        {/* Administration Column */}
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center justify-center">
                            <Switch
                              checked={true}
                              disabled={true}
                              className="data-[state=checked]:bg-purple-600 opacity-80 cursor-not-allowed"
                            />
                            <span className="text-[9px] text-purple-600 dark:text-purple-400 font-semibold mt-1">
                              Always On
                            </span>
                          </div>
                        </TableCell>

                        {/* Operations Column */}
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center justify-center">
                            {tab.adminOnly ? (
                              <Badge variant="outline" className="text-[9px] opacity-60">Admin Only</Badge>
                            ) : (
                              <Switch
                                checked={Boolean(permissions.operations?.[tab.key])}
                                onCheckedChange={(checked) =>
                                  handleToggleTabPermission("operations", tab.key, checked)
                                }
                                className="data-[state=checked]:bg-amber-600 cursor-pointer"
                              />
                            )}
                          </div>
                        </TableCell>

                        {/* Lab Manager Column */}
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center justify-center">
                            {tab.adminOnly ? (
                              <Badge variant="outline" className="text-[9px] opacity-60">Admin Only</Badge>
                            ) : (
                              <Switch
                                checked={Boolean(permissions.lab_manager?.[tab.key])}
                                onCheckedChange={(checked) =>
                                  handleToggleTabPermission("lab_manager", tab.key, checked)
                                }
                                className="data-[state=checked]:bg-blue-600 cursor-pointer"
                              />
                            )}
                          </div>
                        </TableCell>

                        {/* Finance Column */}
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center justify-center">
                            {tab.adminOnly ? (
                              <Badge variant="outline" className="text-[9px] opacity-60">Admin Only</Badge>
                            ) : (
                              <Switch
                                checked={Boolean(permissions.finance?.[tab.key])}
                                onCheckedChange={(checked) =>
                                  handleToggleTabPermission("finance", tab.key, checked)
                                }
                                className="data-[state=checked]:bg-emerald-600 cursor-pointer"
                              />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Matrix Footer */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
              <CheckCircle2 className="h-4 w-4 text-[#0EAA3A]" />
              <span>Permissions are stored in the shared database and broadcasted in real-time across all sessions.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================== */}
      {/* TAB 2: User Accounts & Roles Management */}
      {/* ================================================================== */}
      {activeAdminTab === "users" && (
        <Card className="border-border/70 shadow-xs">
          <CardHeader className="p-5 border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600/10 text-purple-600">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-bold text-foreground">
                    User Accounts &amp; Privilege Assignments
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-600 border-purple-500/30">
                    {users.length} Users Registered
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-0.5">
                  Manage individual user roles, grant privileges, and trigger password reset links.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 space-y-4">
            {/* Legend Rules */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              {PERMISSION_RULES.map((rule) => (
                <div key={rule.key} className="p-2.5 rounded-lg border bg-background space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-foreground">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${rule.badgeColor}`}>
                      {rule.label}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">{rule.description}</p>
                  <div className="text-[10px] text-muted-foreground pt-1 flex flex-wrap gap-1">
                    <span className="font-semibold">Granted Roles:</span>
                    {rule.allowedRoles.map((r) => (
                      <span key={r} className="font-mono text-primary font-medium">{ROLE_LABELS[r]}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Users Table */}
            <div className="rounded-xl border border-border/60 overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="text-xs">
                    <TableHead className="w-56 font-bold">User Identity</TableHead>
                    <TableHead className="font-bold">Assigned Roles</TableHead>
                    <TableHead className="font-bold">Granted Capabilities Matrix</TableHead>
                    <TableHead className="w-48 font-bold">Grant New Role</TableHead>
                    <TableHead className="w-36 text-right font-bold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingUsers ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground animate-pulse">
                        Loading users &amp; access permissions…
                      </TableCell>
                    </TableRow>
                  ) : users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                        No registered user accounts found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((u) => {
                      const availableRoles = ALL_APP_ROLES.filter((r) => !u.roles.includes(r));
                      const isUserAdmin = u.roles.includes("administration");
                      const isUserFinance = u.roles.includes("finance");
                      const isUserLabMgr = u.roles.includes("lab_manager");
                      const isUserOps = u.roles.includes("operations");

                      // Derived Capabilities
                      const canBudget = isUserAdmin || isUserFinance;
                      const canEditPrice = isUserAdmin || isUserFinance || isUserLabMgr;
                      const canEditLabs = isUserAdmin || isUserLabMgr;
                      const canAssignSessions = isUserAdmin || isUserOps;

                      return (
                        <TableRow key={u.id} className="hover:bg-muted/20 text-xs">
                          <TableCell className="font-medium">
                            <div className="font-bold text-foreground">{u.full_name || "Unnamed User"}</div>
                            <div className="font-mono text-muted-foreground text-[11px]">{u.email}</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {u.roles.length === 0 ? (
                                <Badge variant="outline" className="text-muted-foreground text-[10px] gap-1">
                                  <Eye className="h-3 w-3" /> Viewer (Default)
                                </Badge>
                              ) : (
                                u.roles.map((r) => {
                                  const badgeCls =
                                    r === "administration"
                                      ? "bg-purple-600 text-white"
                                      : r === "finance"
                                      ? "bg-[#FF7F1C] text-white"
                                      : r === "lab_manager"
                                      ? "bg-[#056FEC] text-white"
                                      : "bg-amber-600 text-white";

                                  return (
                                    <Badge key={r} className={`gap-1 text-[10px] ${badgeCls}`}>
                                      <span>{ROLE_LABELS[r]}</span>
                                      <button
                                        onClick={() => removeRole(u.id, r)}
                                        className="ml-1 hover:text-rose-200 transition-colors cursor-pointer"
                                        title={`Revoke ${ROLE_LABELS[r]}`}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </Badge>
                                  );
                                })
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant="outline" className={`text-[10px] gap-1 ${canBudget ? "bg-[#056FEC]/10 text-[#056FEC] border-[#056FEC]/30" : "opacity-40"}`}>
                                {canBudget ? <Check className="h-3 w-3 text-[#056FEC]" /> : <Lock className="h-3 w-3" />}
                                <span>Budget</span>
                              </Badge>

                              <Badge variant="outline" className={`text-[10px] gap-1 ${canEditPrice ? "bg-amber-500/10 text-amber-700 border-amber-500/30" : "opacity-40"}`}>
                                {canEditPrice ? <Check className="h-3 w-3 text-amber-600" /> : <Lock className="h-3 w-3" />}
                                <span>Prices</span>
                              </Badge>

                              <Badge variant="outline" className={`text-[10px] gap-1 ${canEditLabs ? "bg-blue-500/10 text-blue-700 border-blue-500/30" : "opacity-40"}`}>
                                {canEditLabs ? <Check className="h-3 w-3 text-blue-600" /> : <Lock className="h-3 w-3" />}
                                <span>Labs</span>
                              </Badge>

                              <Badge variant="outline" className={`text-[10px] gap-1 ${canAssignSessions ? "bg-purple-500/10 text-purple-700 border-purple-500/30" : "opacity-40"}`}>
                                {canAssignSessions ? <Check className="h-3 w-3 text-purple-600" /> : <Lock className="h-3 w-3" />}
                                <span>Assign</span>
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            {availableRoles.length > 0 ? (
                              <Select onValueChange={(r) => addRole(u.id, r as AppRole)}>
                                <SelectTrigger className="h-7 text-xs bg-background">
                                  <SelectValue placeholder="Add system role..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableRoles.map((r) => (
                                    <SelectItem key={r} value={r} className="text-xs">
                                      {ROLE_LABELS[r]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">All roles assigned</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1"
                              disabled={sendingResetFor === u.id}
                              onClick={() => handleSendResetPassword(u.email, u.id)}
                              title="Trigger Password Reset Email"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              <span>{sendingResetFor === u.id ? "Sending..." : "Reset"}</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================== */}
      {/* TAB 3: Deleted Projects & Restoration Archive */}
      {/* ================================================================== */}
      {activeAdminTab === "deleted_projects" && (
        <div className="space-y-4">
          {/* Top KPI Cards for Archive */}
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-rose-500/20 bg-linear-to-br from-rose-500/5 via-transparent to-transparent shadow-xs">
              <CardContent className="flex items-center justify-between p-3.5">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Archived Projects</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
                      {deletedProjects.length}
                    </span>
                    <span className="text-[11px] text-muted-foreground">soft-deleted</span>
                  </div>
                </div>
                <Archive className="h-6 w-6 text-rose-500/40" />
              </CardContent>
            </Card>

            <Card className="border-[#056FEC]/20 bg-linear-to-br from-[#056FEC]/5 via-transparent to-transparent shadow-xs">
              <CardContent className="flex items-center justify-between p-3.5">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Archived Batches</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-2xl font-bold tracking-tight text-[#056FEC] dark:text-[#05ACFF]">
                      {deletedProjects.reduce((sum, p) => sum + p.batches_count, 0)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">in archive</span>
                  </div>
                </div>
                <Layers className="h-6 w-6 text-[#056FEC]/40" />
              </CardContent>
            </Card>

            <Card className="border-purple-500/20 bg-linear-to-br from-purple-500/5 via-transparent to-transparent shadow-xs">
              <CardContent className="flex items-center justify-between p-3.5">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Archived Students</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400">
                      {deletedProjects.reduce((sum, p) => sum + p.students_count, 0).toLocaleString()}
                    </span>
                    <span className="text-[11px] text-muted-foreground">roster rows</span>
                  </div>
                </div>
                <Users className="h-6 w-6 text-purple-500/40" />
              </CardContent>
            </Card>

            <Card className="border-emerald-500/20 bg-linear-to-br from-emerald-500/5 via-transparent to-transparent shadow-xs">
              <CardContent className="flex items-center justify-between p-3.5">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cascade Restore</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                      100%
                    </span>
                    <span className="text-[11px] text-muted-foreground">fidelity</span>
                  </div>
                </div>
                <RotateCcw className="h-6 w-6 text-emerald-500/40" />
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/70 shadow-xs">
            <CardHeader className="p-5 border-b border-border/40">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
                    <Archive className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-bold text-foreground">
                        Deleted &amp; Archived Projects
                      </CardTitle>
                      <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30">
                        {deletedProjects.length} Soft-Deleted
                      </Badge>
                    </div>
                    <CardDescription className="text-xs mt-0.5">
                      Soft-deleted projects retain all child batches, student rosters, allocations, and timeline data. Restore them with one click or permanently purge them.
                    </CardDescription>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search deleted projects..."
                      value={deletedProjectSearch}
                      onChange={(e) => setDeletedProjectSearch(e.target.value)}
                      className="h-8 pl-8 text-xs bg-background"
                    />
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadDeletedProjects}
                    disabled={loadingDeletedProjects}
                    className="h-8 text-xs gap-1.5 shrink-0"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingDeletedProjects ? "animate-spin text-primary" : ""}`} />
                    <span>Refresh</span>
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="min-w-[220px] text-xs font-bold">Project Name &amp; Code</TableHead>
                      <TableHead className="w-[110px] text-xs font-bold">Program</TableHead>
                      <TableHead className="w-[180px] text-xs font-bold">Deleted Date</TableHead>
                      <TableHead className="w-[160px] text-xs font-bold">Deleted By</TableHead>
                      <TableHead className="w-[160px] text-xs font-bold">Archived Records</TableHead>
                      <TableHead className="w-[110px] text-xs font-bold">Status</TableHead>
                      <TableHead className="w-[190px] text-right text-xs font-bold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingDeletedProjects ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-32 text-center text-xs text-muted-foreground animate-pulse">
                          Loading soft-deleted projects from audit archives...
                        </TableCell>
                      </TableRow>
                    ) : filteredDeletedProjects.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-36 text-center">
                          <div className="flex flex-col items-center justify-center text-muted-foreground space-y-1">
                            <Archive className="h-8 w-8 mb-1 opacity-40 text-muted-foreground" />
                            <p className="font-semibold text-xs text-foreground">No soft-deleted projects</p>
                            <p className="text-[11px] text-muted-foreground">
                              {deletedProjectSearch
                                ? "No archived projects match your search query."
                                : "When projects are deleted, they will appear here with full restoration capabilities."}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDeletedProjects.map((p) => {
                        return (
                          <TableRow key={p.id} className="hover:bg-muted/40 transition-colors">
                            {/* Project Name & Code */}
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-2">
                                <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                  <Building2 className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold text-foreground truncate">{p.name}</div>
                                  <div className="text-[11px] font-mono text-muted-foreground">{p.code || p.id}</div>
                                </div>
                              </div>
                            </TableCell>

                            {/* Program */}
                            <TableCell className="text-xs">
                              {p.program ? (
                                <Badge
                                  variant="secondary"
                                  className={`text-[10px] font-bold ${
                                    p.program === "DECI"
                                      ? "bg-[#056FEC]/10 text-[#056FEC] border-[#056FEC]/30"
                                      : "bg-[#FF7F1C]/10 text-[#FF7F1C] border-[#FF7F1C]/30"
                                  }`}
                                >
                                  {p.program}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>

                            {/* Deleted Date */}
                            <TableCell className="text-xs font-mono text-muted-foreground">
                              <div className="font-semibold text-foreground">
                                {new Date(p.deleted_at).toLocaleDateString()}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {new Date(p.deleted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </div>
                            </TableCell>

                            {/* Deleted By */}
                            <TableCell className="text-xs">
                              <span className="font-semibold text-foreground">{p.deleted_by}</span>
                            </TableCell>

                            {/* Archived Contents */}
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge variant="outline" className="text-[10px] font-mono bg-muted/40">
                                  {p.batches_count} Batches
                                </Badge>
                                {p.students_count > 0 && (
                                  <Badge variant="outline" className="text-[10px] font-mono bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30">
                                    {p.students_count.toLocaleString()} Students
                                  </Badge>
                                )}
                              </div>
                            </TableCell>

                            {/* Status */}
                            <TableCell className="text-xs">
                              <Badge variant="outline" className="text-[10px] font-bold bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30">
                                Soft-Deleted
                              </Badge>
                            </TableCell>

                            {/* Actions */}
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedProjectForRestore(p)}
                                  className="h-7 text-[11px] font-bold gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-emerald-500/30"
                                  title="Restore project and all associated batches & rosters"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Restore
                                </Button>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedProjectForPurge(p)}
                                  className="h-7 text-[11px] font-bold gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                                  title="Permanently delete project from database"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Permanently Delete
                                </Button>

                                {p.snapshot && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setSelectedProjectForSnapshot(p)}
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    title="View Archived Snapshot"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Restore Project Confirmation Modal */}
      <AlertDialog
        open={Boolean(selectedProjectForRestore)}
        onOpenChange={(open) => !open && setSelectedProjectForRestore(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-600">
              <RotateCcw className="h-5 w-5 text-emerald-600" /> Restore Project &amp; Associated Data
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2 text-foreground/80">
              <p>
                Are you sure you want to restore{" "}
                <strong>{selectedProjectForRestore?.name}</strong> ({selectedProjectForRestore?.code || selectedProjectForRestore?.id})?
              </p>
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 dark:text-emerald-200 text-[11px] space-y-1.5">
                <strong className="block font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Full Cascade Restoration:
                </strong>
                <ul className="list-disc list-inside space-y-0.5 text-[10px] text-emerald-800 dark:text-emerald-300">
                  <li>Project record restored to active workspace</li>
                  <li>All {selectedProjectForRestore?.batches_count || 0} batches, calendar dates, and time slot schedules</li>
                  <li>Student uploads, roster assignments, and group classifications</li>
                  <li>Lab demand needs, assignments, and allocation outputs</li>
                </ul>
              </div>
              <p className="text-[11px] text-muted-foreground">
                A RESTORE event will be logged in the system audit trail for full accountability.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoringProject}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoringProject}
              onClick={(e) => {
                e.preventDefault();
                void handleRestoreProject();
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {restoringProject ? "Restoring..." : "Yes, Restore Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent Purge Project Confirmation Modal */}
      <AlertDialog
        open={Boolean(selectedProjectForPurge)}
        onOpenChange={(open) => !open && setSelectedProjectForPurge(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Permanently Delete Project
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2 text-foreground/80">
              <p>
                Are you sure you want to permanently delete{" "}
                <strong>{selectedProjectForPurge?.name}</strong> ({selectedProjectForPurge?.code || selectedProjectForPurge?.id})?
              </p>
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-900 dark:text-rose-200 text-[11px] space-y-1">
                <strong className="block text-destructive font-bold">⚠️ IRREVERSIBLE ACTION:</strong>
                <p>
                  This will permanently drop the project and all cascaded batches, needs, student rosters, allocations, and requests from the database. It cannot be undone or restored.
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                An audit log recording this permanent purge will be logged before records are erased.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgingProject}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={purgingProject}
              onClick={(e) => {
                e.preventDefault();
                void handlePermanentPurgeProject();
              }}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold"
            >
              {purgingProject ? "Purging..." : "Permanently Purge All Data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Snapshot Dialog */}
      <Dialog
        open={Boolean(selectedProjectForSnapshot)}
        onOpenChange={(open) => !open && setSelectedProjectForSnapshot(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileCode className="h-4 w-4 text-primary" /> Archived Project Snapshot: {selectedProjectForSnapshot?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Complete JSON snapshot captured at the time of deletion.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto bg-muted/40 p-3 rounded-lg border font-mono text-[11px]">
            <pre>{JSON.stringify(selectedProjectForSnapshot?.snapshot, null, 2)}</pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* TAB 3: Centralized Audit Trail & Activity Logs */}
      {/* ================================================================== */}
      {activeAdminTab === "logs" && (
        <Card className="border-border/70 shadow-xs">
          <CardHeader className="p-5 border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600/10 text-teal-600">
                <History className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-bold text-foreground">
                    Centralized Audit Trail &amp; Activity Logs
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] bg-teal-500/10 text-teal-600 border-teal-500/30">
                    Live Event Trail
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-0.5">
                  Complete chronological history of administrative operations, student lifecycle edits, solver runs, and one-click state restoration.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5">
            <AuditLogsView />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
