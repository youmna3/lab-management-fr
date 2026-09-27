import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth, ROLE_LABELS } from "@/hooks/useAuth";
import {
  fetchAuditLogs,
  restoreAuditEntry,
  permanentlyDeleteProject,
  subscribeToAuditLogs,
  type AuditLogEntry,
  type AuditActionType,
  type FetchAuditLogsFilters,
} from "@/lib/audit-logging";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import {
  History,
  RotateCcw,
  Search,
  RefreshCw,
  Download,
  Eye,
  User,
  Clock,
  Layers,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileCode,
  Trash2,
  AlertTriangle,
} from "lucide-react";

const ACTION_COLORS: Record<AuditActionType, { bg: string; text: string; border: string }> = {
  CREATE: { bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-500/30" },
  UPDATE: { bg: "bg-blue-500/10", text: "text-blue-700 dark:text-blue-300", border: "border-blue-500/30" },
  DELETE: { bg: "bg-rose-500/10", text: "text-rose-700 dark:text-rose-300", border: "border-rose-500/30" },
  STATUS_CHANGE: { bg: "bg-amber-500/10", text: "text-amber-700 dark:text-amber-300", border: "border-amber-500/30" },
  ALLOCATION_RUN: { bg: "bg-purple-500/10", text: "text-purple-700 dark:text-purple-300", border: "border-purple-500/30" },
  RESTORE: { bg: "bg-teal-500/10", text: "text-teal-700 dark:text-teal-300", border: "border-teal-500/30" },
  APPROVE: { bg: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-500/40" },
  REJECT: { bg: "bg-rose-500/15", text: "text-rose-700 dark:text-rose-300", border: "border-rose-500/40" },
  RESOLVE: { bg: "bg-cyan-500/10", text: "text-cyan-700 dark:text-cyan-300", border: "border-cyan-500/30" },
  OUTREACH: { bg: "bg-indigo-500/10", text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-500/30" },
};

function formatRelativeTime(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(isoString).toLocaleDateString();
  } catch {
    return isoString;
  }
}

export function AuditLogsView() {
  const { user, roles, hasAnyRole } = useAuth();

  // Role permissions
  const canRestore = hasAnyRole(["lab_manager", "administration"]);

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters State
  const [search, setSearch] = useState("");
  const [tabFilter, setTabFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [dateRange, setDateRange] = useState<"all" | "today" | "7days" | "30days">("all");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Modals State
  const [selectedLogForDiff, setSelectedLogForDiff] = useState<AuditLogEntry | null>(null);
  const [selectedLogForRestore, setSelectedLogForRestore] = useState<AuditLogEntry | null>(null);
  const [selectedLogForPurge, setSelectedLogForPurge] = useState<AuditLogEntry | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [purging, setPurging] = useState(false);

  // Load audit logs
  const loadLogs = useCallback(async () => {
    try {
      const filters: FetchAuditLogsFilters = {
        tab: tabFilter,
        actionType: actionFilter,
        search,
        dateRange,
      };
      const offset = (currentPage - 1) * pageSize;
      const res = await fetchAuditLogs(filters, pageSize, offset);
      setLogs(res.logs);
      setTotalCount(res.total);
    } catch (err) {
      console.error("Failed to load audit logs:", err);
      toast.error("Failed to load audit logs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tabFilter, actionFilter, search, dateRange, currentPage, pageSize]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Realtime subscription
  useEffect(() => {
    const unsubscribe = subscribeToAuditLogs(() => {
      loadLogs();
    });
    return () => {
      unsubscribe();
    };
  }, [loadLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadLogs();
    toast.success("Audit logs updated");
  };

  // KPI calculations
  const stats = useMemo(() => {
    const todayStr = new Date().toDateString();
    const todayCount = logs.filter((l) => new Date(l.created_at).toDateString() === todayStr).length;
    const restoreCount = logs.filter((l) => l.action_type === "RESTORE").length;
    const uniqueUsers = new Set(logs.map((l) => l.user_name || l.user_email || "System")).size;
    return {
      total: totalCount || logs.length,
      today: todayCount,
      restores: restoreCount,
      users: uniqueUsers,
    };
  }, [logs, totalCount]);

  // Execute Restore Action
  const handleConfirmRestore = async () => {
    if (!selectedLogForRestore) return;
    setRestoring(true);

    const currentUserInfo = {
      id: user?.id || null,
      name: (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "Admin",
      email: user?.email || null,
      role: roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "Administrator",
    };

    try {
      const res = await restoreAuditEntry(selectedLogForRestore, currentUserInfo);
      if (res.success) {
        toast.success(res.message);
        setSelectedLogForRestore(null);
        await loadLogs();
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(`Restore failed: ${err.message || "Unknown error"}`);
    } finally {
      setRestoring(false);
    }
  };

  // Execute Permanent Purge Action
  const handleConfirmPurge = async () => {
    if (!selectedLogForPurge) return;
    setPurging(true);

    const currentUserInfo = {
      id: user?.id || null,
      name: (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "Admin",
      email: user?.email || null,
      role: roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "Administrator",
    };

    try {
      const res = await permanentlyDeleteProject({
        projectId: selectedLogForPurge.entity_id,
        logId: selectedLogForPurge.id,
        actor: currentUserInfo,
      });
      if (res.success) {
        toast.success(res.message);
        setSelectedLogForPurge(null);
        await loadLogs();
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(`Permanent delete failed: ${err.message || "Unknown error"}`);
    } finally {
      setPurging(false);
    }
  };

  // Export to CSV
  const handleExportLogsCsv = () => {
    if (logs.length === 0) {
      toast.error("No logs to export.");
      return;
    }

    const headers = [
      "Timestamp",
      "User",
      "Role",
      "Tab",
      "Section",
      "Action Type",
      "Action Title",
      "Entity Type",
      "Entity ID",
      "Old Value",
      "New Value",
    ];

    const rows = logs.map((l) => [
      `"${l.created_at}"`,
      `"${l.user_name || ""}"`,
      `"${l.user_role || ""}"`,
      `"${l.tab || ""}"`,
      `"${l.section || ""}"`,
      `"${l.action_type || ""}"`,
      `"${(l.action_title || "").replace(/"/g, '""')}"`,
      `"${l.entity_type || ""}"`,
      `"${l.entity_id || ""}"`,
      `"${JSON.stringify(l.old_value || "").replace(/"/g, '""')}"`,
      `"${JSON.stringify(l.new_value || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `audit_trail_logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${logs.length} audit log entries to CSV!`);
  };

  // Render Diff summary preview
  const renderQuickDiff = (log: AuditLogEntry) => {
    if (log.entity_type === "navigation_permission" && log.old_value && log.new_value) {
      const oldVal = log.old_value.is_enabled ? "Enabled" : "Disabled";
      const newVal = log.new_value.is_enabled ? "Enabled" : "Disabled";
      return (
        <div className="flex items-center gap-1 text-[11px] font-mono">
          <span className="text-muted-foreground line-through">{oldVal}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className={`font-bold ${log.new_value.is_enabled ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{newVal}</span>
        </div>
      );
    }

    if (log.entity_type === "user_role") {
      const roleName = log.metadata?.role_label || log.metadata?.role || "Role";
      return (
        <div className="flex items-center gap-1 text-[11px]">
          <Badge variant="outline" className={`text-[10px] ${log.action_type === "CREATE" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300"}`}>
            {log.action_type === "CREATE" ? `+ ${roleName}` : `- ${roleName}`}
          </Badge>
          <span className="text-muted-foreground text-[10px] truncate max-w-[120px]">
            {log.metadata?.target_user_name || log.metadata?.target_user_email || ""}
          </span>
        </div>
      );
    }

    if (log.action_type === "STATUS_CHANGE" || (log.old_value?.Status && log.new_value?.Status)) {
      const oldStat = log.old_value?.Status || log.old_value?.status || "None";
      const newStat = log.new_value?.Status || log.new_value?.status || "None";
      return (
        <div className="flex items-center gap-1 text-[11px] font-mono">
          <span className="text-muted-foreground line-through">{String(oldStat)}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-bold text-foreground">{String(newStat)}</span>
        </div>
      );
    }

    if (log.action_type === "UPDATE" && log.old_value && log.new_value) {
      const changedKeys = Object.keys(log.new_value).filter(
        (k) => JSON.stringify(log.old_value[k]) !== JSON.stringify(log.new_value[k])
      );
      if (changedKeys.length > 0) {
        return (
          <span className="text-[11px] text-muted-foreground">
            Changed: <strong className="text-foreground">{changedKeys.slice(0, 2).join(", ")}</strong>
            {changedKeys.length > 2 && ` +${changedKeys.length - 2} more`}
          </span>
        );
      }
    }

    return (
      <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">
        {log.entity_type}: {log.entity_id}
      </span>
    );
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1F2A55] dark:text-[#F7FAFF] flex items-center gap-2">
            <History className="h-6 w-6 text-[#056FEC]" /> Audit Trail &amp; Activity Logs
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Complete, chronological record of all administrative actions, student lifecycle edits, allocations, and requests across the platform.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-8.5 text-xs gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleExportLogsCsv}
            className="h-8.5 text-xs gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3.5 border-border/70 bg-card/60 backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Total Logged Actions</span>
            <Layers className="h-4 w-4 text-[#056FEC]" />
          </div>
          <div className="text-2xl font-bold text-foreground mt-1.5">{stats.total.toLocaleString()}</div>
        </Card>

        <Card className="p-3.5 border-border/70 bg-card/60 backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Actions Today</span>
            <Clock className="h-4 w-4 text-[#0EAA3A]" />
          </div>
          <div className="text-2xl font-bold text-[#0EAA3A] mt-1.5">{stats.today.toLocaleString()}</div>
        </Card>

        <Card className="p-3.5 border-border/70 bg-card/60 backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Restores Triggered</span>
            <RotateCcw className="h-4 w-4 text-[#FF7F1C]" />
          </div>
          <div className="text-2xl font-bold text-[#FF7F1C] mt-1.5">{stats.restores.toLocaleString()}</div>
        </Card>

        <Card className="p-3.5 border-border/70 bg-card/60 backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Active Contributors</span>
            <User className="h-4 w-4 text-purple-600" />
          </div>
          <div className="text-2xl font-bold text-foreground mt-1.5">{stats.users.toLocaleString()}</div>
        </Card>
      </div>

      {/* Main Content Card */}
      <Card className="border-border/70 shadow-xs">
        <CardHeader className="p-4 border-b border-border/50">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by action, user, student ID, section..."
                className="h-8.5 pl-8 text-xs bg-background"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-2.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Tab Filter */}
              <Select
                value={tabFilter}
                onValueChange={(v) => {
                  setTabFilter(v);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-8.5 text-xs min-w-[130px] bg-background">
                  <SelectValue placeholder="All Tabs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Tabs</SelectItem>
                  <SelectItem value="Admin Control Panel">Admin Control Panel</SelectItem>
                  <SelectItem value="Projects">Projects</SelectItem>
                  <SelectItem value="Lab Allocation">Lab Allocation</SelectItem>
                  <SelectItem value="Operation Requests">Operation Requests</SelectItem>
                  <SelectItem value="Lab Data">Lab Data</SelectItem>
                  <SelectItem value="Quality">Quality</SelectItem>
                  <SelectItem value="Catering">Catering</SelectItem>
                </SelectContent>
              </Select>

              {/* Action Type Filter */}
              <Select
                value={actionFilter}
                onValueChange={(v) => {
                  setActionFilter(v);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-8.5 text-xs min-w-[140px] bg-background">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Actions</SelectItem>
                  <SelectItem value="STATUS_CHANGE">Status Changes</SelectItem>
                  <SelectItem value="UPDATE">Updates</SelectItem>
                  <SelectItem value="CREATE">Creates</SelectItem>
                  <SelectItem value="DELETE">Deletes</SelectItem>
                  <SelectItem value="APPROVE">Approvals</SelectItem>
                  <SelectItem value="REJECT">Rejections</SelectItem>
                  <SelectItem value="ALLOCATION_RUN">Allocation Runs</SelectItem>
                  <SelectItem value="RESTORE">Restores</SelectItem>
                </SelectContent>
              </Select>

              {/* Date Range Filter */}
              <Select
                value={dateRange}
                onValueChange={(v: any) => {
                  setDateRange(v);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-8.5 text-xs min-w-[120px] bg-background">
                  <SelectValue placeholder="Timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7days">Past 7 Days</SelectItem>
                  <SelectItem value="30days">Past 30 Days</SelectItem>
                </SelectContent>
              </Select>

              {(search || tabFilter !== "ALL" || actionFilter !== "ALL" || dateRange !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setTabFilter("ALL");
                    setActionFilter("ALL");
                    setDateRange("all");
                    setCurrentPage(1);
                  }}
                  className="h-8.5 text-xs text-muted-foreground hover:text-foreground px-2"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-[140px] text-xs font-bold">Timestamp</TableHead>
                  <TableHead className="w-[170px] text-xs font-bold">Actor</TableHead>
                  <TableHead className="w-[150px] text-xs font-bold">Location</TableHead>
                  <TableHead className="min-w-[240px] text-xs font-bold">Action &amp; Title</TableHead>
                  <TableHead className="w-[180px] text-xs font-bold">Details &amp; Diff</TableHead>
                  <TableHead className="w-[120px] text-right text-xs font-bold">Restore</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-40 text-center text-xs text-muted-foreground animate-pulse">
                      Loading audit log trail...
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-40 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <History className="h-8 w-8 mb-2 opacity-40 text-[#056FEC]" />
                        <p className="font-semibold text-xs text-foreground">No audit log entries found</p>
                        <p className="text-[11px]">Actions taken across the dashboard will appear here in real time.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    const color = ACTION_COLORS[log.action_type] || {
                      bg: "bg-muted",
                      text: "text-foreground",
                      border: "border-border",
                    };

                    const canBeRestored =
                      log.is_restorable &&
                      log.action_type !== "ALLOCATION_RUN" &&
                      log.old_value !== null &&
                      log.old_value !== undefined;

                    return (
                      <TableRow key={log.id} className="hover:bg-muted/40 transition-colors">
                        {/* Timestamp */}
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                          <div className="font-semibold text-foreground">
                            {new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {formatRelativeTime(log.created_at)}
                          </div>
                        </TableCell>

                        {/* Actor */}
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6 ring-1 ring-border/50 text-[10px] font-bold">
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {(log.user_name || "U").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="font-semibold text-foreground truncate max-w-[120px]">
                                {log.user_name}
                              </span>
                              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                                {log.user_role}
                              </span>
                            </div>
                          </div>
                        </TableCell>

                        {/* Location */}
                        <TableCell className="text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-foreground">{log.tab}</span>
                            <span className="text-[10px] text-muted-foreground">{log.section}</span>
                          </div>
                        </TableCell>

                        {/* Action Title */}
                        <TableCell className="text-xs">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-bold px-1.5 py-0 ${color.bg} ${color.text} ${color.border}`}
                              >
                                {log.action_type}
                              </Badge>
                              <span className="font-medium text-foreground">{log.action_title}</span>
                            </div>
                          </div>
                        </TableCell>

                        {/* Quick Diff & View Diff Button */}
                        <TableCell className="text-xs">
                          <div className="flex items-center justify-between gap-2">
                            {renderQuickDiff(log)}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedLogForDiff(log)}
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              title="View Full Diff Details"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>

                        {/* Restore & Purge Actions */}
                        <TableCell className="text-right whitespace-nowrap">
                          {log.entity_type === "project" && log.action_type === "DELETE" ? (
                            log.metadata?.permanently_purged || log.action_title?.includes("PERMANENTLY") ? (
                              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30 bg-destructive/10">
                                Purged
                              </Badge>
                            ) : canRestore ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedLogForRestore(log)}
                                  className="h-7 text-[11px] font-bold gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-emerald-500/30"
                                  title="Restore project and all associated records"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Restore
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedLogForPurge(log)}
                                  className="h-7 text-[11px] font-bold gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                                  title="Permanently delete project and all data from database"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Purge
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">Restricted</span>
                            )
                          ) : canRestore ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canBeRestored}
                              onClick={() => setSelectedLogForRestore(log)}
                              className="h-7 text-[11px] font-bold gap-1 text-[#056FEC] hover:text-[#043FAD] hover:bg-[#056FEC]/10 border-[#056FEC]/30 disabled:opacity-30"
                              title={
                                canBeRestored
                                  ? "Revert this change back to previous state"
                                  : "This record cannot be automatically restored"
                              }
                            >
                              <RotateCcw className="h-3 w-3" />
                              Restore
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">Restricted</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 border-t border-border/50 text-xs text-muted-foreground">
            <div>
              Showing <strong>{logs.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</strong> to{" "}
              <strong>{Math.min(currentPage * pageSize, totalCount)}</strong> of <strong>{totalCount}</strong> logs
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-7 text-xs bg-background border border-border rounded px-1.5"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="h-7 w-7"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs px-2 font-medium">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="h-7 w-7"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 1. Diff Visualizer Dialog */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={Boolean(selectedLogForDiff)} onOpenChange={(open) => !open && setSelectedLogForDiff(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileCode className="h-4 w-4 text-[#056FEC]" /> Log Entry Inspection &amp; State Diff
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedLogForDiff?.action_title} • {selectedLogForDiff?.tab} &gt; {selectedLogForDiff?.section}
            </DialogDescription>
          </DialogHeader>

          {selectedLogForDiff && (
            <div className="space-y-4 py-2 flex-1 overflow-y-auto">
              {/* Meta Info */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs p-2.5 rounded-lg bg-muted/40 border">
                <div>
                  <span className="text-[10px] text-muted-foreground block">Actor</span>
                  <span className="font-semibold text-foreground">{selectedLogForDiff.user_name}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Role</span>
                  <span className="font-semibold text-foreground">{selectedLogForDiff.user_role}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Timestamp</span>
                  <span className="font-mono text-foreground">
                    {new Date(selectedLogForDiff.created_at).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Entity</span>
                  <span className="font-mono text-foreground font-bold">
                    {selectedLogForDiff.entity_type}: {selectedLogForDiff.entity_id}
                  </span>
                </div>
              </div>

              {/* Old vs New State Comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Old Value */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-rose-600 dark:text-rose-400">
                    <span>Previous State (Old Value)</span>
                  </div>
                  <pre className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/20 text-[11px] font-mono overflow-x-auto text-foreground max-h-60">
                    {selectedLogForDiff.old_value !== null && selectedLogForDiff.old_value !== undefined
                      ? JSON.stringify(selectedLogForDiff.old_value, null, 2)
                      : "null (No previous value recorded)"}
                  </pre>
                </div>

                {/* New Value */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <span>Applied State (New Value)</span>
                  </div>
                  <pre className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-[11px] font-mono overflow-x-auto text-foreground max-h-60">
                    {selectedLogForDiff.new_value !== null && selectedLogForDiff.new_value !== undefined
                      ? JSON.stringify(selectedLogForDiff.new_value, null, 2)
                      : "null"}
                  </pre>
                </div>
              </div>

              {/* Metadata if present */}
              {selectedLogForDiff.metadata && Object.keys(selectedLogForDiff.metadata).length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">Execution Metadata:</span>
                  <pre className="p-2.5 rounded bg-muted/30 border text-[10px] font-mono text-muted-foreground overflow-x-auto">
                    {JSON.stringify(selectedLogForDiff.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-2 border-t flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setSelectedLogForDiff(null)}>
              Close
            </Button>
            {selectedLogForDiff && selectedLogForDiff.is_restorable && canRestore && (
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  const target = selectedLogForDiff;
                  setSelectedLogForDiff(null);
                  setSelectedLogForRestore(target);
                }}
                className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Proceed to Restore
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Restore Confirmation Dialog */}
      {/* ------------------------------------------------------------------ */}
      <AlertDialog
        open={Boolean(selectedLogForRestore)}
        onOpenChange={(open) => !open && setSelectedLogForRestore(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-[#056FEC]">
              <RotateCcw className="h-5 w-5 text-[#056FEC]" /> Confirm State Reversion
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2 text-foreground/80">
              <p>
                You are about to restore <strong>{selectedLogForRestore?.entity_type}</strong> (
                <code>{selectedLogForRestore?.entity_id}</code>) back to its previous recorded state from{" "}
                <strong>{selectedLogForRestore && new Date(selectedLogForRestore.created_at).toLocaleString()}</strong>.
              </p>
              <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-[11px]">
                <strong className="block mb-0.5">Audit Trail Tracking:</strong>
                This restore action will automatically create a new audit log entry recording your identity and the reversion details.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={handleConfirmRestore}
              className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold"
            >
              {restoring ? "Restoring..." : "Yes, Revert to Previous State"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Permanent Purge Modal */}
      <AlertDialog
        open={Boolean(selectedLogForPurge)}
        onOpenChange={(open) => !open && setSelectedLogForPurge(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Permanently Delete Project
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2 text-foreground/80">
              <p>
                Are you sure you want to permanently delete{" "}
                <strong>{selectedLogForPurge?.metadata?.project_name || selectedLogForPurge?.entity_id}</strong>?
              </p>
              <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-800 dark:text-rose-200 text-[11px] space-y-1">
                <strong className="block text-destructive font-bold">⚠️ IRREVERSIBLE ACTION:</strong>
                This will permanently purge this project and all cascaded batches, student rosters, allocations, and requests from the database. It cannot be undone or restored.
              </div>
              <p className="text-[11px] text-muted-foreground">
                An audit log recording this permanent purge will be logged before records are erased.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={purging}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmPurge();
              }}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold"
            >
              {purging ? "Purging..." : "Permanently Purge All Data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
