import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SlidersHorizontal,
  Plus,
  Trash2,
  Sparkles,
  Users,
  Building2,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Send,
  PhoneCall,
  Clock,
  Check,
  X,
  Layers,
  ArrowRight,
  ShieldCheck,
  Headphones,
  Lock,
  RefreshCw,
  FlaskConical,
  Eye,
  Info,
  TrendingUp,
  CheckCheck,
  UserCheck,
  Search,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth, ROLE_LABELS, type AppRole } from "@/hooks/useAuth";
import type {
  AllocationPreferences,
  AllocationResultPayload,
  AllocationSummary,
  AreaGradeSummaryRow,
  LabPivotRow,
  OverfillRule,
  ExtraLabDefinition,
} from "@/lib/allocation-client";
import {
  saveBatchResolutionRequest,
  updateBatchResolutionRequestStatus,
  deleteBatchResolutionRequest,
  markBatchRequestsSolverRerun,
  fetchBatchAllocationOutput,
  type ResolutionRequest,
  type ResolutionRequestType,
  type ResolutionRequestStatus,
} from "@/lib/batch-allocation-storage";
import { RequestAuditHistory } from "@/components/RequestAuditHistory";
import { RequestDecisionDialog } from "@/components/RequestDecisionDialog";
import { CSReallocationReviewDialog } from "@/components/CSReallocationReviewDialog";
import { GovFreeLabsModal } from "@/components/GovFreeLabsModal";
import { formatGradeLevel, sortGradeLevels } from "@/lib/project-grade-levels";

interface ResolveUnassignedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchName?: string;
  projectId?: string | null;
  areaGradeSummary: AreaGradeSummaryRow[];
  labPivot: LabPivotRow[];
  requests: ResolutionRequest[];
  onRequestsChange: (updated: ResolutionRequest[]) => void;
  onApplyApprovedRules: (prefs: AllocationPreferences) => Promise<void>;
  loading?: boolean;
  onPreviewImpact?: (prefs: AllocationPreferences, targetBatchId?: string) => Promise<AllocationResultPayload>;
  baselineSummary?: AllocationSummary;
  preferencesApplied?: AllocationPreferences;
  initialTab?: "overfill" | "nearby_lab" | "new_lab" | "cs_outreach" | "active_requests";
  targetRequestId?: string;
  targetArea?: string;
  targetGrades?: number[];
  targetLabId?: string;
  targetMaxOverfill?: number;
}

function parseGrades(g: unknown): number[] {
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
}

