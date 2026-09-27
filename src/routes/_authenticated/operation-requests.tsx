import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatGradeLevel } from "@/lib/project-grade-levels";
import { useAuth, ROLE_LABELS, type AppRole } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  ShieldAlert,
  Layers,
  Sparkles,
  Building2,
  PhoneCall,
  Check,
  X,
  Lock,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Calendar,
  FolderKanban,
  MapPin,
  Users,
  Send,
  SlidersHorizontal,
  ArrowRight,
  Filter,
  FlaskConical,
  UserCheck,
} from "lucide-react";
import {
  fetchAllResolutionRequests,
  updateBatchResolutionRequestStatus,
  deleteBatchResolutionRequest,
  forwardRequestToCSTeam,
  type ResolutionRequest,
  type ResolutionRequestStatus,
  type ResolutionRequestType,
} from "@/lib/batch-allocation-storage";
import { logAuditAction, type AuditActionType } from "@/lib/audit-logging";
import { BrandIcon } from "@/components/BrandIcon";
import { RequestAuditHistory } from "@/components/RequestAuditHistory";
import { RequestDecisionDialog } from "@/components/RequestDecisionDialog";
import { RequestImpactPreviewDialog } from "@/components/RequestImpactPreviewDialog";
import { CSReallocationReviewDialog } from "@/components/CSReallocationReviewDialog";
import { useOperationRequestsNotifications } from "@/hooks/useOperationRequestsNotifications";
import { useNavigationPermissions } from "@/hooks/useNavigationPermissions";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/operation-requests")({
  head: () => ({ meta: [{ title: "Operation Requests – iSchool" }] }),
  component: OperationRequestsPage,
});

type Project = Tables<"projects">;
type Batch = Tables<"batches">;

function OperationRequestsPage() {
  const { user, roles, hasAnyRole, hasRole, isAdmin } = useAuth();
  const { isTabAllowed } = useNavigationPermissions();
  const { unreadCount, markRequestAsSeen, markAllAsSeen } = useOperationRequestsNotifications();

  // Role permissions
  const canAccess = hasAnyRole(["lab_manager", "administration", "operations"]) || Boolean(user);
  const canApprove = hasAnyRole(["lab_manager", "administration"]);
  const canUpdateCS = hasAnyRole(["operations", "administration"]);
  const canDelete = hasAnyRole(["administration"]);
  const isOperationsOnly = hasRole("operations") && !canApprove;
  const canAccessLabAllocation = isTabAllowed("/lab-allocation", roles);

  const currentUserName = (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "User";
  const currentUserRole = roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "Viewer";

  // Data States
  const [requests, setRequests] = useState<ResolutionRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter States
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [batchFilter, setBatchFilter] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");

  // Decision & Reply Dialog State
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [selectedRequestForDecision, setSelectedRequestForDecision] = useState<ResolutionRequest | null>(null);
  const [decisionTargetStatus, setDecisionTargetStatus] = useState<ResolutionRequestStatus | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Preview Impact Dialog State (Lab Manager / Admin)
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [selectedRequestForPreview, setSelectedRequestForPreview] = useState<ResolutionRequest | null>(null);

  // CS Reallocation Review Dialog State (Event Team / CS Team / Admin)
  const [reallocationModalOpen, setReallocationModalOpen] = useState(false);
  const [selectedRequestForReallocation, setSelectedRequestForReallocation] = useState<ResolutionRequest | null>(null);

  // Load all initial data from Supabase & IndexedDB
  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      try {
        const [projRes, batchRes, reqData] = await Promise.all([
          supabase.from("projects").select("*").order("created_at", { ascending: false }),
          supabase.from("batches").select("*").order("created_at", { ascending: false }),
          fetchAllResolutionRequests(),
        ]);

        if (projRes.data) setProjects(projRes.data);
        if (batchRes.data) setBatches(batchRes.data);
        if (reqData) setRequests(reqData);
      } catch (err: any) {
        console.error("Failed to load operations data:", err);
        toast.error("Failed to load operations data");
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const reqData = await fetchAllResolutionRequests();
      setRequests(reqData || []);
      toast.success("Requests refreshed");
    } catch (e: any) {
      toast.error("Failed to refresh requests");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleForwardToCS(req: ResolutionRequest) {
    try {
      const forwarder = { name: currentUserName, role: currentUserRole };
      const updated = await forwardRequestToCSTeam(req.id, req.batch_id, forwarder);
      setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success("Request forwarded to CS Team for student outreach and placement approval!");
    } catch (e: any) {
      console.error("Failed to forward request to CS:", e);
      toast.error(e.message || "Failed to forward request to CS Team");
    }
  }

  // Lookup Maps
  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    projects.forEach((p) => map.set(p.id, p));
    return map;
  }, [projects]);

  const batchMap = useMemo(() => {
    const map = new Map<string, Batch>();
    batches.forEach((b) => map.set(b.id, b));
    return map;
  }, [batches]);

  // Status update prompt handler (opens Decision & Reply modal)
  const handlePromptStatusUpdate = (req: ResolutionRequest, newStatus: ResolutionRequestStatus) => {
    if ((newStatus === "approved" || newStatus === "rejected") && !canApprove) {
      toast.error("Requires Lab Manager or Administration approval.");
      return;
    }
    if ((newStatus === "contacted" || newStatus === "resolved") && !canUpdateCS) {
      toast.error("Requires Operations or CS Team permissions.");
      return;
    }
    setSelectedRequestForDecision(req);
    setDecisionTargetStatus(newStatus);
    setDecisionModalOpen(true);
  };

  const handleConfirmDecision = async (comment: string) => {
    if (!selectedRequestForDecision || !decisionTargetStatus) return;
    setSubmittingDecision(true);
    try {
      const reviewer = { name: currentUserName, role: currentUserRole };
      const updated = await updateBatchResolutionRequestStatus(
        selectedRequestForDecision.id,
        selectedRequestForDecision.batch_id,
        decisionTargetStatus,
        reviewer,
        comment
      );

      setRequests((prev) =>
        prev.map((r) => (r.id === updated.id ? updated : r))
      );

      const isOverride = selectedRequestForDecision.status !== "pending" && selectedRequestForDecision.status !== decisionTargetStatus;
      if (isOverride) {
        toast.success(`Request status overridden to "${decisionTargetStatus.toUpperCase()}"!`);
      } else {
        toast.success(`Request marked as "${decisionTargetStatus.toUpperCase()}"!`);
      }
      setDecisionModalOpen(false);

      // Audit Trail Logging
      const actionType: AuditActionType =
        decisionTargetStatus === "approved"
          ? "APPROVE"
          : decisionTargetStatus === "rejected"
          ? "REJECT"
          : decisionTargetStatus === "resolved"
          ? "RESOLVE"
          : "STATUS_CHANGE";

      logAuditAction({
        userId: user?.id,
        userName: currentUserName,
        userEmail: user?.email,
        userRole: currentUserRole,
        tab: "Operation Requests",
        section: "Decision Dialog",
        actionType,
        actionTitle: `${actionType === "APPROVE" ? "Approved" : actionType === "REJECT" ? "Rejected" : "Updated"} operation request (${selectedRequestForDecision.type}) for ${selectedRequestForDecision.area || "batch"}`,
        entityType: "resolution_request",
        entityId: selectedRequestForDecision.id,
        projectId: selectedRequestForDecision.project_id,
        batchId: selectedRequestForDecision.batch_id,
        oldValue: {
          status: selectedRequestForDecision.status,
          reviewer_comment: selectedRequestForDecision.reviewer_comment,
          overrides: (selectedRequestForDecision as any).overrides,
        },
        newValue: {
          status: decisionTargetStatus,
          reviewer_comment: comment,
          overrides: (updated as any)?.overrides,
        },
        metadata: {
          isOverride,
          comment,
        },
        isRestorable: true,
      });
    } catch (e: any) {
      toast.error(e.message || "Failed to update status");
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleDelete = async (id: string, batchId: string) => {
    const targetReq = requests.find((r) => r.id === id);
    try {
      await deleteBatchResolutionRequest(id, batchId);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      toast.info("Request removed");

      // Audit Trail Log
      logAuditAction({
        userId: user?.id,
        userName: currentUserName,
        userEmail: user?.email,
        userRole: currentUserRole,
        tab: "Operation Requests",
        section: "Operation Requests Table",
        actionType: "DELETE",
        actionTitle: `Deleted operation request ${id}`,
        entityType: "resolution_request",
        entityId: id,
        batchId,
        oldValue: targetReq || null,
        newValue: null,
        isRestorable: false,
      });
    } catch (e: any) {
      toast.error("Failed to remove request");
    }
  };

  // Filtered & Searched Tickets
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      // Status Filter
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      // Type Filter
      if (typeFilter !== "ALL" && r.type !== typeFilter) return false;
      // Project Filter
      if (projectFilter !== "ALL") {
        const batch = batchMap.get(r.batch_id);
        const resolvedProjId = r.project_id || batch?.project_id;
        if (resolvedProjId !== projectFilter) return false;
      }
      // Batch Filter
      if (batchFilter !== "ALL" && r.batch_id !== batchFilter) return false;

      // Search Query
      if (search.trim()) {
        const q = search.toLowerCase();
        const batch = batchMap.get(r.batch_id);
        const proj = projectMap.get(r.project_id || batch?.project_id || "");
        const matchArea = r.area?.toLowerCase().includes(q);
        const matchLab = r.lab_id?.toLowerCase().includes(q) || r.suggested_nearest_lab?.toLowerCase().includes(q);
        const matchType = r.type?.toLowerCase().includes(q);
        const matchReason = r.reason?.toLowerCase().includes(q) || r.notes?.toLowerCase().includes(q);
        const matchSubmitter = r.submitted_by_name?.toLowerCase().includes(q);
        const matchReviewer = r.reviewed_by_name?.toLowerCase().includes(q);
        const matchProj = proj?.name?.toLowerCase().includes(q) || proj?.code?.toLowerCase().includes(q);
        const matchBatch = batch?.name?.toLowerCase().includes(q);

        if (
          !matchArea &&
          !matchLab &&
          !matchType &&
          !matchReason &&
          !matchSubmitter &&
          !matchReviewer &&
          !matchProj &&
          !matchBatch
        ) {
          return false;
        }
      }

      return true;
    });
  }, [requests, statusFilter, typeFilter, projectFilter, batchFilter, search, batchMap, projectMap]);

  // Statistics
  const stats = useMemo(() => {
    const total = requests.length;
    const pending = requests.filter((r) => r.status === "pending").length;
    const approved = requests.filter((r) => r.status === "approved").length;
    const rejected = requests.filter((r) => r.status === "rejected").length;
    const csActive = requests.filter((r) => r.type === "cs_outreach" && (r.status === "approved" || r.status === "contacted")).length;
    const resolved = requests.filter((r) => r.status === "resolved").length;

    return { total, pending, approved, rejected, csActive, resolved };
  }, [requests]);

  // Format Helper for Project Duration
  const formatDuration = (start?: string | null, end?: string | null) => {
    if (!start && !end) return "No fixed dates";
    const s = start ? new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD";
    const e = end ? new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD";
    return `${s} – ${e}`;
  };

  // Format Helper for Request Date
  const formatRequestDate = (dateStr?: string) => {
    if (!dateStr) return "Just now";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-4xl p-6 sm:p-10">
        <Card className="border-destructive/30 bg-destructive/5 text-center p-8">
          <CardHeader className="space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
              <Lock className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl font-bold">Access Restricted</CardTitle>
            <CardDescription className="text-sm">
              The <strong>Operation Requests</strong> queue is reserved for <strong>Lab Managers</strong> and <strong>Administrators</strong> to review and approve capacity &amp; venue tickets.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Link to="/dashboard">
              <Button variant="outline" className="gap-2">
                Return to Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandIcon name="flags" size={26} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Operation Requests</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Review, authorize, and manage capacity shortfall tickets raised during batch allocation across all projects.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="h-9 text-xs gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Link to="/lab-allocation">
            <Button size="sm" className="h-9 text-xs font-semibold gap-1.5 shadow-xs">
              Go to Lab Allocation
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Role-Scoped Context & Notification Banners */}
      {isOperationsOnly ? (
        <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-blue-900 dark:text-blue-200">
          <div className="flex items-center gap-2.5">
            <BrandIcon name="flags" size={18} />
            <span>
              <strong>Operations Team View:</strong> Read-only view of Lab Manager decisions &amp; audit history. For approved requests, click <strong>"Go to Batch"</strong> to view or re-run allocation for that batch.
            </span>
          </div>
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={markAllAsSeen}
              className="h-7 text-xs bg-background shrink-0 border-blue-300 dark:border-blue-700"
            >
              Mark All as Read ({unreadCount})
            </Button>
          )}
        </div>
      ) : canApprove && unreadCount > 0 ? (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              You have <strong>{unreadCount} pending request(s)</strong> awaiting Lab Manager sign-off.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={markAllAsSeen}
            className="h-7 text-xs bg-background shrink-0 border-amber-300 dark:border-amber-700"
          >
            Acknowledge All
          </Button>
        </div>
      ) : null}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3.5 bg-card shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-primary" /> Total Tickets
          </div>
          <div className="text-xl font-bold text-foreground mt-1">{stats.total}</div>
          <div className="text-[10px] text-muted-foreground">Across all batches</div>
        </Card>

        <Card className="p-3.5 bg-card shadow-xs border-amber-500/30 bg-amber-500/5">
          <div className="text-[11px] font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-600" /> Pending Sign-off
          </div>
          <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{stats.pending}</div>
          <div className="text-[10px] text-muted-foreground">Awaiting Lab Manager</div>
        </Card>

        <Card className="p-3.5 bg-card shadow-xs border-[#056FEC]/30 bg-[#056FEC]/5">
          <div className="text-[11px] font-medium text-[#056FEC] dark:text-[#05ACFF] flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#056FEC]" /> Approved
          </div>
          <div className="text-xl font-bold text-[#056FEC] dark:text-[#05ACFF] mt-1">{stats.approved}</div>
          <div className="text-[10px] text-muted-foreground">Active in pipeline</div>
        </Card>

        <Card className="p-3.5 bg-card shadow-xs border-purple-500/30 bg-purple-500/5">
          <div className="text-[11px] font-medium text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
            <PhoneCall className="h-3.5 w-3.5 text-purple-600" /> CS Outreach
          </div>
          <div className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">{stats.csActive}</div>
          <div className="text-[10px] text-muted-foreground">Assigned to CS team</div>
        </Card>

        <Card className="p-3.5 bg-card shadow-xs">
          <div className="text-[11px] font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-blue-600" /> Resolved
          </div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{stats.resolved}</div>
          <div className="text-[10px] text-muted-foreground">Reassigned / closed</div>
        </Card>

        <Card className="p-3.5 bg-card shadow-xs">
          <div className="text-[11px] font-medium text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
            <X className="h-3.5 w-3.5 text-rose-600" /> Rejected
          </div>
          <div className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1">{stats.rejected}</div>
          <div className="text-[10px] text-muted-foreground">Not approved</div>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="p-4 bg-card shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search area, lab, user, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-xs"
            />
          </div>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Statuses ({requests.length})</SelectItem>
              <SelectItem value="pending" className="text-xs">Pending Review ({stats.pending})</SelectItem>
              <SelectItem value="approved" className="text-xs">Approved ({stats.approved})</SelectItem>
              <SelectItem value="contacted" className="text-xs">CS Contacted</SelectItem>
              <SelectItem value="resolved" className="text-xs">CS Resolved ({stats.resolved})</SelectItem>
              <SelectItem value="rejected" className="text-xs">Rejected ({stats.rejected})</SelectItem>
            </SelectContent>
          </Select>

          {/* Type Filter */}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="All Request Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Request Types</SelectItem>
              <SelectItem value="overfill" className="text-xs">⚡ Fair Overfill</SelectItem>
              <SelectItem value="new_lab" className="text-xs">🏢 Request New Lab</SelectItem>
              <SelectItem value="cs_outreach" className="text-xs">📞 CS Reassignment</SelectItem>
              <SelectItem value="nearby_lab" className="text-xs">Nearby Existing Lab</SelectItem>
              <SelectItem value="cs_reallocation" className="text-xs">🏢 CS Lab Reallocation</SelectItem>
            </SelectContent>
          </Select>

          {/* Project Filter */}
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.code ? `[${p.code}] ` : ""}{p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Batch Filter */}
          <Select value={batchFilter} onValueChange={setBatchFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="All Batches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All Batches</SelectItem>
              {batches.map((b) => (
                <SelectItem key={b.id} value={b.id} className="text-xs">
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active Filters count */}
        {(statusFilter !== "ALL" || typeFilter !== "ALL" || projectFilter !== "ALL" || batchFilter !== "ALL" || search.trim()) && (
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
            <span>
              Showing <strong>{filteredRequests.length}</strong> of <strong>{requests.length}</strong> tickets
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-primary hover:text-primary/80 px-2"
              onClick={() => {
                setStatusFilter("ALL");
                setTypeFilter("ALL");
                setProjectFilter("ALL");
                setBatchFilter("ALL");
                setSearch("");
              }}
            >
              Reset Filters
            </Button>
          </div>
        )}
      </Card>

      {/* Main Table */}
      <Card className="shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
            <span>Loading operation tickets across all batches...</span>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Layers className="h-10 w-10 mx-auto text-muted-foreground/60" />
            <div className="text-base font-semibold text-foreground">No Operation Requests Found</div>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              No tickets match the selected filters. When Operations raises shortfall requests in Lab Allocation, they will appear here for Lab Manager approval.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs font-bold w-[170px]">Project &amp; Duration</TableHead>
                  <TableHead className="text-xs font-bold w-[140px]">Batch</TableHead>
                  <TableHead className="text-xs font-bold w-[140px]">Request Type</TableHead>
                  <TableHead className="text-xs font-bold w-[130px]">Area</TableHead>
                  <TableHead className="text-xs font-bold min-w-[200px]">Target Lab / Extra Capacity</TableHead>
                  <TableHead className="text-xs font-bold w-[110px]">Status</TableHead>
                  <TableHead className="text-xs font-bold w-[160px]">Submitter / Reviewer</TableHead>
                  <TableHead className="text-xs font-bold text-right w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.map((req) => {
                  const batch = batchMap.get(req.batch_id);
                  const project = projectMap.get(req.project_id || batch?.project_id || "");

                  return (
                    <TableRow key={req.id} className="hover:bg-muted/20 text-xs transition-colors">
                      {/* 1. Project & Duration */}
                      <TableCell className="align-top py-3.5">
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                          <FolderKanban className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span>{project?.name || req.project_id || "Unlinked Project"}</span>
                        </div>
                        {project?.code && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            Code: {project.code}
                          </span>
                        )}
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
                          <Calendar className="h-3 w-3 shrink-0" />
                          <span>{formatDuration(project?.start_date, project?.end_date)}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                          Requested: {formatRequestDate(req.created_at)}
                        </div>
                      </TableCell>

                      {/* 2. Batch */}
                      <TableCell className="align-top py-3.5">
                        <Badge variant="outline" className="text-[11px] font-medium bg-muted/30">
                          {batch?.name || req.batch_id}
                        </Badge>
                      </TableCell>

                      {/* 3. Request Type */}
                      <TableCell className="align-top py-3.5">
                        {req.type === "overfill" && (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[11px] font-semibold">
                            ⚡ Fair Overfill
                          </Badge>
                        )}
                        {req.type === "new_lab" && (
                          <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 text-[11px] font-semibold">
                            🏢 Request New Lab
                          </Badge>
                        )}
                        {req.type === "nearby_lab" && (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[11px] font-semibold">
                            Nearby Existing Lab
                          </Badge>
                        )}
                        {req.type === "cs_outreach" && (
                          <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 text-[11px] font-semibold">
                            📞 CS Reassignment
                          </Badge>
                        )}
                        {req.type === "cs_reallocation" && (
                          <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 text-[11px] font-semibold">
                            🏢 CS Lab Reallocation
                          </Badge>
                        )}
                      </TableCell>

                      {/* 4. Area */}
                      <TableCell className="align-top py-3.5">
                        <div className="font-semibold text-foreground flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span>{req.area}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-medium">
                          {req.grades && req.grades.length === 3
                            ? "All Grades in Area (4, 5, 6)"
                            : req.grades && req.grades.length > 0
                            ? req.grades.map((grade) => formatGradeLevel(grade)).join(", ")
                            : "All Grades"}
                        </div>
                        {Boolean(req.unassigned_count) && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                            {req.unassigned_count} unassigned in scope
                          </div>
                        )}
                      </TableCell>

                      {/* 5. Target Lab / Extra Capacity */}
                      <TableCell className="align-top py-3.5">
                        {req.type === "overfill" && (
                          <div className="space-y-1">
                            <div className="font-semibold text-foreground">
                              Target: <span className="font-mono">{req.lab_id || "All Labs in Area"}</span>
                            </div>
                            <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                              Extra Density: +{req.max_overfill_per_lab || 2} seats/slot (~+{Number(req.max_overfill_per_lab || 2) * 7} weekly)
                            </div>
                            {req.notes && <div className="text-[10px] text-muted-foreground italic">{req.notes}</div>}
                          </div>
                        )}

                        {req.type === "new_lab" && (
                          <div className="space-y-1">
                            <div className="font-semibold text-foreground">
                              Requested Venue: <span className="text-blue-600 dark:text-blue-400 font-bold">{req.requested_capacity || 25} Seats</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Reason: {req.reason || "Shortfall deficit in area"}
                            </div>
                          </div>
                        )}

                        {req.type === "nearby_lab" && (
                          <div className="space-y-1">
                            <div className="font-semibold text-foreground">Requested Lab: <span className="text-emerald-700 dark:text-emerald-300">{req.nearby_lab_metadata?.lab_name || req.suggested_nearest_lab || req.lab_id}</span></div>
                            <div className="text-[11px] text-muted-foreground">{req.area} → {req.nearby_lab_metadata?.destination_area || req.suggested_nearest_area} · {req.nearby_lab_metadata?.distance_km != null ? `${req.nearby_lab_metadata.distance_km} km · ` : ""}{req.nearby_lab_metadata?.capacity || req.requested_capacity} seats · {req.nearby_lab_metadata?.required_sessions?.length || 0} sessions</div>
                          </div>
                        )}

                        {req.type === "cs_outreach" && (
                          <div className="space-y-1">
                            <div className="font-semibold text-foreground">
                              Nearest Lab: <span className="text-purple-600 dark:text-purple-400 font-bold">{req.suggested_nearest_lab || "Nearest with Capacity"}</span>
                            </div>
                            {req.notes && <div className="text-[10px] text-muted-foreground italic">Script: {req.notes}</div>}
                          </div>
                        )}

                        {req.type === "cs_reallocation" && (
                          <div className="space-y-1">
                            <div className="font-semibold text-foreground">
                              Target Lab: <span className="text-purple-600 dark:text-purple-400 font-bold">{req.suggested_nearest_lab || req.lab_id}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                              <span>Area: {req.suggested_nearest_area || req.area}</span>
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1 py-0 font-semibold ${
                                  req.target_team === "CS Team" || req.forwarded_to_cs
                                    ? "text-purple-700 bg-purple-50 dark:bg-purple-950/40 border-purple-300"
                                    : "text-blue-700 bg-blue-50 dark:bg-blue-950/40 border-blue-300"
                                }`}
                              >
                                {req.target_team === "CS Team" || req.forwarded_to_cs ? "CS Team" : "Event Team"}
                              </Badge>
                              {req.reallocation_students && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 text-purple-700 bg-purple-50 border-purple-200">
                                  {req.reallocation_students.filter((s) => s.status === "approved").length}/{req.reallocation_students.length} Approved
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                      </TableCell>

                      {/* 6. Status Badge */}
                      <TableCell className="align-top py-3.5">
                        <Badge
                          className={`text-[10px] uppercase font-bold ${
                            req.status === "resolved"
                              ? "bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/30"
                              : req.status === "approved"
                              ? req.type !== "cs_outreach" && !req.solver_rerun_at
                                ? "bg-[#FF7F1C]/20 text-[#FF7F1C] border-[#FF7F1C]/40 animate-pulse"
                                : "bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/30"
                              : req.status === "rejected"
                              ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                              : req.status === "contacted"
                              ? "bg-blue-500/15 text-blue-600 border-blue-500/30"
                              : req.target_team === "CS Team" || req.forwarded_to_cs
                              ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30"
                              : "bg-amber-500/15 text-amber-600 border-amber-500/30"
                          }`}
                        >
                          {req.status === "approved" && req.type !== "cs_outreach" && !req.solver_rerun_at
                            ? "Approved • Re-run Needed"
                            : req.status === "approved" && req.type !== "cs_outreach" && req.solver_rerun_at
                            ? "Approved • Re-run Done"
                            : req.status === "pending" && (req.target_team === "CS Team" || req.forwarded_to_cs)
                            ? "CS Team Review"
                            : req.status}
                        </Badge>
                      </TableCell>

                      {/* 7. Submitter & Reviewer Audit Trail with Overrides & Reply Notes */}
                      <TableCell className="align-top py-3.5">
                        <RequestAuditHistory request={req} />
                      </TableCell>

                      {/* 8. Action Buttons */}
                      <TableCell className="align-top py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {((req.type as string) === "cs_reallocation" || (req.reallocation_students && req.reallocation_students.length > 0)) && (
                            <>
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-[11px] font-bold gap-1 bg-purple-600 hover:bg-purple-700 text-white shadow-xs px-2.5"
                                onClick={() => {
                                  setSelectedRequestForReallocation(req);
                                  setReallocationModalOpen(true);
                                }}
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                Review Students ({req.reallocation_students?.length || req.unassigned_count || 0})
                              </Button>

                              {req.target_team !== "CS Team" && !req.forwarded_to_cs && req.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px] font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-500/10 border-purple-500/30 px-2 gap-1 shadow-2xs"
                                  title="Forward review responsibility to Customer Success (CS) Team"
                                  onClick={() => handleForwardToCS(req)}
                                >
                                  <Send className="h-3 w-3 text-purple-600 dark:text-purple-400" /> Forward to CS Team
                                </Button>
                              )}
                            </>
                          )}

                          {canApprove && req.type !== "cs_reallocation" ? (
                            /* Lab Manager & Admin Action Controls for Solver Tickets (Overfill & New Lab) */
                            req.target_team === "Event Team" ? (
                              req.status === "pending" ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 border-amber-500/30 px-2 gap-1 shadow-2xs"
                                    title="Preview simulation impact before approving (zero persistence)"
                                    onClick={() => {
                                      setSelectedRequestForPreview(req);
                                      setPreviewModalOpen(true);
                                    }}
                                  >
                                    <FlaskConical className="h-3 w-3 text-amber-600 dark:text-amber-400" /> Preview Impact
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] text-[#056FEC] hover:bg-[#056FEC]/10 border-[#056FEC]/30 px-2"
                                    onClick={() => handlePromptStatusUpdate(req, "approved")}
                                  >
                                    <Check className="h-3 w-3 mr-1" /> Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-500/30 px-2"
                                    onClick={() => handlePromptStatusUpdate(req, "rejected")}
                                  >
                                    <X className="h-3 w-3 mr-1" /> Reject
                                  </Button>
                                </>
                              ) : req.status === "approved" ? (
                                <>
                                  {canAccessLabAllocation ? (
                                    <Link
                                      to="/lab-allocation"
                                      search={{
                                        projectId: req.project_id || project?.id,
                                        batchId: req.batch_id,
                                        openResolve: true,
                                        resolveAction: req.type,
                                        requestId: req.id,
                                        area: req.area,
                                      }}
                                      onClick={() => markRequestAsSeen(req.id, req.status)}
                                    >
                                      <Button
                                        size="sm"
                                        variant="default"
                                        className="h-7 text-[11px] font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs px-2.5"
                                        title={`Direct deep-link to ${req.type === "overfill" ? "Fair Overfill" : "New Lab"} resolution pre-scoped to ${req.area}`}
                                      >
                                        <Sparkles className="h-3 w-3" /> Resolve in Lab Allocation
                                      </Button>
                                    </Link>
                                  ) : req.type === "new_lab" ? (
                                    <Link
                                      to="/lab-data"
                                      search={{ area: req.area }}
                                      onClick={() => markRequestAsSeen(req.id, req.status)}
                                    >
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px] font-semibold gap-1 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-950/40 px-2.5"
                                        title={`View physical lab venues for ${req.area} in Lab Data`}
                                      >
                                        <Building2 className="h-3 w-3" /> View Labs in {req.area}
                                      </Button>
                                    </Link>
                                  ) : null}

                                  {req.solver_rerun_at ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[11px] text-primary hover:bg-primary/10 border-primary/30 px-2"
                                      onClick={() => handlePromptStatusUpdate(req, "resolved")}
                                    >
                                      <Check className="h-3 w-3 mr-1" /> Mark Resolved
                                    </Button>
                                  ) : (
                                    <div
                                      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/70 border px-2 py-1 rounded cursor-not-allowed"
                                      title="Re-run the solver in Lab Allocation before resolving this ticket."
                                    >
                                      <Lock className="h-3 w-3 text-muted-foreground" />
                                      <span>Re-run needed to resolve</span>
                                    </div>
                                  )}

                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-[10px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 px-1.5"
                                    onClick={() => handlePromptStatusUpdate(req, "rejected")}
                                    title="Override Decision (Reject)"
                                  >
                                    <X className="h-3 w-3 mr-0.5" /> Override: Reject
                                  </Button>
                                </>
                              ) : req.status === "rejected" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px] text-[#056FEC] hover:bg-[#056FEC]/10 border-[#056FEC]/30 px-2"
                                  onClick={() => handlePromptStatusUpdate(req, "approved")}
                                  title="Override Decision (Approve)"
                                >
                                  <Check className="h-3 w-3 mr-1" /> Override: Approve
                                </Button>
                              ) : req.status === "resolved" ? (
                                <div className="flex items-center gap-1">
                                  <span className="inline-flex items-center gap-1 text-[11px] text-[#056FEC] dark:text-[#05ACFF] font-semibold px-2 py-0.5">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 text-[10px] text-muted-foreground hover:text-primary px-1.5"
                                    onClick={() => handlePromptStatusUpdate(req, "approved")}
                                    title="Reopen or Override Status"
                                  >
                                    Reopen
                                  </Button>
                                </div>
                              ) : null
                            ) : (
                              /* CS Team (CS Reassignment) - Requires LM approval first */
                              req.status === "pending" ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] text-[#056FEC] hover:bg-[#056FEC]/10 border-[#056FEC]/30 px-2"
                                    onClick={() => handlePromptStatusUpdate(req, "approved")}
                                  >
                                    <Check className="h-3 w-3 mr-1" /> Approve for CS
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-500/30 px-2"
                                    onClick={() => handlePromptStatusUpdate(req, "rejected")}
                                  >
                                    <X className="h-3 w-3 mr-1" /> Reject
                                  </Button>
                                </>
                              ) : (
                                /* CS Reassignment approved/contacted/resolved */
                                <>
                                  {req.status !== "contacted" && req.status !== "resolved" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[11px] text-blue-600 hover:bg-blue-50 border-blue-500/30 px-2"
                                      onClick={() => handlePromptStatusUpdate(req, "contacted")}
                                    >
                                      Mark Contacted
                                    </Button>
                                  )}
                                  {req.status !== "resolved" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[11px] text-purple-600 hover:bg-purple-50 border-purple-500/30 px-2"
                                      onClick={() => handlePromptStatusUpdate(req, "resolved")}
                                    >
                                      Mark Resolved
                                    </Button>
                                  )}
                                  {req.status !== "rejected" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-[10px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-1.5"
                                      onClick={() => handlePromptStatusUpdate(req, "rejected")}
                                      title="Override Decision (Reject)"
                                    >
                                      <X className="h-3 w-3 mr-0.5" /> Override: Reject
                                    </Button>
                                  )}
                                </>
                              )
                            )
                          ) : (
                            /* Operations Team View (Read-only + Deep Link to Batch) */
                            <>
                              {req.status === "approved" ? (
                                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                  {canAccessLabAllocation ? (
                                    <Link
                                      to="/lab-allocation"
                                      search={{
                                        projectId: req.project_id || project?.id,
                                        batchId: req.batch_id,
                                        openResolve: true,
                                        resolveAction: req.type,
                                        requestId: req.id,
                                        area: req.area,
                                      }}
                                      onClick={() => markRequestAsSeen(req.id, req.status)}
                                    >
                                      <Button
                                        size="sm"
                                        variant="default"
                                        className="h-7 text-[11px] font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs px-2.5"
                                        title={`Direct deep-link to ${req.type === "overfill" ? "Fair Overfill" : req.type === "new_lab" ? "New Lab" : "Active Requests"} pre-scoped for ${req.area}`}
                                      >
                                        <Sparkles className="h-3 w-3" /> Resolve in Lab Allocation
                                      </Button>
                                    </Link>
                                  ) : req.type === "new_lab" ? (
                                    <Link
                                      to="/lab-data"
                                      search={{ area: req.area }}
                                      onClick={() => markRequestAsSeen(req.id, req.status)}
                                    >
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px] font-semibold gap-1 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-950/40 px-2.5"
                                      >
                                        <Building2 className="h-3 w-3" /> View Labs in {req.area}
                                      </Button>
                                    </Link>
                                  ) : null}

                                  {req.type === "cs_outreach" && canUpdateCS && (
                                    <>
                                      {(req.status as string) !== "contacted" && (req.status as string) !== "resolved" && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 text-[11px] text-blue-600 hover:bg-blue-50 border-blue-500/30 px-2"
                                          onClick={() => handlePromptStatusUpdate(req, "contacted")}
                                        >
                                          Mark Contacted
                                        </Button>
                                      )}
                                      {(req.status as string) !== "resolved" && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 text-[11px] text-purple-600 hover:bg-purple-50 border-purple-500/30 px-2"
                                          onClick={() => handlePromptStatusUpdate(req, "resolved")}
                                        >
                                          Mark Resolved
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </div>
                              ) : req.status === "pending" ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 gap-1 font-medium py-1"
                                >
                                  <Clock className="h-3 w-3 text-amber-600" /> Awaiting LM Review
                                </Badge>
                              ) : req.status === "rejected" ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 gap-1 font-medium py-1"
                                >
                                  <X className="h-3 w-3 text-rose-600" /> Rejected by LM
                                </Badge>
                              ) : req.status === "resolved" ? (
                                <Badge className="text-[10px] bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/30 gap-1 font-semibold py-1">
                                  <CheckCircle2 className="h-3 w-3 text-[#056FEC]" /> Resolved
                                </Badge>
                              ) : req.status === "contacted" ? (
                                <div className="flex items-center gap-1.5">
                                  <Badge className="text-[10px] bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 gap-1 font-semibold py-1">
                                    <PhoneCall className="h-3 w-3 text-blue-600" /> Contacted
                                  </Badge>
                                  {canUpdateCS && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-[11px] text-purple-600 hover:bg-purple-50 border-purple-500/30 px-2"
                                      onClick={() => handlePromptStatusUpdate(req, "resolved")}
                                    >
                                      Mark Resolved
                                    </Button>
                                  )}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Decision & Reply Dialog */}
      <RequestDecisionDialog
        open={decisionModalOpen}
        onOpenChange={setDecisionModalOpen}
        request={selectedRequestForDecision}
        targetStatus={decisionTargetStatus}
        onConfirm={handleConfirmDecision}
        loading={submittingDecision}
      />

      {/* Lab Manager Impact Preview Dialog (Zero Persistence) */}
      <RequestImpactPreviewDialog
        open={previewModalOpen}
        onOpenChange={setPreviewModalOpen}
        request={selectedRequestForPreview}
        batchName={selectedRequestForPreview ? batchMap.get(selectedRequestForPreview.batch_id)?.name : undefined}
        projectName={selectedRequestForPreview && selectedRequestForPreview.project_id ? projectMap.get(selectedRequestForPreview.project_id)?.name : undefined}
        onRequestApprove={(req) => handlePromptStatusUpdate(req, "approved")}
        onRequestReject={(req) => handlePromptStatusUpdate(req, "rejected")}
        canApprove={canApprove}
      />

      {/* CS Reallocation Student-Level Review & Action Dialog */}
      <CSReallocationReviewDialog
        open={reallocationModalOpen}
        onOpenChange={setReallocationModalOpen}
        request={selectedRequestForReallocation}
        onUpdateRequest={(updated) => {
          setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          setSelectedRequestForReallocation(updated);
        }}
        onReallocationApplied={handleRefresh}
      />
    </div>
  );
}