export function ResolveUnassignedDialog({
  open,
  onOpenChange,
  batchId,
  batchName = "Current Batch",
  projectId,
  areaGradeSummary,
  labPivot,
  requests,
  onRequestsChange,
  onApplyApprovedRules,
  loading = false,
  onPreviewImpact,
  baselineSummary,
  preferencesApplied,
  initialTab,
  targetRequestId,
  targetArea,
  targetGrades,
  targetLabId,
  targetMaxOverfill,
}: ResolveUnassignedDialogProps) {
  const { user, roles, hasAnyRole, isAdmin } = useAuth();

  // Role Permissions aligned with System Permission Matrix
  const canSubmit = hasAnyRole(["operations", "administration", "lab_manager"]);
  const canApprove = hasAnyRole(["lab_manager", "administration"]);
  const canUpdateCS = hasAnyRole(["operations", "administration"]);

  // User identity for tracking submitters & reviewers
  const currentUserName = (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "User";
  const currentUserRole = roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "Viewer";

  const [activeTab, setActiveTab] = useState<"overfill" | "nearby_lab" | "new_lab" | "cs_outreach" | "active_requests">("overfill");
  const [nearbyArea, setNearbyArea] = useState("");
  const [nearbyModalOpen, setNearbyModalOpen] = useState(false);

  // Filter for Active Requests tab
  const [requestFilter, setRequestFilter] = useState<"all" | "event" | "cs">("all");

  // Decision & Reply Dialog State
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [selectedRequestForDecision, setSelectedRequestForDecision] = useState<ResolutionRequest | null>(null);
  const [decisionTargetStatus, setDecisionTargetStatus] = useState<ResolutionRequestStatus | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // CS Reallocation Student-Level Review State
  const [reallocationModalOpen, setReallocationModalOpen] = useState(false);
  const [selectedRequestForReallocation, setSelectedRequestForReallocation] = useState<ResolutionRequest | null>(null);

  // Live Baseline Output State (Refreshed directly from batch storage to avoid stale parent snapshots)
  const [liveBaselineOutput, setLiveBaselineOutput] = useState<AllocationResultPayload | null>(null);

  // Fetch live batch baseline directly from authoritative storage
  const fetchLiveBaseline = useCallback(async () => {
    if (!batchId || batchId === "ALL") return null;
    try {
      const output = await fetchBatchAllocationOutput(batchId);
      if (output && output.summary) {
        setLiveBaselineOutput(output);
        return output;
      }
    } catch (e) {
      console.warn("Failed to fetch live baseline output for batch:", batchId, e);
    }
    return null;
  }, [batchId]);

  // Preview / Simulation State (Read-only dry run)
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<AllocationResultPayload | null>(null);
  const [previewType, setPreviewType] = useState<"overfill" | "new_lab" | "cs_outreach" | "active_requests" | null>(null);
  const [previewMeta, setPreviewMeta] = useState<any>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Whenever dialog opens, closes, or batchId changes, fully reset preview simulation state to prevent stale data bleed
  useEffect(() => {
    setPreviewResult(null);
    setPreviewType(null);
    setPreviewMeta(null);
    setPreviewError(null);
    if (open && batchId) {
      void fetchLiveBaseline();
    }
  }, [open, batchId, fetchLiveBaseline]);

  // Effective live baseline datasets with fallback to parent props
  const effectiveAreaGradeSummary = useMemo(() => {
    if (liveBaselineOutput?.area_grade_summary && liveBaselineOutput.area_grade_summary.length > 0) {
      return liveBaselineOutput.area_grade_summary;
    }
    return areaGradeSummary;
  }, [liveBaselineOutput, areaGradeSummary]);

  const effectiveBaselineSummary = useMemo(() => {
    if (liveBaselineOutput?.summary) {
      return liveBaselineOutput.summary;
    }
    return baselineSummary;
  }, [liveBaselineOutput, baselineSummary]);

  const effectiveLabPivot = useMemo(() => {
    if (liveBaselineOutput?.lab_pivot && liveBaselineOutput.lab_pivot.length > 0) {
      return liveBaselineOutput.lab_pivot;
    }
    return labPivot;
  }, [liveBaselineOutput, labPivot]);

  // All unique areas from live data
  const uniqueAreas = useMemo(() => {
    const set = new Set<string>();
    effectiveAreaGradeSummary.forEach((r: any) => {
      const area = r["Physical Area"] || r.area || r.Area;
      if (area) set.add(area);
    });
    effectiveLabPivot.forEach((r: any) => {
      const area = r["Physical Area"] || r.area || r.Area;
      if (area) set.add(area);
    });
    return Array.from(set).sort();
  }, [effectiveAreaGradeSummary, effectiveLabPivot]);

  // Areas with shortfalls
  const shortfallAreas = useMemo(() => {
    const map = new Map<string, number>();
    effectiveAreaGradeSummary.forEach((r: any) => {
      const area = r["Physical Area"] || r.area || r.Area;
      const unassigned = Number(r.Unassigned ?? r.unassigned ?? r.unassigned_count) || 0;
      if (area && unassigned > 0) {
        map.set(area, (map.get(area) || 0) + unassigned);
      }
    });
    return map;
  }, [effectiveAreaGradeSummary]);

  const availableGrades = useMemo(
    () => sortGradeLevels(
      effectiveAreaGradeSummary
        .map((row: any) => Number(row.Grade ?? row.grade))
        .filter(Number.isFinite),
    ),
    [effectiveAreaGradeSummary],
  );

  // Accurate helper: calculate unassigned count scoped to selected area and grades against live baseline
  const getUnassignedCount = (area: string, grades: number[]) => {
    const targetA = String(area || "").trim().toLowerCase();
    return effectiveAreaGradeSummary
      .filter((r: any) => {
        const rowArea = String(r["Physical Area"] || r.area || r.Area || "").trim().toLowerCase();
        const rowGrade = Number(r.Grade ?? r.grade);
        return rowArea === targetA && (grades.length === 0 || grades.includes(rowGrade));
      })
      .reduce((sum: number, r: any) => sum + (Number(r.Unassigned ?? r.unassigned ?? r.unassigned_count) || 0), 0);
  };

  // Resolve linked request from deep-link
  const linkedTargetRequest = useMemo(() => {
    if (!targetRequestId) return null;
    return requests.find((r) => r.id === targetRequestId) || null;
  }, [requests, targetRequestId]);

  // Path 1 Form: Fair Overfill Request
  const [overfillArea, setOverfillArea] = useState<string>(uniqueAreas[0] || "");
  const [overfillGrades, setOverfillGrades] = useState<number[]>(() => availableGrades);
  const [overfillLabId, setOverfillLabId] = useState<string>("ALL");
  const [maxOverfillPerLab, setMaxOverfillPerLab] = useState<number>(2);

  // Path 2 Form: Request New Lab
  const [newLabArea, setNewLabArea] = useState<string>(uniqueAreas[0] || "");
  const [newLabGrades, setNewLabGrades] = useState<number[]>(() => availableGrades);
  const [newLabCapacity, setNewLabCapacity] = useState<number>(25);
  const [newLabReason, setNewLabReason] = useState<string>("");

  // Path 3 Form: CS Outreach
  const [csArea, setCsArea] = useState<string>(uniqueAreas[0] || "");
  const [csGrades, setCsGrades] = useState<number[]>(() => availableGrades);
  const [csNearestLab, setCsNearestLab] = useState<string>("");
  const [csNotes, setCsNotes] = useState<string>("");

  useEffect(() => {
    if (!open || availableGrades.length === 0) return;
    const reconcile = (selected: number[]) => selected.filter((grade) => availableGrades.includes(grade));
    setOverfillGrades((current) => reconcile(current).length ? reconcile(current) : availableGrades);
    setNewLabGrades((current) => reconcile(current).length ? reconcile(current) : availableGrades);
    setCsGrades((current) => reconcile(current).length ? reconcile(current) : availableGrades);
  }, [open, availableGrades]);

  // Ingest deep link props and pre-load linked request into its specific action view
  useEffect(() => {
    if (open) {
      if (linkedTargetRequest) {
        if (linkedTargetRequest.type === "overfill") {
          setActiveTab("overfill");
          if (linkedTargetRequest.area) setOverfillArea(linkedTargetRequest.area);
          const parsedG = parseGrades(linkedTargetRequest.grades);
          if (parsedG.length > 0) setOverfillGrades(parsedG);
          setOverfillLabId(linkedTargetRequest.lab_id || "ALL");
          setMaxOverfillPerLab(Number(linkedTargetRequest.max_overfill_per_lab || 2));
        } else if (linkedTargetRequest.type === "new_lab") {
          setActiveTab("new_lab");
          if (linkedTargetRequest.area) setNewLabArea(linkedTargetRequest.area);
          const parsedG = parseGrades(linkedTargetRequest.grades);
          if (parsedG.length > 0) setNewLabGrades(parsedG);
          setNewLabCapacity(Number(linkedTargetRequest.requested_capacity || 25));
          setNewLabReason(linkedTargetRequest.reason || linkedTargetRequest.notes || "");
        } else if (linkedTargetRequest.type === "cs_outreach") {
          setActiveTab("cs_outreach");
          if (linkedTargetRequest.area) setCsArea(linkedTargetRequest.area);
          const parsedG = parseGrades(linkedTargetRequest.grades);
          if (parsedG.length > 0) setCsGrades(parsedG);
          if (linkedTargetRequest.suggested_nearest_lab) setCsNearestLab(linkedTargetRequest.suggested_nearest_lab);
          setCsNotes(linkedTargetRequest.notes || "");
        }
      } else {
        if (initialTab) {
          setActiveTab(initialTab);
        }
        if (targetArea) {
          setOverfillArea(targetArea);
          setNewLabArea(targetArea);
          setCsArea(targetArea);
        }
        if (targetGrades && targetGrades.length > 0) {
          setOverfillGrades(targetGrades);
          setNewLabGrades(targetGrades);
          setCsGrades(targetGrades);
        }
        if (targetLabId) {
          setOverfillLabId(targetLabId);
        }
        if (targetMaxOverfill) {
          setMaxOverfillPerLab(targetMaxOverfill);
        }
      }
    }
  }, [open, initialTab, targetArea, targetGrades, targetLabId, targetMaxOverfill, linkedTargetRequest]);

  // When area list updates, ensure fallback area is valid
  useEffect(() => {
    if (uniqueAreas.length > 0) {
      if (!overfillArea || !uniqueAreas.includes(overfillArea)) {
        setOverfillArea(uniqueAreas[0]);
      }
      if (!newLabArea || !uniqueAreas.includes(newLabArea)) {
        setNewLabArea(uniqueAreas[0]);
      }
      if (!csArea || !uniqueAreas.includes(csArea)) {
        setCsArea(uniqueAreas[0]);
      }
    }
  }, [uniqueAreas]);

  // Labs in overfill area
  const labsInOverfillArea = useMemo(() => {
    if (!overfillArea) return [];
    const set = new Set<string>();
    const targetA = overfillArea.trim().toLowerCase();
    effectiveLabPivot
      .filter((r: any) => String(r["Physical Area"] || r.area || r.Area || "").trim().toLowerCase() === targetA)
      .forEach((r: any) => {
        const lab = r.Lab_ID || r.lab_id || r.labId;
        if (lab) set.add(lab);
      });
    return Array.from(set).sort();
  }, [effectiveLabPivot, overfillArea]);

  // Available alternative labs across the system for CS Suggestion
  const systemAvailableLabs = useMemo(() => {
    const list: Array<{ labId: string; area: string; label: string }> = [];
    const seen = new Set<string>();
    effectiveLabPivot.forEach((r: any) => {
      const labId = r.Lab_ID || r.lab_id || r.labId;
      const area = r["Physical Area"] || r.area || r.Area || "";
      if (labId && !seen.has(labId)) {
        seen.add(labId);
        list.push({
          labId,
          area,
          label: `${labId} (${area})`,
        });
      }
    });
    return list;
  }, [effectiveLabPivot]);

  // Auto suggest nearest lab for CS tab
  useEffect(() => {
    if (!csNearestLab && systemAvailableLabs.length > 0) {
      const alt = systemAvailableLabs.find((l) => l.area !== csArea) || systemAvailableLabs[0];
      if (alt) setCsNearestLab(alt.label);
    }
  }, [csArea, systemAvailableLabs, csNearestLab]);

  // Baseline metrics from summary or aggregated area grade summary
  const baselineTotalStudents = useMemo(() => {
    if (effectiveBaselineSummary?.total_students) return effectiveBaselineSummary.total_students;
    return effectiveAreaGradeSummary.reduce(
      (sum: number, r: any) => sum + (Number(r.Total_Students ?? r.total_students) || (Number(r.Students_Assigned ?? r.students_assigned ?? r.assigned_count) || 0) + (Number(r.Unassigned ?? r.unassigned ?? r.unassigned_count) || 0)),
      0
    );
  }, [effectiveBaselineSummary, effectiveAreaGradeSummary]);

  const baselineAssigned = useMemo(() => {
    if (effectiveBaselineSummary?.assigned_count !== undefined) return effectiveBaselineSummary.assigned_count;
    return effectiveAreaGradeSummary.reduce((sum: number, r: any) => sum + (Number(r.Students_Assigned ?? r.students_assigned ?? r.assigned_count) || 0), 0);
  }, [effectiveBaselineSummary, effectiveAreaGradeSummary]);

  const baselineUnassigned = useMemo(() => {
    if (effectiveBaselineSummary?.unassigned_count !== undefined) return effectiveBaselineSummary.unassigned_count;
    return effectiveAreaGradeSummary.reduce((sum: number, r: any) => sum + (Number(r.Unassigned ?? r.unassigned ?? r.unassigned_count) || 0), 0);
  }, [effectiveBaselineSummary, effectiveAreaGradeSummary]);

  const getBaselineGradeUnassigned = (area: string, grade: number): number => {
    const targetA = String(area || "").trim().toLowerCase();
    const row = effectiveAreaGradeSummary.find((r: any) => {
      const rowArea = String(r["Physical Area"] || r.area || r.Area || "").trim().toLowerCase();
      const rowGrade = Number(r.Grade ?? r.grade);
      return rowArea === targetA && rowGrade === grade;
    });
    return row ? Number((row as any).Unassigned ?? (row as any).unassigned ?? (row as any).unassigned_count) || 0 : 0;
  };

  const getSimGradeUnassigned = (area: string, grade: number): number => {
    if (!previewResult?.area_grade_summary) return getBaselineGradeUnassigned(area, grade);
    const targetA = String(area || "").trim().toLowerCase();
    const row = previewResult.area_grade_summary.find((r: any) => {
      const rowArea = String(r["Physical Area"] || r.area || r.Area || "").trim().toLowerCase();
      const rowGrade = Number(r.Grade ?? r.grade);
      return rowArea === targetA && rowGrade === grade;
    });
    return row ? Number((row as any).Unassigned ?? (row as any).unassigned ?? (row as any).unassigned_count) || 0 : 0;
  };

  // -------------------------------------------------------------------------
  // Handlers for Submitting Requests
  // -------------------------------------------------------------------------

  const handleSendOverfillRequest = async () => {
    if (!canSubmit) {
      toast.error("Requires Operations or Lab Manager permissions to submit requests.");
      return;
    }
    if (!overfillArea) {
      toast.error("Please select a target area for overfill.");
      return;
    }
    if (overfillGrades.length === 0) {
      toast.error("Please select at least one grade.");
      return;
    }

    const unassignedCount = getUnassignedCount(overfillArea, overfillGrades);
    const gradesLabel = overfillGrades.length === availableGrades.length
      ? "All grades / levels"
      : overfillGrades.map((grade) => formatGradeLevel(grade)).join(", ");
    const req = await saveBatchResolutionRequest({
      batch_id: batchId,
      project_id: projectId,
      type: "overfill",
      target_team: "Event Team",
      status: "pending",
      area: overfillArea,
      grades: overfillGrades,
      unassigned_count: unassignedCount,
      lab_id: overfillLabId === "ALL" ? undefined : overfillLabId,
      max_overfill_per_lab: maxOverfillPerLab,
      notes: `Requested +${maxOverfillPerLab} overfill for ${overfillArea} (${overfillLabId === "ALL" ? "All Labs" : overfillLabId}) across ${gradesLabel} (${unassignedCount} unassigned students targeted).`,
      submitted_by_name: currentUserName,
      submitted_by_role: currentUserRole,
    });

    onRequestsChange([req, ...requests]);
    toast.success(`Overfill request sent to Event Team for ${overfillArea} (${gradesLabel})!`);
    setActiveTab("active_requests");
  };

  const handleSendNewLabRequest = async () => {
    if (!canSubmit) {
      toast.error("Requires Operations or Lab Manager permissions to submit requests.");
      return;
    }
    if (!newLabArea) {
      toast.error("Please select an area for the new lab.");
      return;
    }

    const unassignedCount = getUnassignedCount(newLabArea, newLabGrades);
    const req = await saveBatchResolutionRequest({
      batch_id: batchId,
      project_id: projectId,
      type: "new_lab",
      target_team: "Event Team",
      status: "pending",
      area: newLabArea,
      grades: newLabGrades,
      unassigned_count: unassignedCount,
      requested_capacity: newLabCapacity,
      reason: newLabReason.trim() || `Demand deficit in ${newLabArea} (${unassignedCount} unseated students).`,
      submitted_by_name: currentUserName,
      submitted_by_role: currentUserRole,
    });

    onRequestsChange([req, ...requests]);
    toast.success(`New Lab provisioning request sent to Event Team for ${newLabArea}!`);
    setActiveTab("active_requests");
  };

  const handleSendCSOutreach = async () => {
    if (!canSubmit) {
      toast.error("Requires Operations or Lab Manager permissions to submit requests.");
      return;
    }
    if (!csArea) {
      toast.error("Please select an area for CS outreach.");
      return;
    }

    const unassignedCount = getUnassignedCount(csArea, csGrades);
    const req = await saveBatchResolutionRequest({
      batch_id: batchId,
      project_id: projectId,
      type: "cs_outreach",
      target_team: "CS Team",
      status: "pending",
      area: csArea,
      grades: csGrades,
      unassigned_count: unassignedCount,
      suggested_nearest_lab: csNearestLab,
      notes: csNotes.trim() || `Offer reassignment to ${csNearestLab} for unassigned cohort in ${csArea}.`,
      submitted_by_name: currentUserName,
      submitted_by_role: currentUserRole,
    });

    onRequestsChange([req, ...requests]);
    toast.success(`Outreach task dispatched to Customer Service Team for ${csArea}!`);
    setPreviewResult(null);
    setPreviewType(null);
    setActiveTab("active_requests");
  };

  // Dynamic slot count must be initialized before approved request preferences use it.
  const dynamicSlotCount = useMemo(() => {
    const applied = liveBaselineOutput?.preferences_applied || preferencesApplied;
    if (applied?.customSlots && applied.customSlots.length > 0) {
      return applied.customSlots.length;
    }
    const summary = liveBaselineOutput?.summary || baselineSummary;
    if (summary?.total_labs && summary?.total_sessions_available) {
      return Math.round(summary.total_sessions_available / summary.total_labs);
    }
    return 7;
  }, [liveBaselineOutput, preferencesApplied, baselineSummary]);

  // Convert Approved Requests into Solver Preferences
  const approvedPreferences = useMemo((): AllocationPreferences => {
    const overfillRules: OverfillRule[] = [];
    const extraLabs: ExtraLabDefinition[] = [];

    requests.forEach((r) => {
      if (r.status === "approved") {
        if (r.type === "overfill") {
          const gradesList = parseGrades(r.grades);
          overfillRules.push({
            area: String(r.area || "").trim(),
            grades: gradesList.length > 0 ? gradesList : availableGrades,
            labIds: r.lab_id ? [String(r.lab_id).trim()] : ["ALL"],
            maxOverfillPerLab: Number(r.max_overfill_per_lab || 2),
          });
        } else if (r.type === "new_lab") {
          extraLabs.push({
            area: String(r.area || "").trim(),
            labId: `EXTRA-${String(r.area || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "LAB"}-${r.id.slice(0, 4)}`,
            capacity: Number(r.requested_capacity || 25),
            slots: r.time_slot_num ? [Number(r.time_slot_num)] : Array.from({ length: dynamicSlotCount }, (_, i) => i + 1),
          });
        } else if (r.type === "nearby_lab" && r.nearby_lab_metadata) {
          const metadata = r.nearby_lab_metadata;
          extraLabs.push({
            area: metadata.destination_area,
            labId: metadata.lab_code || r.lab_id || metadata.lab_uuid,
            capacity: metadata.capacity,
            slots: metadata.required_sessions.map((session, index) => session.slot_num || index + 1),
          });
        }
      }
    });

    return {
      overfillRules,
      preferredLabRules: [],
      extraLabs,
    };
  }, [requests, dynamicSlotCount, availableGrades]);

  // Baseline active preferences from the authoritative current allocation result
  const baselinePreferences = useMemo((): AllocationPreferences => {
    const applied = liveBaselineOutput?.preferences_applied || preferencesApplied;
    return {
      overfillRules: applied?.overfillRules || [],
      preferredLabRules: applied?.preferredLabRules || [],
      extraLabs: applied?.extraLabs || [],
      customSlots: applied?.customSlots,
    };
  }, [liveBaselineOutput, preferencesApplied]);

  // Helper to merge baseline rules, approved batch rules, and an optional candidate rule
  const buildSimulatedPreferences = useCallback(
    (candidateOverfill?: OverfillRule, candidateExtraLab?: ExtraLabDefinition): AllocationPreferences => {
      const baseOverfill = liveBaselineOutput?.preferences_applied?.overfillRules || baselinePreferences.overfillRules || [];
      const approvedOverfill = approvedPreferences.overfillRules;
      const mergedOverfillMap = new Map<string, OverfillRule>();

      // 1. Seed with baseline overfill rules (e.g. earlier resolved areas)
      baseOverfill.forEach((r) => mergedOverfillMap.set(r.area, r));
      // 2. Overlay approved requests
      approvedOverfill.forEach((r) => mergedOverfillMap.set(r.area, r));
      // 3. Overlay candidate rule if provided
      if (candidateOverfill) {
        mergedOverfillMap.set(candidateOverfill.area, candidateOverfill);
      }

      // Merge extraLabs
      const baseExtraLabs = liveBaselineOutput?.preferences_applied?.extraLabs || baselinePreferences.extraLabs || [];
      const approvedExtraLabs = approvedPreferences.extraLabs;
      const mergedExtraLabs = [...baseExtraLabs];
      approvedExtraLabs.forEach((extra) => {
        if (!mergedExtraLabs.some((e) => e.labId === extra.labId)) {
          mergedExtraLabs.push(extra);
        }
      });
      if (candidateExtraLab) {
        mergedExtraLabs.push(candidateExtraLab);
      }

      // Merge preferredLabRules
      const basePreferredLabs = liveBaselineOutput?.preferences_applied?.preferredLabRules || baselinePreferences.preferredLabRules || [];

      return {
        overfillRules: Array.from(mergedOverfillMap.values()),
        preferredLabRules: [...basePreferredLabs, ...approvedPreferences.preferredLabRules],
        extraLabs: mergedExtraLabs,
      };
    },
    [liveBaselineOutput, baselinePreferences, approvedPreferences]
  );

  const approvedCount = requests.filter((r) => r.status === "approved").length;
  const [isApplying, setIsApplying] = useState(false);

  // -------------------------------------------------------------------------
  // Handlers for Preview Simulations (Non-persisting dry-run)
  // -------------------------------------------------------------------------

  const handlePreviewOverfill = async (overrideRule?: OverfillRule) => {
    const area = overrideRule?.area || overfillArea;
    const grades = overrideRule?.grades || overfillGrades;
    const labId = overrideRule?.labIds ? overrideRule.labIds[0] : overfillLabId;
    const maxOverfill = overrideRule?.maxOverfillPerLab || maxOverfillPerLab;

    if (!area) {
      toast.error("Please select a target area for overfill preview.");
      return;
    }
    if (!grades || grades.length === 0) {
      toast.error("Please select at least one grade.");
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      // 1. Freshly sync live baseline data from authoritative batch storage
      await fetchLiveBaseline();

      const candidateRule: OverfillRule = {
        area: String(area).trim(),
        grades,
        labIds: labId === "ALL" || !labId ? ["ALL"] : [String(labId).trim()],
        maxOverfillPerLab: Number(maxOverfill || 2),
      };

      const simPrefs = buildSimulatedPreferences(candidateRule);

      if (onPreviewImpact) {
        const simResult = await onPreviewImpact(simPrefs, batchId);
        setPreviewResult(simResult);
        setPreviewType("overfill");
        setPreviewMeta({
          area,
          grades,
          maxOverfill,
          labId,
        });
        toast.success(`Preview simulated for ${area} (+${maxOverfill} overfill)`);
      } else {
        toast.info("Preview calculation engine not connected.");
      }
    } catch (err: any) {
      console.error("Preview simulation error:", err);
      setPreviewError(err.message || "Failed to generate simulation");
      toast.error(`Preview failed: ${err.message || "Unknown error"}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePreviewNewLab = async (overrideLab?: ExtraLabDefinition) => {
    const area = overrideLab?.area || newLabArea;
    const capacity = overrideLab?.capacity || newLabCapacity;

    if (!area) {
      toast.error("Please select an area for the new lab preview.");
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      // 1. Freshly sync live baseline data from authoritative batch storage
      await fetchLiveBaseline();

      const candidateLab: ExtraLabDefinition = overrideLab || {
        area: String(area).trim(),
        labId: `SIM-${String(area).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "LAB"}-${capacity}`,
        capacity: Number(capacity || 25),
        slots: Array.from({ length: dynamicSlotCount }, (_, i) => i + 1),
      };

      const simPrefs = buildSimulatedPreferences(undefined, candidateLab);

      if (onPreviewImpact) {
        const simResult = await onPreviewImpact(simPrefs, batchId);
        setPreviewResult(simResult);
        setPreviewType("new_lab");
        setPreviewMeta({
          area,
          capacity,
        });
        toast.success(`Preview simulated for ${area} (+${capacity} seats venue)`);
      } else {
        toast.info("Preview calculation engine not connected.");
      }
    } catch (err: any) {
      console.error("Preview simulation error:", err);
      setPreviewError(err.message || "Failed to generate simulation");
      toast.error(`Preview failed: ${err.message || "Unknown error"}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePreviewCSOutreach = async () => {
    if (!csArea) {
      toast.error("Please select an origin area for CS outreach preview.");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      // 1. Freshly sync live baseline data from authoritative batch storage
      await fetchLiveBaseline();

      const unassignedCount = getUnassignedCount(csArea, csGrades);
      setPreviewType("cs_outreach");
      setPreviewMeta({
        area: csArea,
        grades: csGrades,
        nearestLab: csNearestLab,
        unassignedCount,
      });
      toast.success(`CS Outreach campaign simulation ready for ${csArea}`);
    } catch (err: any) {
      setPreviewError(err.message || "Failed to generate CS simulation");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePreviewSingleRequest = async (req: ResolutionRequest) => {
    if (req.type === "overfill") {
      const grades = parseGrades(req.grades);
      await handlePreviewOverfill({
        area: req.area,
        grades: grades.length > 0 ? grades : availableGrades,
        labIds: req.lab_id ? [req.lab_id] : ["ALL"],
        maxOverfillPerLab: Number(req.max_overfill_per_lab || 2),
      });
    } else if (req.type === "new_lab") {
      await handlePreviewNewLab({
        area: req.area,
        labId: `SIM-${req.area.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "LAB"}-${req.requested_capacity || 25}`,
        capacity: Number(req.requested_capacity || 25),
        slots: Array.from({ length: dynamicSlotCount }, (_, i) => i + 1),
      });
    } else if (req.type === "cs_outreach") {
      await fetchLiveBaseline();
      const grades = parseGrades(req.grades);
      setPreviewLoading(true);
      setPreviewType("cs_outreach");
      setPreviewMeta({
        area: req.area,
        grades: grades.length > 0 ? grades : availableGrades,
        nearestLab: req.suggested_nearest_lab || "",
        unassignedCount: req.unassigned_count || getUnassignedCount(req.area, grades),
      });
      setPreviewLoading(false);
      toast.success(`CS Outreach campaign simulation ready for ${req.area}`);
    }
  };

  const handlePreviewAllApproved = async () => {
    if (approvedCount === 0) {
      toast.info("No approved rules to simulate.");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      // 1. Freshly sync live baseline data from authoritative batch storage
      await fetchLiveBaseline();

      const simPrefs = buildSimulatedPreferences();

      if (onPreviewImpact) {
        const simResult = await onPreviewImpact(simPrefs, batchId);
        setPreviewResult(simResult);
        setPreviewType("active_requests");
        setPreviewMeta({
          approvedCount,
        });
        toast.success(`Simulation generated for ${approvedCount} approved rule(s)`);
      }
    } catch (err: any) {
      console.error("Simulation failed:", err);
      setPreviewError(err.message || "Simulation failed");
      toast.error(`Simulation failed: ${err.message || "Unknown error"}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Status toggle & decision prompt handler (opens Decision & Reply modal)
  const handlePromptStatusUpdate = (req: ResolutionRequest, newStatus: ResolutionRequestStatus) => {
    if ((newStatus === "approved" || newStatus === "rejected") && !canApprove) {
      toast.error("Requires Lab Manager or Event Team approval permissions.");
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
      const updatedRecord = await updateBatchResolutionRequestStatus(
        selectedRequestForDecision.id,
        batchId,
        decisionTargetStatus,
        reviewer,
        comment
      );
      const updated = requests.map((r) =>
        r.id === updatedRecord.id ? updatedRecord : r
      );
      onRequestsChange(updated);
      const isOverride =
        selectedRequestForDecision.status !== "pending" &&
        selectedRequestForDecision.status !== decisionTargetStatus;
      if (isOverride) {
        toast.success(`Request status overridden to "${decisionTargetStatus.toUpperCase()}".`);
      } else {
        toast.success(`Request status updated to "${decisionTargetStatus.toUpperCase()}".`);
      }
      setDecisionModalOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to update status");
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (!canSubmit) {
      toast.error("You do not have permission to delete resolution requests.");
      return;
    }
    await deleteBatchResolutionRequest(id, batchId);
    onRequestsChange(requests.filter((r) => r.id !== id));
    toast.info("Resolution request removed.");
  };

  const handleApplyToSolver = async () => {
    if (isApplying || loading) return;
    setIsApplying(true);
    try {
      try {
        const updated = await markBatchRequestsSolverRerun(batchId);
        if (updated && updated.length > 0) {
          onRequestsChange(updated);
        }
      } catch (e) {
        console.warn("markBatchRequestsSolverRerun error:", e);
      }
      const mergedPrefs = buildSimulatedPreferences();
      await onApplyApprovedRules(mergedPrefs);
      onOpenChange(false);
      toast.success("Applied approved capacity rules and re-ran solver successfully!");
    } catch (err: any) {
      console.error("Failed to re-run solver with approved rules:", err);
      toast.error(`Solver re-run failed: ${err.message || "Unknown error"}`);
    } finally {
      setIsApplying(false);
    }
  };

  const filteredRequests = requests.filter((r) => {
    if (requestFilter === "event") return r.target_team === "Event Team";
    if (requestFilter === "cs") return r.target_team === "CS Team";
    return true;
  });

  // -------------------------------------------------------------------------
  // Sub-component: Simulation Preview Results Card
  // -------------------------------------------------------------------------
  const renderSimulationPreviewCard = (
    type: "overfill" | "new_lab" | "cs_outreach" | "active_requests",
    targetAreaLabel: string,
    targetGradesList: number[]
  ) => {
    if (type === "cs_outreach") {
      const originUnassigned = getUnassignedCount(csArea, csGrades);
      return (
        <div className="p-4 rounded-xl border border-purple-500/40 bg-gradient-to-b from-purple-500/10 to-purple-500/5 dark:from-purple-950/30 dark:to-purple-950/10 space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-purple-500/20">
            <div className="flex items-center gap-2">
              <Badge className="bg-purple-600 text-white font-extrabold text-[10px] tracking-wide uppercase px-2 py-0.5 shadow-xs gap-1">
                <FlaskConical className="h-3 w-3" /> Preview — Not Saved
              </Badge>
              <span className="text-xs font-bold text-foreground">
                CS Outreach Scope Simulation ({csArea})
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-2"
              onClick={() => {
                setPreviewResult(null);
                setPreviewType(null);
              }}
            >
              <X className="h-3 w-3 mr-1" /> Dismiss Preview
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-lg border bg-background/80 space-y-1">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">Target Student Cohort</div>
              <div className="text-sm font-bold text-foreground">{originUnassigned} Unassigned</div>
              <div className="text-[10px] text-muted-foreground">in {csArea} ({csGrades.join(", ")})</div>
            </div>

            <div className="p-3 rounded-lg border bg-background/80 space-y-1">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">Suggested Alternative</div>
              <div className="text-xs font-bold text-purple-600 dark:text-purple-400 truncate" title={csNearestLab}>
                {csNearestLab || "Nearest Venue"}
              </div>
              <div className="text-[10px] text-muted-foreground">Destination for phone outreach</div>
            </div>

            <div className="p-3 rounded-lg border bg-background/80 space-y-1">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">Campaign Target</div>
              <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                100% of Shortfall
              </div>
              <div className="text-[10px] text-muted-foreground">{originUnassigned} call tickets to CS</div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg border bg-background/60 space-y-1 text-xs">
            <div className="font-semibold text-foreground text-[11px]">Cohort Breakdown by Grade in {csArea}:</div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              {availableGrades.map((g) => {
                const unassignedG = getUnassignedCount(csArea, [g]);
                return (
                  <div key={g} className="p-1.5 rounded bg-muted/40 border">
                    <div className="font-semibold">{formatGradeLevel(g, undefined, true)}</div>
                    <div className="text-xs font-bold text-purple-600 dark:text-purple-400 mt-0.5">
                      {unassignedG} unassigned
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-[11px] text-purple-800 dark:text-purple-200/90 flex items-start gap-1.5 bg-purple-500/10 p-2 rounded">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-purple-600" />
            <span>
              This is a read-only preview. No tickets have been created and no student data has been altered. Click <strong>Dispatch Outreach Campaign</strong> below to commit.
            </span>
          </div>
        </div>
      );
    }

    if (!previewResult) return null;

    const simAssigned = previewResult.summary.assigned_count;
    const simUnassigned = previewResult.summary.unassigned_count;
    const deltaAssigned = Math.max(0, simAssigned - baselineAssigned);
    const deltaUnassigned = Math.max(0, baselineUnassigned - simUnassigned);

    // Determine affected areas list
    const affectedAreasList: string[] =
      type === "active_requests"
        ? Array.from(
            new Set(
              requests
                .filter((r) => r.status === "approved" && r.area)
                .map((r) => r.area)
            )
          )
        : [targetAreaLabel];

    const baseAreaUnassigned = affectedAreasList.reduce(
      (sum, a) => sum + getUnassignedCount(a, targetGradesList),
      0
    );
    const simAreaUnassigned = affectedAreasList.reduce(
      (sum, a) =>
        sum +
        targetGradesList.reduce((gSum, g) => gSum + getSimGradeUnassigned(a, g), 0),
      0
    );
    const areaUnassignedDelta = Math.max(0, baseAreaUnassigned - simAreaUnassigned);

    return (
      <div className="p-4 rounded-xl border border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-amber-500/5 dark:from-amber-950/30 dark:to-amber-950/10 space-y-3.5 animate-in fade-in duration-200">
        {/* Header banner */}
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-amber-500/20">
          <div className="flex items-center gap-2">
            <Badge className="bg-amber-500 text-amber-950 dark:bg-amber-400 font-extrabold text-[10px] tracking-wide uppercase px-2 py-0.5 shadow-xs gap-1">
              <FlaskConical className="h-3 w-3" /> Preview — Not Saved
            </Badge>
            <span className="text-xs font-bold text-foreground">
              {type === "overfill"
                ? `Simulated Fair Overfill (+${previewMeta?.maxOverfill || maxOverfillPerLab} / lab in ${previewMeta?.area || overfillArea})`
                : type === "new_lab"
                ? `Simulated New Lab Venue (+${previewMeta?.capacity || newLabCapacity} seats in ${previewMeta?.area || newLabArea})`
                : `Simulated ${approvedCount} Approved Request(s)`}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-2"
            onClick={() => {
              setPreviewResult(null);
              setPreviewType(null);
            }}
          >
            <X className="h-3 w-3 mr-1" /> Dismiss Preview
          </Button>
        </div>

        {/* Metric Comparison Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* 1. Assigned Students */}
          <div className="p-2.5 rounded-lg border bg-background/80 shadow-2xs space-y-1">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">Assigned Students</div>
            <div className="text-sm font-bold text-foreground flex items-baseline gap-1.5 flex-wrap">
              <span>{simAssigned.toLocaleString()}</span>
              {deltaAssigned > 0 && (
                <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                  (+{deltaAssigned} seated!)
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Baseline: {baselineAssigned.toLocaleString()}
            </div>
          </div>

          {/* 2. Unassigned Remaining */}
          <div className="p-2.5 rounded-lg border bg-background/80 shadow-2xs space-y-1">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">Unassigned Remaining</div>
            <div className="text-sm font-bold text-foreground flex items-baseline gap-1.5 flex-wrap">
              <span>{simUnassigned.toLocaleString()}</span>
              {deltaUnassigned > 0 && (
                <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                  (-{deltaUnassigned})
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Baseline: {baselineUnassigned.toLocaleString()}
            </div>
          </div>

          {/* 3. Extra / Overfill Placed Seats */}
          <div className="p-2.5 rounded-lg border bg-background/80 shadow-2xs space-y-1">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">
              {type === "overfill" ? "Overfill Placed" : "Extra Placed"}
            </div>
            <div className="text-sm font-bold text-amber-600 dark:text-amber-400">
              +{previewResult.summary.overfill_count ?? 0} seats
            </div>
            <div className="text-[10px] text-muted-foreground">
              {previewResult.summary.overfilled_sessions_count ?? 0} sessions boosted
            </div>
          </div>

          {/* 4. Target Area Shortfall */}
          <div className="p-2.5 rounded-lg border bg-background/80 shadow-2xs space-y-1">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground truncate" title={affectedAreasList.join(", ")}>
              {affectedAreasList.length === 1 ? `${affectedAreasList[0]} Shortfall` : "Approved Areas Shortfall"}
            </div>
            <div className="text-sm font-bold text-foreground flex items-baseline gap-1 flex-wrap">
              <span>{simAreaUnassigned}</span>
              {areaUnassignedDelta > 0 && (
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  (-{areaUnassignedDelta} seated)
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Baseline: {baseAreaUnassigned} unassigned
            </div>
          </div>
        </div>

        {/* Grade Breakdown for each affected area */}
        <div className="p-3 rounded-lg border bg-background/60 space-y-2 text-xs">
          <div className="font-semibold text-foreground text-[11px] flex items-center justify-between">
            <span>
              Area Impact Breakdown:{" "}
              <strong>{affectedAreasList.join(", ")}</strong>
            </span>
            <span className="text-[10px] text-muted-foreground">
              Mixed-Integer Linear Program Simulation
            </span>
          </div>

          {affectedAreasList.map((areaName) => (
            <div key={areaName} className="space-y-1">
              {affectedAreasList.length > 1 && (
                <div className="text-[11px] font-bold text-foreground/90">{areaName}:</div>
              )}
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                {availableGrades.map((g) => {
                  const baseG = getBaselineGradeUnassigned(areaName, g);
                  const simG = getSimGradeUnassigned(areaName, g);
                  const seatedG = Math.max(0, baseG - simG);
                  return (
                    <div key={g} className="p-2 rounded bg-muted/40 border">
                      <div className="font-semibold">{formatGradeLevel(g, undefined, true)}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Unassigned: <span className="line-through text-muted-foreground/70">{baseG}</span> → <strong className="text-foreground">{simG}</strong>
                      </div>
                      {seatedG > 0 ? (
                        <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                          +{seatedG} seated
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground mt-0.5">0 delta</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Important Note */}
        <div className="text-[11px] text-amber-800 dark:text-amber-200/90 flex items-start gap-1.5 bg-amber-500/10 p-2 rounded">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
          <span>
            This is a non-persisting simulation. Live allocation data and database records have not been modified. Click <strong>Send Request</strong> below to officially submit this ticket for approval.
          </span>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-5 pb-3 border-b bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Resolve Unassigned Students</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Batch: <strong className="text-foreground">{batchName}</strong> • Take action on unassigned students via Event Team sign-off or CS Outreach.
                </DialogDescription>
              </div>
            </div>
            {requests.length > 0 && (
              <Badge variant="outline" className="text-xs px-2.5 py-1 gap-1.5 font-bold border-primary/40 bg-primary/5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                {requests.length} Active Request(s)
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Tab Navigation */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as any)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="px-5 pt-3 border-b bg-muted/20">
            <TabsList className="grid grid-cols-4 h-10 w-full">
              <TabsTrigger value="overfill" className="text-xs gap-1.5 font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                1. Fair Overfill
              </TabsTrigger>
              <TabsTrigger value="nearby_lab" className="text-xs gap-1.5 font-semibold">
                <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                2. Nearby Available Labs
              </TabsTrigger>
              <TabsTrigger value="new_lab" className="text-xs gap-1.5 font-semibold">
                <Building2 className="h-3.5 w-3.5 text-blue-500" />
                3. Request New Lab
              </TabsTrigger>
              <TabsTrigger value="active_requests" className="text-xs gap-1.5 font-semibold relative">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Active Requests
                {requests.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                    {requests.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* --------------------------------------------------------------- */}
            {/* 1. FAIR OVERFILL TAB */}
            {/* --------------------------------------------------------------- */}
            <TabsContent value="overfill" className="mt-0 space-y-4">
              {linkedTargetRequest && linkedTargetRequest.type === "overfill" && (
                <div className="p-3.5 rounded-lg border border-primary/40 bg-primary/5 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary text-primary-foreground font-bold text-[10px] gap-1 shadow-xs">
                        🎯 Linked Request Action View
                      </Badge>
                      <span className="text-xs font-bold text-foreground">
                        {linkedTargetRequest.area} (+{linkedTargetRequest.max_overfill_per_lab || 2} overfill)
                      </span>
                      <Badge
                        className={`text-[10px] uppercase font-bold ${
                          linkedTargetRequest.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                            : linkedTargetRequest.status === "rejected"
                            ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                            : "bg-amber-500/15 text-amber-600 border-amber-500/30"
                        }`}
                      >
                        {linkedTargetRequest.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handlePreviewSingleRequest(linkedTargetRequest)}
                        disabled={previewLoading}
                        className="h-7 text-xs font-semibold gap-1 text-primary border-primary/30 hover:bg-primary/10"
                      >
                        <FlaskConical className="h-3.5 w-3.5" /> Preview This Rule
                      </Button>
                      {linkedTargetRequest.status === "approved" && canApprove && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleApplyToSolver}
                          disabled={loading || isApplying}
                          className="h-7 text-xs font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> Apply &amp; Re-run Solver
                        </Button>
                      )}
                    </div>
                  </div>
                  {linkedTargetRequest.notes && (
                    <div className="text-[11px] text-muted-foreground bg-background/60 p-2 rounded border">
                      <strong>Notes:</strong> {linkedTargetRequest.notes}
                    </div>
                  )}
                </div>
              )}

              <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-foreground flex items-center gap-2">
                    <span>Fair Overfill Request</span>
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600">
                      Destination: Event &amp; Operations Team
                    </Badge>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Overfilling (+1 to +2 seats per lab) increases seating density beyond normal capacity. Submitting this request sends a formal approval ticket to the Event Team. You can simulate the seating impact in preview mode before committing.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Area Select */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Target Area</Label>
                  <Select
                    value={overfillArea}
                    onValueChange={(val) => {
                      setOverfillArea(val);
                      if (previewType === "overfill") {
                        setPreviewResult(null);
                        setPreviewType(null);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select Area" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueAreas.map((area) => {
                        const short = shortfallAreas.get(area) || 0;
                        return (
                          <SelectItem key={area} value={area} className="text-xs">
                            {area} {short > 0 ? `(${short} Unassigned)` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Target Lab in Area */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Target Physical Lab</Label>
                  <Select
                    value={overfillLabId}
                    onValueChange={(val) => {
                      setOverfillLabId(val);
                      if (previewType === "overfill") {
                        setPreviewResult(null);
                        setPreviewType(null);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="All Labs in Area" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL" className="text-xs">
                        All Labs in {overfillArea}
                      </SelectItem>
                      {labsInOverfillArea.map((lab) => (
                        <SelectItem key={lab} value={lab} className="text-xs font-mono">
                          {lab}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Grades Checkboxes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Cohort Grades Allowed to Overfill</Label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer font-medium">
                    <Checkbox
                      checked={overfillGrades.length === availableGrades.length && availableGrades.every((g) => overfillGrades.includes(g))}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setOverfillGrades(availableGrades);
                        } else {
                          setOverfillGrades(availableGrades.slice(0, 1));
                        }
                        if (previewType === "overfill") {
                          setPreviewResult(null);
                          setPreviewType(null);
                        }
                      }}
                    />
                    <span>Apply to all grades in this area</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg border bg-card">
                  {availableGrades.map((g) => {
                    const gradeUnassigned = getUnassignedCount(overfillArea, [g]);
                    const isChecked = overfillGrades.includes(g);
                    return (
                      <label key={g} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setOverfillGrades([...overfillGrades, g].sort((a, b) => a - b));
                            } else {
                              setOverfillGrades(overfillGrades.filter((x) => x !== g));
                            }
                            if (previewType === "overfill") {
                              setPreviewResult(null);
                              setPreviewType(null);
                            }
                          }}
                        />
                        <span>{formatGradeLevel(g, undefined, true)}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${
                            gradeUnassigned > 0
                              ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30 font-bold"
                              : "text-muted-foreground opacity-60"
                          }`}
                        >
                          {gradeUnassigned} unassigned
                        </Badge>
                      </label>
                    );
                  })}
                </div>

                {/* Target Scope Summary */}
                <div className="flex items-center justify-between text-[11px] px-1 bg-muted/30 p-2 rounded border border-border/50">
                  <span className="text-muted-foreground">
                    Target Scope: <strong className="text-foreground">{overfillGrades.length === availableGrades.length ? "All grades / levels in area" : overfillGrades.length > 0 ? overfillGrades.map((grade) => formatGradeLevel(grade)).join(", ") : "No grade / level selected"}</strong>
                  </span>
                  <span className="font-bold text-amber-600 dark:text-amber-400">
                    {getUnassignedCount(overfillArea, overfillGrades)} Unassigned Students Targeted
                  </span>
                </div>
              </div>

              {/* Max Overfill per Lab */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Max Extra Seats per Lab Session (+1 or +2)</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2].map((num) => (
                    <div
                      key={num}
                      onClick={() => {
                        setMaxOverfillPerLab(num);
                        if (previewType === "overfill") {
                          setPreviewResult(null);
                          setPreviewType(null);
                        }
                      }}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                        maxOverfillPerLab === num
                          ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500"
                          : "border-border/70 hover:bg-muted/40"
                      }`}
                    >
                      <div>
                        <div className="font-bold text-xs">+{num} Student / Lab</div>
                        <div className="text-[10px] text-muted-foreground">Up to +{num * dynamicSlotCount} seats per {dynamicSlotCount}-slot schedule</div>
                      </div>
                      {maxOverfillPerLab === num && <Check className="h-4 w-4 text-amber-600" />}
                    </div>
                  ))}
                </div>
              </div>

              {/* Simulation Result Card */}
              {previewType === "overfill" && previewResult && renderSimulationPreviewCard("overfill", overfillArea, overfillGrades)}

              {/* Action Buttons */}
              <div className="pt-2 space-y-2">
                <div className="flex items-center gap-2.5 flex-col sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { void handlePreviewOverfill(); }}
                    disabled={previewLoading || !overfillArea || overfillGrades.length === 0}
                    className="w-full sm:flex-1 gap-2 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 font-semibold"
                  >
                    {previewLoading && previewType === "overfill" ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
                        Simulating Solver Impact...
                      </>
                    ) : (
                      <>
                        <FlaskConical className="h-4 w-4 text-amber-600" />
                        Preview Impact (Dry Run)
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    onClick={handleSendOverfillRequest}
                    disabled={!canSubmit}
                    className="w-full sm:flex-1 gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                  >
                    <Send className="h-4 w-4" />
                    Send Overfill Request to Event Team
                  </Button>
                </div>
                {!canSubmit && (
                  <p className="text-[11px] text-muted-foreground text-center mt-1 flex items-center justify-center gap-1">
                    <Lock className="h-3 w-3 text-amber-500" /> Requires Operations or Lab Manager role to submit.
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="nearby_lab" className="mt-0 space-y-4">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Nearby Available Labs</h3>
                  <p className="text-xs text-muted-foreground mt-1">Availability is checked across all projects for the selected batch dates and times. Event Team approval reserves the schedule; it does not move students.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Select value={nearbyArea} onValueChange={setNearbyArea}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select shortfall area" /></SelectTrigger>
                    <SelectContent>{Array.from(shortfallAreas.keys()).map((area) => <SelectItem key={area} value={area}>{area} ({shortfallAreas.get(area)})</SelectItem>)}</SelectContent>
                  </Select>
                  <Button type="button" disabled={!nearbyArea || !canSubmit} onClick={() => setNearbyModalOpen(true)} className="gap-2">
                    <Search className="h-4 w-4" /> Find Free Labs
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Approved Nearby Labs</h3>
                {requests.filter((request) => request.type === "nearby_lab" && request.status === "approved").length === 0 ? (
                  <p className="text-xs text-muted-foreground border rounded-md p-4">No nearby labs have been approved for this batch.</p>
                ) : requests.filter((request) => request.type === "nearby_lab" && request.status === "approved").map((request) => (
                  <div key={request.id} className="flex items-center justify-between gap-3 border rounded-md p-3">
                    <div className="text-xs"><div className="font-semibold">{request.nearby_lab_metadata?.lab_name || request.suggested_nearest_lab || request.lab_id}</div><div className="text-muted-foreground">{request.nearby_lab_metadata?.destination_area} · {request.nearby_lab_metadata?.free_capacity ?? request.requested_capacity} seats · Approved by Event Team</div></div>
                    <Button size="sm" onClick={handleApplyToSolver} disabled={isApplying || Boolean(request.solver_rerun_at)}>Use for Shortfall</Button>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* --------------------------------------------------------------- */}
            {/* 2. REQUEST NEW LAB TAB */}
            {/* --------------------------------------------------------------- */}
            <TabsContent value="new_lab" className="mt-0 space-y-4">
              {linkedTargetRequest && linkedTargetRequest.type === "new_lab" && (
                <div className="p-3.5 rounded-lg border border-primary/40 bg-primary/5 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary text-primary-foreground font-bold text-[10px] gap-1 shadow-xs">
                        🎯 Linked Request Action View
                      </Badge>
                      <span className="text-xs font-bold text-foreground">
                        {linkedTargetRequest.area} ({linkedTargetRequest.requested_capacity || 25} Seats Venue)
                      </span>
                      <Badge
                        className={`text-[10px] uppercase font-bold ${
                          linkedTargetRequest.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                            : linkedTargetRequest.status === "rejected"
                            ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                            : "bg-amber-500/15 text-amber-600 border-amber-500/30"
                        }`}
                      >
                        {linkedTargetRequest.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handlePreviewSingleRequest(linkedTargetRequest)}
                        disabled={previewLoading}
                        className="h-7 text-xs font-semibold gap-1 text-primary border-primary/30 hover:bg-primary/10"
                      >
                        <FlaskConical className="h-3.5 w-3.5" /> Preview This Rule
                      </Button>
                      {linkedTargetRequest.status === "approved" && canApprove && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleApplyToSolver}
                          disabled={loading || isApplying}
                          className="h-7 text-xs font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> Apply &amp; Re-run Solver
                        </Button>
                      )}
                    </div>
                  </div>
                  {linkedTargetRequest.reason && (
                    <div className="text-[11px] text-muted-foreground bg-background/60 p-2 rounded border">
                      <strong>Justification:</strong> {linkedTargetRequest.reason}
                    </div>
                  )}
                </div>
              )}

              <div className="p-3.5 rounded-lg border border-blue-500/30 bg-blue-500/5 flex items-start gap-3">
                <Building2 className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-foreground flex items-center gap-2">
                    <span>New Lab Provisioning Request</span>
                    <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600">
                      Destination: Event Team
                    </Badge>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Request the Event Team to source, lease, or activate an additional physical lab venue in an area with a severe capacity deficit. You can simulate the placement impact before submitting.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Area Select */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Deficit Area</Label>
                  <Select
                    value={newLabArea}
                    onValueChange={(val) => {
                      setNewLabArea(val);
                      if (previewType === "new_lab") {
                        setPreviewResult(null);
                        setPreviewType(null);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select Area" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueAreas.map((area) => {
                        const short = shortfallAreas.get(area) || 0;
                        return (
                          <SelectItem key={area} value={area} className="text-xs">
                            {area} {short > 0 ? `(${short} Unassigned)` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Seat Capacity Needed */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Requested Lab Capacity (Seats)</Label>
                  <Select
                    value={String(newLabCapacity)}
                    onValueChange={(v) => {
                      setNewLabCapacity(Number(v));
                      if (previewType === "new_lab") {
                        setPreviewResult(null);
                        setPreviewType(null);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20" className="text-xs">20 Seats (~140 weekly capacity)</SelectItem>
                      <SelectItem value="25" className="text-xs">25 Seats (~175 weekly capacity)</SelectItem>
                      <SelectItem value="30" className="text-xs">30 Seats (~210 weekly capacity)</SelectItem>
                      <SelectItem value="35" className="text-xs">35 Seats (~245 weekly capacity)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Justification & Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Business Justification / Venue Notes</Label>
                <Textarea
                  value={newLabReason}
                  onChange={(e) => setNewLabReason(e.target.value)}
                  placeholder="e.g. Over 45 unseated students in Dokki require a 2nd physical venue near Metro station."
                  className="text-xs h-20"
                />
              </div>

              {/* Simulation Result Card */}
              {previewType === "new_lab" && previewResult && renderSimulationPreviewCard("new_lab", newLabArea, newLabGrades)}

              {/* Action Buttons */}
              <div className="pt-2 space-y-2">
                <div className="flex items-center gap-2.5 flex-col sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { void handlePreviewNewLab(); }}
                    disabled={previewLoading || !newLabArea}
                    className="w-full sm:flex-1 gap-2 border-blue-500/40 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10 font-semibold"
                  >
                    {previewLoading && previewType === "new_lab" ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                        Simulating Venue Impact...
                      </>
                    ) : (
                      <>
                        <FlaskConical className="h-4 w-4 text-blue-600" />
                        Preview Impact (Dry Run)
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    onClick={handleSendNewLabRequest}
                    disabled={!canSubmit}
                    className="w-full sm:flex-1 gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  >
                    <Send className="h-4 w-4" />
                    Submit New Lab Request to Event Team
                  </Button>
                </div>
                {!canSubmit && (
                  <p className="text-[11px] text-muted-foreground text-center mt-1 flex items-center justify-center gap-1">
                    <Lock className="h-3 w-3 text-blue-500" /> Requires Operations or Lab Manager role to submit.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* --------------------------------------------------------------- */}
            {/* 3. CS OUTREACH TAB */}
            {/* --------------------------------------------------------------- */}
            <TabsContent value="cs_outreach" className="mt-0 space-y-4">
              {linkedTargetRequest && linkedTargetRequest.type === "cs_outreach" && (
                <div className="p-3.5 rounded-lg border border-primary/40 bg-primary/5 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary text-primary-foreground font-bold text-[10px] gap-1 shadow-xs">
                        🎯 Linked Request Action View
                      </Badge>
                      <span className="text-xs font-bold text-foreground">
                        {linkedTargetRequest.area} → Alternative: {linkedTargetRequest.suggested_nearest_lab || "Nearest Lab"}
                      </span>
                      <Badge
                        className={`text-[10px] uppercase font-bold ${
                          linkedTargetRequest.status === "resolved"
                            ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                            : linkedTargetRequest.status === "contacted"
                            ? "bg-blue-500/15 text-blue-600 border-blue-500/30"
                            : "bg-purple-500/15 text-purple-600 border-purple-500/30"
                        }`}
                      >
                        {linkedTargetRequest.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handlePreviewSingleRequest(linkedTargetRequest)}
                        disabled={previewLoading}
                        className="h-7 text-xs font-semibold gap-1 text-primary border-primary/30 hover:bg-primary/10"
                      >
                        <FlaskConical className="h-3.5 w-3.5" /> Preview Campaign Scope
                      </Button>
                    </div>
                  </div>
                  {linkedTargetRequest.notes && (
                    <div className="text-[11px] text-muted-foreground bg-background/60 p-2 rounded border">
                      <strong>Call Script / Notes:</strong> {linkedTargetRequest.notes}
                    </div>
                  )}
                </div>
              )}

              <div className="p-3.5 rounded-lg border border-purple-500/30 bg-purple-500/5 flex items-start gap-3">
                <Headphones className="h-5 w-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-foreground flex items-center gap-2">
                    <span>CS Nearest-Lab Reassignment Outreach</span>
                    <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-600">
                      Destination: Customer Service Team
                    </Badge>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Flag unassigned cohorts for proactive Customer Support calls. CS agents will reach out to parents/students and offer reassignment to the nearest physical lab with spare seating capacity.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Deficit Area */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Origin Area (Unassigned Cohort)</Label>
                  <Select
                    value={csArea}
                    onValueChange={(val) => {
                      setCsArea(val);
                      if (previewType === "cs_outreach") {
                        setPreviewResult(null);
                        setPreviewType(null);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select Area" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueAreas.map((area) => {
                        const short = shortfallAreas.get(area) || 0;
                        return (
                          <SelectItem key={area} value={area} className="text-xs">
                            {area} {short > 0 ? `(${short} Unassigned)` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Suggested Nearest Lab */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Suggested Alternative Lab</Label>
                  <Select
                    value={csNearestLab}
                    onValueChange={(val) => {
                      setCsNearestLab(val);
                      if (previewType === "cs_outreach") {
                        setPreviewResult(null);
                        setPreviewType(null);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select Alternative Lab" />
                    </SelectTrigger>
                    <SelectContent>
                      {systemAvailableLabs.map((l) => (
                        <SelectItem key={l.labId} value={l.label} className="text-xs">
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Notes for CS Agent */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Call Script / Guidance Notes for CS</Label>
                <Textarea
                  value={csNotes}
                  onChange={(e) => setCsNotes(e.target.value)}
                  placeholder="e.g. Inform parents that transport is accessible via Ring Road; offer Friday morning slot priority."
                  className="text-xs h-20"
                />
              </div>

              {/* Simulation Result Card */}
              {previewType === "cs_outreach" && renderSimulationPreviewCard("cs_outreach", csArea, csGrades)}

              {/* Action Buttons */}
              <div className="pt-2 space-y-2">
                <div className="flex items-center gap-2.5 flex-col sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePreviewCSOutreach}
                    disabled={previewLoading || !csArea}
                    className="w-full sm:flex-1 gap-2 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10 font-semibold"
                  >
                    {previewLoading && previewType === "cs_outreach" ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin text-purple-600" />
                        Simulating Outreach Scope...
                      </>
                    ) : (
                      <>
                        <FlaskConical className="h-4 w-4 text-purple-600" />
                        Preview Impact (Dry Run)
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    onClick={handleSendCSOutreach}
                    disabled={!canSubmit}
                    className="w-full sm:flex-1 gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold"
                  >
                    <PhoneCall className="h-4 w-4" />
                    Dispatch Outreach Campaign to CS Team
                  </Button>
                </div>
                {!canSubmit && (
                  <p className="text-[11px] text-muted-foreground text-center mt-1 flex items-center justify-center gap-1">
                    <Lock className="h-3 w-3 text-purple-500" /> Requires Operations or Lab Manager role to submit.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* --------------------------------------------------------------- */}
            {/* 4. ACTIVE REQUESTS TAB */}
            {/* --------------------------------------------------------------- */}
            <TabsContent value="active_requests" className="mt-0 space-y-4">
              <div className="flex items-center justify-between gap-2 pb-1 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs flex-wrap">
                  <span className="text-muted-foreground font-medium">Filter:</span>
                  <Button
                    size="sm"
                    variant={requestFilter === "all" ? "default" : "outline"}
                    className="h-7 text-xs px-2.5"
                    onClick={() => setRequestFilter("all")}
                  >
                    All ({requests.length})
                  </Button>
                  <Button
                    size="sm"
                    variant={requestFilter === "event" ? "default" : "outline"}
                    className="h-7 text-xs px-2.5 gap-1 text-amber-600 dark:text-amber-400"
                    onClick={() => setRequestFilter("event")}
                  >
                    Event Team ({requests.filter((r) => r.target_team === "Event Team").length})
                  </Button>
                  <Button
                    size="sm"
                    variant={requestFilter === "cs" ? "default" : "outline"}
                    className="h-7 text-xs px-2.5 gap-1 text-purple-600 dark:text-purple-400"
                    onClick={() => setRequestFilter("cs")}
                  >
                    CS Team ({requests.filter((r) => r.target_team === "CS Team").length})
                  </Button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {approvedCount > 0 && onPreviewImpact && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePreviewAllApproved}
                      disabled={loading || previewLoading}
                      className="h-7 text-xs font-semibold gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                    >
                      {previewLoading && previewType === "active_requests" ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                          Simulating...
                        </>
                      ) : (
                        <>
                          <FlaskConical className="h-3.5 w-3.5 text-emerald-600" />
                          Preview Approved Impact ({approvedCount})
                        </>
                      )}
                    </Button>
                  )}

                  {approvedCount > 0 && (
                    canApprove ? (
                      <Button
                        size="sm"
                        onClick={handleApplyToSolver}
                        disabled={loading || isApplying}
                        className="h-7 text-xs font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                      >
                        {isApplying ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            Applying...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5" />
                            Apply {approvedCount} Approved Rule(s) &amp; Re-run
                          </>
                        )}
                      </Button>
                    ) : (
                      <div
                        className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-muted/80 text-muted-foreground border cursor-not-allowed"
                        title="Requires Lab Manager or Administration approval to apply rules to solver."
                      >
                        <Lock className="h-3 w-3 text-amber-500" />
                        <span>{approvedCount} Approved (Lab Manager Apply)</span>
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Combined Approved Simulation Card */}
              {previewType === "active_requests" && previewResult && (
                renderSimulationPreviewCard("active_requests", "All Approved Areas", availableGrades)
              )}

              {linkedTargetRequest && (
                <div className="p-3.5 rounded-lg border border-primary/40 bg-primary/5 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary text-primary-foreground font-bold text-[10px] gap-1 shadow-xs">
                        🎯 Targeted Linked Request
                      </Badge>
                      <span className="text-xs font-bold text-foreground">
                        {linkedTargetRequest.area} ({linkedTargetRequest.type === "overfill" ? `+${linkedTargetRequest.max_overfill_per_lab || 2} Overfill` : linkedTargetRequest.type === "new_lab" ? `${linkedTargetRequest.requested_capacity || 25} Seats Lab` : "CS Outreach"})
                      </span>
                      <Badge
                        className={`text-[10px] uppercase font-bold ${
                          linkedTargetRequest.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                            : linkedTargetRequest.status === "rejected"
                            ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                            : "bg-amber-500/15 text-amber-600 border-amber-500/30"
                        }`}
                      >
                        {linkedTargetRequest.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handlePreviewSingleRequest(linkedTargetRequest)}
                        disabled={previewLoading}
                        className="h-7 text-xs font-semibold gap-1 text-primary border-primary/30 hover:bg-primary/10"
                      >
                        <FlaskConical className="h-3.5 w-3.5" /> Preview This Request
                      </Button>
                      {linkedTargetRequest.status === "approved" && canApprove && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleApplyToSolver}
                          disabled={loading || isApplying}
                          className="h-7 text-xs font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> Re-run Solver with this Rule
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {filteredRequests.length === 0 ? (
                <div className="text-center py-12 border rounded-lg border-dashed bg-muted/20 space-y-2">
                  <Layers className="h-8 w-8 mx-auto text-muted-foreground" />
                  <div className="text-xs font-semibold text-foreground">No Active Requests for this Batch</div>
                  <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                    Use the tabs above to raise Fair Overfill requests, New Lab tickets, or CS outreach campaigns.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredRequests.map((req) => (
                    <div
                      key={req.id}
                      className={`p-3.5 rounded-lg border bg-card shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs transition-all ${
                        req.id === targetRequestId
                          ? "ring-2 ring-primary border-primary bg-primary/5 shadow-md"
                          : ""
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Deep Link Targeted Badge */}
                          {req.id === targetRequestId && (
                            <Badge className="bg-primary text-primary-foreground font-bold text-[10px] gap-1 shadow-xs">
                              🎯 Linked Ticket
                            </Badge>
                          )}

                          {/* Team Badge */}
                          <Badge
                            className={
                              req.target_team === "Event Team"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px]"
                                : "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 text-[10px]"
                            }
                          >
                            {req.target_team}
                          </Badge>

                          {/* Type Badge */}
                          <Badge variant="outline" className="text-[10px] font-semibold">
                            {req.type === "overfill" && "⚡ Fair Overfill"}
                            {req.type === "new_lab" && "🏢 New Lab Request"}
                            {req.type === "nearby_lab" && "Nearby Existing Lab"}
                            {req.type === "cs_outreach" && "📞 CS Reassignment"}
                            {req.type === "cs_reallocation" && "🏢 CS Lab Reallocation"}
                          </Badge>

                          {/* Status Badge */}
                          <Badge
                            className={`text-[10px] uppercase font-bold ${
                              req.status === "resolved"
                                ? "bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/30"
                                : req.status === "approved"
                                ? req.type !== "cs_outreach" && req.type !== "cs_reallocation" && !req.solver_rerun_at
                                  ? "bg-[#FF7F1C]/20 text-[#FF7F1C] border-[#FF7F1C]/40 animate-pulse"
                                  : "bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/30"
                                : req.status === "rejected"
                                ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                                : req.status === "contacted" || req.status === "in_progress"
                                ? "bg-blue-500/15 text-blue-600 border-blue-500/30"
                                : "bg-amber-500/15 text-amber-600 border-amber-500/30"
                            }`}
                          >
                            {req.status === "approved" && req.type !== "cs_outreach" && req.type !== "cs_reallocation" && !req.solver_rerun_at
                              ? "Approved • Re-run Needed"
                              : req.status === "approved" && req.type !== "cs_outreach" && req.type !== "cs_reallocation" && req.solver_rerun_at
                              ? "Approved • Re-run Done"
                              : req.status}
                          </Badge>
                        </div>

                        <div className="text-foreground font-semibold flex items-center gap-1.5 flex-wrap">
                          <span>{req.area}</span>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-xs font-medium text-foreground/90">
                            {Array.isArray(req.grades) && req.grades.length === 3
                              ? "All Grades in Area (4, 5, 6)"
                              : Array.isArray(req.grades) && req.grades.length > 0
                              ? req.grades.map((grade) => formatGradeLevel(grade)).join(", ")
                              : "All Grades"}
                          </span>
                          {req.unassigned_count ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30 font-bold">
                              {req.unassigned_count} unassigned
                            </Badge>
                          ) : null}
                        </div>

                        <div className="text-muted-foreground text-[11px]">
                          {req.type === "overfill" && `+${req.max_overfill_per_lab || 2} seats/lab on ${req.lab_id || "All Labs"}`}
                          {req.type === "new_lab" && `Requested ${req.requested_capacity || 25} seats venue. Reason: ${req.reason || "Shortfall"}`}
                          {req.type === "nearby_lab" && `Reserve ${req.nearby_lab_metadata?.lab_name || req.suggested_nearest_lab || req.lab_id} for ${req.nearby_lab_metadata?.required_sessions?.length || 0} required sessions`}
                          {req.type === "cs_outreach" && `Offer nearest lab: ${req.suggested_nearest_lab || "Nearest with capacity"}`}
                          {req.type === "cs_reallocation" && `Reallocate to: ${req.suggested_nearest_lab || req.lab_id} (${req.suggested_nearest_area || req.area})`}
                        </div>

                        {/* Attribution metadata: who submitted and who reviewed with Overrides & Reply Notes */}
                        <div className="pt-1">
                          <RequestAuditHistory request={req} />
                        </div>
                      </div>

                      {/* Action buttons on request card */}
                      <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0 flex-wrap justify-end">
                        {((req.type as string) === "cs_reallocation" || (req.reallocation_students && req.reallocation_students.length > 0)) && (
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
                        )}

                        {/* Universal Solver Preview Button (Overfill & New Lab) */}
                        {req.type !== "cs_reallocation" && req.type !== "nearby_lab" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] font-semibold gap-1 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-50 dark:hover:bg-amber-950/40 px-2"
                            onClick={() => handlePreviewSingleRequest(req)}
                            disabled={previewLoading}
                            title="Preview solver impact for this request (dry run)"
                          >
                            <FlaskConical className="h-3 w-3 text-amber-600" /> Preview
                          </Button>
                        )}

                        {/* Event Team (Overfill & New Lab) */}
                        {req.target_team === "Event Team" && req.type !== "cs_reallocation" ? (
                          req.status === "pending" ? (
                            canApprove ? (
                              <>
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
                            ) : (
                              <div
                                className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded"
                                title="Requires Lab Manager or Event Team approval."
                              >
                                <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                                <span>Requires Lab Manager approval</span>
                              </div>
                            )
                          ) : req.status === "approved" ? (
                            <>
                              {/* 1. Inline Re-run Solver Button */}
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-[11px] font-bold gap-1 bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs px-2.5"
                                onClick={handleApplyToSolver}
                                disabled={loading || isApplying}
                                title="Re-run solver with approved extra capacity"
                              >
                                {isApplying ? (
                                  <>
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    Re-running...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="h-3 w-3" />
                                    Re-run Solver
                                  </>
                                )}
                              </Button>

                              {/* 2. Mark Resolved - only active once solver has been re-run! */}
                              {req.solver_rerun_at ? (
                                canSubmit && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] text-primary hover:bg-primary/10 border-primary/30 px-2"
                                    onClick={() => handlePromptStatusUpdate(req, "resolved")}
                                  >
                                    <Check className="h-3 w-3 mr-1" /> Mark Resolved
                                  </Button>
                                )
                              ) : (
                                <div
                                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/70 border px-2 py-1 rounded cursor-not-allowed"
                                  title="You must Re-run Solver with this approved capacity before marking it resolved."
                                >
                                  <Lock className="h-3 w-3 text-muted-foreground" />
                                  <span>Re-run required to resolve</span>
                                </div>
                              )}

                              {canApprove && (
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
                          ) : req.status === "rejected" ? (
                            canApprove && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] text-[#056FEC] hover:bg-[#056FEC]/10 border-[#056FEC]/30 px-2"
                                onClick={() => handlePromptStatusUpdate(req, "approved")}
                                title="Override Decision (Approve)"
                              >
                                <Check className="h-3 w-3 mr-1" /> Override: Approve
                              </Button>
                            )
                          ) : req.status === "resolved" ? (
                            <div className="flex items-center gap-1">
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#056FEC] dark:text-[#05ACFF] font-semibold px-2 py-0.5">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
                              </span>
                              {canApprove && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] text-muted-foreground hover:text-primary px-1.5"
                                  onClick={() => handlePromptStatusUpdate(req, "approved")}
                                  title="Reopen or Override Status"
                                >
                                  Reopen
                                </Button>
                              )}
                            </div>
                          ) : null
                        ) : (
                          /* CS Team (CS Reassignment) - Requires Lab Manager sign-off first! */
                          req.status === "pending" ? (
                            canApprove ? (
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
                              <div
                                className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded"
                                title="Requires Lab Manager or Event Team sign-off before CS outreach begins."
                              >
                                <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                                <span>Awaiting Lab Manager sign-off</span>
                              </div>
                            )
                          ) : (
                            canUpdateCS ? (
                              <>
                                {req.status !== "contacted" && req.status !== "resolved" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 border-blue-500/30 px-2"
                                    onClick={() => handlePromptStatusUpdate(req, "contacted")}
                                  >
                                    Mark Contacted
                                  </Button>
                                )}
                                {req.status !== "resolved" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[11px] text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 border-purple-500/30 px-2"
                                    onClick={() => handlePromptStatusUpdate(req, "resolved")}
                                  >
                                    Mark Resolved
                                  </Button>
                                )}
                                {canApprove && req.status !== "rejected" && (
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
                            ) : (
                              <div
                                className="inline-flex items-center gap-1 text-[11px] text-purple-700 dark:text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-1 rounded"
                                title="Requires CS or Operations permissions."
                              >
                                <Lock className="h-3 w-3 shrink-0 text-purple-500" />
                                <span>CS / Operations only</span>
                              </div>
                            )
                          )
                        )}

                        {canSubmit && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteRequest(req.id)}
                            aria-label="Delete Request"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* Decision & Reply Dialog */}
        <RequestDecisionDialog
          open={decisionModalOpen}
          onOpenChange={setDecisionModalOpen}
          request={selectedRequestForDecision}
          targetStatus={decisionTargetStatus}
          onConfirm={handleConfirmDecision}
          loading={submittingDecision}
        />

        {/* CS Reallocation Student-Level Review & Action Dialog */}
        <CSReallocationReviewDialog
          open={reallocationModalOpen}
          onOpenChange={setReallocationModalOpen}
          request={selectedRequestForReallocation}
          onUpdateRequest={(updated) => {
            onRequestsChange(requests.map((r) => (r.id === updated.id ? updated : r)));
            setSelectedRequestForReallocation(updated);
          }}
          onReallocationApplied={async () => {
            await fetchLiveBaseline();
          }}
        />

        <GovFreeLabsModal
          open={nearbyModalOpen}
          onOpenChange={setNearbyModalOpen}
          shortfallArea={nearbyArea}
          unassignedStudents={liveBaselineOutput?.unassigned_students || []}
          masterAllocation={liveBaselineOutput?.master_allocation || []}
          batchId={batchId}
          projectId={projectId}
          batchName={batchName}
          slotCount={dynamicSlotCount}
          onSuccess={() => {
            setNearbyModalOpen(false);
            fetchLiveBaseline();
          }}
        />

        {/* Footer */}
        <DialogFooter className="p-4 border-t bg-card flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {approvedCount > 0 ? (
              <span className="text-[#056FEC] dark:text-[#05ACFF] font-semibold">
                ✓ {approvedCount} Event Team request(s) approved and ready for solver.
              </span>
            ) : (
              <span>All requests are scoped to batch &amp; synced in database.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {approvedCount > 0 && canApprove && (
              <Button
                size="sm"
                onClick={handleApplyToSolver}
                disabled={loading || isApplying}
                className="gap-1.5 bg-primary font-bold shadow-xs"
              >
                {isApplying ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Recalculating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Apply Approved &amp; Recalculate
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
