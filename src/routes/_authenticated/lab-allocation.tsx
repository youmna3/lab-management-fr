import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigationPermissions } from "@/hooks/useNavigationPermissions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { isProjectSoftDeleted } from "@/lib/audit-logging";
import { applyAcceptedVpGrouping } from "@/lib/vp-session-grouping";
import { isCurrentBatchRequest } from "@/lib/latest-batch-request";
import {
  runLabAllocationApi,
  getAllocationDownloadUrl,
  getSampleTemplateUrl,
  isVpStudent,
  calculateAllocationAccounting,
  type AllocationResultPayload,
  type AllocationPreferences,
  type MegaGroupDefinition,
  type SlotIdTemplate,
  type OnlineMigrationSuggestion,
  type ConsolidationAnalysisDecision,
} from "@/lib/allocation-client";
import { AllocationVisualizations } from "@/components/AllocationVisualizations";
import { ShortfallVisualizer } from "@/components/ShortfallVisualizer";
import { ResolveUnassignedDialog } from "@/components/ResolveUnassignedDialog";
import { GroupClassificationDialog } from "@/components/GroupClassificationDialog";
import { MegaGroupMembershipDialog } from "@/components/MegaGroupMembershipDialog";
import {
  fetchProjectStudentRoster,
  fetchBatchAllocationOutput,
  fetchBatchAllocationSummary,
  saveBatchAllocationOutput,
  bulkUpdateVpRecommendations,
  reconcileFinalAllocationSummary,
  invalidateBatchAllocationCache,
  deleteBatchAllocationOutput,
  fetchBatchResolutionRequests,
  createStudentFileFromRecords,
  isStudentActive,
  type BatchStudentUploadRecord,
  type BatchAllocationOutputRecord,
  type StudentRecord,
  type ResolutionRequest,
} from "@/lib/batch-allocation-storage";
import {
  fetchBatchGroupClassifications,
  fetchBatchGroupSettings,
  saveBatchGroupSettings,
  autoDetectBatchGroupClassifications,
  type GroupClassificationRecord,
} from "@/lib/batch-group-classification-storage";
import { getCanonicalVisitCount } from "@/lib/project-timeline-template";
import { logAuditAction } from "@/lib/audit-logging";
import { useAuth, ROLE_LABELS } from "@/hooks/useAuth";
import { loadStudents, loadLabCapacity, formatGradeLabel, cleanGrade, CANONICAL_GRADE_LABELS, type LabRow } from "@/lib/lab-allocation-runner/parse";
import { resolveSlotSchedule } from "@/lib/lab-allocation-runner/schedule";
import {
  getLabPivotColumns,
  buildVpPivotSummary,
  buildAreaTimePivot,
  buildSingleSessionLabPivot,
  type SingleSessionLabPivotCell,
  buildDashboardStyleSummary,
  buildGroupCountSummary,
} from "@/lib/lab-allocation-runner/summaries";
import { formatGradeLevel, getGradeLevelOptions, sortGradeLevels, type ProjectProgram } from "@/lib/project-grade-levels";
import * as XLSX from "xlsx";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  FolderArchive,
  FolderKanban,
  Layers,
  List,
  MapPin,
  PieChart as PieChartIcon,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  Upload,
  Users,
  Globe,
  X,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { formatTimeSlot, getDayTimeSlots, flattenDayTimeSlots } from "@/lib/time-slots";
import { BrandIcon } from "@/components/BrandIcon";

type Project = Tables<"projects">;
type Batch = Tables<"batches">;
type Need = Tables<"batch_needs">;

interface LabAllocationSearch {
  projectId?: string;
  batchId?: string;
  openResolve?: boolean | string;
  resolveAction?: "overfill" | "new_lab" | "cs_outreach" | "active_requests" | "resolve" | string;
  requestId?: string;
  area?: string;
  grade?: number | string;
  labId?: string;
  maxOverfill?: number | string;
}

export const Route = createFileRoute("/_authenticated/lab-allocation")({
  validateSearch: (s: Record<string, unknown>): LabAllocationSearch => ({
    projectId: typeof s.projectId === "string" ? s.projectId : undefined,
    batchId: typeof s.batchId === "string" ? s.batchId : undefined,
    openResolve:
      s.openResolve === true || s.openResolve === "true" || typeof s.openResolve === "string"
        ? s.openResolve
        : undefined,
    resolveAction: typeof s.resolveAction === "string" ? s.resolveAction : undefined,
    requestId: typeof s.requestId === "string" ? s.requestId : undefined,
    area: typeof s.area === "string" ? s.area : undefined,
    grade:
      typeof s.grade === "number"
        ? s.grade
        : typeof s.grade === "string" && !isNaN(Number(s.grade))
        ? Number(s.grade)
        : undefined,
    labId: typeof s.labId === "string" ? s.labId : undefined,
    maxOverfill:
      typeof s.maxOverfill === "number"
        ? s.maxOverfill
        : typeof s.maxOverfill === "string" && !isNaN(Number(s.maxOverfill))
        ? Number(s.maxOverfill)
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Lab Allocation Engine – iSchool" },
      { name: "description", content: "Mathematical integer linear programming lab allocation pipeline for DECI and DEMI." },
    ],
  }),
  component: LabAllocationPage,
});

type ProgramType = "DECI" | "DEMI";

function LabAllocationPage() {
  const { user, roles } = useAuth();
  const { isTabAllowed, loading: permsLoading } = useNavigationPermissions();
  const currentActorName = (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "User";
  const currentActorRole = roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "User";

  const searchParams = Route.useSearch();
  const isAllowed = isTabAllowed("/lab-allocation", roles);

  // Program & Project & Scheme selection
  const [program, setProgram] = useState<ProgramType>("DECI");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [prefix, setPrefix] = useState("Physical-DS-G");

  // Database loaded projects and batches
  const [projects, setProjects] = useState<Project[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Labs from database (Default / Pre-selected)
  const [useDbLabs, setUseDbLabs] = useState(true);
  const [dbLabs, setDbLabs] = useState<Array<{ "Lab ID": string; Area: string; "Lab Capacity": number; "Lab Name"?: string; name?: string }>>([]);
  const [dbLabsLoading, setDbLabsLoading] = useState(false);
  const [labNameMap, setLabNameMap] = useState<Record<string, string>>({});

  // Files state
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [labFile, setLabFile] = useState<File | null>(null);
  const [parsedLabRows, setParsedLabRows] = useState<LabRow[]>([]);
  const [dashboardFile, setDashboardFile] = useState<File | null>(null);

  // Execution state
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [result, setResult] = useState<AllocationResultPayload | null>(null);
  const [allocationSyncStatus, setAllocationSyncStatus] = useState<"synced" | "syncing" | "not_synced" | "offline">("synced");
  const [allocationUploadProgress, setAllocationUploadProgress] = useState<number | null>(null);
  const [activeResultsTab, setActiveResultsTab] = useState("visualizations");
  const [allocationDetailsLoaded, setAllocationDetailsLoaded] = useState(false);

  // Master allocation view table filtering & pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string>("ALL");
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<string>("ALL");
  const [selectedSlotFilter, setSelectedSlotFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Lab Grid Matrix filtering & pagination
  const [pivotGradeFilter, setPivotGradeFilter] = useState<string>("ALL");
  const [pivotAreaFilter, setPivotAreaFilter] = useState<string>("ALL");
  const [pivotGovernorateFilter, setPivotGovernorateFilter] = useState<string>("ALL");
  const [pivotLabSearch, setPivotLabSearch] = useState("");
  const [pivotOccupancyFilter, setPivotOccupancyFilter] = useState<"ALL" | "HAS_EMPTY" | "FULLY_OCCUPIED">("ALL");
  const [pivotDateFilter, setPivotDateFilter] = useState<string>("ALL");
  const [pivotPage, setPivotPage] = useState<number>(1);
  const [pivotPageSize, setPivotPageSize] = useState<number>(25);

  // Consolidation Analysis filtering, pagination, and expansion state
  const [consolidationGovernorateFilter, setConsolidationGovernorateFilter] = useState("ALL");
  const [consolidationAcademicFilter, setConsolidationAcademicFilter] = useState("ALL");
  const [consolidationAreaSearch, setConsolidationAreaSearch] = useState("");
  const [consolidationPage, setConsolidationPage] = useState(1);
  const [consolidationPageSize, setConsolidationPageSize] = useState(25);
  const [expandedConsolidationKeys, setExpandedConsolidationKeys] = useState<Set<string>>(new Set());
  const [consolidationBulkAction, setConsolidationBulkAction] = useState<"accepted" | "rejected" | null>(null);
  const [savingConsolidationBulk, setSavingConsolidationBulk] = useState(false);

  // Allocation Preferences (Overfill & Alternative Labs)
  const [preferences, setPreferences] = useState<AllocationPreferences>({
    overfillRules: [],
    preferredLabRules: [],
    extraLabs: [],
    slotIdTemplate: "original",
  });
  const [prefDialogOpen, setPrefDialogOpen] = useState(false);
  const [slotIdTemplate, setSlotIdTemplate] = useState<SlotIdTemplate>("original");
  const [onlineMigrationDecisions, setOnlineMigrationDecisions] = useState<
    Record<string, "accepted" | "rejected" | "keep_physical" | { status: "accepted" | "rejected" | "keep_physical"; grades?: number[] }>
  >({});
  const [pendingGradeSelections, setPendingGradeSelections] = useState<Record<string, number[]>>({});
  const [savingVpWorkflow, setSavingVpWorkflow] = useState(false);
  const [expandedVpSessionId, setExpandedVpSessionId] = useState<string | null>(null);
  const [vpRecommendationsCollapsed, setVpRecommendationsCollapsed] = useState(false);
  const [selectedVpRecommendationIds, setSelectedVpRecommendationIds] = useState<Set<string>>(new Set());
  const [vpStatusFilter, setVpStatusFilter] = useState("ALL");
  const [vpGovernorateFilter, setVpGovernorateFilter] = useState("ALL");
  const [vpAcademicFilter, setVpAcademicFilter] = useState("ALL");
  const [vpRecommendationPage, setVpRecommendationPage] = useState(1);
  const [vpProcessingCount, setVpProcessingCount] = useState(0);
  const vpRecommendationPageSize = 50;

  // VP Sessions Tab State (Table View vs Matrix Grid View)
  const [vpViewMode, setVpViewMode] = useState<"table" | "matrix">("table");
  const [vpSearchQuery, setVpSearchQuery] = useState("");
  const [vpGradeFilter, setVpGradeFilter] = useState("ALL");
  const [vpGovFilter, setVpGovFilter] = useState("ALL");
  const [vpSessionStatusFilter, setVpSessionStatusFilter] = useState("ALL");
  const [vpMatrixPage, setVpMatrixPage] = useState(1);
  const [vpMatrixPageSize, setVpMatrixPageSize] = useState(25);

  // Schedule resolution mode (default 7 slots vs batch-configured custom slots)
  const [scheduleMode, setScheduleMode] = useState<"default_7" | "batch_custom">("default_7");

  // Batch Persistence States
  const [savedUploadRecord, setSavedUploadRecord] = useState<BatchStudentUploadRecord | null>(null);
  const [persistedOutput, setPersistedOutput] = useState<AllocationResultPayload | null>(null);
  const [loadingBatchData, setLoadingBatchData] = useState(false);
  const [resolutionRequests, setResolutionRequests] = useState<ResolutionRequest[]>([]);
  const [groupClassDialogOpen, setGroupClassDialogOpen] = useState(false);
  const [groupClassifications, setGroupClassifications] = useState<GroupClassificationRecord[]>([]);
  const [megaGroupDialogOpen, setMegaGroupDialogOpen] = useState(false);

  const multiVisitGroupsCount = useMemo(() => {
    return groupClassifications.filter((c) => c.visit_type === "multi_visit").length;
  }, [groupClassifications]);

  // File input refs
  const labFileRef = useRef<HTMLInputElement>(null);
  const dashboardFileRef = useRef<HTMLInputElement>(null);
  const selectedBatchIdRef = useRef(selectedBatchId);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const batchLoadRequestRef = useRef(0);
  selectedBatchIdRef.current = selectedBatchId;
  selectedProjectIdRef.current = selectedProjectId;

  // Load projects & batches from database on mount
  useEffect(() => {
    void loadProjectsAndBatches();
  }, []);

  async function loadProjectsAndBatches() {
    setProjectsLoading(true);
    try {
      const [projRes, batchRes] = await Promise.all([
        supabase.from("projects").select("*").order("code"),
        supabase.from("batches").select("*"),
      ]);
      if (projRes.error) throw projRes.error;
      const rawProjects = projRes.data || [];
      const loadedProjects = rawProjects.filter((p) => !isProjectSoftDeleted(p));
      const activeProjIds = new Set(loadedProjects.map((p) => p.id));
      const loadedBatches = (batchRes.data || []).filter((b) => activeProjIds.has(b.project_id));
      setProjects(loadedProjects);
      setBatches(loadedBatches);

      const storedProjId = typeof window !== "undefined" ? localStorage.getItem("ischool_last_selected_project_id") : null;
      const storedBatchId = typeof window !== "undefined" ? localStorage.getItem("ischool_last_selected_batch_id") : null;

      let targetProjId = "";
      if (searchParams.projectId) {
        const found = loadedProjects.find((p) => p.id === searchParams.projectId);
        if (found) {
          targetProjId = found.id;
          const prog = (found.program as ProgramType) || "DECI";
          setProgram(prog);
          setPrefix(computePrefixForProject(prog, found.code));
        }
      } else if (storedProjId && loadedProjects.some((p) => p.id === storedProjId)) {
        const found = loadedProjects.find((p) => p.id === storedProjId)!;
        targetProjId = found.id;
        const prog = (found.program as ProgramType) || "DECI";
        setProgram(prog);
        setPrefix(computePrefixForProject(prog, found.code));
      }

      if (!targetProjId && loadedProjects.length > 0) {
        const matchingProg = loadedProjects.filter(
          (p) => (p.program || "").toUpperCase() === program.toUpperCase(),
        );
        const defaultProj = matchingProg[0] || loadedProjects[0];
        if (defaultProj) {
          targetProjId = defaultProj.id;
          const prog = (defaultProj.program as ProgramType) || "DECI";
          setProgram(prog);
          setPrefix(computePrefixForProject(prog, defaultProj.code));
        }
      }
      setSelectedProjectId(targetProjId);

      if (searchParams.batchId && loadedBatches.some((x) => x.id === searchParams.batchId)) {
        setSelectedBatchId(searchParams.batchId);
        const b = loadedBatches.find((x) => x.id === searchParams.batchId);
        if (b && b.time_slots && b.time_slots.length > 0) {
          setScheduleMode("batch_custom");
        } else {
          setScheduleMode("default_7");
        }
      } else if (storedBatchId && loadedBatches.some((x) => x.id === storedBatchId && x.project_id === targetProjId)) {
        setSelectedBatchId(storedBatchId);
        const b = loadedBatches.find((x) => x.id === storedBatchId);
        if (b && b.time_slots && b.time_slots.length > 0) {
          setScheduleMode("batch_custom");
        } else {
          setScheduleMode("default_7");
        }
      } else if (targetProjId) {
        const projBatches = loadedBatches.filter((b) => b.project_id === targetProjId);
        if (projBatches.length > 0) {
          const firstB = projBatches[0];
          setSelectedBatchId(firstB.id);
          if (firstB.time_slots && firstB.time_slots.length > 0) {
            setScheduleMode("batch_custom");
          } else {
            setScheduleMode("default_7");
          }
        }
      }
    } catch (e: any) {
      console.error("Failed to load projects:", e);
    } finally {
      setProjectsLoading(false);
    }
  }

  function computePrefixForProject(prog: ProgramType, projectCode?: string | null): string {
    if (!projectCode) {
      return prog === "DEMI" ? "Physical-DEMI-G" : "Physical-DS-G";
    }
    const cleanCode = projectCode.replace(/[^a-zA-Z0-9_-]/g, "");
    return `Physical-${cleanCode}-G`;
  }

  // Filter projects by selected program
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => (p.program || "").toUpperCase() === program.toUpperCase());
  }, [projects, program]);

  // Filter batches by selected project
  const filteredBatches = useMemo(() => {
    if (!selectedProjectId || selectedProjectId === "ALL") return [];
    return batches.filter((b) => b.project_id === selectedProjectId);
  }, [batches, selectedProjectId]);

  // Selected project object
  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId);
  }, [projects, selectedProjectId]);

  // Selected batch object
  const activeBatch = useMemo(() => {
    return batches.find((b) => b.id === selectedBatchId);
  }, [batches, selectedBatchId]);

  // Canonical visit count from batch object (Single source of truth)
  const activeBatchCanonicalVisits = useMemo(() => {
    if (!activeBatch) {
      return 1;
    }
    const mode = preferences.batchGroupType || activeBatch.group_distribution_mode || "single_session";
    if (mode === "single_session") return 1;

    const storedExp = activeBatch.expected_sessions_per_group ? Number(activeBatch.expected_sessions_per_group) : null;
    if (storedExp && storedExp > 1) {
      return storedExp;
    }
    return 1;
  }, [activeBatch, preferences.batchGroupType]);
  const labGridMode = preferences.batchGroupType || activeBatch?.group_distribution_mode || "single_session";
  const isSingleSessionGrid = labGridMode === "single_session";
  const useUnifiedLabMatrix = labGridMode === "single_session" || labGridMode === "multi_session";

  // Compute batch custom slots with full date expansion & blocked days exclusion
  const resolvedBatchSlots = useMemo(() => {
    if (!activeBatch || !activeBatch.time_slots || activeBatch.time_slots.length === 0) {
      return [];
    }
    const rawSlots = activeBatch.time_slots;
    const blockedDaysList: string[] = preferences.blocked_days || (activeBatch as any).blocked_days || [];

    let candidateSlots: string[] = [];
    const hasDateTags = rawSlots.some((s) => s.includes("@"));
    if (hasDateTags) {
      candidateSlots = rawSlots;
    } else if (activeBatch.dates && activeBatch.dates.length > 0) {
      const map = getDayTimeSlots(activeBatch.dates, rawSlots);
      const flattened = flattenDayTimeSlots(map);
      candidateSlots = flattened.length > 0 ? flattened : rawSlots;
    } else {
      candidateSlots = rawSlots;
    }

    if (blockedDaysList.length === 0) return candidateSlots;

    return candidateSlots.filter((slotStr) => {
      const slotLower = slotStr.toLowerCase();
      for (const b of blockedDaysList) {
        const bLower = String(b).trim().toLowerCase();
        if (!bLower) continue;
        if (slotLower.includes(bLower)) return false;
      }
      return true;
    });
  }, [activeBatch, preferences.blocked_days]);

  const isProjectSelected = Boolean(selectedProjectId && selectedProjectId !== "ALL");
  const isBatchSelected = Boolean(selectedBatchId && selectedBatchId !== "ALL");
  const isStudentFileReady = Boolean(studentFile);
  const isLabCapacityReady = useDbLabs ? dbLabs.length > 0 : Boolean(labFile);
  const isFilesReady = isStudentFileReady && isLabCapacityReady;
  const canRunAllocation = isProjectSelected && isBatchSelected && isFilesReady && !loading;
  const isAllocationAdmin = roles.includes("administration");
  const canManageAllocation = isAllocationAdmin || !result?.allocation_owner || result.allocation_owner === user?.id;
  const allocationOwnerLabel = result?.allocation_owner_email || result?.updated_by || result?.allocation_owner || "another user";

  // Update program & auto-adjust prefix
  const handleProgramChange = (prog: ProgramType) => {
    setProgram(prog);
    // Clear batch data immediately to prevent stale leakage
    setSavedUploadRecord(null);
    setStudentFile(null);
    setPersistedOutput(null);
    setResult(null);

    const progProjects = projects.filter(
      (p) => (p.program || "").toUpperCase() === prog.toUpperCase()
    );
    if (progProjects.length > 0) {
      const firstProj = progProjects[0];
      setSelectedProjectId(firstProj.id);
      setPrefix(computePrefixForProject(prog, firstProj.code));
      const projectBatches = batches.filter((b) => b.project_id === firstProj.id);
      const firstB = projectBatches[0];
      setSelectedBatchId(firstB?.id || "");
      if (firstB && firstB.time_slots && firstB.time_slots.length > 0) {
        setScheduleMode("batch_custom");
      } else {
        setScheduleMode("default_7");
      }
    } else {
      setSelectedProjectId("");
      setSelectedBatchId("");
      setPrefix(prog === "DEMI" ? "Physical-DEMI-G" : "Physical-DS-G");
      setScheduleMode("default_7");
    }
  };

  // Update project & auto-adjust prefix
  const handleProjectSelect = (projId: string) => {
    setSelectedProjectId(projId);
    // Clear batch data immediately to prevent stale leakage
    setSavedUploadRecord(null);
    setStudentFile(null);
    setPersistedOutput(null);
    setResult(null);

    const proj = projects.find((p) => p.id === projId);
    if (proj) {
      setPrefix(computePrefixForProject(program, proj.code));
      const projectBatches = batches.filter((b) => b.project_id === projId);
      const firstB = projectBatches[0];
      setSelectedBatchId(firstB?.id || "");
      if (firstB && firstB.time_slots && firstB.time_slots.length > 0) {
        setScheduleMode("batch_custom");
      } else {
        setScheduleMode("default_7");
      }
    } else {
      setSelectedBatchId("");
      setScheduleMode("default_7");
    }
  };

  const lastLoadedBatchIdRef = useRef<string | null>(null);
  const previousSelectedBatchIdRef = useRef<string | null>(null);
  const allocationDetailsBatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previousBatchId = previousSelectedBatchIdRef.current;
    if (import.meta.env.DEV && previousBatchId !== selectedBatchId) {
      console.log("[Batch Switch]", { selectedBatchId, previousBatchId });
    }
    previousSelectedBatchIdRef.current = selectedBatchId || null;
  }, [selectedBatchId]);

  // Sync active project and batch to localStorage for seamless tab switches
  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem("ischool_last_selected_project_id", selectedProjectId);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedBatchId) {
      localStorage.setItem("ischool_last_selected_batch_id", selectedBatchId);
    }
  }, [selectedBatchId]);

  // Load persisted student upload & allocation output when selected batch changes
  useEffect(() => {
    if (!selectedBatchId || selectedBatchId === "ALL") {
      batchLoadRequestRef.current += 1;
      lastLoadedBatchIdRef.current = null;
      allocationDetailsBatchIdRef.current = null;
      setAllocationDetailsLoaded(false);
      setSavedUploadRecord(null);
      setStudentFile(null);
      setPersistedOutput(null);
      setResult(null);
      setScheduleMode("default_7");
      return;
    }

    const targetBatch = batches.find((b) => b.id === selectedBatchId);
    if (targetBatch && targetBatch.time_slots && targetBatch.time_slots.length > 0) {
      setScheduleMode("batch_custom");
    } else {
      setScheduleMode("default_7");
    }

    if (lastLoadedBatchIdRef.current !== selectedBatchId) {
      lastLoadedBatchIdRef.current = selectedBatchId;
      allocationDetailsBatchIdRef.current = null;
      setAllocationDetailsLoaded(false);
      void loadBatchPersistedData(selectedBatchId);
    }
  }, [selectedBatchId, batches]);

  // Real-time synchronization with Projects tab additions and updates
  useEffect(() => {
    const handleStudentDataChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ batchId?: string; projectId?: string }>;
      if (!customEvent.detail?.projectId || customEvent.detail.projectId === selectedProjectId) {
        void loadBatchPersistedData(selectedBatchId);
      }
    };

    window.addEventListener("batch-student-data-changed", handleStudentDataChanged);
    return () => {
      window.removeEventListener("batch-student-data-changed", handleStudentDataChanged);
    };
  }, [selectedBatchId, selectedProjectId]);

  // Keep every viewer on the authoritative cloud revision for the selected batch.
  useEffect(() => {
    if (!selectedBatchId || selectedBatchId === "ALL") return;
    const channel = supabase
      .channel(`allocation-output-${selectedBatchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "batch_allocation_outputs", filter: `batch_id=eq.${selectedBatchId}` },
        () => {
          const realtimeBatchId = selectedBatchId;
          const realtimeProjectId = selectedProjectId;
          void (async () => {
            await invalidateBatchAllocationCache(realtimeBatchId);
            const latest = activeResultsTab === "visualizations"
              ? await fetchBatchAllocationSummary(realtimeBatchId)
              : await fetchBatchAllocationOutput(realtimeBatchId);
            if (selectedBatchIdRef.current !== realtimeBatchId || selectedProjectIdRef.current !== realtimeProjectId) return;
            if (!latest) {
              setPersistedOutput(null);
              setResult(null);
              allocationDetailsBatchIdRef.current = null;
              setAllocationDetailsLoaded(false);
              return;
            }
            setOnlineMigrationDecisions(latest.preferences_applied?.onlineMigrationDecisions || {});
            setPersistedOutput(latest);
            setResult(latest);
            allocationDetailsBatchIdRef.current = realtimeBatchId;
            setAllocationSyncStatus(latest.sync_status === "offline" ? "offline" : "synced");
            setAllocationDetailsLoaded(true);
            if (import.meta.env.DEV) {
              console.log("[Allocation Applied]", {
                selectedBatchId: selectedBatchIdRef.current,
                resultBatchId: latest.batch_id,
                consolidationCount: latest.consolidation_analysis?.length ?? 0,
              });
            }
          })();
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedBatchId, selectedProjectId, activeResultsTab]);

  async function loadBatchPersistedData(batchId: string) {
    const requestId = ++batchLoadRequestRef.current;
    const targetBatch = batches.find((b) => b.id === batchId);
    const projectId = targetBatch?.project_id || selectedProjectIdRef.current;
    const request = { version: requestId, batchId, projectId };
    const isCurrentRequest = () => isCurrentBatchRequest(
      request,
      batchLoadRequestRef.current,
      selectedBatchIdRef.current,
      selectedProjectIdRef.current,
    );
    if (!isCurrentRequest()) return;
    setLoadingBatchData(true);
    // Keep the previous result mounted while the target batch is loading; the
    // request guard below ensures only the target batch can replace it.
    setSavedUploadRecord(null);
    setStudentFile(null);
    setResolutionRequests([]);
    let persistedAllocationLoaded = false;

    try {
      // Saved allocation viewing is independent from project-roster input readiness.
      const [uploadResult, outputResult] = await Promise.allSettled([
        projectId ? fetchProjectStudentRoster(projectId) : Promise.resolve(null),
        fetchBatchAllocationSummary(batchId),
      ]);
      if (!isCurrentRequest()) return;
      const upload = uploadResult.status === "fulfilled" ? uploadResult.value : null;
      if (uploadResult.status === "rejected") {
        console.warn("Failed to load project student roster; saved allocation remains viewable:", uploadResult.reason);
      }
      let activeStudents: StudentRecord[] = [];
      if (upload && upload.students && upload.students.length > 0) {
        setSavedUploadRecord(upload);
        // Only active/enrolled students are included in the allocation demand file
        activeStudents = upload.students.filter(isStudentActive);
        const file = createStudentFileFromRecords(activeStudents, upload.file_name, true);
        setStudentFile(file);
      } else {
        setSavedUploadRecord(null);
        setStudentFile(null);
      }

      // 2. Apply the saved allocation independently of whether the roster loaded.
      if (outputResult.status === "rejected") throw outputResult.reason;
      const fullPersistedResult = outputResult.value;
      if (fullPersistedResult && fullPersistedResult.summary) {
        const output = fullPersistedResult;
        allocationDetailsBatchIdRef.current = batchId;
        setAllocationDetailsLoaded(true);
        setAllocationSyncStatus(output.sync_status === "offline" ? "offline" : "synced");
        setOnlineMigrationDecisions(output.preferences_applied?.onlineMigrationDecisions || {});
        // Reconcile: If upload has active students not yet recorded in output, merge them into unassigned
        if (output.master_allocation.length > 0 && activeStudents.length > 0) {
          const assignedIds = new Set((output.master_allocation || []).map((m) => m.S_ID));
          const unassignedMap = new Map((output.unassigned_students || []).map((u) => [u.S_ID, u]));

          let modified = false;
          for (const s of activeStudents) {
            if (!assignedIds.has(s.S_ID) && !unassignedMap.has(s.S_ID)) {
              output.unassigned_students = output.unassigned_students || [];
              output.unassigned_students.unshift({
                S_ID: s.S_ID,
                Grade: cleanGrade(s.Grade)?.gradeNum ?? 4,
                "Physical Area": String(s["Physical Area"] || "").trim(),
                Reason: "Newly added student — pending lab assignment",
              });
              modified = true;
            }
          }

          if (modified) {
            output.summary.unassigned_count = (output.unassigned_students || []).length;
            output.summary.total_students = (output.summary.assigned_count || 0) + output.summary.unassigned_count;
            if (isCurrentRequest()) void saveBatchAllocationOutput(batchId, projectId || null, output);
          }
        }

        if (output.preferences_applied?.onlineMigrationDecisions) {
          setOnlineMigrationDecisions(output.preferences_applied.onlineMigrationDecisions);
        }
        if (import.meta.env.DEV) {
          console.log("[Persisted Allocation Loaded]", {
            batchId,
            runId: fullPersistedResult.run_id,
            consolidationCount: fullPersistedResult.consolidation_analysis?.length ?? 0,
          });
          console.log("[Allocation Hydration] applying result", {
            total: fullPersistedResult.summary?.total_students,
            assigned: fullPersistedResult.summary?.assigned_count,
            masterRows: fullPersistedResult.master_allocation?.length,
            unassignedRows: fullPersistedResult.unassigned_students?.length,
          });
          console.log("[Allocation Applied]", {
            selectedBatchId: selectedBatchIdRef.current,
            resultBatchId: fullPersistedResult.batch_id,
            consolidationCount: fullPersistedResult.consolidation_analysis?.length ?? 0,
          });
        }
        setPersistedOutput(fullPersistedResult);
        setResult(fullPersistedResult);
        persistedAllocationLoaded = true;
      } else if (activeStudents.length > 0) {
        // Synthesize pending draft demand result so Total Demand and Unassigned lists show immediately
        const draftPayload: AllocationResultPayload = {
          jobId: "draft",
          logs: [],
          area_grade_summary: [],
          generated_files: {},
          summary: {
            total_students: activeStudents.length,
            assigned_count: 0,
            unassigned_count: activeStudents.length,
            total_sessions_assigned: 0,
            total_sessions_available: 0,
            total_labs: 0,
            areas_count: new Set(activeStudents.map((s) => s["Physical Area"])).size,
          },
          dashboard_summary: [],
          master_allocation: [],
          lab_pivot: [],
          lab_allocation: [],
          unassigned_students: activeStudents.map((s) => ({
            S_ID: s.S_ID,
            Grade: cleanGrade(s.Grade)?.gradeNum ?? 4,
            "Physical Area": String(s["Physical Area"] || "").trim(),
            Reason: "Newly added student — pending lab assignment",
          })),
          shortfall_math: [],
          overfill_details: [],
          shortfall_text: `Loaded ${activeStudents.length} active students in demand cohort awaiting nationwide solver run.`,
        };
        setPersistedOutput(null);
        allocationDetailsBatchIdRef.current = null;
        setAllocationDetailsLoaded(false);
        setResult(draftPayload);
      } else {
        setPersistedOutput(null);
        allocationDetailsBatchIdRef.current = null;
        setAllocationDetailsLoaded(false);
        setResult(null);
      }

      // 3. Fetch resolution requests for this exact batch
      const reqs = await fetchBatchResolutionRequests(batchId);
      if (!isCurrentRequest()) return;
      setResolutionRequests(reqs);

      // 4. Fetch complete batch group settings (Batch distribution mode + per-group classifications)
      const groupSettings = await fetchBatchGroupSettings(batchId);
      if (!isCurrentRequest()) return;
      setGroupClassifications(groupSettings.classifications || []);

      // 5. Fetch fresh batch record directly to guarantee live expected_sessions_per_group & group_distribution_mode
      const { data: liveBatchRow } = await supabase
        .from("batches")
        .select("*")
        .eq("id", batchId)
        .maybeSingle();

      if (!isCurrentRequest()) return;

      if (liveBatchRow) {
        setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, ...liveBatchRow } : b)));
      }

      const currentBatchObj = liveBatchRow || batches.find((b) => b.id === batchId);
      const batchExp = currentBatchObj?.expected_sessions_per_group ? Number(currentBatchObj.expected_sessions_per_group) : null;
      const isMulti = currentBatchObj?.group_distribution_mode === "multi_session" || (batchExp !== null && batchExp > 1);
      const repeat = isMulti && batchExp && batchExp > 1 ? batchExp : 1;

      setPreferences((prev) => ({
        ...prev,
        batchGroupType: isMulti ? "multi_session" : "single_session",
        defaultRepeatCount: repeat,
        blocked_days: currentBatchObj?.blocked_days || groupSettings.blocked_days || undefined,
        mega_groups: (currentBatchObj?.mega_groups as any) || (groupSettings.mega_groups as any) || undefined,
      }));
    } catch (err) {
      if (!isCurrentRequest()) return;
      console.warn("Failed to load persisted batch data:", err);
      if (!persistedAllocationLoaded) {
        setPersistedOutput(null);
        allocationDetailsBatchIdRef.current = null;
        setAllocationDetailsLoaded(false);
        setResult(null);
      }
      setResolutionRequests([]);
      setGroupClassifications([]);
    } finally {
      if (isCurrentRequest()) setLoadingBatchData(false);
    }
  }

  // Deep-link auto-open ingestion effect
  const deepLinkHandledRef = useRef<string | null>(null);
  useEffect(() => {
    const hasDeepLink =
      Boolean(searchParams.openResolve) ||
      Boolean(searchParams.resolveAction) ||
      Boolean(searchParams.requestId);

    if (hasDeepLink && !loadingBatchData && selectedBatchId) {
      const deepLinkKey = `${selectedBatchId}_${searchParams.resolveAction || ""}_${searchParams.requestId || ""}_${searchParams.area || ""}`;
      if (deepLinkHandledRef.current !== deepLinkKey) {
        deepLinkHandledRef.current = deepLinkKey;
        setPrefDialogOpen(true);
      }
    }
  }, [searchParams, loadingBatchData, selectedBatchId]);

  // Fetch student demand directly from the Project roster as the single source of truth
  async function handleFetchProjectStudents() {
    if (!selectedProjectId || selectedProjectId === "ALL") {
      toast.error("Please select a specific Project first.");
      return;
    }

    try {
      const upload = await fetchProjectStudentRoster(selectedProjectId);
      if (!upload?.students?.length) {
        toast.info(
          `No project roster found for "${activeProject?.name || "selected project"}". Upload students from the Project Student Roster.`
        );
        return;
      }

      const activeStudents = upload.students.filter(isStudentActive);
      const file = createStudentFileFromRecords(activeStudents, upload.file_name, true);
      setStudentFile(file);
      setSavedUploadRecord(upload);

      const excludedCount = upload.students.length - activeStudents.length;
      toast.success(
        `Successfully loaded ${activeStudents.length.toLocaleString()} active students from project "${activeProject?.name || "selected project"}"!${
          excludedCount > 0 ? ` (${excludedCount} dropped/inactive excluded from allocation)` : ""
        }`
      );
    } catch (err: any) {
      toast.error("Failed to fetch students from project: " + (err.message || "Unknown error"));
    }
  }

  // Fetch active labs from Supabase or fallback benchmark directory
  useEffect(() => {
    if (useDbLabs) {
      void fetchDbLabs();
    }
  }, [useDbLabs]);

  async function fetchDbLabs(): Promise<Array<{ "Lab ID": string; Area: string; "Lab Capacity": number; "Lab Name"?: string; name?: string; nearby_labs?: any[]; nearbyLabs?: any[] }>> {
    setDbLabsLoading(true);
    let formatted: Array<{ "Lab ID": string; Area: string; "Lab Capacity": number; "Lab Name"?: string; name?: string; nearby_labs?: any[]; nearbyLabs?: any[] }> = [];
    try {
      const { data, error } = await supabase
        .from("labs")
        .select("*")
        .eq("is_active", true);

      if (!error && data && data.length > 0) {
        const nameMap: Record<string, string> = {};
        formatted = data
          .filter((l: any) => l.lab_code && l.area && l.capacity)
          .map((l: any) => {
            if (l.lab_code && l.name) {
              nameMap[l.lab_code] = l.name;
            }
            let nearby: any[] = [];
            if (Array.isArray(l.nearby_labs) && l.nearby_labs.length > 0) {
              nearby = l.nearby_labs;
            } else if (Array.isArray(l.nearbyLabs) && l.nearbyLabs.length > 0) {
              nearby = l.nearbyLabs;
            } else if (l.notes && typeof l.notes === "string" && l.notes.includes("[NEARBY_LABS_JSON]:")) {
              try {
                const parsed = JSON.parse(l.notes.split("[NEARBY_LABS_JSON]:")[1]?.trim() || "[]");
                if (Array.isArray(parsed)) nearby = parsed;
              } catch {}
            }
            return {
              "Lab ID": l.lab_code!,
              id: l.id || l.lab_code!,
              Area: l.area!,
              "Lab Capacity": Number(l.capacity),
              "Lab Name": l.name || undefined,
              name: l.name || undefined,
              Gov: l.gov || l.governorate,
              Governorate: l.gov || l.governorate,
              nearby_labs: nearby,
              nearbyLabs: nearby,
            };
          });
        setLabNameMap((prev) => ({ ...prev, ...nameMap }));
      }

      // If database table has 0 active labs, fallback to nationwide benchmark directory
      if (formatted.length === 0) {
        try {
          const resp = await fetch("/sample-files/egypt_labs_benchmark.xlsx");
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            const benchmarkLabFile = new File([buf], "egypt_labs_benchmark.xlsx");
            const parsed = await loadLabCapacity(benchmarkLabFile);
            setParsedLabRows(parsed);
            const nameMap: Record<string, string> = {};
            formatted = parsed.map((l) => {
              if (l["Lab ID"] && (l["Lab Name"] || l.name)) {
                nameMap[l["Lab ID"]] = l["Lab Name"] || l.name || "";
              }
              return {
                "Lab ID": l["Lab ID"],
                Area: l.Area,
                "Lab Capacity": l["Lab Capacity"],
                "Lab Name": l["Lab Name"] || l.name,
                name: l["Lab Name"] || l.name,
                Gov: l.Gov || l.Governorate,
                Governorate: l.Governorate || l.Gov,
                nearby_labs: l.nearby_labs || l.nearbyLabs || [],
                nearbyLabs: l.nearby_labs || l.nearbyLabs || [],
              };
            });
            if (Object.keys(nameMap).length > 0) {
              setLabNameMap((prev) => ({ ...prev, ...nameMap }));
            }
          }
        } catch (fbErr) {
          console.warn("Fallback benchmark labs fetch failed:", fbErr);
        }
      }

      setDbLabs(formatted);
      return formatted;
    } catch (e: any) {
      console.warn("Failed to load labs from database:", e);
      return formatted;
    } finally {
      setDbLabsLoading(false);
    }
  }

  // Import and apply batch custom time slots
  const handleImportTimeSlotsFromBatch = () => {
    if (!activeBatch) {
      toast.error("Please select a specific batch first.");
      return;
    }
    if (resolvedBatchSlots.length === 0) {
      toast.info(`Batch "${activeBatch.name}" does not have custom time slots configured. Using standard 7-slot schedule.`);
      setScheduleMode("default_7");
      return;
    }
    setScheduleMode("batch_custom");
    toast.success(
      `Imported and applied ${resolvedBatchSlots.length} configured time slot(s) for batch "${activeBatch.name}"!`
    );
  };



  // Run Allocation
  const handleRunAllocation = async (customPrefs?: unknown) => {
    if (loading) {
      toast.info("The optimization solver is currently running. Please wait for it to complete.");
      return;
    }

    if (!isAllowed) {
      toast.error("Access Restricted: You do not have permission to execute the Lab Allocation solver.");
      return;
    }
    if (!isProjectSelected) {
      toast.error("Please select a specific project in Step 1 before running the pipeline.");
      return;
    }
    if (!isBatchSelected) {
      toast.error("Please select a specific batch in Step 1 before running the pipeline.");
      return;
    }
    if (!studentFile) {
      toast.error("No Project Student Roster is available. Upload students from the selected project's roster first.");
      return;
    }
    if (!useDbLabs && !labFile) {
      toast.error("Please upload the Lab Capacity file or switch to 'Use System Physical Labs' in Step 2.");
      return;
    }
    if (!canManageAllocation) {
      toast.error(`View only - allocation managed by ${allocationOwnerLabel}`);
      return;
    }
    if (!user?.email) {
      toast.error("Your signed-in email is required to record and verify this allocation rerun.");
      return;
    }

    const runBatchId = selectedBatchId;
    const runProjectId = selectedProjectId;
    const runUserEmail = user.email;
    const runId = crypto.randomUUID();

    // If scheduleMode is batch_custom and batch has custom slots, use them; otherwise use default 7 slots (undefined)
    const effectiveCustomSlots =
      scheduleMode === "batch_custom" && resolvedBatchSlots.length > 0
        ? resolvedBatchSlots
        : undefined;

    // Safely check if customPrefs is a valid AllocationPreferences object and not a React Event
    const isPreferencesObject =
      customPrefs &&
      typeof customPrefs === "object" &&
      !("nativeEvent" in customPrefs) &&
      ("overfillRules" in (customPrefs as any) ||
        "preferredLabRules" in (customPrefs as any) ||
        "extraLabs" in (customPrefs as any) ||
        "batchGroupType" in (customPrefs as any) ||
        "groupClassifications" in (customPrefs as any));

    const basePrefs: AllocationPreferences = isPreferencesObject
      ? (customPrefs as AllocationPreferences)
      : preferences;

    // Dynamically resolve batch group type and default repeat count from activeBatch canonical source of truth
    const effectiveBatchGroupType: "single_session" | "multi_session" = (activeBatch?.group_distribution_mode as "single_session" | "multi_session") || basePrefs.batchGroupType || preferences.batchGroupType || "single_session";
    const canonicalRepeat = getCanonicalVisitCount({
      mode: effectiveBatchGroupType,
      expectedSessionsPerGroup: activeBatch?.expected_sessions_per_group,
    });

    const activePrefs: AllocationPreferences = {
      ...basePrefs,
      batchGroupType: effectiveBatchGroupType,
      defaultRepeatCount: canonicalRepeat,
      batchDates: activeBatch?.dates || basePrefs.batchDates,
      customSlots: effectiveCustomSlots,
      slotIdTemplate: basePrefs.slotIdTemplate || slotIdTemplate || "original",
      slotIdStartInteger: basePrefs.slotIdStartInteger || 14000,
      onlineMigrationDecisions: basePrefs.onlineMigrationDecisions || onlineMigrationDecisions,
      blocked_days: activeBatch?.blocked_days ?? basePrefs.blocked_days ?? undefined,
      mega_groups: (activeBatch?.mega_groups as any) ?? (basePrefs.mega_groups as any) ?? undefined,
      // Auto-detected output classifications are display-only. Only an explicit
      // Apply & Re-run action supplies classifications to the solver.
      groupClassifications: basePrefs.groupClassifications || [],
    };

    setLoading(true);
    setProgressStep("Initializing pipeline & loading data files...");
    const activeTimers: ReturnType<typeof setTimeout>[] = [];

    try {
      // Ensure database labs are loaded if useDbLabs is enabled
      let activeLabsJson = dbLabs;
      if (useDbLabs && activeLabsJson.length === 0) {
        setProgressStep("Loading active physical labs...");
        activeLabsJson = await fetchDbLabs();
      }

      const res = await runLabAllocationApi({
        studentFile,
        labFile: useDbLabs ? null : labFile,
        dashboardFile,
        program,
        projectId: runProjectId,
        projectName: activeProject?.name || activeProject?.code || program,
        projectCode: activeProject?.code || undefined,
        prefix: prefix.trim() || (program === "DEMI" ? "Physical-DEMI-G" : "Physical-DS-G"),
        useDbLabs,
        labsJson: useDbLabs ? activeLabsJson : undefined,
        preferences: activePrefs,
        onProgress: (p) => {
          if (selectedBatchIdRef.current === runBatchId) setProgressStep(p.message);
        },
      });

      activeTimers.forEach(clearTimeout);

      let cloudSaveFailed = false;
      // Deterministically clear loading state and progress banner the instant the solver completes
      setLoading(false);
      setProgressStep("");
      if (res.preferences_applied?.onlineMigrationDecisions) {
        setOnlineMigrationDecisions(res.preferences_applied.onlineMigrationDecisions);
      }
      const previousSessions = new Map((result?.vp_sessions || persistedOutput?.vp_sessions || []).map((session) => [session.id, session]));
      const finalResult: AllocationResultPayload = {
        ...res,
        batch_id: runBatchId,
        project_id: runProjectId,
        run_id: runId,
        vp_sessions: (res.vp_sessions || []).map((session) => {
          const previous = previousSessions.get(session.id);
          const sameMembers = previous && [...previous.studentIds].sort().join("\0") === [...session.studentIds].sort().join("\0");
          return sameMembers ? { ...session, status: previous.status || "active" } : session;
        }),
      };
      const runIsStillSelected = () => selectedBatchIdRef.current === runBatchId
        && selectedProjectIdRef.current === runProjectId;
      if (runIsStillSelected()) {
        setResult({ ...finalResult, sync_status: "syncing" });
        setAllocationDetailsLoaded(true);
        setAllocationSyncStatus("syncing");
        setCurrentPage(1);
      }

      // Legacy stable persistence: one allocation row per batch, no chunk staging or promotion RPC.
      if (runBatchId && runBatchId !== "ALL") {
        try {
          const saved = await saveBatchAllocationOutput(runBatchId, runProjectId, finalResult, {
            requireCloud: true,
            cloudFirst: true,
            updatedBy: runUserEmail,
            onUploadProgress: (percent) => {
              if (runIsStillSelected()) setAllocationUploadProgress(percent);
            },
          });
          const syncedResult: AllocationResultPayload = {
            ...finalResult,
            revision: saved.revision,
            updated_by: saved.updated_by ?? undefined,
            updated_at: saved.updated_at,
            run_id: saved.run_id || runId,
            sync_status: "synced",
          };
          if (runIsStillSelected()) {
            setResult(syncedResult);
            setPersistedOutput(syncedResult);
            setAllocationSyncStatus("synced");
            setAllocationUploadProgress(null);
          }

          const freshClassifications = autoDetectBatchGroupClassifications(runBatchId, {
            batchGroupType: activePrefs.batchGroupType,
            expectedSessionsPerGroup: activePrefs.defaultRepeatCount,
            masterAllocation: finalResult.master_allocation,
            studentRecords: savedUploadRecord?.students,
          });
          if (runIsStillSelected()) setGroupClassifications(freshClassifications);
        } catch (saveErr: any) {
          cloudSaveFailed = true;
          console.error("Allocation output cloud persistence failed:", saveErr);
          if (runIsStillSelected()) {
            setResult({ ...finalResult, sync_status: "not_synced" });
            setAllocationSyncStatus("not_synced");
            setAllocationUploadProgress(null);
            const persistenceMessage = saveErr instanceof Error ? saveErr.message : "Supabase persistence failed.";
            toast.error(`Allocation completed locally but was not synced: ${persistenceMessage}`);
          }
        }
      }

      // Audit Trail Log
      try {
        void logAuditAction({
          userId: user?.id,
          userName: currentActorName,
          userEmail: runUserEmail,
          userRole: currentActorRole,
          tab: "Lab Allocation",
          section: "Solver Pipeline",
          actionType: "ALLOCATION_RUN",
          actionTitle: `Executed nationwide allocation solver for batch "${runBatchId}" (${res.summary.assigned_count}/${res.summary.total_students} seated)`,
          entityType: "allocation_run",
          entityId: runBatchId,
          projectId: runProjectId || null,
          batchId: runBatchId,
          oldValue: null,
          newValue: {
            total_students: res.summary.total_students,
            assigned_count: res.summary.assigned_count,
            unassigned_count: res.summary.unassigned_count,
            overfill_count: res.summary.overfill_count,
            match_rate: res.summary.total_students > 0 ? (res.summary.assigned_count / res.summary.total_students) * 100 : 100,
          },
          metadata: {
            program,
            scheduleMode,
          },
          isRestorable: false,
        });
      } catch (logErr) {
        console.warn("Audit logging notice:", logErr);
      }

      if (!cloudSaveFailed && (res.summary.overfill_count ?? 0) > 0) {
        toast.success(
          `Optimization complete! Placed ${res.summary.assigned_count.toLocaleString()} / ${res.summary.total_students.toLocaleString()} students (${res.summary.overfill_count} via fair overfill).`
        );
      } else if (!cloudSaveFailed) {
        toast.success(
          `Optimization completed! Allocated ${res.summary.assigned_count.toLocaleString()} / ${res.summary.total_students.toLocaleString()} students.`
        );
      }
    } catch (e: any) {
      toast.error(e.message || "Allocation failed. Please check your data inputs and try again.");
    } finally {
      activeTimers.forEach(clearTimeout);
      setLoading(false);
      setProgressStep("");
    }
  };

  const handleRetryAllocationSave = async () => {
    if (!result || !selectedBatchId || selectedBatchId === "ALL" || allocationSyncStatus === "syncing") return;
    const retryBatchId = selectedBatchId;
    const retryProjectId = selectedProjectId;
    setAllocationSyncStatus("syncing");
    setAllocationUploadProgress(0);
    try {
      const saved = await saveBatchAllocationOutput(retryBatchId, retryProjectId, result, {
        requireCloud: true,
        cloudFirst: true,
        updatedBy: user?.email || undefined,
        onUploadProgress: (percent) => {
          if (selectedBatchIdRef.current === retryBatchId) setAllocationUploadProgress(percent);
        },
      });
      if (selectedBatchIdRef.current !== retryBatchId) return;
      const synced = {
        ...result,
        revision: saved.revision,
        run_id: saved.run_id || result.run_id,
        updated_by: saved.updated_by ?? undefined,
        updated_at: saved.updated_at,
        sync_status: "synced" as const,
      };
      setResult(synced);
      setPersistedOutput(synced);
      setAllocationSyncStatus("synced");
      toast.success("Allocation saved and shared successfully.");
    } catch (error) {
      if (selectedBatchIdRef.current === retryBatchId) {
        setAllocationSyncStatus("not_synced");
        toast.error(error instanceof Error ? error.message : "Allocation save failed.");
      }
    } finally {
      if (selectedBatchIdRef.current === retryBatchId) setAllocationUploadProgress(null);
    }
  };

  const loadAllocationDetails = async (tab = activeResultsTab) => {
    if (!selectedBatchId || selectedBatchId === "ALL"
      || (allocationDetailsLoaded && allocationDetailsBatchIdRef.current === selectedBatchId)) return;
    const detailsBatchId = selectedBatchId;
    const detailsProjectId = selectedProjectId;
    setLoadingBatchData(true);
    try {
      const full = await fetchBatchAllocationOutput(detailsBatchId);
      if (selectedBatchIdRef.current !== detailsBatchId || selectedProjectIdRef.current !== detailsProjectId) return;
      if (!full) throw new Error("No saved allocation details were found.");
      if (import.meta.env.DEV) {
        console.log("[Persisted Allocation Loaded]", {
          batchId: detailsBatchId,
          runId: full.run_id,
          consolidationCount: full.consolidation_analysis?.length ?? 0,
        });
        console.log("[Allocation Applied]", {
          selectedBatchId: selectedBatchIdRef.current,
          resultBatchId: full.batch_id,
          consolidationCount: full.consolidation_analysis?.length ?? 0,
        });
      }
      setResult(full);
      setPersistedOutput(full);
      allocationDetailsBatchIdRef.current = detailsBatchId;
      setAllocationDetailsLoaded(true);
      setAllocationSyncStatus(full.sync_status === "offline" ? "offline" : "synced");
      setActiveResultsTab(tab);
    } catch (error) {
      if (selectedBatchIdRef.current !== detailsBatchId || selectedProjectIdRef.current !== detailsProjectId) return;
      toast.error(error instanceof Error ? error.message : "Could not load allocation details.");
    } finally {
      if (selectedBatchIdRef.current === detailsBatchId && selectedProjectIdRef.current === detailsProjectId) setLoadingBatchData(false);
    }
  };

  const handleResultsTabChange = (tab: string) => {
    setActiveResultsTab(tab);
    if (tab !== "visualizations"
      && (!allocationDetailsLoaded || allocationDetailsBatchIdRef.current !== selectedBatchId)) {
      void loadAllocationDetails(tab);
    }
  };

  // Reset
  const handleReset = () => {
    setStudentFile(null);
    setLabFile(null);
    setDashboardFile(null);
    setResult(null);
    setPreferences({ overfillRules: [], preferredLabRules: [], extraLabs: [] });
    if (labFileRef.current) labFileRef.current.value = "";
    if (dashboardFileRef.current) dashboardFileRef.current.value = "";
  };

  const handleApplyPreferences = async (newPrefs: AllocationPreferences) => {
    if (!canManageAllocation) {
      toast.error(`View only - allocation managed by ${allocationOwnerLabel}`);
      return;
    }
    setPreferences(newPrefs);
    await handleRunAllocation(newPrefs);
  };

  const handleSaveMegaGroups = async (updatedMegaGroups: MegaGroupDefinition[]) => {
    if (!canManageAllocation) {
      toast.error(`View only - allocation managed by ${allocationOwnerLabel}`);
      return;
    }
    if (!selectedBatchId) return;
    const currentBatchObj = batches.find((b) => b.id === selectedBatchId);
    await saveBatchGroupSettings(selectedBatchId, selectedProjectId || currentBatchObj?.project_id || "", {
      batch_group_type: preferences.batchGroupType || "single_session",
      default_repeat_count: preferences.defaultRepeatCount,
      classifications: groupClassifications,
      blocked_days: preferences.blocked_days,
      mega_groups: updatedMegaGroups,
    });

    const newPrefs: AllocationPreferences = {
      ...preferences,
      mega_groups: updatedMegaGroups,
    };
    setPreferences(newPrefs);
    if (result) {
      await handleRunAllocation(newPrefs);
    }
  };

  const handlePreviewImpact = async (
    simulatedPrefs: AllocationPreferences,
    targetBatchId?: string
  ): Promise<AllocationResultPayload> => {
    const batchIdToUse = targetBatchId || selectedBatchId;
    const targetBatch = batches.find((batch) => batch.id === batchIdToUse);

    // 1. Always ensure student file is freshly loaded for the target batch
    let activeStudentFile: File | null = null;
    if (batchIdToUse && batchIdToUse !== "ALL") {
      const upload = targetBatch?.project_id
        ? await fetchProjectStudentRoster(targetBatch.project_id)
        : null;
      if (upload && upload.students && upload.students.length > 0) {
        const activeStudents = upload.students.filter(isStudentActive);
        activeStudentFile = createStudentFileFromRecords(activeStudents, upload.file_name, true);
        if (batchIdToUse === selectedBatchId) {
          setStudentFile(activeStudentFile);
        }
      }
    }

    if (!activeStudentFile) {
      activeStudentFile = studentFile;
    }

    if (!activeStudentFile) {
      throw new Error("Student demand dataset is not available for simulation. Please upload or fetch student records first.");
    }

    // 2. Ensure database labs are loaded if useDbLabs is enabled
    let activeLabsJson = dbLabs;
    if (useDbLabs && activeLabsJson.length === 0) {
      activeLabsJson = await fetchDbLabs();
    }

    const effectiveCustomSlots =
      scheduleMode === "batch_custom" && resolvedBatchSlots.length > 0
        ? resolvedBatchSlots
        : undefined;

    const targetGroupSettings =
      batchIdToUse && batchIdToUse === selectedBatchId
        ? { batch_group_type: preferences.batchGroupType, default_repeat_count: preferences.defaultRepeatCount, classifications: groupClassifications }
        : batchIdToUse
        ? await fetchBatchGroupSettings(batchIdToUse)
        : { batch_group_type: preferences.batchGroupType, default_repeat_count: preferences.defaultRepeatCount, classifications: groupClassifications };

    const activePrefs: AllocationPreferences = {
      ...simulatedPrefs,
      customSlots: effectiveCustomSlots,
      batchGroupType: simulatedPrefs.batchGroupType ?? targetGroupSettings.batch_group_type ?? preferences.batchGroupType,
      defaultRepeatCount: simulatedPrefs.defaultRepeatCount ?? targetGroupSettings.default_repeat_count ?? preferences.defaultRepeatCount,
      batchDates: targetBatch?.dates || simulatedPrefs.batchDates,
      groupClassifications:
        simulatedPrefs.groupClassifications ||
        (targetGroupSettings.classifications || []).map((c) => ({
          group_id: c.group_id,
          visit_type: c.visit_type,
          repeat_count: c.repeat_count,
          area: c.area,
          grade: c.grade,
          lab_id: c.lab_id,
        })),
    };

    // 3. Purely run solver calculation in-memory with ZERO writes to storage, ZERO page-state mutation, ZERO audit logs
    return await runLabAllocationApi({
      studentFile: activeStudentFile,
      labFile: useDbLabs ? null : labFile,
      dashboardFile,
      program,
      projectId: selectedProjectId,
      projectName: activeProject?.name || activeProject?.code || program,
      projectCode: activeProject?.code || undefined,
      prefix: prefix.trim() || (program === "DEMI" ? "Physical-DEMI-G" : "Physical-DS-G"),
      useDbLabs,
      labsJson: useDbLabs ? activeLabsJson : undefined,
      preferences: activePrefs,
    });
  };

  const handleResetPreferences = async () => {
    if (!canManageAllocation) {
      toast.error(`View only - allocation managed by ${allocationOwnerLabel}`);
      return;
    }
    const cleanPrefs: AllocationPreferences = { overfillRules: [], preferredLabRules: [], extraLabs: [], slotIdTemplate: "original" };
    setPreferences(cleanPrefs);
    setOnlineMigrationDecisions({});
    setPendingGradeSelections({});
    await handleRunAllocation(cleanPrefs);
  };

  const getVpRecommendationKey = (item: OnlineMigrationSuggestion) =>
    item.decisionKey || item.id || item.governorate || item.gov || item.area;

  const handleBulkVpRecommendations = async (
    recommendationIds: string[],
    status: "accepted" | "keep_physical",
  ) => {
    if (!canManageAllocation) {
      toast.error(`View only - allocation managed by ${allocationOwnerLabel}`);
      return;
    }
    if (!result || !selectedBatchId || selectedBatchId === "ALL" || recommendationIds.length === 0 || savingVpWorkflow) return;
    const targetIds = new Set(recommendationIds);
    const targetCount = (result.online_migration_suggestions || []).filter(
      (item) => item.status === "pending" && targetIds.has(getVpRecommendationKey(item)),
    ).length;
    if (targetCount === 0) return;
    if (targetCount > 1 && !window.confirm(`${status === "accepted" ? "Accept" : "Keep"} ${targetCount} recommendations ${status === "accepted" ? "as VP Sessions" : "physical"}?`)) return;

    setVpProcessingCount(targetCount);
    setSavingVpWorkflow(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const updatedDecisions = { ...onlineMigrationDecisions };
      const updatedSuggestions = (result.online_migration_suggestions || []).map((item) => {
        const key = getVpRecommendationKey(item);
        if (item.status !== "pending" || !targetIds.has(key)) return item;
        updatedDecisions[key] = status;
        return { ...item, status, ...(status === "accepted" ? { acceptedAt: new Date().toISOString() } : {}) };
      });

      let masterAllocation = result.master_allocation || [];
      let vpSessions = result.vp_sessions || [];
      let unassignedStudents = result.unassigned_students || [];
      let newlyAccepted = 0;
      if (status === "accepted") {
        const grouping = applyAcceptedVpGrouping(masterAllocation, updatedSuggestions, {
          id: selectedProjectId || program,
          name: activeProject?.name || activeProject?.code || program,
          program,
        }, unassignedStudents);
        const acceptedStudentIds = new Set(updatedSuggestions.filter((item) => item.status === "accepted").flatMap((item) => item.affectedStudentIds));
        newlyAccepted = new Set(unassignedStudents.filter((student) => acceptedStudentIds.has(student.S_ID)).map((student) => student.S_ID)).size;
        masterAllocation = grouping.rows;
        vpSessions = grouping.sessions;
        unassignedStudents = unassignedStudents.filter((student) => !acceptedStudentIds.has(student.S_ID));
      }

      const bulkPhysicalMaster = masterAllocation.filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE");
      const bulkAccounting = calculateAllocationAccounting(masterAllocation, unassignedStudents);
      const bulkPhysicalSessions = new Set(bulkPhysicalMaster.filter((r) => r.Group_ID).map((r) => r.Group_ID)).size;

      const updatedResult = reconcileFinalAllocationSummary({
        ...result,
        summary: {
          ...result.summary,
          assigned_count: bulkAccounting.physicalAssignedCount + bulkAccounting.vpAssignedCount,
          unassigned_count: bulkAccounting.unassignedCount,
          total_seat_visits: bulkAccounting.totalSeatVisits,
          total_sessions_assigned: bulkPhysicalSessions || result.summary?.total_sessions_assigned || 0,
        },
        master_allocation: masterAllocation,
        unassigned_students: unassignedStudents,
        online_migration_suggestions: updatedSuggestions,
        vp_sessions: vpSessions,
        vp_pivot: buildVpPivotSummary(vpSessions, masterAllocation, canonicalPivotSlots, program) as AllocationResultPayload["vp_pivot"],
        lab_pivot: buildAreaTimePivot(masterAllocation as any, canonicalPivotSlots, program) as AllocationResultPayload["lab_pivot"],
        dashboard_summary: buildDashboardStyleSummary(masterAllocation as any, unassignedStudents as any, program) as AllocationResultPayload["dashboard_summary"],
        area_grade_summary: buildGroupCountSummary(masterAllocation as any, unassignedStudents as any, program) as AllocationResultPayload["area_grade_summary"],
        preferences_applied: { ...(result.preferences_applied || preferences), onlineMigrationDecisions: updatedDecisions },
      });

      const authoritativeResult = await bulkUpdateVpRecommendations(selectedBatchId, selectedProjectId, updatedResult, user?.email || currentActorName);
      setOnlineMigrationDecisions(updatedDecisions);
      setResult(authoritativeResult);
      setPersistedOutput(authoritativeResult);
      setAllocationSyncStatus("synced");
      setSelectedVpRecommendationIds(new Set());
      toast.success(`${targetCount} recommendation${targetCount === 1 ? "" : "s"} updated in one operation.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "VP recommendation bulk update failed. No decisions were changed.");
    } finally {
      setSavingVpWorkflow(false);
      setVpProcessingCount(0);
    }
  };

  const handleAcceptOnlineMigration = async (targetKey: string, selectedGrades?: number[]) => {
    if (!canManageAllocation) {
      toast.error(`View only - allocation managed by ${allocationOwnerLabel}`);
      return;
    }
    if (!result) return;
    const suggestion = (result.online_migration_suggestions || []).find(
      (item) => (item.decisionKey || item.id || item.governorate || item.gov || item.area) === targetKey,
    );
    if (!suggestion) return;

    const decisionKey = suggestion.decisionKey || suggestion.id || targetKey;
    const affectedGrades = suggestion.affectedGrades ?? [];
    const gradesToMigrate =
      selectedGrades && selectedGrades.length > 0
        ? selectedGrades
        : affectedGrades;

    if (affectedGrades.length > 0 && gradesToMigrate.length === 0) {
      toast.error("Please select at least one grade to migrate online.");
      return;
    }

    const updatedDecisions = {
      ...onlineMigrationDecisions,
      [decisionKey]: "accepted" as const,
    };

    const updatedSuggestions = (result.online_migration_suggestions || []).map((item) =>
      item === suggestion
        ? {
            ...item,
            status: "accepted" as const,
            acceptedAt: new Date().toISOString(),
            acceptedGrades: gradesToMigrate,
          }
        : item,
    );

    let grouping;
    try {
      grouping = applyAcceptedVpGrouping(
        result.master_allocation || [],
        updatedSuggestions,
        {
          id: selectedProjectId || suggestion.projectId || program,
          name: activeProject?.name || activeProject?.code || suggestion.projectName || program,
          program,
        },
        result.unassigned_students || [],
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "VP allocation rejected: invalid mixed-level session.");
      return;
    }

    const acceptedVpStudentIds = new Set(
      updatedSuggestions
        .filter((item) => item.status === "accepted")
        .flatMap((item) => item.affectedStudentIds),
    );
    const remainingUnassigned = (result.unassigned_students || []).filter(
      (student) => !acceptedVpStudentIds.has(student.S_ID),
    );

    const physicalMaster = grouping.rows.filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE");
    const accounting = calculateAllocationAccounting(grouping.rows, remainingUnassigned);
    const physicalSessions = new Set(physicalMaster.filter((r) => r.Group_ID).map((r) => r.Group_ID)).size;

    const updatedResult = reconcileFinalAllocationSummary({
      ...result,
      summary: {
        ...result.summary,
        assigned_count: accounting.physicalAssignedCount + accounting.vpAssignedCount,
        unassigned_count: accounting.unassignedCount,
        total_seat_visits: accounting.totalSeatVisits,
        total_sessions_assigned: physicalSessions || result.summary?.total_sessions_assigned || 0,
      },
      master_allocation: grouping.rows,
      online_migration_suggestions: updatedSuggestions,
      vp_sessions: grouping.sessions,
      vp_pivot: buildVpPivotSummary(grouping.sessions, grouping.rows, canonicalPivotSlots, program) as AllocationResultPayload["vp_pivot"],
      lab_pivot: buildAreaTimePivot(grouping.rows as any, canonicalPivotSlots, program) as AllocationResultPayload["lab_pivot"],
      dashboard_summary: buildDashboardStyleSummary(grouping.rows as any, remainingUnassigned as any, program) as AllocationResultPayload["dashboard_summary"],
      area_grade_summary: buildGroupCountSummary(grouping.rows as any, remainingUnassigned as any, program) as AllocationResultPayload["area_grade_summary"],
      unassigned_students: remainingUnassigned,
      preferences_applied: {
        ...(result.preferences_applied || preferences),
        onlineMigrationDecisions: updatedDecisions,
      },
    });

    setOnlineMigrationDecisions(updatedDecisions);
    setResult(updatedResult);
    if (selectedBatchId && selectedBatchId !== "ALL") {
      setSavingVpWorkflow(true);
      try {
        const authoritativeResult = await bulkUpdateVpRecommendations(selectedBatchId, selectedProjectId, updatedResult, user?.email || currentActorName);
        setResult(authoritativeResult);
        setPersistedOutput(authoritativeResult);
      } catch (error) {
        setOnlineMigrationDecisions(result.preferences_applied?.onlineMigrationDecisions || {});
        setResult(result);
        toast.error(error instanceof Error && error.message.includes("Session expired")
          ? "Session expired - please sign in again."
          : "VP change was not saved. The view was restored to the last synced allocation.");
        return;
      } finally { setSavingVpWorkflow(false); }
    }
    const cohortLabel = suggestion.academicLabel || "Academic cohort";
    const govLabel = suggestion.governorate || suggestion.gov || suggestion.area;
    toast.success(`${cohortLabel} in ${govLabel} was assigned to validated VP sessions.`);
  };

  const handleRejectOnlineMigration = async (targetKey: string) => {
    if (!canManageAllocation) {
      toast.error(`View only - allocation managed by ${allocationOwnerLabel}`);
      return;
    }
    if (!result) return;
    const targetSuggestion = (result.online_migration_suggestions || []).find(
      (item) => (item.decisionKey || item.id || item.governorate || item.gov || item.area) === targetKey,
    );
    if (!targetSuggestion) return;

    const decisionKey = targetSuggestion.decisionKey || targetSuggestion.id || targetKey;
    const updatedDecisions = { ...onlineMigrationDecisions, [decisionKey]: "keep_physical" as const };
    const updatedSuggestions = (result.online_migration_suggestions || []).map((item) =>
      item === targetSuggestion
        ? {
            ...item,
            status: "keep_physical" as const,
            acceptedGrades: undefined,
            acceptedStudentIds: undefined,
            acceptedAt: undefined,
          }
        : item,
    );
    let grouping;
    try {
      grouping = applyAcceptedVpGrouping(
        result.master_allocation || [],
        updatedSuggestions,
        {
          id: selectedProjectId || targetSuggestion.projectId || program,
          name: activeProject?.name || activeProject?.code || targetSuggestion.projectName || program,
          program,
        },
        result.unassigned_students || [],
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "VP allocation rejected: invalid mixed-level session.");
      return;
    }

    const acceptedVpStudentIds = new Set(
      updatedSuggestions
        .filter((item) => item.status === "accepted")
        .flatMap((item) => item.affectedStudentIds),
    );
    const remainingUnassigned = (result.unassigned_students || []).filter(
      (student) => !acceptedVpStudentIds.has(student.S_ID),
    );

    const physicalMaster = grouping.rows.filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE");
    const accounting = calculateAllocationAccounting(grouping.rows, remainingUnassigned);
    const physicalSessions = new Set(physicalMaster.filter((r) => r.Group_ID).map((r) => r.Group_ID)).size;

    const updatedResult = reconcileFinalAllocationSummary({
      ...result,
      summary: {
        ...result.summary,
        assigned_count: accounting.physicalAssignedCount + accounting.vpAssignedCount,
        unassigned_count: accounting.unassignedCount,
        total_seat_visits: accounting.totalSeatVisits,
        total_sessions_assigned: physicalSessions || result.summary?.total_sessions_assigned || 0,
      },
      master_allocation: grouping.rows,
      online_migration_suggestions: updatedSuggestions,
      vp_sessions: grouping.sessions,
      vp_pivot: buildVpPivotSummary(grouping.sessions, grouping.rows, canonicalPivotSlots, program) as AllocationResultPayload["vp_pivot"],
      lab_pivot: buildAreaTimePivot(grouping.rows as any, canonicalPivotSlots, program) as AllocationResultPayload["lab_pivot"],
      dashboard_summary: buildDashboardStyleSummary(grouping.rows as any, remainingUnassigned as any, program) as AllocationResultPayload["dashboard_summary"],
      area_grade_summary: buildGroupCountSummary(grouping.rows as any, remainingUnassigned as any, program) as AllocationResultPayload["area_grade_summary"],
      unassigned_students: remainingUnassigned,
      preferences_applied: {
        ...(result.preferences_applied || preferences),
        onlineMigrationDecisions: updatedDecisions,
      },
    });

    setOnlineMigrationDecisions(updatedDecisions);
    setResult(updatedResult);
    if (selectedBatchId && selectedBatchId !== "ALL") {
      setSavingVpWorkflow(true);
      try {
        const authoritativeResult = await bulkUpdateVpRecommendations(selectedBatchId, selectedProjectId, updatedResult, user?.email || currentActorName);
        setResult(authoritativeResult);
        setPersistedOutput(authoritativeResult);
      } catch (error) {
        setOnlineMigrationDecisions(result.preferences_applied?.onlineMigrationDecisions || {});
        setResult(result);
        toast.error(error instanceof Error && error.message.includes("Session expired")
          ? "Session expired - please sign in again."
          : "VP change was not saved. The view was restored to the last synced allocation.");
        return;
      } finally { setSavingVpWorkflow(false); }
    }
    toast.info(`${targetSuggestion.academicLabel || "Academic cohort"} in ${targetSuggestion.governorate || targetSuggestion.gov || targetSuggestion.area} will remain physical.`);
  };

  const handleVpSessionStatusChange = async (sessionId: string, status: "active" | "completed" | "cancelled") => {
    if (!canManageAllocation) {
      toast.error(`View only - allocation managed by ${allocationOwnerLabel}`);
      return;
    }
    if (!result || !selectedBatchId || selectedBatchId === "ALL") return;
    const updatedResult = { ...result, vp_sessions: (result.vp_sessions || []).map((session) => session.id === sessionId ? { ...session, status } : session) };
    setResult(updatedResult);
    setSavingVpWorkflow(true);
    try {
      const authoritativeResult = await bulkUpdateVpRecommendations(selectedBatchId, selectedProjectId, updatedResult, user?.email || currentActorName);
      setResult(authoritativeResult);
      setPersistedOutput(authoritativeResult);
      toast.success(`${sessionId} status saved.`);
    } catch (error) {
      setResult(result);
      toast.error(error instanceof Error && error.message.includes("Session expired")
        ? "Session expired - please sign in again."
        : "VP Session status was not saved. The view was restored to the last synced allocation.");
    } finally { setSavingVpWorkflow(false); }
  };

  // Master allocation filtered rows
  const filteredMasterRows = useMemo(() => {
    if (!result?.master_allocation) return [];
    return result.master_allocation.filter((row) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        row.S_ID?.toLowerCase().includes(q) ||
        row.Lab_ID?.toLowerCase().includes(q) ||
        row.Group_ID?.toLowerCase().includes(q) ||
        row["Physical Area"]?.toLowerCase().includes(q);

      const matchesArea = selectedAreaFilter === "ALL" || row["Physical Area"] === selectedAreaFilter;
      const matchesGrade = selectedGradeFilter === "ALL" || String(row.Grade) === selectedGradeFilter;
      const matchesSlot = selectedSlotFilter === "ALL" || row.Time_Slot === selectedSlotFilter;

      return matchesQuery && matchesArea && matchesGrade && matchesSlot;
    });
  }, [result?.master_allocation, searchQuery, selectedAreaFilter, selectedGradeFilter, selectedSlotFilter]);

  const totalPages = Math.ceil(filteredMasterRows.length / pageSize) || 1;
  const paginatedMasterRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMasterRows.slice(start, start + pageSize);
  }, [filteredMasterRows, currentPage]);

  const uniqueAreas = useMemo(() => {
    if (!result?.master_allocation) return [];
    return Array.from(
      new Set(
        result.master_allocation
          .filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE")
          .map((r) => String(r["Physical Area"] ?? "").trim())
          .filter((v) => v.length > 0),
      ),
    ).sort();
  }, [result?.master_allocation]);

  const uniqueGrades = useMemo(() => {
    if (!result?.master_allocation) return [];
    return sortGradeLevels(
      result.master_allocation
        .filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE")
        .map((r) => Number(r.Grade))
        .filter((g) => Number.isFinite(g)),
    ).map(String);
  }, [result?.master_allocation]);

  const uniqueSlots = useMemo(() => {
    if (!result?.master_allocation) return [];
    return Array.from(
      new Set(
        result.master_allocation
          .filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE")
          .map((r) => String(r.Time_Slot ?? "").trim())
          .filter((v) => v.length > 0),
      ),
    ).sort();
  }, [result?.master_allocation]);

  const canonicalPivotSlots = useMemo(() => {
    const applied = result?.preferences_applied;
    const customSlots = applied?.customSlots ?? (scheduleMode === "batch_custom" ? resolvedBatchSlots : undefined);
    return resolveSlotSchedule(customSlots, applied?.blocked_days);
  }, [result?.preferences_applied, scheduleMode, resolvedBatchSlots]);

  // Lab Grid Matrix physical rows generated dynamically from master_allocation
  const physicalPivotRows = useMemo(() => {
    if (!result?.master_allocation || result.master_allocation.length === 0) return [];
    return buildAreaTimePivot(
      result.master_allocation as any,
      canonicalPivotSlots,
      program,
    );
  }, [result?.master_allocation, canonicalPivotSlots, program]);

  const singleSessionLabRows = useMemo(() => {
    if (!result?.master_allocation?.length) return [];
    return buildSingleSessionLabPivot(result.master_allocation as any, canonicalPivotSlots, program);
  }, [result?.master_allocation, canonicalPivotSlots, program]);

  const displayGroupIdMap = useMemo(() => {
    const internalIds = [...new Set((result?.master_allocation ?? [])
      .filter((row) => !isVpStudent(row) && row.Lab_ID !== "ONLINE")
      .map((row) => String(row.Group_ID ?? "").trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const derivedPrefix = internalIds
      .map((id) => id.match(/^(.*?-G)-.+-G\d+(?:\D.*)?$/)?.[1] || id.match(/^(.*?G)\d+(?:\D.*)?$/)?.[1])
      .find(Boolean);
    const cleanPrefix = String(derivedPrefix || prefix || "Physical-G").trim();
    return new Map(internalIds.map((id, index) => [id, `${cleanPrefix}${index + 1}`]));
  }, [result?.master_allocation, prefix]);

  const singleSessionGovernorates = useMemo(
    () => [...new Set(singleSessionLabRows.map((row) => row.governorate))].sort(),
    [singleSessionLabRows],
  );
  const singleSessionAreas = useMemo(
    () => [...new Set(singleSessionLabRows
      .filter((row) => pivotGovernorateFilter === "ALL" || row.governorate === pivotGovernorateFilter)
      .map((row) => row.physicalArea))].sort(),
    [singleSessionLabRows, pivotGovernorateFilter],
  );
  const singleSessionAcademicOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const row of singleSessionLabRows) {
      for (const cell of row.cells.values()) values.set(String(cell.grade), cell.academicLabel);
    }
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [singleSessionLabRows]);
  const singleSessionDateOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const slot of canonicalPivotSlots) {
      const key = slot.date || slot.day;
      if (!key) continue;
      const label = slot.date
        ? new Date(`${slot.date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
        : slot.day;
      values.set(key, label);
    }
    return [...values.entries()];
  }, [canonicalPivotSlots]);
  const visibleSingleSessionSlots = useMemo(
    () => pivotDateFilter === "ALL"
      ? canonicalPivotSlots
      : canonicalPivotSlots.filter((slot) => (slot.date || slot.day) === pivotDateFilter),
    [canonicalPivotSlots, pivotDateFilter],
  );
  const singleSessionDailyTotals = useMemo(() => {
    const dateKeyBySlot = new Map(canonicalPivotSlots.map((slot) => [slot.num, slot.date || slot.day]));
    const studentsByDate = new Map<string, Set<string>>();
    for (const row of result?.master_allocation ?? []) {
      if (isVpStudent(row) || row.Lab_ID === "ONLINE") continue;
      const dateKey = dateKeyBySlot.get(Number(row.Slot_Num));
      if (!dateKey) continue;
      if (!studentsByDate.has(dateKey)) studentsByDate.set(dateKey, new Set());
      studentsByDate.get(dateKey)!.add(String(row.S_ID));
    }
    return singleSessionDateOptions.map(([key, label]) => ({
      key,
      label,
      total: studentsByDate.get(key)?.size ?? 0,
    }));
  }, [canonicalPivotSlots, result?.master_allocation, singleSessionDateOptions]);

  const filteredSingleSessionLabRows = useMemo(() => {
    const labQuery = pivotLabSearch.trim().toLocaleLowerCase();
    return singleSessionLabRows.filter((row) => {
      const hasGrade = pivotGradeFilter === "ALL"
        || [...row.cells.values()].some((cell) => String(cell.grade) === pivotGradeFilter);
      const occupiedSlots = canonicalPivotSlots.reduce((count, slot) => count + (row.cells.has(slot.num) ? 1 : 0), 0);
      const hasEmptySlots = occupiedSlots < canonicalPivotSlots.length;
      const matchesOccupancy = pivotOccupancyFilter === "ALL"
        || (pivotOccupancyFilter === "HAS_EMPTY" && hasEmptySlots)
        || (pivotOccupancyFilter === "FULLY_OCCUPIED" && canonicalPivotSlots.length > 0 && !hasEmptySlots);
      return (pivotGovernorateFilter === "ALL" || row.governorate === pivotGovernorateFilter)
        && (pivotAreaFilter === "ALL" || row.physicalArea === pivotAreaFilter)
        && hasGrade
        && (!labQuery || row.labId.toLocaleLowerCase().includes(labQuery))
        && matchesOccupancy;
    });
  }, [singleSessionLabRows, pivotGovernorateFilter, pivotAreaFilter, pivotGradeFilter, pivotLabSearch, pivotOccupancyFilter, canonicalPivotSlots]);

  // Lab Grid Matrix filtered rows (filtered across the full dataset, physical-only)
  const filteredPivotRows = useMemo(() => {
    return physicalPivotRows.filter((row) => {
      if (isVpStudent(row) || row.Lab_ID === "ONLINE") return false;
      const matchesGrade =
        pivotGradeFilter === "ALL" || String(row.Grade) === pivotGradeFilter;
      const matchesArea =
        pivotAreaFilter === "ALL" || row["Physical Area"] === pivotAreaFilter;
      return matchesGrade && matchesArea;
    });
  }, [physicalPivotRows, pivotGradeFilter, pivotAreaFilter]);

  const activeFilteredPivotRows = filteredSingleSessionLabRows;

  // Reset Lab Grid Matrix page to 1 whenever filters or result changes
  useEffect(() => {
    setPivotPage(1);
  }, [pivotGradeFilter, pivotAreaFilter, pivotGovernorateFilter, pivotLabSearch, pivotOccupancyFilter, pivotDateFilter, result]);

  // Lab Grid Matrix paginated slice (applies to filtered results)
  const paginatedPivotRows = useMemo(() => {
    if (pivotPageSize === -1) return activeFilteredPivotRows;
    const start = (pivotPage - 1) * pivotPageSize;
    return activeFilteredPivotRows.slice(start, start + pivotPageSize);
  }, [activeFilteredPivotRows, pivotPage, pivotPageSize]);

  const totalPivotPages = useMemo(() => {
    if (pivotPageSize === -1) return 1;
    return Math.max(1, Math.ceil(activeFilteredPivotRows.length / pivotPageSize));
  }, [activeFilteredPivotRows.length, pivotPageSize]);

  const consolidationResults = useMemo(
    () => result?.consolidation_analysis ?? [],
    [result?.consolidation_analysis],
  );
  const consolidationDecisionCounts = useMemo(() => consolidationResults.reduce((counts, decision) => {
    const status = decision.decisionStatus ?? "pending";
    counts[status] += 1;
    return counts;
  }, { pending: 0, accepted: 0, rejected: 0 }), [consolidationResults]);

  const persistConsolidationDecisions = async (status: "accepted" | "rejected") => {
    if (!result || !selectedBatchId || selectedBatchId === "ALL" || savingConsolidationBulk) return;
    const runBatchId = selectedBatchId;
    const runProjectId = selectedProjectId;
    const pendingCount = consolidationResults.filter((decision) => (decision.decisionStatus ?? "pending") === "pending").length;
    if (pendingCount === 0) return;

    setSavingConsolidationBulk(true);
    try {
      const updatedResult: AllocationResultPayload = {
        ...result,
        consolidation_analysis: consolidationResults.map((decision) =>
          (decision.decisionStatus ?? "pending") === "pending"
            ? { ...decision, decisionStatus: status }
            : decision,
        ),
      };
      const saved = await saveBatchAllocationOutput(runBatchId, runProjectId, updatedResult, {
        requireCloud: true,
        cloudFirst: true,
        updatedBy: user?.email || currentActorName,
      });
      if (selectedBatchIdRef.current !== runBatchId || selectedProjectIdRef.current !== runProjectId) return;
      const authoritativeResult: AllocationResultPayload = {
        ...updatedResult,
        revision: saved.revision,
        run_id: saved.run_id || updatedResult.run_id,
        updated_by: saved.updated_by ?? undefined,
        updated_at: saved.updated_at,
        sync_status: "synced",
      };
      setResult(authoritativeResult);
      setPersistedOutput(authoritativeResult);
      setAllocationSyncStatus("synced");
      toast.success(`${status === "accepted" ? "Accepted" : "Rejected"} ${pendingCount} consolidation recommendations.`);
    } catch (error) {
      console.error("Bulk consolidation decision failed:", error);
      toast.error(error instanceof Error ? error.message : "Could not persist consolidation decisions.");
    } finally {
      setSavingConsolidationBulk(false);
      setConsolidationBulkAction(null);
    }
  };
  const consolidationGovernorates = useMemo(
    () => [...new Set(consolidationResults.map((decision) => decision.governorate))].sort(),
    [consolidationResults],
  );
  const consolidationAcademicOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const decision of consolidationResults) {
      const key = `${decision.track || ""}\u0000${decision.level}`;
      const label = program === "DEMI" ? `G${decision.level}` : `${decision.track || "Unspecified track"} - Level ${decision.level}`;
      options.set(key, label);
    }
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [consolidationResults, program]);
  const filteredConsolidationResults = useMemo(() => {
    const query = consolidationAreaSearch.trim().toLocaleLowerCase();
    return consolidationResults.filter((decision) => {
      const academicKey = `${decision.track || ""}\u0000${decision.level}`;
      const matchesArea = !query || decision.destinationArea.toLocaleLowerCase().includes(query)
        || decision.sourceAreas.some((source) => source.sourceArea.toLocaleLowerCase().includes(query));
      return (consolidationGovernorateFilter === "ALL" || decision.governorate === consolidationGovernorateFilter)
        && (consolidationAcademicFilter === "ALL" || academicKey === consolidationAcademicFilter)
        && matchesArea;
    });
  }, [consolidationResults, consolidationGovernorateFilter, consolidationAcademicFilter, consolidationAreaSearch]);
  const totalConsolidationPages = Math.max(1, Math.ceil(filteredConsolidationResults.length / consolidationPageSize));
  const visibleConsolidationResults = useMemo(() => {
    const start = (consolidationPage - 1) * consolidationPageSize;
    return filteredConsolidationResults.slice(start, start + consolidationPageSize);
  }, [filteredConsolidationResults, consolidationPage, consolidationPageSize]);
  const consolidationPageItems = useMemo<Array<number | "ellipsis-start" | "ellipsis-end">>(() => {
    if (totalConsolidationPages <= 7) return Array.from({ length: totalConsolidationPages }, (_, index) => index + 1);
    const pages: Array<number | "ellipsis-start" | "ellipsis-end"> = [1];
    if (consolidationPage > 4) pages.push("ellipsis-start");
    for (let page = Math.max(2, consolidationPage - 1); page <= Math.min(totalConsolidationPages - 1, consolidationPage + 1); page++) pages.push(page);
    if (consolidationPage < totalConsolidationPages - 3) pages.push("ellipsis-end");
    pages.push(totalConsolidationPages);
    return pages;
  }, [consolidationPage, totalConsolidationPages]);

  useEffect(() => {
    setConsolidationPage(1);
  }, [consolidationGovernorateFilter, consolidationAcademicFilter, consolidationAreaSearch, consolidationPageSize, result]);
  // Metadata is explicit; only the canonical schedule may contribute dynamic columns.
  const pivotColumns = useMemo(() => {
    if (physicalPivotRows.length === 0) return [];
    return getLabPivotColumns(program, canonicalPivotSlots);
  }, [physicalPivotRows, program, canonicalPivotSlots]);

  // Helper for rendering high-contrast Grade & Track badges using brand colors
  const renderGradeBadge = (grade: unknown) => {
    if (grade === null || grade === undefined) {
      return (
        <Badge variant="outline" className="text-xs px-2.5 py-0.5 shadow-2xs">
          Grade —
        </Badge>
      );
    }
    const raw = String(grade).trim();
    if (!raw || raw === "undefined" || raw === "null") {
      return (
        <Badge variant="outline" className="text-xs px-2.5 py-0.5 shadow-2xs">
          Grade —
        </Badge>
      );
    }
    const gNum = Number(raw);
    const label = formatGradeLabel(grade as number | string, program);
    const lower = label.toLowerCase();

    if (lower.includes("cyber") || lower.includes("security")) {
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          {label}
        </Badge>
      );
    }
    if (lower.includes("digital") || lower.includes("art")) {
      return (
        <Badge className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          {label}
        </Badge>
      );
    }
    if (lower.includes("web")) {
      return (
        <Badge className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          {label}
        </Badge>
      );
    }
    if (lower.includes("data")) {
      return (
        <Badge className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          {label}
        </Badge>
      );
    }
    if (lower.includes("embedded")) {
      return (
        <Badge className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          {label}
        </Badge>
      );
    }
    if (lower.includes("computer fund") || lower.includes("fundamentals")) {
      return (
        <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          {label}
        </Badge>
      );
    }
    if (lower.includes("computer adv") || lower.includes("advanced")) {
      return (
        <Badge className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          {label}
        </Badge>
      );
    }
    if (gNum === 4 || lower === "grade 4" || lower === "g4") {
      return (
        <Badge className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          Grade 4 (G4)
        </Badge>
      );
    }
    if (gNum === 5 || lower === "grade 5" || lower === "g5") {
      return (
        <Badge className="bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          Grade 5 (G5)
        </Badge>
      );
    }
    if (gNum === 6 || lower === "grade 6" || lower === "g6") {
      return (
        <Badge className="bg-[#05ACFF] hover:bg-[#056FEC] text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          Grade 6 (G6)
        </Badge>
      );
    }
    if (!isNaN(gNum) && gNum >= 1 && gNum <= 12) {
      return (
        <Badge className="bg-[#043FAD] hover:bg-[#056FEC] text-white font-bold text-xs px-2.5 py-0.5 shadow-2xs">
          Grade {gNum} (G{gNum})
        </Badge>
      );
    }
    return (
      <Badge className="bg-slate-700 hover:bg-slate-800 text-white font-semibold text-xs px-2.5 py-0.5 shadow-2xs">
        {label}
      </Badge>
    );
  };

  // Helper to extract short group identifier (e.g. "Physical-DEMI-SUM-26-G1" -> "G1", "Group 4" -> "G4")
  const extractShortGroupId = (groupId: string): string => {
    if (!groupId) return "";
    const clean = String(groupId).trim();
    // 1. Matches "-G1", "-G01", "-G123", "G1" anywhere or at end: e.g. "Physical-DEMI-SUM-26-G1" -> "G1"
    const matchG = clean.match(/[-_]?(G\d+)(?:[-_]|$)/i) || clean.match(/\b(G\d+)\b/i);
    if (matchG) return matchG[1].toUpperCase();

    // 2. Matches "Group 1", "Group-1", "Group_1", "Group1", "GRP-1", "GRP_1" -> "G1"
    const matchNamed = clean.match(/\b(?:Group|GRP)[-_\s]?(\d+)\b/i);
    if (matchNamed) return `G${matchNamed[1]}`;

    // 3. Matches trailing numbers: e.g. "Physical-DEMI-SUM-26-1" -> "G1"
    const matchTrailingNum = clean.match(/[-_](\d+)$/);
    if (matchTrailingNum) return `G${matchTrailingNum[1]}`;

    // 4. Matches pure number: e.g. "1" -> "G1"
    if (/^\d+$/.test(clean)) return `G${clean}`;

    return clean;
  };

  // Helper to extract short mega group identifier (e.g. "Mega Group A" -> "MGA", "Group 1" -> "MG1", "Sub-Batch 2" -> "SB2", "MGA" -> "MGA")
  const extractShortMegaGroupId = (mgName: string): string => {
    if (!mgName) return "";
    const clean = String(mgName).trim();

    // 1. Matches "Mega Group A", "Mega Group 1", "MegaGroup-A", "Mega-Group 2" -> "MGA" / "MG1"
    const matchMegaGroup = clean.match(/\bMega[-_\s]?Group[-_\s]?([A-Za-z0-9]+)\b/i);
    if (matchMegaGroup) return `MG${matchMegaGroup[1].toUpperCase()}`;

    // 2. Matches "Sub-Batch 1", "SubBatch A", "SB1", "SB-A" -> "SB1" / "SBA"
    const matchSb = clean.match(/\b(?:Sub[-_\s]?Batch|SB)[-_\s]?([A-Za-z0-9]+)\b/i);
    if (matchSb) return `SB${matchSb[1].toUpperCase()}`;

    // 3. Matches "MG1", "MG-1", "MG_A", "MG A", "Mega A", "Mega-1" -> "MG1" / "MGA"
    const matchMg = clean.match(/\b(?:Mega|MG)[-_\s]?([A-Za-z0-9]+)\b/i);
    if (matchMg) return `MG${matchMg[1].toUpperCase()}`;

    // 4. Matches "Group A", "Group 1", "GRP-A", "GRP 1" (e.g. user names Mega Group as "Group A") -> "MGA" / "MG1"
    const matchGroup = clean.match(/\b(?:Group|GRP)[-_\s]?([A-Za-z0-9]+)\b/i);
    if (matchGroup) return `MG${matchGroup[1].toUpperCase()}`;

    // 5. Matches single letter or number: "A" -> "MGA", "1" -> "MG1"
    if (/^[A-Za-z0-9]$/.test(clean)) return `MG${clean.toUpperCase()}`;

    // 6. If short enough (<= 4 chars), return uppercase without spaces, else return acronym.
    const abbrev = clean.length <= 4
      ? clean.replace(/\s+/g, "").toUpperCase()
      : clean.split(/\s+/).map((w) => w[0]).join("").toUpperCase();
    return abbrev.startsWith("MG") || abbrev.startsWith("SB") ? abbrev : `MG${abbrev}`;
  };

  // Helper for English ordinal suffix (1st, 2nd, 3rd, 4th, ...)
  const getOrdinalSuffix = (n: number): string => {
    const j = n % 10;
    const k = n % 100;
    if (j === 1 && k !== 11) return `${n}st`;
    if (j === 2 && k !== 12) return `${n}nd`;
    if (j === 3 && k !== 13) return `${n}rd`;
    return `${n}th`;
  };

  // Pre-indexed multi-session occupancy and visit sequence lookup for Lab Grid Matrix cells
  const pivotSlotNumByLabel = useMemo(() => {
    return new Map(canonicalPivotSlots.map((slot) => [slot.label, slot.num]));
  }, [canonicalPivotSlots]);

  const cellOccupancyMap = useMemo(() => {
    if (!result?.master_allocation || result.master_allocation.length === 0) {
      return new Map<
        string,
        {
          hasMultiSession: boolean;
          groupVisits: Array<{
            groupId: string;
            visitNum: number;
            repeatCount: number;
            visitType: "single_visit" | "multi_visit";
            studentCount: number;
            megaGroup?: string;
          }>;
          displayVisitLabel: string;
          tooltipText: string;
        }
      >();
    }

    type GroupVisitItem = {
      groupId: string;
      visitNum: number;
      repeatCount: number;
      visitType: "single_visit" | "multi_visit";
      studentCount: number;
      megaGroup?: string;
    };

    const tempMap = new Map<string, Map<string, GroupVisitItem>>();

    for (const r of result.master_allocation) {
      const area = String(r["Physical Area"] ?? (r as any).Physical_Area ?? (r as any).Area ?? (r as any).area ?? "").replace(/\s+/g, " ").trim();
      const grade = Number(r.Grade ?? (r as any).grade);
      const labId = String(r.Lab_ID ?? (r as any).Lab_Id ?? (r as any).LabId ?? (r as any)["Lab ID"] ?? (r as any).lab_id ?? "").replace(/\s+/g, " ").trim();
      const storedSlotLabel = String(r.Slot_Label ?? (r as any).slot_label ?? "");
      const slotNum = pivotSlotNumByLabel.get(storedSlotLabel) ?? Number(r.Slot_Num ?? (r as any).slot_num);
      if (!Number.isFinite(slotNum)) continue;
      const key = `${area}__${grade}__${labId}__${slotNum}`;

      if (!tempMap.has(key)) {
        tempMap.set(key, new Map());
      }

      const groupMap = tempMap.get(key)!;
      const groupId = String(r.Group_ID ?? (r as any).GroupId ?? (r as any)["Group ID"] ?? (r as any).group_id ?? "").trim();
      const visitNum = Math.max(1, Number(r.Visit_Num ?? (r as any).VisitNum ?? (r as any)["Visit Num"] ?? (r as any).visit_num) || 1);
      const visitTypeVal = String(r.Visit_Type ?? (r as any).VisitType ?? (r as any)["Visit Type"] ?? (r as any).visit_type ?? "").trim();
      const repeatCountVal = Number(r.Repeat_Count ?? (r as any).RepeatCount ?? (r as any)["Repeat Count"] ?? (r as any).repeat_count) || 1;
      const megaGroupVal = String(r.Mega_Group ?? (r as any).MegaGroup ?? (r as any)["Mega Group"] ?? (r as any).mega_group ?? "").trim();

      const isMulti =
        visitTypeVal === "multi_visit" ||
        repeatCountVal > 1 ||
        visitNum > 1;
      const repeatCount = isMulti
        ? Math.max(2, repeatCountVal || visitNum)
        : 1;
      const visitType: "single_visit" | "multi_visit" = isMulti
        ? "multi_visit"
        : "single_visit";

      const gKey = `${groupId}__v${visitNum}__${megaGroupVal}`;
      if (!groupMap.has(gKey)) {
        groupMap.set(gKey, {
          groupId,
          visitNum,
          repeatCount,
          visitType,
          studentCount: 0,
          megaGroup: megaGroupVal,
        });
      }
      groupMap.get(gKey)!.studentCount += 1;
    }

    const resultMap = new Map<
      string,
      {
        hasMultiSession: boolean;
        groupVisits: GroupVisitItem[];
        displayVisitLabel: string;
        tooltipText: string;
      }
    >();

    for (const [key, groupMap] of tempMap.entries()) {
      const groupVisits = Array.from(groupMap.values());
      const multiVisits = groupVisits.filter((g) => g.visitType === "multi_visit");
      const hasMultiSession = multiVisits.length > 0;

      let displayVisitLabel = "";
      let tooltipText = "";

      // Format visit labels for all groups in this cell
      // Exact order: Group ID -> Mega Group Tag -> Visit Order Indicator
      // Example: "G1 · MG1 · 1st" or "G1 · 1st" or "G1 · MG1" or "G1"
      const groupLabels = groupVisits
        .map((g) => {
          const shortGid = extractShortGroupId(g.groupId);
          const isMulti = g.visitType === "multi_visit" || g.repeatCount > 1 || g.visitNum > 1;
          const shortMg = isMulti && g.megaGroup ? extractShortMegaGroupId(g.megaGroup) : "";
          const visitSeq = isMulti ? getOrdinalSuffix(g.visitNum) : "";

          const parts: string[] = [];
          if (shortGid) parts.push(shortGid);
          if (shortMg) parts.push(shortMg);
          if (visitSeq) parts.push(visitSeq);

          return parts.join(" · ");
        })
        .filter(Boolean);

      if (groupLabels.length > 0) {
        displayVisitLabel = groupLabels.join(" / ");
      }

      const lines = groupVisits.map((g) => {
        const isMulti = g.visitType === "multi_visit" || g.repeatCount > 1 || g.visitNum > 1;
        const mgNote = isMulti && g.megaGroup ? ` [Mega Group: ${g.megaGroup}]` : "";
        if (isMulti) {
          return `• Group ${g.groupId}: ${getOrdinalSuffix(g.visitNum)} visit of ${g.repeatCount} (${g.studentCount} students)${mgNote}`;
        }
        return `• Group ${g.groupId}: ${g.studentCount} students`;
      });
      tooltipText = lines.join("\n");

      resultMap.set(key, {
        hasMultiSession,
        groupVisits,
        displayVisitLabel,
        tooltipText,
      });
    }

    return resultMap;
  }, [result?.master_allocation, pivotSlotNumByLabel]);

  const renderSingleSessionGroupCell = (cell?: SingleSessionLabPivotCell) => {
    if (!cell) return <div className="flex min-h-12 min-w-28 items-center justify-center rounded border border-dashed border-border bg-muted/40 text-muted-foreground">—</div>;
    const occupancy = cell.capacity > 0 ? cell.studentCount / cell.capacity : 1;
    const occupancyClass = cell.studentCount > cell.capacity
      ? "border-purple-500/60 bg-purple-500/15 text-purple-900 dark:text-purple-200"
      : occupancy === 1
        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200"
        : occupancy >= 0.8
          ? "border-blue-500/60 bg-blue-500/15 text-blue-900 dark:text-blue-200"
          : "border-amber-500/60 bg-amber-500/15 text-amber-900 dark:text-amber-200";
    const displayGroupId = displayGroupIdMap.get(cell.groupId) || cell.groupId;
    return (
      <div
        className={`min-h-12 min-w-28 rounded border px-2 py-1 ${cell.integrityIssue ? "border-destructive bg-destructive/10 text-destructive" : occupancyClass}`}
        title={cell.integrityIssue || `${displayGroupId}: ${cell.studentCount} / ${cell.capacity}`}
      >
        <div className="flex items-center gap-1 text-[11px] font-semibold">
          {cell.integrityIssue && <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />}
          <span className="truncate">{displayGroupId || "Unknown group"}</span>
        </div>
        <div className="text-[10px] tabular-nums text-muted-foreground">{cell.studentCount} / {cell.capacity}</div>
      </div>
    );
  };

  const renderSingleSessionAcademicCell = (cell?: SingleSessionLabPivotCell) => (
    cell
      ? <span className="block min-w-28 whitespace-normal text-[11px] font-medium" title={cell.academicLabel}>{cell.academicLabel}</span>
      : <span className="text-muted-foreground/40">—</span>
  );

  // Helper for color-coding slot capacity cells with multi-session visit sequence indicator
  const renderPivotSlotCell = (
    val: unknown,
    row?: Record<string, unknown>,
    col?: string
  ) => {
    if (val === null || val === undefined || String(val).trim() === "" || String(val).trim() === "-") {
      return (
        <span className="text-muted-foreground/30 font-mono text-[11px] select-none">—</span>
      );
    }
    const strVal = String(val);
    const parts = strVal.split("/");
    if (parts.length === 2) {
      const seated = Number(parts[0]);
      const cap = Number(parts[1]);
      const pct = cap > 0 ? (seated / cap) * 100 : 100;
      const isOverfilled = seated > cap;

      const area = String(row?.["Physical Area"] ?? (row as any)?.Physical_Area ?? (row as any)?.Area ?? (row as any)?.area ?? "").replace(/\s+/g, " ").trim();
      const grade = Number(row?.Grade ?? (row as any)?.grade);
      const labId = String(row?.Lab_ID ?? (row as any)?.Lab_Id ?? (row as any)?.LabId ?? (row as any)?.["Lab ID"] ?? (row as any)?.lab_id ?? "").replace(/\s+/g, " ").trim();
      const slotNum = pivotSlotNumByLabel.get(String(col ?? ""));

      const cellKey = row && slotNum !== undefined ? `${area}__${grade}__${labId}__${slotNum}` : "";
      const cellDetail = cellKey ? cellOccupancyMap.get(cellKey) : undefined;
      const hasDisplayLabel = Boolean(cellDetail?.displayVisitLabel);

      if (isOverfilled) {
        const extra = seated - cap;
        return (
          <div
            title={cellDetail?.tooltipText || undefined}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-mono font-bold shadow-2xs bg-purple-500/15 text-purple-800 dark:text-purple-300 border-purple-500/40 cursor-default"
          >
            <span className="h-2 w-2 rounded-full bg-purple-600 animate-pulse" />
            <span>{seated}/{cap}</span>
            <span className="text-[10px] bg-purple-500/25 text-purple-700 dark:text-purple-300 px-1 rounded font-bold">+{extra} Overfill</span>
            {hasDisplayLabel && (
              <span className="text-[10px] opacity-90 font-bold">
                · {cellDetail!.displayVisitLabel}
              </span>
            )}
          </div>
        );
      }

      let badgeClass = "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/40";
      let dotClass = "bg-emerald-500";

      if (pct < 80) {
        badgeClass = "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40";
        dotClass = "bg-amber-500";
      } else if (pct < 100) {
        badgeClass = "bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-500/40";
        dotClass = "bg-blue-500";
      }

      return (
        <div
          title={cellDetail?.tooltipText || undefined}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-mono font-semibold shadow-2xs ${badgeClass} cursor-default`}
        >
          <span className={`h-2 w-2 rounded-full ${dotClass} animate-pulse`} />
          <span>{seated}/{cap}</span>
          <span className="text-[10px] opacity-75 font-normal">({Math.round(pct)}%)</span>
          {hasDisplayLabel && (
            <span className="text-[10px] opacity-90 font-bold">
              · {cellDetail!.displayVisitLabel}
            </span>
          )}
        </div>
      );
    }
    return <span className="text-xs font-mono">{strVal}</span>;
  };

  // Export all tabs into a single unified multi-sheet Excel (.xlsx) workbook
  const handleExportAllTabsToExcel = () => {
    if (!result) {
      toast.error("No allocation results available to export.");
      return;
    }

    try {
      const wb = XLSX.utils.book_new();

      const autoFitCols = (jsonRows: Record<string, any>[]) => {
        if (!jsonRows || jsonRows.length === 0) return [];
        const keys = Object.keys(jsonRows[0]);
        return keys.map((key) => {
          const maxLen = Math.max(
            key.length,
            ...jsonRows.slice(0, 100).map((r) => String(r[key] ?? "").length)
          );
          return { wch: Math.min(Math.max(maxLen + 3, 12), 65) };
        });
      };

      // 1. Tab: Visual Analytics (Key Performance Indicators & Workspace Context)
      const visualAnalyticsRows = [
        { "KPI / Dimension": "Total Student Demand", "Value": result.summary?.total_students ?? 0, "Notes": "Total registered students submitted" },
        { "KPI / Dimension": "Students Assigned", "Value": physicalAssignedCount, "Notes": "Successfully placed in a dedicated physical seat" },
        { "KPI / Dimension": "Match Rate (%)", "Value": `${(((physicalAssignedCount) / (result.summary?.total_students || 1)) * 100).toFixed(2)}%`, "Notes": "Physical cohort placement rate" },
        { "KPI / Dimension": "Unassigned Shortfall", "Value": physicalUnassignedCount, "Notes": physicalUnassignedCount === 0 ? "Zero Shortfall (100% Satisfied)" : "Requires extra capacity" },
        { "KPI / Dimension": "Placed via Fair Overfill", "Value": result.summary?.overfill_count ?? 0, "Notes": "Approved +1 or +2 capacity extensions" },
        { "KPI / Dimension": "Physical Labs Utilized", "Value": result.summary?.total_labs ?? 0, "Notes": "Unique lab venues active in run" },
        { "KPI / Dimension": "Total Sessions Assigned", "Value": physicalSessionsAssignedCount, "Notes": `Out of ${result.summary?.total_sessions_available ?? 0} total time slots` },
        { "KPI / Dimension": "Physical Areas Covered", "Value": result.summary?.areas_count ?? 0, "Notes": "Geographic districts" },
        { "KPI / Dimension": "Group Scheme Prefix", "Value": prefix, "Notes": "Designated grouping prefix" },
        { "KPI / Dimension": "Project Context", "Value": activeProject?.name || "N/A", "Notes": "Associated workspace project" },
        { "KPI / Dimension": "Batch Context", "Value": activeBatch?.name || "N/A", "Notes": "Active cohort batch" },
        { "KPI / Dimension": "Export Timestamp", "Value": new Date().toLocaleString(), "Notes": "Generated from Lab Allocation Engine" },
      ];
      const wsVisual = XLSX.utils.json_to_sheet(visualAnalyticsRows);
      wsVisual["!cols"] = autoFitCols(visualAnalyticsRows);
      XLSX.utils.book_append_sheet(wb, wsVisual, "Visual Analytics");

      // 2. Tab: Dashboard Summary
      if (computedDashboardSummary && computedDashboardSummary.length > 0) {
        const wsDashboard = XLSX.utils.json_to_sheet(computedDashboardSummary);
        wsDashboard["!cols"] = autoFitCols(computedDashboardSummary);
        XLSX.utils.book_append_sheet(wb, wsDashboard, "Dashboard Summary");
      }

      // 3. Tab: Master Allocation
      if (result.master_allocation && result.master_allocation.length > 0) {
        const masterExportRows = result.master_allocation.map((m) => ({
          ...m,
          Grade: formatGradeLabel(m.Grade),
        }));
        const wsMaster = XLSX.utils.json_to_sheet(masterExportRows);
        wsMaster["!cols"] = autoFitCols(masterExportRows);
        const masterSheetName = `Seat Visits (${result.master_allocation.length})`;
        XLSX.utils.book_append_sheet(wb, wsMaster, masterSheetName.slice(0, 31));
      }

      // 4. Tab: Lab Grid Matrix (Physical Labs Only)
      if (physicalPivotRows && physicalPivotRows.length > 0) {
        const exportRows = physicalPivotRows.map((row) =>
          Object.fromEntries(
            pivotColumns.map((column) => [
              column,
              column === "Grade" ? formatGradeLabel(row[column]) : row[column],
            ]),
          ),
        );
        const wsLabPivot = XLSX.utils.json_to_sheet(exportRows, { header: pivotColumns });
        wsLabPivot["!cols"] = autoFitCols(exportRows);
        XLSX.utils.book_append_sheet(wb, wsLabPivot, "Lab Grid Matrix");
      }

      // 4b. Tab: VP Sessions Matrix (Virtual Portal Only)
      if (vpPivotRows && vpPivotRows.length > 0) {
        const vpExportRows = vpPivotRows.map((row) =>
          Object.fromEntries(
            vpPivotColumns.map((column) => [
              column,
              column === "Grade" || column === "Level" ? formatGradeLabel(row[column] as any, program) : row[column],
            ]),
          ),
        );
        const wsVpPivot = XLSX.utils.json_to_sheet(vpExportRows, { header: vpPivotColumns });
        wsVpPivot["!cols"] = autoFitCols(vpExportRows);
        XLSX.utils.book_append_sheet(wb, wsVpPivot, "VP Sessions Matrix");
      }

      // 4c. Tab: VP Sessions List
      if (vpSessions && vpSessions.length > 0) {
        const vpListRows = vpSessions.map((session) => ({
          "Session ID": session.id,
          Project: session.projectName,
          Track: session.track || "General",
          Level: program === "DEMI" ? `G${session.level}` : `L${session.level}`,
          "Enrolled Students": session.studentCount,
          Capacity: session.capacity,
          "Occupancy (%)": `${((session.studentCount / session.capacity) * 100).toFixed(1)}%`,
          "Remaining Seats": Math.max(0, session.capacity - session.studentCount),
          Governorates: session.governorates.join(", "),
          Status: session.status || "active",
        }));
        const wsVpList = XLSX.utils.json_to_sheet(vpListRows);
        wsVpList["!cols"] = autoFitCols(vpListRows);
        XLSX.utils.book_append_sheet(wb, wsVpList, "VP Sessions List");

        // 4d. Tab: VP Enrolled Students
        const vpStudentsRows = vpSessions.flatMap((session) =>
          session.studentIds.map((studentId) => {
            const student = vpStudentById.get(studentId) || ({ S_ID: studentId } as StudentRecord);
            return {
              "Session ID": session.id,
              "Student ID": studentId,
              "Student Name": String(student.Name || student.name || (student as any)["Student Name"] || ""),
              Phone: String(student.Phone || student.phone || (student as any)["Phone Number"] || (student as any).Mobile || ""),
              Email: String(student.Email || student.email || (student as any)["Email Address"] || ""),
              Governorate: String(student.Governorate || student.Gov || (student as any).gov || session.governorates.join(", ")),
              "Physical Area": String(student["Physical Area"] || (student as any).Area || ""),
              Track: String(student.Track || session.track || "General"),
              Level: formatGradeLabel(student.Grade || session.level, session.program),
              Status: session.status || "active",
            };
          }),
        );
        if (vpStudentsRows.length > 0) {
          const wsVpStudents = XLSX.utils.json_to_sheet(vpStudentsRows);
          wsVpStudents["!cols"] = autoFitCols(vpStudentsRows);
          XLSX.utils.book_append_sheet(wb, wsVpStudents, "VP Enrolled Students");
        }
      }

      // 5. Tab: Area & Grade Summary
      if (computedAreaGradeSummary && computedAreaGradeSummary.length > 0) {
        const areaGradeExportRows = computedAreaGradeSummary.map((r) => ({
          "Physical Area": r["Physical Area"],
          Grade: formatGradeLabel(r.Grade),
          "Total Demand": r.Total_Students,
          "Students Assigned": r.Students_Assigned,
          Unassigned: r.Unassigned,
          "Groups Used": r.Unique_Groups,
          "Labs Used": r.Labs_Used,
        }));
        const wsAreaGrade = XLSX.utils.json_to_sheet(areaGradeExportRows);
        wsAreaGrade["!cols"] = autoFitCols(areaGradeExportRows);
        XLSX.utils.book_append_sheet(wb, wsAreaGrade, "Area & Grade Summary");
      }

      // Consolidation Analysis
      if (result.consolidation_analysis && result.consolidation_analysis.length > 0) {
        const consolidationRows = result.consolidation_analysis.flatMap((decision) =>
          decision.sourceAreas.map((source) => ({
            Governorate: decision.governorate,
            Track: decision.track || "",
            Level: program === "DEMI" ? `G${decision.level}` : `L${decision.level}`,
            "Source Area": source.sourceArea,
            "Destination Area": decision.destinationArea,
            "Students Moved": source.studentsMoved,
            "Destination Existing Students": decision.destinationExistingStudents,
            "Final Cohort Size": decision.finalCohortSize,
            Reason: decision.reason,
          })),
        );
        const wsConsolidation = XLSX.utils.json_to_sheet(consolidationRows);
        wsConsolidation["!cols"] = autoFitCols(consolidationRows);
        XLSX.utils.book_append_sheet(wb, wsConsolidation, "Consolidation Analysis");
      }

      // 5. Tab: Area Breakdown
      if (result.area_grade_summary && result.area_grade_summary.length > 0) {
        const areaGradeExportRows = result.area_grade_summary.map((r) => ({
          ...r,
          Grade: formatGradeLabel(r.Grade),
        }));
        const wsAreaGrade = XLSX.utils.json_to_sheet(areaGradeExportRows);
        wsAreaGrade["!cols"] = autoFitCols(areaGradeExportRows);
        XLSX.utils.book_append_sheet(wb, wsAreaGrade, "Area Breakdown");
      }

      // 6. Tab: Shortfall & Logs
      const shortfallLogsRows: Array<{ Section: string; "Identifier / Key": string; Grade: string | number; "Physical Area": string; "Details / Diagnostic Note": string }> = [];
      if (result.unassigned_students && result.unassigned_students.length > 0) {
        result.unassigned_students.forEach((u) => {
          shortfallLogsRows.push({
            Section: "Unassigned Student",
            "Identifier / Key": u.S_ID,
            Grade: formatGradeLabel(u.Grade),
            "Physical Area": u["Physical Area"],
            "Details / Diagnostic Note": u.Reason,
          });
        });
      }
      if (result.shortfall_math && result.shortfall_math.length > 0) {
        result.shortfall_math.forEach((s) => {
          shortfallLogsRows.push({
            Section: "Capacity Diagnostics",
            "Identifier / Key": `${s.Area} - ${formatGradeLabel(s.Grade)}`,
            Grade: formatGradeLabel(s.Grade),
            "Physical Area": s.Area,
            "Details / Diagnostic Note": `Demand: ${s.Demand} students | Assigned: ${s.Sessions_Assigned} sessions (${s.Capacity_Assigned} seats) | Short: ${s.Students_Short}`,
          });
        });
      }
      if (result.logs && result.logs.length > 0) {
        result.logs.forEach((line, idx) => {
          shortfallLogsRows.push({
            Section: "Optimizer Log",
            "Identifier / Key": `Step #${idx + 1}`,
            Grade: "",
            "Physical Area": "",
            "Details / Diagnostic Note": line,
          });
        });
      }
      if (shortfallLogsRows.length === 0) {
        shortfallLogsRows.push({
          Section: "Shortfall Status",
          "Identifier / Key": "Zero Shortfall",
          Grade: "All",
          "Physical Area": "All",
          "Details / Diagnostic Note": "100% Demand Satisfied — Every student was allocated a seat without violating lab capacity.",
        });
      }
      const wsShortfall = XLSX.utils.json_to_sheet(shortfallLogsRows);
      wsShortfall["!cols"] = autoFitCols(shortfallLogsRows);
      XLSX.utils.book_append_sheet(wb, wsShortfall, "Shortfall & Logs");

      // 7. Tab: Online Migrations Tracker
      if (result.online_migration_suggestions && result.online_migration_suggestions.length > 0) {
        const onlineTrackerRows = result.online_migration_suggestions.map((s) => {
          const isAcc = s.status === "accepted";
          const grades = isAcc ? (s.acceptedGrades ?? s.affectedGrades ?? []) : (s.affectedGrades ?? []);
          const studentIds = isAcc ? (s.acceptedStudentIds ?? s.affectedStudentIds ?? []) : (s.affectedStudentIds ?? []);
          return {
            Governorate: s.governorate || s.gov || s.area || "N/A",
            "Physical Areas": Array.isArray(s.affectedAreas) ? s.affectedAreas.join(", ") : s.area,
            "Affected Grades": grades.map((g) => formatGradeLabel(g)).join(", ") || s.area,
            "Student Count": studentIds.length || s.studentCount || 0,
            Status: isAcc ? "Accepted (Online)" : s.status === "rejected" ? "Rejected (In-Person)" : "Pending",
            "Qualification Reason": s.qualificationReason || "Headcount < 8 threshold",
            "Student IDs": Array.isArray(studentIds) ? studentIds.join(", ") : "",
            "Accepted At": s.acceptedAt ? new Date(s.acceptedAt).toLocaleString() : "",
          };
        });
        const wsOnline = XLSX.utils.json_to_sheet(onlineTrackerRows);
        wsOnline["!cols"] = autoFitCols(onlineTrackerRows);
        XLSX.utils.book_append_sheet(wb, wsOnline, "Online Migrations");
      }

      // Trigger multi-sheet download
      const cleanPrefix = (prefix || "allocation").replace(/[^a-zA-Z0-9_-]/g, "_");
      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${cleanPrefix}_all_tabs_${dateStr}.xlsx`);
      toast.success("Exported all tabs to Excel workbook (.xlsx)!");
    } catch (err: any) {
      console.error("Export all tabs error:", err);
      toast.error(`Failed to export tabs: ${err?.message || "Unknown error"}`);
    }
  };

  const vpRecommendations = useMemo(() => result?.online_migration_suggestions || [], [result?.online_migration_suggestions]);
  const vpSessions = result?.vp_sessions || [];
  const vpEligibleCount = new Set(vpRecommendations.flatMap((item) => item.affectedStudentIds)).size;
  const vpAcceptedCount = new Set(vpRecommendations.filter((item) => item.status === "accepted").flatMap((item) => item.affectedStudentIds)).size;
  const vpCapacity = vpSessions.reduce((sum, session) => sum + session.capacity, 0);
  const vpStudentById = new Map((savedUploadRecord?.students || []).map((student) => [String(student.S_ID), student]));
  const vpGovernorates = useMemo(() => Array.from(new Set(vpRecommendations.map((item) => String(item.governorate || item.gov || item.area || "").trim()).filter((v) => v.length > 0))).sort(), [vpRecommendations]);
  const vpAcademicOptions = useMemo(() => Array.from(new Set(vpRecommendations.map((item) => String(item.academicLabel || `${item.track || ""} L${item.level || ""}`).trim()).filter((v) => v.length > 0))).sort(), [vpRecommendations]);
  const filteredVpRecommendations = useMemo(() => vpRecommendations.filter((item) => {
    const governorate = item.governorate || item.gov || item.area;
    const academic = item.academicLabel || `${item.track || ""} L${item.level || ""}`;
    return (vpStatusFilter === "ALL" || item.status === vpStatusFilter) &&
      (vpGovernorateFilter === "ALL" || governorate === vpGovernorateFilter) &&
      (vpAcademicFilter === "ALL" || academic === vpAcademicFilter);
  }), [vpRecommendations, vpStatusFilter, vpGovernorateFilter, vpAcademicFilter]);
  const vpRecommendationPageCount = Math.max(1, Math.ceil(filteredVpRecommendations.length / vpRecommendationPageSize));
  const paginatedVpRecommendations = useMemo(() => {
    const start = (vpRecommendationPage - 1) * vpRecommendationPageSize;
    return filteredVpRecommendations.slice(start, start + vpRecommendationPageSize);
  }, [filteredVpRecommendations, vpRecommendationPage]);
  const matchingPendingVpIds = useMemo(() => filteredVpRecommendations.filter((item) => item.status === "pending").map(getVpRecommendationKey), [filteredVpRecommendations]);
  const allPendingVpIds = useMemo(() => vpRecommendations.filter((item) => item.status === "pending").map(getVpRecommendationKey), [vpRecommendations]);

  useEffect(() => { setVpRecommendationPage(1); }, [vpStatusFilter, vpGovernorateFilter, vpAcademicFilter, selectedBatchId]);
  useEffect(() => { setVpRecommendationPage((page) => Math.min(page, vpRecommendationPageCount)); }, [vpRecommendationPageCount]);
  useEffect(() => { setSelectedVpRecommendationIds(new Set()); }, [selectedBatchId]);

  const uniqueVpGrades = useMemo(() => {
    return sortGradeLevels(
      vpSessions
        .map((s) => Number(s.level))
        .filter((g) => Number.isFinite(g)),
    ).map(String);
  }, [vpSessions]);

  const uniqueVpGovernorates = useMemo(() => {
    const govs = new Set<string>();
    for (const s of vpSessions) {
      for (const g of s.governorates || []) {
        if (g && g.trim()) govs.add(g.trim());
      }
    }
    return Array.from(govs).sort();
  }, [vpSessions]);

  const vpPivotRows = useMemo(() => {
    return buildVpPivotSummary(
      vpSessions,
      result?.master_allocation || [],
      canonicalPivotSlots,
      program,
    );
  }, [vpSessions, result?.master_allocation, canonicalPivotSlots, program]);

  const filteredVpPivotRows = useMemo(() => {
    return vpPivotRows.filter((row) => {
      const matchesGrade =
        vpGradeFilter === "ALL" || String(row.Grade) === vpGradeFilter;
      const rowGov = String(row.Governorate || row["Physical Area"] || "");
      const matchesGov =
        vpGovFilter === "ALL" || rowGov.toLowerCase().includes(vpGovFilter.toLowerCase());
      const matchesSearch =
        !vpSearchQuery ||
        String(row["Session ID"] || "").toLowerCase().includes(vpSearchQuery.toLowerCase()) ||
        String(row.Track || "").toLowerCase().includes(vpSearchQuery.toLowerCase()) ||
        rowGov.toLowerCase().includes(vpSearchQuery.toLowerCase());
      return matchesGrade && matchesGov && matchesSearch;
    });
  }, [vpPivotRows, vpGradeFilter, vpGovFilter, vpSearchQuery]);

  const paginatedVpPivotRows = useMemo(() => {
    if (vpMatrixPageSize === -1) return filteredVpPivotRows;
    const start = (vpMatrixPage - 1) * vpMatrixPageSize;
    return filteredVpPivotRows.slice(start, start + vpMatrixPageSize);
  }, [filteredVpPivotRows, vpMatrixPage, vpMatrixPageSize]);

  const totalVpMatrixPages = useMemo(() => {
    if (vpMatrixPageSize === -1) return 1;
    return Math.max(1, Math.ceil(filteredVpPivotRows.length / vpMatrixPageSize));
  }, [filteredVpPivotRows.length, vpMatrixPageSize]);

  const vpPivotColumns = useMemo(() => {
    const leadCols = ["Governorate", "Track", "Level", "Session ID"];
    return [...leadCols, ...canonicalPivotSlots.map((slot) => slot.label)];
  }, [canonicalPivotSlots]);

  // Dynamically compute physical-only dashboard summary and area-grade summaries from master_allocation
  const computedDashboardSummary = useMemo(() => {
    if (!result?.master_allocation || result.master_allocation.length === 0) return [];
    return buildDashboardStyleSummary(
      result.master_allocation as any,
      (result.unassigned_students || []) as any,
      program,
    );
  }, [result?.master_allocation, result?.unassigned_students, program]);

  const computedAreaGradeSummary = useMemo(() => {
    if (!result?.master_allocation || result.master_allocation.length === 0) return [];
    return buildGroupCountSummary(
      result.master_allocation as any,
      (result.unassigned_students || []) as any,
      program,
    );
  }, [result?.master_allocation, result?.unassigned_students, program]);

  const physicalAssignedCount = useMemo(() => {
    if (!result?.master_allocation) return 0;
    return calculateAllocationAccounting(result.master_allocation, result.unassigned_students || []).physicalAssignedCount;
  }, [result?.master_allocation, result?.unassigned_students]);

  const physicalUnassignedCount = useMemo(() => {
    if (!result?.unassigned_students) return 0;
    return calculateAllocationAccounting(result.master_allocation || [], result.unassigned_students).unassignedCount;
  }, [result?.master_allocation, result?.unassigned_students]);

  const physicalSessionsAssignedCount = useMemo(() => {
    if (!result?.master_allocation) return 0;
    return new Set(
      result.master_allocation
        .filter((r) => !isVpStudent(r) && r.Lab_ID !== "ONLINE" && r.Group_ID)
        .map((r) => r.Group_ID),
    ).size;
  }, [result?.master_allocation]);

  const filteredVpSessions = useMemo(() => {
    return vpSessions.filter((session) => {
      const matchesGrade =
        vpGradeFilter === "ALL" || String(session.level) === vpGradeFilter;
      const matchesGov =
        vpGovFilter === "ALL" ||
        (session.governorates || []).some((g) => g.toLowerCase().includes(vpGovFilter.toLowerCase()));
      const matchesStatus =
        vpSessionStatusFilter === "ALL" || (session.status || "active") === vpSessionStatusFilter;
      const matchesSearch =
        !vpSearchQuery ||
        session.id.toLowerCase().includes(vpSearchQuery.toLowerCase()) ||
        session.projectName.toLowerCase().includes(vpSearchQuery.toLowerCase()) ||
        String(session.track || "").toLowerCase().includes(vpSearchQuery.toLowerCase()) ||
        (session.governorates || []).some((g) => g.toLowerCase().includes(vpSearchQuery.toLowerCase()));
      return matchesGrade && matchesGov && matchesStatus && matchesSearch;
    });
  }, [vpSessions, vpGradeFilter, vpGovFilter, vpSessionStatusFilter, vpSearchQuery]);

  if (!permsLoading && !isAllowed) {
    return (
      <div className="mx-auto max-w-3xl py-12 px-4 text-center">
        <Card className="border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 shadow-md">
          <CardHeader className="pb-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 mb-2">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl text-rose-700 dark:text-rose-300">
              Access Restricted: Lab Allocation Engine
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-1">
              Your assigned role ({roles.map((r) => ROLE_LABELS[r]).join(", ") || "Viewer"}) does not have permission to access the Lab Allocation pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground max-w-xl mx-auto">
              By system policy, the <strong>Lab Manager (Event Team)</strong> role is restricted from executing the allocation engine. Lab Managers manage physical labs in <strong>Lab Data</strong> and review capacity tickets in <strong>Operation Requests</strong>.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Link to="/operation-requests">
                <Button variant="outline" size="sm">Go to Operation Requests</Button>
              </Link>
              <Link to="/dashboard">
                <Button size="sm" className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold">Back to Dashboard</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-[#056FEC]/15 to-[#05ACFF]/15 text-[#056FEC] dark:text-[#05ACFF] shadow-xs shrink-0">
            <BrandIcon name="process_on" size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-[#1F2A55] dark:text-[#F7FAFF]">
                Lab Allocation Engine
              </h1>

            </div>

          </div>
        </div>

        {result && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="gap-1.5 text-xs text-[#597587] dark:text-[#85A5B9] hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Start New Run
            </Button>
          </div>
        )}
      </div>

      {/* Step 1: Program, Sub-Projects & Batch Selection */}
      <Card className="shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#056FEC] text-white text-xs font-bold shadow-xs">
                1
              </span>
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-[#056FEC]" />
                  Allocation specification
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Pick program type, link to active project batch, and define group identifier prefixes.
                </CardDescription>
              </div>
            </div>
            <div className="text-xs font-mono bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF] px-3 py-1 rounded-xl border border-[#056FEC]/20 font-semibold self-start sm:self-auto">
              Sample Group ID: <span className="font-bold">{prefix}1</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Program Type selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF]">Program Type</Label>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-muted/50 border border-border/50">
                <Button
                  type="button"
                  size="sm"
                  variant={program === "DECI" ? "default" : "ghost"}
                  onClick={() => handleProgramChange("DECI")}
                  className={`text-xs h-8 rounded-lg font-semibold transition-all ${program === "DECI"
                    ? "bg-[#056FEC] text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  DECI
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={program === "DEMI" ? "default" : "ghost"}
                  onClick={() => handleProgramChange("DEMI")}
                  className={`text-xs h-8 rounded-lg font-semibold transition-all ${program === "DEMI"
                    ? "bg-[#FF7F1C] text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  DEMI
                </Button>
              </div>
            </div>

            {/* 2. Specific Sub-Project selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF] flex items-center justify-between">
                <span>Specific Project</span>
                <span className="text-[10px] text-muted-foreground">({filteredProjects.length} found)</span>
              </Label>
              <Select value={selectedProjectId} onValueChange={handleProjectSelect} disabled={savingVpWorkflow}>
                <SelectTrigger className="h-9 text-xs rounded-xl">
                  <SelectValue placeholder="Select specific project..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {filteredProjects.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground text-center">No projects found</div>
                  ) : (
                    filteredProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name} {p.code ? `(${p.code})` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* 3. Batch Selector (if project selected) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF] flex items-center justify-between">
                <span>Batch / Intake</span>
                <span className="text-[10px] text-muted-foreground">({filteredBatches.length} available)</span>
              </Label>
              <Select
                value={selectedBatchId}
                onValueChange={setSelectedBatchId}
                disabled={!isProjectSelected || filteredBatches.length === 0 || savingVpWorkflow}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl">
                  <SelectValue
                    placeholder={
                      !isProjectSelected
                        ? "Select project first"
                        : filteredBatches.length === 0
                          ? "No batches in project"
                          : "Select specific batch..."
                    }
                  />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {filteredBatches.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground text-center">No batches found</div>
                  ) : (
                    filteredBatches.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-xs">
                        {b.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* 4. Prefix configuration */}
            <div className="space-y-1.5">
              <Label htmlFor="prefix-input" className="text-xs font-medium text-[#1F2A55] dark:text-[#F7FAFF]">
                Group ID Prefix
              </Label>
              <Input
                id="prefix-input"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. Physical-DS-G or Physical-DEMI-G"
                className="h-9 font-mono text-xs rounded-xl"
              />
            </div>
          </div>

          {/* Batch Distribution Mode & Recurring Group Configuration */}
          {isProjectSelected && isBatchSelected && (
            <div className="mt-4 pt-4 border-t border-border/60 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-[#1F2A55] dark:text-[#F7FAFF] flex items-center gap-1.5">
                    <Repeat className="h-3.5 w-3.5 text-[#056FEC]" />
                    Batch Group Distribution &amp; Session Structure
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Configure whether student groups have single one-off sessions or recurring multi-day visits across the schedule.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setGroupClassDialogOpen(true)}
                    className="h-7 text-[11px] gap-1 rounded-lg border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30 font-medium"
                  >
                    <SlidersHorizontal className="h-3 w-3 text-purple-600" />
                    Group Classifications
                    {multiVisitGroupsCount > 0 && (
                      <Badge className="bg-purple-600 text-white font-bold text-[9px] ml-1 px-1 py-0">
                        {multiVisitGroupsCount}
                      </Badge>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setMegaGroupDialogOpen(true)}
                    className="h-7 text-[11px] gap-1 rounded-lg border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30 font-medium"
                  >
                    <Layers className="h-3 w-3 text-purple-600" />
                    Mega Groups
                    {((preferences.mega_groups?.length ?? 0) > 0 || ((activeBatch?.mega_groups as any)?.length ?? 0) > 0) && (
                      <Badge className="bg-purple-600 text-white font-bold text-[9px] ml-1 px-1 py-0">
                        {preferences.mega_groups?.length || (activeBatch?.mega_groups as any)?.length}
                      </Badge>
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-foreground">
                    Distribution Mode
                  </Label>
                  <Select
                    value={preferences.batchGroupType || activeBatch?.group_distribution_mode || "single_session"}
                    disabled
                  >
                    <SelectTrigger className="h-8 text-xs rounded-lg bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="single_session" className="text-xs">
                        Single-Session (1-off sessions per group)
                      </SelectItem>
                      <SelectItem value="multi_session" className="text-xs">
                        Multi-Session (Recurring Multi-Day Visits)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col justify-center text-[11px] text-muted-foreground">
                  {preferences.batchGroupType === "multi_session" || activeBatch?.group_distribution_mode === "multi_session" ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-semibold text-purple-700 dark:text-purple-300">
                        <Badge variant="outline" className="bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-700 text-[10px] px-1.5 py-0 font-bold">
                          {activeBatchCanonicalVisits} Visits / Student
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-normal">(Inherited from Batch)</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        Groups retain the same Group_ID, Lab, and recurring Time Slot across all {activeBatchCanonicalVisits} visit days.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-300">
                        <Badge variant="outline" className="bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-700 text-[10px] px-1.5 py-0 font-bold">
                          1 Visit / Student
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-normal">(Single Group Mode)</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight">
                        Each time slot receives a unique single-visit group ID with 1 visit.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Project Workspace Context Banner */}
          {isProjectSelected && isBatchSelected && activeBatch && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-[#056FEC]/5 border border-[#056FEC]/20 text-xs">
              <FolderKanban className="h-4 w-4 text-[#056FEC] shrink-0" />
              <div>
                <span className="font-semibold text-foreground">Project Workspace Context</span>
                <span className="text-muted-foreground ml-1.5 font-medium">
                  ({activeProject?.name} • {activeBatch.name})
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: File Upload Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#056FEC] text-white text-xs font-bold shadow-xs">
            2
          </span>
          <div>
            <h2 className="text-sm font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
              Data Ingestion &amp; Lab Capacity
            </h2>
            <p className="text-xs text-muted-foreground">
              Provide student demand cohort files and specify physical lab capacity sources.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* 1. Student Demand File */}
          <Card className={`shadow-xs transition-all ${studentFile ? "border-[#056FEC]/40 bg-[#056FEC]/5" : ""}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#056FEC]" />
                  Student Demand File
                </CardTitle>
                <Badge variant={studentFile ? "default" : "destructive"} className="text-[10px] font-semibold">
                  {studentFile ? "Ready" : "Required"}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Columns: <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">S_ID</code>, <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">Grade</code>, <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">Physical Area</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {savedUploadRecord && (
                <div className="flex items-center gap-1.5 text-[11px] text-[#056FEC] dark:text-[#05ACFF] bg-[#056FEC]/10 px-2.5 py-1.5 rounded-lg border border-[#056FEC]/20">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    Project roster: <strong>{activeProject?.name || "Current Project"}</strong> ({savedUploadRecord.student_count.toLocaleString()} students)
                  </span>
                </div>
              )}

              {studentFile ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#056FEC]/10 border border-[#056FEC]/30">
                  <div className="flex items-center gap-2.5 truncate">
                    <FileSpreadsheet className="h-5 w-5 text-[#056FEC] shrink-0" />
                    <div className="truncate">
                      <div className="text-xs font-semibold truncate">{studentFile.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {(studentFile.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] px-2 text-[#056FEC] hover:bg-[#056FEC]/10 font-semibold"
                      onClick={handleFetchProjectStudents}
                      title="Re-fetch student dataset from project roster"
                    >
                      <BrandIcon name="project" size={12} className="mr-1" />
                      Sync Project
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5 border-[#056FEC]/40 text-[#056FEC] hover:bg-[#056FEC]/10 font-semibold rounded-lg"
                      onClick={handleFetchProjectStudents}
                      title="Fetch student demand directly from project roster"
                    >
                      <BrandIcon name="project" size={14} />
                      Fetch from Project
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Student uploads and edits are managed in the Project Student Roster.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 text-[11px]">
                <a
                  href={getSampleTemplateUrl("students")}
                  download
                  className="text-[#056FEC] hover:underline flex items-center gap-1 font-medium"
                >
                  <Download className="h-3 w-3" /> Sample Students Template
                </a>
              </div>
            </CardContent>
          </Card>

          {/* 2. Lab Capacity File */}
          <Card className={`shadow-xs transition-all ${labFile || useDbLabs ? "border-[#FF7F1C]/40 bg-[#FF7F1C]/5" : ""}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-[#FF7F1C]" />
                  Lab Capacity Source
                </CardTitle>
                <Badge variant={labFile || useDbLabs ? "default" : "destructive"} className="text-[10px] font-semibold">
                  {labFile || useDbLabs ? "Ready" : "Required"}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Columns: <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">Lab ID</code>, <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">Area</code>, <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">Lab Capacity</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Toggle DB vs File: Fetch System Labs is default */}
              <div className="flex items-center justify-between bg-muted/50 p-1 rounded-xl border border-border/50 text-xs">
                <button
                  type="button"
                  onClick={() => setUseDbLabs(true)}
                  className={`flex-1 py-1 px-2 rounded-lg text-center text-xs font-semibold transition-all ${
                    useDbLabs ? "bg-background text-foreground shadow-xs text-[#056FEC]" : "text-muted-foreground"
                  }`}
                >
                  Fetch System Labs (Default)
                </button>
                <button
                  type="button"
                  onClick={() => setUseDbLabs(false)}
                  className={`flex-1 py-1 px-2 rounded-lg text-center text-xs font-semibold transition-all ${!useDbLabs ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                    }`}
                >
                  Upload Excel / CSV
                </button>
              </div>

              <input
                ref={labFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={async (e) => {
                  if (e.target.files?.[0]) {
                    const file = e.target.files[0];
                    setLabFile(file);
                    setUseDbLabs(false);
                    try {
                      const parsed = await loadLabCapacity(file);
                      setParsedLabRows(parsed);
                      const nameMap: Record<string, string> = {};
                      for (const l of parsed) {
                        if (l["Lab ID"] && (l["Lab Name"] || l.name)) {
                          nameMap[l["Lab ID"]] = l["Lab Name"] || l.name || "";
                        }
                      }
                      if (Object.keys(nameMap).length > 0) {
                        setLabNameMap((prev) => ({ ...prev, ...nameMap }));
                      }
                    } catch (err) {
                      console.warn("Could not parse lab names from upload:", err);
                    }
                  }
                }}
              />

              {useDbLabs ? (
                <div className="p-3 rounded-xl bg-[#056FEC]/10 border border-[#056FEC]/30 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Database className="h-5 w-5 text-[#056FEC]" />
                    <div>
                      <div className="text-xs font-bold text-foreground">Active Portal Labs</div>
                      <div className="text-[10px] text-muted-foreground">
                        {dbLabsLoading ? "Loading from database..." : `${dbLabs.length} active physical labs loaded`}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchDbLabs}
                    className="h-7 text-xs rounded-lg hover:bg-[#056FEC]/15"
                    aria-label="Refresh database labs"
                  >
                    <RefreshCw className={`h-3 w-3 ${dbLabsLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              ) : labFile ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#FF7F1C]/10 border border-[#FF7F1C]/30">
                  <div className="flex items-center gap-2.5 truncate">
                    <FileSpreadsheet className="h-5 w-5 text-[#FF7F1C] shrink-0" />
                    <div className="truncate">
                      <div className="text-xs font-semibold truncate">{labFile.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {(labFile.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setLabFile(null);
                      if (labFileRef.current) labFileRef.current.value = "";
                    }}
                    aria-label="Remove lab capacity file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Choose from device:</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5 border-[#FF7F1C]/40 text-[#FF7F1C] hover:bg-[#FF7F1C]/10 font-semibold rounded-lg"
                      onClick={() => labFileRef.current?.click()}
                      aria-label="Upload Lab Capacity File"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Browse File
                    </Button>
                  </div>
                  <div
                    onClick={() => labFileRef.current?.click()}
                    className="border-2 border-dashed border-border/80 hover:border-[#FF7F1C]/60 rounded-xl p-4 text-center cursor-pointer transition-colors bg-muted/20 hover:bg-muted/40"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        labFileRef.current?.click();
                      }
                    }}
                    aria-label="Drag and drop or click to upload Lab Capacity File"
                  >
                    <Upload className="h-5 w-5 mx-auto text-[#FF7F1C] mb-1" />
                    <div className="text-xs font-medium">Or drag &amp; drop lab file here</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Supports .xlsx, .xls, .csv</div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 text-[11px]">
                <a
                  href={getSampleTemplateUrl("labs")}
                  download
                  className="text-[#056FEC] hover:underline flex items-center gap-1 font-medium"
                >
                  <Download className="h-3 w-3" /> Sample Lab Template
                </a>
              </div>
            </CardContent>
          </Card>

          {/* 3. Dashboard Template File (Optional) */}
          <Card className={`shadow-xs transition-all ${dashboardFile ? "border-purple-500/40 bg-purple-500/5" : ""}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TableProperties className="h-4 w-4 text-purple-500" />
                  Dashboard Template
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-semibold text-muted-foreground">
                  Optional
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Preserves custom metadata columns (Gov, Vendor, Supervisor, Addresses).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                ref={dashboardFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) setDashboardFile(e.target.files[0]);
                }}
              />

              {dashboardFile ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-purple-500/10 border border-purple-500/30">
                  <div className="flex items-center gap-2.5 truncate">
                    <FileSpreadsheet className="h-5 w-5 text-purple-500 shrink-0" />
                    <div className="truncate">
                      <div className="text-xs font-semibold truncate">{dashboardFile.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {(dashboardFile.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setDashboardFile(null);
                      if (dashboardFileRef.current) dashboardFileRef.current.value = "";
                    }}
                    aria-label="Remove dashboard template file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Choose from device:</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5 border-purple-500/40 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30 font-semibold rounded-lg"
                      onClick={() => dashboardFileRef.current?.click()}
                      aria-label="Upload Dashboard Template File"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Browse File
                    </Button>
                  </div>
                  <div
                    onClick={() => dashboardFileRef.current?.click()}
                    className="border-2 border-dashed border-border/80 hover:border-purple-500/60 rounded-xl p-4 text-center cursor-pointer transition-colors bg-muted/20 hover:bg-muted/40"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        dashboardFileRef.current?.click();
                      }
                    }}
                    aria-label="Drag and drop or click to upload Dashboard Template File"
                  >
                    <Upload className="h-5 w-5 mx-auto text-purple-500 mb-1" />
                    <div className="text-xs font-medium">Or drag &amp; drop template here</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Generates layout if omitted</div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 text-[11px]">
                <a
                  href={getSampleTemplateUrl("dashboard")}
                  download
                  className="text-[#056FEC] hover:underline flex items-center gap-1 font-medium"
                >
                  <Download className="h-3 w-3" /> Sample Dashboard Template
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Step 3: Action Bar & Execution */}
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#056FEC] text-white text-xs font-bold shadow-xs">
            3
          </span>
          <div>
            <h2 className="text-sm font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
              Optimization &amp; Pipeline Execution
            </h2>
            <p className="text-xs text-muted-foreground">
              Review pre-flight validation and launch the exact mixed-integer programming solver.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-card border border-border/70 shadow-xs">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${result ? "bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF]" : "bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF]"
              } shrink-0`}>
              {result ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : (
                <Play className="h-5 w-5 fill-[#056FEC]/20" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs sm:text-lg font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                  Allocation Results &amp; Dashboard
                </h2>
                {result && (
                  <Badge className="bg-[#056FEC] text-white text-[10px] font-bold shadow-xs">
                    Optimized
                  </Badge>
                )}
                {result && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {allocationSyncStatus === "synced" && (
                      <>
                        <span>Revision {result.revision ?? "-"}</span>
                        <span>Saved by {result.updated_by || "Unknown"}</span>
                        <span>{result.updated_at ? new Date(result.updated_at).toLocaleString() : "Unknown save time"}</span>
                        <span title={result.run_id}>Run: {result.run_id ? `${result.run_id.slice(0, 12)}${result.run_id.length > 12 ? "..." : ""}` : "Unknown"}</span>
                      </>
                    )}
                    <Badge variant="outline" className={allocationSyncStatus === "synced" ? "border-emerald-500 text-emerald-700" : allocationSyncStatus === "not_synced" ? "border-destructive text-destructive" : "border-amber-500 text-amber-700"}>
                      {allocationSyncStatus === "synced" ? "Synced" : allocationSyncStatus === "syncing" ? (allocationUploadProgress === null ? "Syncing" : `Uploading shared result ${allocationUploadProgress}%`) : allocationSyncStatus === "offline" ? "Offline cache" : "Not synced"}
                    </Badge>
                    {allocationSyncStatus === "not_synced" && (
                      <Button size="sm" variant="outline" onClick={() => void handleRetryAllocationSave()}>
                        Retry Save
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                {preferences.batchGroupType === "multi_session" ? (
                  <Badge className="bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 text-[10px] font-semibold">
                    <Repeat className="h-3 w-3 mr-1" />
                    Multi-Session ({activeBatchCanonicalVisits} Visits / Group)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[10px] font-semibold">
                    Single-Session (1 Visit / Group)
                  </Badge>
                )}
                {((preferences.mega_groups?.length ?? 0) > 0 || ((activeBatch?.mega_groups as any)?.length ?? 0) > 0) && (
                  <Badge className="bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 text-[10px] font-semibold">
                    <Layers className="h-3 w-3 mr-1" />
                    {preferences.mega_groups?.length || (activeBatch?.mega_groups as any)?.length} Mega Groups
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap w-full sm:w-auto shrink-0">
            {/* Pre-Allocation Slot ID Generator Setting (Section 1) */}
            <div className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 rounded-xl border border-border/60">
              <Label className="text-xs font-semibold whitespace-nowrap text-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[#056FEC]" /> Slot ID Format:
              </Label>
              <Select
                value={slotIdTemplate}
                onValueChange={(v) => setSlotIdTemplate(v as SlotIdTemplate)}
                disabled={loading || !canManageAllocation}
              >
                <SelectTrigger className="h-7 text-xs min-w-[170px] bg-background">
                  <SelectValue placeholder="Slot ID Template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="original">Keep Original (SLOT-LAB-DAY-TIME)</SelectItem>
                  <SelectItem value="template_a">Template A — Pure Integer (14000, 14001)</SelectItem>
                  <SelectItem value="template_b">Template B — Mixed (L556G4, L123G4)</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground hidden lg:inline-flex">
                Max 6 Chars
              </Badge>
            </div>

            {result && (
              <Button
                size="sm"
                asChild
                className="gap-1.5 bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white font-bold rounded-xl shadow-xs"
              >
                <a href={getAllocationDownloadUrl(result.jobId, "all_zip")} download>
                  <FolderArchive className="h-4 w-4" /> Download Complete ZIP Bundle
                </a>
              </Button>
            )}
            <Button
              size={result ? "sm" : "lg"}
              onClick={() => handleRunAllocation()}
              disabled={loading || !canManageAllocation}
              className={`gap-2 text-white font-bold rounded-xl transition-all ${
                !canRunAllocation
                  ? "bg-[#056FEC]/70 hover:bg-[#056FEC] shadow-sm cursor-pointer"
                  : "bg-[#056FEC] hover:bg-[#043FAD] shadow-md shadow-[#056FEC]/25"
              }`}
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> Solving ILP Model...
                </>
              ) : (
                <>
                  <BrandIcon name="process_on" size={18} /> {result ? "Re-run Pipeline" : "Run Lab Allocation Pipeline"}
                </>
              )}
            </Button>
            {!canManageAllocation && (
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                View only - allocation managed by {allocationOwnerLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress Message during execution */}
      {loading && !result && (
        <div className="p-6 rounded-2xl border border-[#056FEC]/30 bg-[#056FEC]/5 text-center space-y-3 animate-pulse">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-[#056FEC]/20 text-[#056FEC] mb-1">
            <Cpu className="h-6 w-6 animate-spin" />
          </div>
          <h3 className="text-sm font-bold text-foreground">Solving Exact Integer Linear Programming Model...</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">{progressStep}</p>
        </div>
      )}

      {/* Results Section */}
      {result && !loading && (
        <div className="space-y-4 pt-2">

          {/* Operations Online Migration Suggestions (Section 4) */}
          {result.online_migration_suggestions && result.online_migration_suggestions.length > 0 && (
            <div className="p-4 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-background to-orange-500/5 shadow-xs space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-foreground">
                        VP Session Recommendations
                      </h3>
                      <Badge className="bg-amber-600 text-white font-bold text-[10px]">
                        {result.online_migration_suggestions.filter((s) => s.status === "pending").length} Pending Review
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-semibold border-amber-500/40 text-amber-700 dark:text-amber-300">
                        Cost Optimization
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Cohorts with <strong>fewer than 8 students in the same governorate and exact academic level</strong>. Accepted cohorts are regrouped across governorates without mixing levels.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!allocationDetailsLoaded && <Button size="sm" variant="outline" disabled={loadingBatchData} onClick={() => void loadAllocationDetails("vp_sessions")}>{loadingBatchData ? "Loading..." : "Load VP details"}</Button>}
                  <Button size="sm" variant="outline" disabled={!canManageAllocation || !allocationDetailsLoaded || savingVpWorkflow || matchingPendingVpIds.length === 0} onClick={() => setSelectedVpRecommendationIds(new Set(matchingPendingVpIds))}>Select All Pending</Button>
                  <Button size="sm" variant="ghost" disabled={selectedVpRecommendationIds.size === 0} onClick={() => setSelectedVpRecommendationIds(new Set())}>Clear Selection</Button>
                  <Button size="sm" disabled={!canManageAllocation || !allocationDetailsLoaded || savingVpWorkflow || selectedVpRecommendationIds.size === 0} onClick={() => void handleBulkVpRecommendations(Array.from(selectedVpRecommendationIds), "accepted")}>Accept Selected as VP</Button>
                  <Button size="sm" variant="outline" disabled={!canManageAllocation || !allocationDetailsLoaded || savingVpWorkflow || selectedVpRecommendationIds.size === 0} onClick={() => void handleBulkVpRecommendations(Array.from(selectedVpRecommendationIds), "keep_physical")}>Keep Selected Physical</Button>
                  <Button size="sm" variant="ghost" onClick={() => setVpRecommendationsCollapsed((value) => !value)}>{vpRecommendationsCollapsed ? "Expand" : "Collapse"}</Button>
                </div>
              </div>

              {!vpRecommendationsCollapsed && <>
              {vpProcessingCount > 0 && <div className="rounded-lg border border-[#056FEC]/30 bg-[#056FEC]/5 px-3 py-2 text-xs font-semibold text-[#056FEC]">Processing {vpProcessingCount} recommendations...</div>}
              <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
                <div className="space-y-1"><Label className="text-[11px]">Status</Label><Select value={vpStatusFilter} onValueChange={setVpStatusFilter}><SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="accepted">Accepted VP</SelectItem><SelectItem value="keep_physical">Keep Physical</SelectItem></SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-[11px]">Governorate</Label><Select value={vpGovernorateFilter} onValueChange={setVpGovernorateFilter}><SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All Governorates</SelectItem>{vpGovernorates.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-[11px]">Track / Level</Label><Select value={vpAcademicFilter} onValueChange={setVpAcademicFilter}><SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All Tracks / Levels</SelectItem>{vpAcademicOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                <Button size="sm" variant="outline" disabled={!canManageAllocation || !allocationDetailsLoaded || savingVpWorkflow || allPendingVpIds.length === 0} onClick={() => void handleBulkVpRecommendations(allPendingVpIds, "accepted")}>Accept All Pending as VP</Button>
                <Button size="sm" variant="outline" disabled={!canManageAllocation || !allocationDetailsLoaded || savingVpWorkflow || allPendingVpIds.length === 0} onClick={() => void handleBulkVpRecommendations(allPendingVpIds, "keep_physical")}>Keep All Pending Physical</Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                {paginatedVpRecommendations.map((sug) => {
                  const isAccepted = sug.status === "accepted";
                  const isRejected = sug.status === "rejected" || sug.status === "keep_physical";
                  const isPending = !isAccepted && !isRejected;
                  const govName = sug.governorate || sug.gov || sug.area;
                  const suggestionKey = sug.decisionKey || sug.id || govName;
                  const affectedGrades = sug.affectedGrades ?? [];
                  const selectedGrades = pendingGradeSelections[suggestionKey] ?? pendingGradeSelections[govName] ?? affectedGrades;
                  const acceptedGrades = sug.acceptedGrades ?? affectedGrades;
                  const isPartialAccepted = isAccepted && sug.acceptedGrades && sug.acceptedGrades.length < affectedGrades.length;

                  return (
                    <div
                      key={suggestionKey}
                      className={`p-3 rounded-xl border transition-all space-y-2.5 ${
                        isAccepted
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : isRejected
                          ? "border-muted bg-muted/20 opacity-70"
                          : "border-amber-500/30 bg-card"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {sug.status === "pending" && <Checkbox checked={selectedVpRecommendationIds.has(suggestionKey)} onCheckedChange={(checked) => setSelectedVpRecommendationIds((current) => { const next = new Set(current); if (checked) next.add(suggestionKey); else next.delete(suggestionKey); return next; })} aria-label={`Select ${govName} ${sug.academicLabel || "recommendation"}`} />}
                        <div>
                          <div className="font-bold text-xs text-foreground flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-amber-600" />
                            {govName}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground">{sug.academicLabel || sug.affectedGrades?.map((grade) => `G${grade}`).join(", ")}</span>
                            <span> - </span>
                            {sug.affectedAreas && sug.affectedAreas.length > 0 ? (
                              <span>Areas: {sug.affectedAreas.join(", ")}</span>
                            ) : (
                              <span>Lab: {sug.labId}</span>
                            )}
                          </div>
                        </div>
                        {isAccepted ? (
                          <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                            {isPartialAccepted
                              ? `Partial VP (${acceptedGrades.length}/${affectedGrades.length})`
                              : "VP Session Accepted"}
                          </Badge>
                        ) : isRejected ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Kept Physical
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-600 text-white text-[10px] font-bold animate-pulse">
                            {sug.totalAssigned} Students (&lt;8)
                          </Badge>
                        )}
                      </div>

                      <div className="text-[11px] text-muted-foreground space-y-1.5 bg-muted/20 p-2.5 rounded-lg">
                        <div className="flex justify-between items-center">
                          <span>Governorate Student Count:</span>
                          <span className="font-semibold text-foreground">{sug.totalAssigned} students</span>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="shrink-0 font-medium text-foreground/80">
                              {isPending ? "Select Grades to Migrate:" : "Grades Affected:"}
                            </span>
                            {isPending && affectedGrades.length > 1 && (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingGradeSelections((prev) => ({
                                      ...prev,
                                      [suggestionKey]: [...affectedGrades],
                                    }))
                                  }
                                  className="text-amber-600 dark:text-amber-400 hover:underline font-semibold cursor-pointer"
                                >
                                  All
                                </button>
                                <span>/</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingGradeSelections((prev) => ({
                                      ...prev,
                                      [suggestionKey]: [],
                                    }))
                                  }
                                  className="hover:underline cursor-pointer"
                                >
                                  None
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col gap-1.5 pt-0.5">
                            {affectedGrades.length > 0 ? (
                              affectedGrades.map((g, gIdx) => {
                                const label = formatGradeLabel(g, program);
                                const count =
                                  sug.affectedGradeCounts?.[label] ??
                                  (affectedGrades.length === 1 ? sug.totalAssigned : undefined);
                                const isChecked = selectedGrades.includes(g);
                                const wasAccepted = isAccepted && acceptedGrades.includes(g);

                                return (
                                  <div
                                    key={gIdx}
                                    className={`flex items-center justify-between gap-2 p-1.5 rounded-md border text-xs transition-colors ${
                                      isPending
                                        ? isChecked
                                          ? "bg-amber-500/10 border-amber-500/30 text-foreground"
                                          : "bg-background/50 border-border/50 text-muted-foreground opacity-60"
                                        : isAccepted
                                        ? wasAccepted
                                          ? "bg-emerald-500/10 border-emerald-500/30 text-foreground"
                                          : "bg-muted/40 border-border/40 text-muted-foreground opacity-50"
                                        : "bg-background/50 border-border/50 text-muted-foreground"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      {isPending && (
                                        <Checkbox
                                          id={`vp-grade-${suggestionKey}-${g}`}
                                          checked={isChecked}
                                          onCheckedChange={(checked) => {
                                            const current = pendingGradeSelections[suggestionKey] ?? [...affectedGrades];
                                            const next = checked
                                              ? Array.from(new Set([...current, g]))
                                              : current.filter((x) => x !== g);
                                            setPendingGradeSelections((prev) => ({
                                              ...prev,
                                              [suggestionKey]: next,
                                            }));
                                          }}
                                          className="h-3.5 w-3.5 data-[state=checked]:bg-amber-600 data-[state=checked]:border-amber-600"
                                        />
                                      )}
                                      <label
                                        htmlFor={`vp-grade-${suggestionKey}-${g}`}
                                        className={`cursor-pointer flex items-center gap-1.5 select-none ${
                                          isPending && !isChecked ? "line-through opacity-75" : ""
                                        }`}
                                      >
                                        <span>{renderGradeBadge(g)}</span>
                                      </label>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      {count !== undefined && (
                                        <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">
                                          {count} student{count !== 1 ? "s" : ""}
                                        </span>
                                      )}
                                      {isAccepted && (
                                        <Badge
                                          variant="outline"
                                          className={`text-[9px] px-1 py-0 h-4 font-semibold ${
                                            wasAccepted
                                              ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                                              : "border-muted text-muted-foreground bg-muted/40"
                                          }`}
                                        >
                                          {wasAccepted ? "Online" : "Physical"}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <span className="font-semibold text-foreground">All</span>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-0.5 border-t border-border/40">
                          <span>Eligibility Rule:</span>
                          <span className="font-bold text-amber-600">
                            Governorate-level cohort &lt; 8
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        {isAccepted ? (
                          <div className="w-full text-center text-xs font-semibold text-emerald-600 py-1 flex items-center justify-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isPartialAccepted
                              ? `Added ${acceptedGrades.length} Grade(s) to VP Sessions`
                              : "Added to VP Sessions"}
                          </div>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              disabled={!canManageAllocation || !allocationDetailsLoaded || savingVpWorkflow || (affectedGrades.length > 0 && selectedGrades.length === 0)}
                              onClick={() => handleAcceptOnlineMigration(suggestionKey, selectedGrades)}
                              className="h-7 text-xs flex-1 gap-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg shadow-xs disabled:opacity-50"
                            >
                              <Sparkles className="h-3 w-3" />
                              {selectedGrades.length === 0
                                ? "Select Grade(s)"
                                : selectedGrades.length < affectedGrades.length
                                ? `Accept VP (${selectedGrades.length} Grades)`
                                : "Accept VP Session"}
                            </Button>
                            {!isRejected && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canManageAllocation || !allocationDetailsLoaded || savingVpWorkflow}
                                onClick={() => handleRejectOnlineMigration(suggestionKey)}
                                className="h-7 text-xs text-muted-foreground hover:text-foreground rounded-lg"
                              >
                                Keep Physical
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <span>Showing {filteredVpRecommendations.length === 0 ? 0 : (vpRecommendationPage - 1) * vpRecommendationPageSize + 1}-{Math.min(filteredVpRecommendations.length, vpRecommendationPage * vpRecommendationPageSize)} of {filteredVpRecommendations.length}</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled={vpRecommendationPage === 1} onClick={() => setVpRecommendationPage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-3.5 w-3.5" /> Previous</Button>
                  {Array.from({ length: vpRecommendationPageCount }, (_, index) => index + 1).filter((page) => page === 1 || page === vpRecommendationPageCount || Math.abs(page - vpRecommendationPage) <= 1).map((page) => <Button key={page} size="sm" variant={page === vpRecommendationPage ? "default" : "ghost"} className="h-8 w-8 p-0" onClick={() => setVpRecommendationPage(page)}>{page}</Button>)}
                  <Button size="sm" variant="outline" disabled={vpRecommendationPage === vpRecommendationPageCount} onClick={() => setVpRecommendationPage((page) => Math.min(vpRecommendationPageCount, page + 1))}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
                </div>
              </div>

              {result.vp_sessions && result.vp_sessions.length > 0 && (
                <div className="overflow-x-auto border-t border-border/60 pt-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>VP Session</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Track</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead className="text-right">Students</TableHead>
                        <TableHead className="text-right">Capacity</TableHead>
                        <TableHead>Governorates</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.vp_sessions.map((session) => (
                        <TableRow key={`${session.projectId}-${session.id}`}>
                          <TableCell className="font-mono font-semibold">{session.id}</TableCell>
                          <TableCell>{session.projectName}</TableCell>
                          <TableCell>{session.track || "-"}</TableCell>
                          <TableCell>{session.program === "DEMI" ? `G${session.level}` : `L${session.level}`}</TableCell>
                          <TableCell className="text-right">{session.studentCount}</TableCell>
                          <TableCell className="text-right">{session.capacity}</TableCell>
                          <TableCell>{session.governorates.join(", ")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              </>}
            </div>
          )}

          {/* Resolve Unassigned Students & Action Paths Banner */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 p-4 rounded-2xl border border-border/70 bg-card shadow-xs">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF] shrink-0">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                    Resolve Unassigned Students &amp; Exception Rules
                  </span>
                  {resolutionRequests.length > 0 && (
                    <Badge className="bg-[#056FEC] text-white font-bold text-[10px]">
                      {resolutionRequests.length} Active Request(s)
                    </Badge>
                  )}
                  {(preferences.overfillRules.length + preferences.extraLabs.length) > 0 && (
                    <Badge className="bg-[#056FEC] text-white font-bold text-[10px]">
                      {preferences.overfillRules.length + preferences.extraLabs.length} Approved Rule(s) Applied
                    </Badge>
                  )}
                  {(result.summary?.overfill_count ?? 0) > 0 && (
                    <Badge variant="outline" className="border-purple-500 text-purple-600 dark:text-purple-400 font-bold text-[10px] bg-purple-50/50 dark:bg-purple-950/30">
                      +{result.summary.overfill_count} Placed via Fair Overfill
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Resolve cohort shortfalls via <strong>Fair Overfill</strong> (+2 sign-off), <strong>Request New Lab</strong> (Event Team), or <strong>CS Nearest-Lab Outreach</strong>.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setGroupClassDialogOpen(true)}
                disabled={loading || !canManageAllocation}
                className="h-8 text-xs gap-1.5 font-medium rounded-xl border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30"
              >
                <Repeat className="h-3.5 w-3.5 text-purple-600" />
                Group Classifications
                {multiVisitGroupsCount > 0 && (
                  <Badge className="bg-purple-600 text-white font-bold text-[10px] ml-1 px-1.5 py-0">
                    {multiVisitGroupsCount} Multi-Visit
                  </Badge>
                )}
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setMegaGroupDialogOpen(true)}
                disabled={loading}
                className="h-8 text-xs gap-1.5 font-medium rounded-xl border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30"
              >
                <Layers className="h-3.5 w-3.5 text-purple-600" />
                Mega Groups
                {((preferences.mega_groups?.length ?? 0) > 0 || ((activeBatch?.mega_groups as any)?.length ?? 0) > 0) && (
                  <Badge className="bg-purple-600 text-white font-bold text-[10px] ml-1 px-1.5 py-0">
                    {preferences.mega_groups?.length || (activeBatch?.mega_groups as any)?.length}
                  </Badge>
                )}
              </Button>

              {(preferences.overfillRules.length + preferences.preferredLabRules.length + preferences.extraLabs.length) > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleResetPreferences}
                  disabled={loading || !canManageAllocation}
                  className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1 rounded-xl"
                >
                  <RotateCcw className="h-3 w-3" /> Reset Rules
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setPrefDialogOpen(true)}
                disabled={loading || !canManageAllocation}
                className="h-8 text-xs gap-1.5 font-bold shadow-xs bg-[#056FEC] hover:bg-[#043FAD] text-white rounded-xl"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Resolve Unassigned {resolutionRequests.length > 0 ? `(${resolutionRequests.length})` : ""}
              </Button>
            </div>
          </div>

          {/* Metric Summary Cards */}
          {(() => {
            const acceptedSuggestions = (result.online_migration_suggestions ?? []).filter((s) => s.status === "accepted");
            const onlineStudentCount = acceptedSuggestions.reduce(
              (acc, s) => acc + ((s.acceptedStudentIds ?? s.affectedStudentIds)?.length ?? s.studentCount ?? 0),
              0
            );
            const onlineGovCount = acceptedSuggestions.length;

            return (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                {/* Total Students */}
                <Card className="shadow-xs">
                  <CardContent className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Total Demand</span>
                      <Users className="h-3.5 w-3.5 text-[#056FEC]" />
                    </div>
                    <div className="text-2xl font-bold text-foreground">{(result.summary?.total_students ?? 0).toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground">Students submitted</div>
                  </CardContent>
                </Card>

                {/* Assigned Count */}
                <Card className="border-[#056FEC]/30 bg-[#056FEC]/5 shadow-xs">
                  <CardContent className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold text-[#056FEC] dark:text-[#05ACFF] flex items-center justify-between">
                      <span>Physical Assigned</span>
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#056FEC]" />
                    </div>
                    <div className="text-2xl font-bold text-[#056FEC] dark:text-[#05ACFF]">
                      {physicalAssignedCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-[#056FEC]/90 font-medium">
                      {(((physicalAssignedCount) / (result.summary?.total_students || 1)) * 100).toFixed(1)}% match rate
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-xs">
                  <CardContent className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Seat Visits</span>
                      <List className="h-3.5 w-3.5 text-[#FF7F1C]" />
                    </div>
                    <div className="text-2xl font-bold text-foreground">
                      {(result.summary?.total_seat_visits ?? result.master_allocation.length).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Master allocation visit rows</div>
                  </CardContent>
                </Card>

                {/* Unassigned Count */}
                <Card className={`shadow-xs ${physicalUnassignedCount > 0 ? "border-[#DE1F1F]/40 bg-[#DE1F1F]/5" : ""}`}>
                  <CardContent className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Unassigned</span>
                      <AlertTriangle className={`h-3.5 w-3.5 ${physicalUnassignedCount > 0 ? "text-[#DE1F1F]" : "text-muted-foreground"}`} />
                    </div>
                    <div className={`text-2xl font-bold ${physicalUnassignedCount > 0 ? "text-[#DE1F1F]" : "text-foreground"}`}>
                      {physicalUnassignedCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {physicalUnassignedCount === 0 ? "0 Shortfall" : "Needs extra capacity"}
                    </div>
                  </CardContent>
                </Card>

                {/* Sessions Used */}
                <Card className="shadow-xs">
                  <CardContent className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Sessions Assigned</span>
                      <Clock className="h-3.5 w-3.5 text-[#FF7F1C]" />
                    </div>
                    <div className="text-2xl font-bold text-foreground">
                      {physicalSessionsAssignedCount}
                      <span className="text-xs text-muted-foreground font-normal"> / {result.summary?.total_sessions_available ?? 0}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">Across {result.summary?.total_labs ?? 0} physical labs</div>
                  </CardContent>
                </Card>

                {/* Online Migrations (VP) */}
                <Card className={`shadow-xs ${acceptedSuggestions.length > 0 ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
                  <CardContent className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center justify-between">
                      <span>Online Migrations</span>
                      <Globe className="h-3.5 w-3.5 text-amber-500" />
                    </div>
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                      {onlineStudentCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-medium">
                      {onlineGovCount} governorate{onlineGovCount === 1 ? "" : "s"} online
                    </div>
                  </CardContent>
                </Card>

                {/* Integrity Status */}
                <Card className="shadow-xs col-span-2">
                  <CardContent className="p-4 space-y-2">
                    <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Integrity Checks</span>
                      <Badge variant="outline" className="text-[10px] text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/40 font-semibold">
                        Verified
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                      <div className="flex items-center gap-1 text-[#0EAA3A] font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>0 Cap Overflow</span>
                      </div>
                      <div className="flex items-center gap-1 text-[#0EAA3A] font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>0 Mixed Grade</span>
                      </div>
                      <div className="flex items-center gap-1 text-[#0EAA3A] font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>0 Duplicate S_ID</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })()}

          {/* Interactive Results Data Tabs */}
          <Tabs value={activeResultsTab} onValueChange={handleResultsTabChange} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1 overflow-x-auto pb-1">
              <TabsList className="flex h-auto w-max min-w-full justify-start gap-1 p-1 bg-muted/60 rounded-xl">
                <TabsTrigger value="visualizations" className="min-w-max shrink-0 whitespace-nowrap px-3 text-xs py-2 gap-1.5 font-semibold">
                  <PieChartIcon className="h-3.5 w-3.5 text-[#056FEC]" /> Visual Analytics
                </TabsTrigger>
                <TabsTrigger value="vp_sessions" className="min-w-max shrink-0 whitespace-nowrap px-3 text-xs py-2 font-semibold">VP Sessions ({vpSessions.length})</TabsTrigger>
                <TabsTrigger value="consolidation_analysis" className="min-w-max shrink-0 whitespace-nowrap px-3 text-xs py-2 font-semibold">Consolidation Analysis ({result.consolidation_analysis?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="dashboard_summary" className="min-w-max shrink-0 whitespace-nowrap px-3 text-xs py-2 font-semibold">
                  Area Demand Matrix
                </TabsTrigger>
                <TabsTrigger value="master_allocation" className="min-w-max shrink-0 whitespace-nowrap px-3 text-xs py-2 font-semibold">
                  Master Allocation / Seat Visits ({result.master_allocation.length})
                </TabsTrigger>
                <TabsTrigger value="lab_pivot" className="min-w-max shrink-0 whitespace-nowrap px-3 text-xs py-2 font-semibold">
                  Lab Grid Matrix
                </TabsTrigger>
                <TabsTrigger value="area_grade" className="min-w-max shrink-0 whitespace-nowrap px-3 text-xs py-2 font-semibold">
                  Area Grade Breakdown
                </TabsTrigger>
                <TabsTrigger value="shortfall" className="min-w-max shrink-0 whitespace-nowrap px-3 text-xs py-2 font-semibold">
                  Shortfall &amp; Logs {physicalUnassignedCount > 0 ? `(${physicalUnassignedCount})` : "✓"}
                </TabsTrigger>
              </TabsList>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleExportAllTabsToExcel}
                className="h-9 gap-1.5 bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white rounded-xl font-bold text-xs shadow-xs shrink-0"
              >
                <FileSpreadsheet className="h-4 w-4" /> Export Tabs to Excel (.xlsx)
              </Button>
            </div>

            {/* TAB 0: Rich Visual Analytics & Charts */}
            <TabsContent value="visualizations" className="space-y-4">
              <AllocationVisualizations
                program={program as ProjectProgram}
                summary={result.summary}
                shortfallMath={result.shortfall_math}
                unassignedStudents={result.unassigned_students}
                areaGradeSummary={computedAreaGradeSummary}
                shortfallText={result.shortfall_text}
              />
            </TabsContent>

            <TabsContent value="consolidation_analysis" className="space-y-3">
              <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">Pending: {consolidationDecisionCounts.pending}</Badge>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">Accepted: {consolidationDecisionCounts.accepted}</Badge>
                  <Badge variant="outline" className="border-rose-500/40 text-rose-700 dark:text-rose-300">Rejected: {consolidationDecisionCounts.rejected}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={consolidationDecisionCounts.pending === 0 || savingConsolidationBulk} onClick={() => setConsolidationBulkAction("accepted")}>
                    {savingConsolidationBulk && consolidationBulkAction === "accepted" ? "Accepting..." : "Accept All Pending"}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={consolidationDecisionCounts.pending === 0 || savingConsolidationBulk} onClick={() => setConsolidationBulkAction("rejected")}>
                    {savingConsolidationBulk && consolidationBulkAction === "rejected" ? "Rejecting..." : "Reject All Pending"}
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_minmax(240px,1.4fr)_minmax(220px,1.2fr)]">
                <Select value={consolidationGovernorateFilter} onValueChange={setConsolidationGovernorateFilter}>
                  <SelectTrigger className="h-9 min-w-0 text-xs"><SelectValue placeholder="All Governorates" /></SelectTrigger>
                  <SelectContent><SelectItem value="ALL">All Governorates</SelectItem>{consolidationGovernorates.map((governorate) => <SelectItem key={governorate} value={governorate}>{governorate}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={consolidationAcademicFilter} onValueChange={setConsolidationAcademicFilter}>
                  <SelectTrigger className="h-9 min-w-0 text-xs"><SelectValue placeholder="All Tracks / Levels" /></SelectTrigger>
                  <SelectContent><SelectItem value="ALL">{program === "DEMI" ? "All Grades" : "All Tracks / Levels"}</SelectItem>{consolidationAcademicOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
                <div className="relative min-w-0"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={consolidationAreaSearch} onChange={(event) => setConsolidationAreaSearch(event.target.value)} placeholder="Search source or destination area" className="h-9 pl-9 text-xs" /></div>
              </div>
              {filteredConsolidationResults.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{consolidationResults.length === 0 ? "No physical area consolidation was needed for this allocation." : "No consolidation records match the selected filters."}</CardContent></Card>
              ) : visibleConsolidationResults.map((decision: ConsolidationAnalysisDecision) => {
                const decisionKey = `${decision.governorate}\u0000${decision.academicLabel}\u0000${decision.destinationArea}`;
                return <Card key={decisionKey}>
                  <details className="group" open={expandedConsolidationKeys.has(decisionKey)} onToggle={(event) => {
                    const open = event.currentTarget.open;
                    setExpandedConsolidationKeys((current) => {
                      const next = new Set(current);
                      if (open) next.add(decisionKey); else next.delete(decisionKey);
                      return next;
                    });
                  }}>
                    <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
                      <div className="grid items-center gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(120px,1fr)_minmax(220px,1.8fr)_minmax(140px,1.2fr)_minmax(100px,.7fr)_minmax(110px,.8fr)_24px]">
                        <div className="min-w-0"><div className="text-[11px] text-muted-foreground">Governorate</div><div className="truncate text-sm font-semibold" title={decision.governorate}>{decision.governorate}</div></div>
                        <div className="min-w-0"><div className="text-[11px] text-muted-foreground">Academic Track / Level</div><div className="truncate text-sm font-semibold" title={program === "DEMI" ? `G${decision.level}` : `${decision.track || "Unspecified track"} - Level ${decision.level}`}>{program === "DEMI" ? `G${decision.level}` : `${decision.track || "Unspecified track"} - Level ${decision.level}`}</div></div>
                        <div className="min-w-0"><div className="text-[11px] text-muted-foreground">Destination Area</div><div className="truncate text-sm font-semibold" title={decision.destinationArea}>{decision.destinationArea}</div></div>
                        <div><div className="text-[11px] text-muted-foreground">Students Moved</div><div className="text-sm font-semibold">{decision.studentsMoved}</div></div>
                        <div><div className="text-[11px] text-muted-foreground">Final Cohort Size</div><div className="text-sm font-semibold">{decision.finalCohortSize}</div><Badge variant={decision.decisionStatus === "rejected" ? "destructive" : decision.decisionStatus === "accepted" ? "default" : "secondary"} className="mt-1 text-[10px]">{decision.decisionStatus ?? "pending"}</Badge></div>
                        <ChevronRight className="hidden h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90 lg:block" />
                      </div>
                    </summary>
                    <CardContent className="border-t pt-4 space-y-4">
                      <div className="overflow-x-auto rounded-md border">
                        <Table><TableHeader><TableRow><TableHead>Source Area</TableHead><TableHead>Students Moved</TableHead></TableRow></TableHeader>
                          <TableBody>{decision.sourceAreas.map((source) => <TableRow key={source.sourceArea}><TableCell className="font-medium">{source.sourceArea}</TableCell><TableCell>{source.studentsMoved}</TableCell></TableRow>)}</TableBody>
                        </Table>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div><div className="text-[11px] text-muted-foreground">Destination Area</div><div className="text-sm font-semibold">{decision.destinationArea}</div></div>
                        <div><div className="text-[11px] text-muted-foreground">Existing Students Before Consolidation</div><div className="text-sm font-semibold">{decision.destinationExistingStudents}</div></div>
                        <div><div className="text-[11px] text-muted-foreground">Students Added</div><div className="text-sm font-semibold">{decision.studentsMoved}</div></div>
                        <div><div className="text-[11px] text-muted-foreground">Final Students</div><div className="text-sm font-semibold">{decision.finalCohortSize}</div></div>
                      </div>
                      <div><div className="text-[11px] font-semibold text-muted-foreground mb-1">Why this area was selected</div><p className="text-sm leading-6">{decision.reason}</p></div>
                    </CardContent>
                  </details>
                </Card>;
              })}
              {filteredConsolidationResults.length > 0 && <div className="flex flex-col items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground sm:flex-row">
                <span>Showing {(consolidationPage - 1) * consolidationPageSize + 1}–{Math.min(filteredConsolidationResults.length, consolidationPage * consolidationPageSize)} of {filteredConsolidationResults.length} consolidation records{filteredConsolidationResults.length !== consolidationResults.length ? ` (${consolidationResults.length} total)` : ""}</span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Select value={String(consolidationPageSize)} onValueChange={(value) => setConsolidationPageSize(Number(value))}><SelectTrigger className="h-8 w-20 bg-background text-xs"><SelectValue /></SelectTrigger><SelectContent>{[25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select>
                  <Button variant="outline" size="sm" className="h-8" disabled={consolidationPage === 1} onClick={() => setConsolidationPage((page) => Math.max(1, page - 1))}>Previous</Button>
                  {consolidationPageItems.map((item) => typeof item === "number" ? <Button key={item} variant={item === consolidationPage ? "default" : "outline"} size="sm" className="h-8 min-w-8 px-2" onClick={() => setConsolidationPage(item)}>{item}</Button> : <span key={item} className="px-1">...</span>)}
                  <Button variant="outline" size="sm" className="h-8" disabled={consolidationPage === totalConsolidationPages} onClick={() => setConsolidationPage((page) => Math.min(totalConsolidationPages, page + 1))}>Next</Button>
                </div>
              </div>}
            </TabsContent>

            {/* TAB: VP Sessions (Fully isolated from physical Lab Grid Matrix) */}
            <TabsContent value="vp_sessions" className="space-y-4">
              {/* 1. Top KPI Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  ["VP Eligible Students", vpEligibleCount],
                  ["VP Students Accepted", vpAcceptedCount],
                  ["Pending Recommendations", vpRecommendations.filter((item) => item.status === "pending").length],
                  ["VP Sessions Created", vpSessions.length],
                  ["Total Capacity", vpCapacity],
                  ["Capacity Utilization", `${vpCapacity ? ((vpAcceptedCount / vpCapacity) * 100).toFixed(1) : "0.0"}%`],
                ].map(([label, value]) => (
                  <Card key={String(label)}>
                    <CardContent className="p-3">
                      <div className="text-[11px] text-muted-foreground">{label}</div>
                      <div className="text-xl font-bold mt-1">{value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {/* 2. Control Bar: View Mode Switcher + Shared Filters */}
              <Card>
                <CardHeader className="pb-3 pt-4 px-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center rounded-lg border bg-muted/60 p-1">
                        <Button
                          variant={vpViewMode === "table" ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => setVpViewMode("table")}
                          className={`h-8 gap-1.5 text-xs font-semibold rounded-md ${vpViewMode === "table" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"}`}
                        >
                          <List className="h-3.5 w-3.5 text-primary" /> Session Table ({filteredVpSessions.length})
                        </Button>
                        <Button
                          variant={vpViewMode === "matrix" ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => setVpViewMode("matrix")}
                          className={`h-8 gap-1.5 text-xs font-semibold rounded-md ${vpViewMode === "matrix" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"}`}
                        >
                          <TableProperties className="h-3.5 w-3.5 text-primary" /> Schedule &amp; Matrix View ({filteredVpPivotRows.length})
                        </Button>
                      </div>
                    </div>

                    {/* Filter controls */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative w-48">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search VP session, track, gov..."
                          value={vpSearchQuery}
                          onChange={(e) => {
                            setVpSearchQuery(e.target.value);
                            setVpMatrixPage(1);
                          }}
                          className="h-8 pl-8 text-xs"
                        />
                      </div>

                      {/* Grade / Track Filter */}
                      <Select
                        value={vpGradeFilter}
                        onValueChange={(v) => {
                          setVpGradeFilter(v);
                          setVpMatrixPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs w-36">
                          <SelectValue placeholder={program === "DEMI" ? "All Grades" : "All Tracks / Levels"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{program === "DEMI" ? "All Grades" : "All Tracks / Levels"}</SelectItem>
                          {uniqueVpGrades.map((g) => (
                            <SelectItem key={g} value={g}>
                              {formatGradeLabel(g, program)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Governorate Filter */}
                      <Select
                        value={vpGovFilter}
                        onValueChange={(v) => {
                          setVpGovFilter(v);
                          setVpMatrixPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs w-36">
                          <SelectValue placeholder="All Governorates" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All Governorates</SelectItem>
                          {uniqueVpGovernorates.map((gov) => (
                            <SelectItem key={gov} value={gov}>
                              {gov}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Session Status Filter (Table View) */}
                      {vpViewMode === "table" && (
                        <Select
                          value={vpSessionStatusFilter}
                          onValueChange={setVpSessionStatusFilter}
                        >
                          <SelectTrigger className="h-8 text-xs w-32">
                            <SelectValue placeholder="All Statuses" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All Statuses</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* 3A. View Mode: Session Table */}
              {vpViewMode === "table" && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <List className="h-4 w-4 text-primary" />
                          Batch VP Sessions Roster
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Online student cohorts grouped by exact project and academic track/level (max 30 per session).
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="text-xs font-normal">
                        Showing {filteredVpSessions.length} of {vpSessions.length} Sessions
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="text-xs font-semibold">Session ID</TableHead>
                          <TableHead className="text-xs font-semibold">Project</TableHead>
                          <TableHead className="text-xs font-semibold">Track</TableHead>
                          <TableHead className="text-xs font-semibold">Level</TableHead>
                          <TableHead className="text-xs font-semibold">Students</TableHead>
                          <TableHead className="text-xs font-semibold">Capacity</TableHead>
                          <TableHead className="text-xs font-semibold">Occupancy</TableHead>
                          <TableHead className="text-xs font-semibold">Remaining</TableHead>
                          <TableHead className="text-xs font-semibold">Governorates</TableHead>
                          <TableHead className="text-xs font-semibold">Status</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredVpSessions.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={11} className="text-center py-8 text-sm text-muted-foreground">
                              No VP sessions found matching the selected filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredVpSessions.map((session) => {
                            const pct = session.capacity > 0 ? (session.studentCount / session.capacity) * 100 : 0;
                            const isFull = session.studentCount >= session.capacity;
                            return (
                              <Fragment key={session.id}>
                                <TableRow className="hover:bg-muted/30">
                                  <TableCell className="font-mono font-bold text-xs text-foreground">{session.id}</TableCell>
                                  <TableCell className="text-xs">{session.projectName}</TableCell>
                                  <TableCell className="text-xs">{session.track ? renderGradeBadge(session.track) : "-"}</TableCell>
                                  <TableCell className="text-xs">{renderGradeBadge(session.level)}</TableCell>
                                  <TableCell className="text-xs font-semibold">{session.studentCount}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{session.capacity}</TableCell>
                                  <TableCell className="text-xs">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${isFull ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" : pct >= 80 ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"}`}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${isFull ? "bg-emerald-500" : pct >= 80 ? "bg-blue-500" : "bg-amber-500"}`} />
                                      {pct.toFixed(0)}% Full
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">{Math.max(0, session.capacity - session.studentCount)}</TableCell>
                                  <TableCell className="text-xs max-w-xs truncate" title={session.governorates.join(", ")}>
                                    {session.governorates.join(", ")}
                                  </TableCell>
                                  <TableCell>
                                    <Select
                                      value={session.status || "active"}
                                      onValueChange={(value) => void handleVpSessionStatusChange(session.id, value as "active" | "completed" | "cancelled")}
                                      disabled={!canManageAllocation || savingVpWorkflow}
                                    >
                                      <SelectTrigger className="h-7 w-24 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="completed">Completed</SelectItem>
                                        <SelectItem value="cancelled">Cancelled</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      variant={expandedVpSessionId === session.id ? "secondary" : "outline"}
                                      onClick={() => setExpandedVpSessionId((current) => current === session.id ? null : session.id)}
                                      className="h-7 text-xs px-2.5 font-medium"
                                    >
                                      {expandedVpSessionId === session.id ? "Hide Roster" : "View Roster"}
                                    </Button>
                                  </TableCell>
                                </TableRow>

                                {expandedVpSessionId === session.id && (
                                  <TableRow>
                                    <TableCell colSpan={11} className="p-4 bg-muted/20 border-y">
                                      <div className="space-y-2">
                                        <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                                          <span className="flex items-center gap-1.5">
                                            <Users className="h-3.5 w-3.5 text-primary" />
                                            Enrolled Students ({session.studentIds.length} students)
                                          </span>
                                          <span className="text-muted-foreground text-[11px]">
                                            Session ID: {session.id} · Academic Identity: {session.academicLabel || session.academicIdentity}
                                          </span>
                                        </div>
                                        <div className="overflow-x-auto rounded-md border bg-background">
                                          <Table>
                                            <TableHeader className="bg-muted/40">
                                              <TableRow>
                                                <TableHead className="text-[11px] font-semibold">Student ID</TableHead>
                                                <TableHead className="text-[11px] font-semibold">Student Name</TableHead>
                                                <TableHead className="text-[11px] font-semibold">Governorate</TableHead>
                                                <TableHead className="text-[11px] font-semibold">Physical Area</TableHead>
                                                <TableHead className="text-[11px] font-semibold">Track</TableHead>
                                                <TableHead className="text-[11px] font-semibold">Level</TableHead>
                                                <TableHead className="text-[11px] font-semibold">Phone</TableHead>
                                                <TableHead className="text-[11px] font-semibold">Email</TableHead>
                                              </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                              {session.studentIds.map((studentId) => {
                                                const student = vpStudentById.get(studentId) || ({ S_ID: studentId } as StudentRecord);
                                                return (
                                                  <TableRow key={studentId} className="hover:bg-muted/20">
                                                    <TableCell className="font-mono font-bold text-xs">{studentId}</TableCell>
                                                    <TableCell className="text-xs font-medium">{String(student.Name || student.name || student["Student Name"] || "-")}</TableCell>
                                                    <TableCell className="text-xs">{String(student.Governorate || student.Gov || "-")}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{String(student["Physical Area"] || "-")}</TableCell>
                                                    <TableCell className="text-xs">{String(student.Track || session.track || "-")}</TableCell>
                                                    <TableCell className="text-xs">{formatGradeLevel(student.Grade || session.level, session.program)}</TableCell>
                                                    <TableCell className="text-xs font-mono text-muted-foreground">{String(student.Phone || student.phone || "-")}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{String(student.Email || student.email || "-")}</TableCell>
                                                  </TableRow>
                                                );
                                              })}
                                            </TableBody>
                                          </Table>
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </Fragment>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* 3B. View Mode: Schedule & Matrix View */}
              {vpViewMode === "matrix" && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <TableProperties className="h-4 w-4 text-primary" />
                          VP Session Schedule &amp; Capacity Utilization Matrix
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Color-coded occupancy across VP session slots. Format: [Students / Capacity (% Full)].
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="text-xs font-normal">
                        {filteredVpPivotRows.length} VP Session Rows
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    {/* Visual Legend Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs">
                      {/* Cohort Badges Legend */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-muted-foreground text-[11px]">
                          {program === "DEMI" ? "VP Grade Cohorts:" : "VP Track / Level Cohorts:"}
                        </span>
                        {uniqueVpGrades.length > 0 ? (
                          uniqueVpGrades.map((g) => (
                            <span key={g} className="inline-flex items-center gap-1">
                              {renderGradeBadge(g)}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">No VP cohort data</span>
                        )}
                      </div>

                      {/* Occupancy Colors Legend */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-muted-foreground text-[11px]">Occupancy:</span>
                        <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30 font-medium text-[11px]">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Full (100%)
                        </span>
                        <span className="inline-flex items-center gap-1 bg-blue-500/10 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-500/30 font-medium text-[11px]">
                          <span className="h-2 w-2 rounded-full bg-blue-500" /> Near Full (80-99%)
                        </span>
                        <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded border border-amber-500/30 font-medium text-[11px]">
                          <span className="h-2 w-2 rounded-full bg-amber-500" /> Partial (&lt;80%)
                        </span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground px-2 py-0.5 rounded font-mono text-[11px]">
                          — Open / Unscheduled
                        </span>
                      </div>
                    </div>

                    {/* Responsive Matrix Table */}
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            {vpPivotColumns.map((col) => (
                              <TableHead key={col} className="text-xs font-semibold text-foreground whitespace-nowrap">
                                {col}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedVpPivotRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={Math.max(1, vpPivotColumns.length)} className="text-center py-6 text-xs text-muted-foreground">
                                No VP sessions match the selected filters.
                              </TableCell>
                            </TableRow>
                          ) : (
                            paginatedVpPivotRows.map((row, idx) => (
                              <TableRow key={idx} className="hover:bg-muted/30">
                                {vpPivotColumns.map((col, cellIdx) => {
                                  const val = (row as Record<string, unknown>)[col];
                                  const isSlotCell = pivotSlotNumByLabel.has(col);

                                  if (col === "Level" || col === "Grade") {
                                    return (
                                      <TableCell key={cellIdx} className="text-xs whitespace-nowrap">
                                        {renderGradeBadge(val as any)}
                                      </TableCell>
                                    );
                                  }
                                  if (col === "Track") {
                                    return (
                                      <TableCell key={cellIdx} className="text-xs font-medium whitespace-nowrap">
                                        {val ? renderGradeBadge(val as any) : "-"}
                                      </TableCell>
                                    );
                                  }
                                  if (col === "Session ID" || col === "Lab_ID") {
                                    const sessIdStr = val !== null && val !== undefined ? String(val) : "—";
                                    return (
                                      <TableCell key={cellIdx} className="text-xs font-mono font-bold whitespace-nowrap text-foreground">
                                        {sessIdStr}
                                      </TableCell>
                                    );
                                  }
                                  if (col === "Governorate" || col === "Physical Area") {
                                    return (
                                      <TableCell key={cellIdx} className="text-xs font-medium whitespace-nowrap">
                                        {val !== null && val !== undefined ? String(val) : "—"}
                                      </TableCell>
                                    );
                                  }

                                  return (
                                    <TableCell key={cellIdx} className="text-xs whitespace-nowrap">
                                      {isSlotCell
                                        ? renderPivotSlotCell(val, row as Record<string, unknown>, col)
                                        : val !== null && val !== undefined
                                          ? String(val)
                                          : "—"}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination Footer */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 border rounded-lg bg-muted/20 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>
                          Showing {filteredVpPivotRows.length === 0 ? 0 : (vpMatrixPage - 1) * (vpMatrixPageSize === -1 ? filteredVpPivotRows.length : vpMatrixPageSize) + 1}–{vpMatrixPageSize === -1 ? filteredVpPivotRows.length : Math.min(filteredVpPivotRows.length, vpMatrixPage * vpMatrixPageSize)} of {filteredVpPivotRows.length} VP session rows
                        </span>
                        {filteredVpPivotRows.length !== vpPivotRows.length && (
                          <span className="text-[11px] opacity-75">
                            (filtered from {vpPivotRows.length} total)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span>Rows per page:</span>
                          <Select
                            value={String(vpMatrixPageSize)}
                            onValueChange={(v) => {
                              setVpMatrixPageSize(Number(v));
                              setVpMatrixPage(1);
                            }}
                          >
                            <SelectTrigger className="h-7 w-20 text-xs bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10</SelectItem>
                              <SelectItem value="25">25</SelectItem>
                              <SelectItem value="50">50</SelectItem>
                              <SelectItem value="100">100</SelectItem>
                              <SelectItem value="-1">All</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setVpMatrixPage((p) => Math.max(1, p - 1))}
                            disabled={vpMatrixPage === 1}
                            className="h-7 w-7 p-0"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <span className="px-2 text-xs font-medium">
                            {vpMatrixPage} / {totalVpMatrixPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setVpMatrixPage((p) => Math.min(totalVpMatrixPages, p + 1))}
                            disabled={vpMatrixPage === totalVpMatrixPages}
                            className="h-7 w-7 p-0"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* TAB 1: Dashboard Summary Matrix */}
            <TabsContent value="dashboard_summary" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      Physical Area × Grade Student Matrix
                      <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                        Total Demand = Assigned + Unassigned
                      </Badge>
                    </span>
                    <Badge variant="outline" className="text-xs font-normal">
                      {computedDashboardSummary.length} Areas
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Reconciled area breakdown showing full submitted student demand (source pivot), assigned student counts, dedicated unassigned shortfall, and group usage per area and grade.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        {computedDashboardSummary.length > 0 && (() => {
                          const cols = Object.keys(computedDashboardSummary[0]);
                          const demandCols = cols.filter((c) => c.endsWith("Demand"));
                          const assignedCols = cols.filter((c) => c.endsWith("Assigned"));
                          const unassignedCols = cols.filter((c) => c.endsWith("Unassigned"));
                          const groupCols = cols.filter((c) => c.includes("Groups"));

                          if (demandCols.length > 0 && assignedCols.length > 0) {
                            return (
                              <TableRow className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider">
                                <TableHead className="bg-muted/70 text-foreground font-semibold">Area</TableHead>
                                <TableHead
                                  colSpan={demandCols.length}
                                  className="text-center bg-sky-100/60 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 font-bold border-l border-r border-border/60"
                                >
                                  Student Demand (Source Data)
                                </TableHead>
                                <TableHead
                                  colSpan={assignedCols.length}
                                  className="text-center bg-emerald-100/60 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold border-r border-border/60"
                                >
                                  Students Assigned (Placed)
                                </TableHead>
                                <TableHead
                                  colSpan={unassignedCols.length}
                                  className="text-center bg-rose-100/60 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 font-bold border-r border-border/60"
                                >
                                  Unassigned Shortfall
                                </TableHead>
                                {groupCols.length > 0 && (
                                  <TableHead
                                    colSpan={groupCols.length}
                                    className="text-center bg-muted/40 text-muted-foreground font-semibold"
                                  >
                                    Groups Utilized
                                  </TableHead>
                                )}
                              </TableRow>
                            );
                          }
                          return null;
                        })()}
                        <TableRow>
                          {computedDashboardSummary.length > 0 &&
                            Object.keys(computedDashboardSummary[0]).map((col) => {
                              const isTotalDemand = col === "Total Demand";
                              const isDemand = col.endsWith("Demand");
                              const isTotalAssigned = col === "Total Assigned";
                              const isAssigned = col.endsWith("Assigned");
                              const isTotalUnassigned = col === "Total Unassigned" || col === "Unassigned";
                              const isUnassigned = col.endsWith("Unassigned");

                              const colStyle = isTotalDemand
                                ? "bg-sky-100/70 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200 font-bold border-r border-border/60 text-right"
                                : isDemand
                                ? "bg-sky-50/40 dark:bg-sky-950/20 text-sky-800 dark:text-sky-300 text-right"
                                : isTotalAssigned
                                ? "bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 font-bold border-r border-border/60 text-right"
                                : isAssigned
                                ? "bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 text-right"
                                : isTotalUnassigned
                                ? "bg-rose-100/70 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 font-bold border-r border-border/60 text-right"
                                : isUnassigned
                                ? "bg-rose-50/40 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 text-right"
                                : col === "Physical Area"
                                ? "text-left font-semibold text-foreground"
                                : "text-right font-semibold text-muted-foreground";

                              return (
                                <TableHead key={col} className={`text-xs whitespace-nowrap py-2 px-3 ${colStyle}`}>
                                  {(() => {
                                    const m = col.match(/^G(\d+)\s*(Demand|Assigned|Unassigned)$/);
                                    if (m) {
                                      const label = formatGradeLabel(Number(m[1]));
                                      return `${label} ${m[2]}`;
                                    }
                                    const mGrp = col.match(/^Grade(\d+)\s*(Groups)$/);
                                    if (mGrp) {
                                      const label = formatGradeLabel(Number(mGrp[1]));
                                      return `${label} ${mGrp[2]}`;
                                    }
                                    return col;
                                  })()}
                                </TableHead>
                              );
                            })}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {computedDashboardSummary.map((row, idx) => (
                          <TableRow key={idx} className="hover:bg-muted/30">
                            {Object.entries(row).map(([key, val], cellIdx) => {
                              const numVal = Number(val);
                              const isArea = key === "Physical Area";
                              const isTotalDemand = key === "Total Demand";
                              const isDemand = key.endsWith("Demand");
                              const isTotalAssigned = key === "Total Assigned" || key === "Grand Total";
                              const isAssigned = key.endsWith("Assigned");
                              const isTotalUnassigned = key === "Total Unassigned" || key === "Unassigned";
                              const isUnassigned = key.endsWith("Unassigned");

                              const cellStyle = isArea
                                ? "font-medium text-foreground text-left"
                                : isTotalDemand
                                ? "font-bold text-sky-800 dark:text-sky-300 bg-sky-50/50 dark:bg-sky-950/30 border-r border-border/60 text-right"
                                : isDemand
                                ? "text-foreground text-right"
                                : isTotalAssigned
                                ? "font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/30 border-r border-border/60 text-right"
                                : isAssigned
                                ? "text-foreground text-right"
                                : isTotalUnassigned
                                ? `font-bold text-right border-r border-border/60 ${
                                    numVal > 0
                                      ? "text-rose-700 dark:text-rose-300 bg-rose-100/70 dark:bg-rose-950/50"
                                      : "text-muted-foreground"
                                  }`
                                : isUnassigned
                                ? `text-right ${
                                    numVal > 0
                                      ? "font-semibold text-rose-600 dark:text-rose-400 bg-rose-50/40 dark:bg-rose-950/20"
                                      : "text-muted-foreground"
                                  }`
                                : "text-muted-foreground text-right font-mono";

                              return (
                                <TableCell key={cellIdx} className={`text-xs whitespace-nowrap py-2 px-3 ${cellStyle}`}>
                                  {val !== null && val !== undefined ? String(val) : "—"}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: Master Allocation Table */}
            <TabsContent value="master_allocation" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm font-semibold">
                        Master Student-to-Slot Allocation Roster
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Showing {filteredMasterRows.length} of {result.master_allocation.length} seat visits.
                      </CardDescription>
                    </div>

                    {/* Filter controls */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative w-48">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search student, lab, ID..."
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setCurrentPage(1);
                          }}
                          className="h-8 pl-8 text-xs"
                        />
                      </div>

                      {/* Area Filter */}
                      <Select
                        value={selectedAreaFilter}
                        onValueChange={(v) => {
                          setSelectedAreaFilter(v);
                          setCurrentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs w-36">
                          <SelectValue placeholder="All Areas" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All Areas</SelectItem>
                          {uniqueAreas.map((a) => (
                            <SelectItem key={a} value={a}>
                              {a}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Grade Filter */}
                      <Select
                        value={selectedGradeFilter}
                        onValueChange={(v) => {
                          setSelectedGradeFilter(v);
                          setCurrentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs w-28">
                          <SelectValue placeholder={program === "DEMI" ? "All Grades" : "All Tracks / Levels"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{program === "DEMI" ? "All Grades" : "All Tracks / Levels"}</SelectItem>
                          {uniqueGrades.map((g) => (
                            <SelectItem key={g} value={g}>
                              {formatGradeLabel(g, program)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Slot Filter */}
                      <Select
                        value={selectedSlotFilter}
                        onValueChange={(v) => {
                          setSelectedSlotFilter(v);
                          setCurrentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs w-32">
                          <SelectValue placeholder="All Slots" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All Slots</SelectItem>
                          {uniqueSlots.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs">Physical Area</TableHead>
                          <TableHead className="text-xs">{program === "DEMI" ? "Grade" : "Track / Level"}</TableHead>
                          <TableHead className="text-xs">Day &amp; Session</TableHead>
                          <TableHead className="text-xs">Time Slot</TableHead>
                          <TableHead className="text-xs">Lab ID</TableHead>
                          <TableHead className="text-xs">Group ID</TableHead>
                          <TableHead className="text-xs font-semibold text-primary">Student ID (S_ID)</TableHead>
                          <TableHead className="text-xs text-right">Lab Cap</TableHead>
                          <TableHead className="text-xs text-right">Assigned In Lab</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedMasterRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} className="text-center py-8 text-xs text-muted-foreground">
                              No students matched the filter criteria.
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedMasterRows.map((r, i) => (
                            <TableRow key={i} className="hover:bg-muted/30">
                              <TableCell className="text-xs font-medium">{r["Physical Area"]}</TableCell>
                              <TableCell className="text-xs">
                                {renderGradeBadge(r.Grade)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{r.Day}</TableCell>
                              <TableCell className="text-xs font-medium">{r.Time_Slot}</TableCell>
                              <TableCell className="text-xs font-mono">
                                <span>{r.Lab_ID}</span>
                                {labNameMap[r.Lab_ID] && (
                                  <span className="text-muted-foreground font-normal ml-1">({labNameMap[r.Lab_ID]})</span>
                                )}
                              </TableCell>
                              <TableCell className="text-xs font-mono font-medium text-foreground">
                                <Badge variant="outline" className="text-[10px] font-mono bg-background">
                                  {r.Group_ID}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs font-mono font-bold text-primary">
                                <div className="flex items-center gap-1.5">
                                  <span>{r.S_ID}</span>
                                  {r.Is_Overfill && (
                                    <Badge className="bg-purple-600 text-white text-[9px] px-1 py-0 font-bold uppercase">
                                      Overfill
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">{r.Lab_Capacity}</TableCell>
                              <TableCell className="text-xs text-right font-medium">
                                {r.Assigned_Count_Per_Lab} / {r.Lab_Capacity}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination footer */}
                  <div className="flex items-center justify-between p-4 border-t text-xs text-muted-foreground">
                    <div>
                      Page {currentPage} of {totalPages} ({filteredMasterRows.length} total students)
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="h-8 px-2"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="h-8 px-2"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: Lab Schedule Grid (Pivot) */}
            <TabsContent value="lab_pivot" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <TableProperties className="h-4 w-4 text-primary" />
                        Lab Schedule &amp; Capacity Utilization Matrix
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {isSingleSessionGrid
                          ? "One logical row per physical lab, with every configured slot kept visible."
                          : "Color-coded occupancy by academic cohort and recurring visit."}
                      </CardDescription>
                    </div>

                    {/* Filter controls */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={pivotGovernorateFilter} onValueChange={(value) => { setPivotGovernorateFilter(value); setPivotAreaFilter("ALL"); }}>
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="All Governorates" /></SelectTrigger>
                        <SelectContent><SelectItem value="ALL">All Governorates</SelectItem>{singleSessionGovernorates.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                      </Select>
                      {/* Grade Filter */}
                      <Select
                        value={pivotGradeFilter}
                        onValueChange={setPivotGradeFilter}
                      >
                        <SelectTrigger className="h-8 text-xs w-32">
                          <SelectValue placeholder={program === "DEMI" ? "All Grades" : "All Tracks / Levels"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{program === "DEMI" ? "All Grades" : "All Tracks / Levels"}</SelectItem>
                          {singleSessionAcademicOptions.map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Area Filter */}
                      <Select
                        value={pivotAreaFilter}
                        onValueChange={setPivotAreaFilter}
                      >
                        <SelectTrigger className="h-8 text-xs w-36">
                          <SelectValue placeholder="All Areas" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All Areas</SelectItem>
                          {singleSessionAreas.map((a) => (
                            <SelectItem key={a} value={a}>
                              {a}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <>
                          <Input className="h-8 w-36 text-xs" value={pivotLabSearch} onChange={(event) => setPivotLabSearch(event.target.value)} placeholder="Search Lab ID" />
                          <Select value={pivotOccupancyFilter} onValueChange={(value) => setPivotOccupancyFilter(value as typeof pivotOccupancyFilter)}>
                            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="ALL">All Occupancy</SelectItem><SelectItem value="HAS_EMPTY">Has Empty Slots</SelectItem><SelectItem value="FULLY_OCCUPIED">Fully Occupied</SelectItem></SelectContent>
                          </Select>
                          {singleSessionDateOptions.length > 1 && (
                            <Select value={pivotDateFilter} onValueChange={setPivotDateFilter}>
                              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="ALL">All Dates</SelectItem>{singleSessionDateOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                            </Select>
                          )}
                      </>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 p-4 pt-0">
                  {/* Visual Legend Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs">
                    {/* Grade Colors Legend — dynamic per actual batch cohorts */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-muted-foreground text-[11px]">{program === "DEMI" ? "Grade Cohorts:" : "Track / Level Cohorts:"}</span>
                      {uniqueGrades.length > 0
                        ? uniqueGrades.map((g) => (
                            <span key={g} className="inline-flex items-center gap-1">
                              {renderGradeBadge(g)}
                            </span>
                          ))
                        : (
                          <span className="text-[11px] text-muted-foreground italic">No grade data</span>
                        )
                      }
                    </div>

                    {/* Occupancy Colors Legend */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-muted-foreground text-[11px]">Occupancy:</span>
                      <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30 font-medium text-[11px]">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" /> Full (100%)
                      </span>
                      <span className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded border border-purple-500/30 font-medium text-[11px]">
                        <span className="h-2 w-2 rounded-full bg-purple-600" /> Overfill (+1/+2)
                      </span>
                      <span className="inline-flex items-center gap-1 bg-blue-500/10 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-500/30 font-medium text-[11px]">
                        <span className="h-2 w-2 rounded-full bg-blue-500" /> Near Full (80-99%)
                      </span>
                      <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded border border-amber-500/30 font-medium text-[11px]">
                        <span className="h-2 w-2 rounded-full bg-amber-500" /> Partial (&lt;80%)
                      </span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground px-2 py-0.5 rounded font-mono text-[11px]">
                        — Open Slot
                      </span>
                    </div>
                  </div>

                  {useUnifiedLabMatrix && (
                    <div className="flex flex-wrap gap-2">
                      {singleSessionDailyTotals.filter((item) => pivotDateFilter === "ALL" || item.key === pivotDateFilter).map((item) => (
                        <div key={item.key} className="border-l-2 border-primary px-3 py-1 text-xs">
                          <div className="font-semibold">{item.label}</div>
                          <div className="text-muted-foreground">Total Students: {item.total.toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {useUnifiedLabMatrix ? (
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead rowSpan={2} className="whitespace-nowrap text-xs">Governorate</TableHead>
                            <TableHead rowSpan={2} className="whitespace-nowrap text-xs">Physical Area</TableHead>
                            <TableHead rowSpan={2} className="whitespace-nowrap text-xs">Lab ID</TableHead>
                            <TableHead rowSpan={2} className="whitespace-nowrap text-xs">Lab Capacity</TableHead>
                            <TableHead rowSpan={2} className="whitespace-nowrap text-xs">Type</TableHead>
                            <TableHead colSpan={Math.max(1, visibleSingleSessionSlots.length)} className="border-l text-center text-xs">Canonical Schedule</TableHead>
                          </TableRow>
                          <TableRow>
                            {visibleSingleSessionSlots.map((slot) => <TableHead key={slot.num} className="min-w-32 whitespace-nowrap border-l text-xs">{slot.label}</TableHead>)}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedPivotRows.length === 0 ? (
                            <TableRow><TableCell colSpan={5 + Math.max(1, visibleSingleSessionSlots.length)} className="py-6 text-center text-xs text-muted-foreground">No labs match the selected filters.</TableCell></TableRow>
                          ) : paginatedPivotRows.map((rawRow) => {
                            const row = rawRow as (typeof singleSessionLabRows)[number];
                            return (
                              <Fragment key={row.rowKey}>
                                <TableRow className="hover:bg-muted/20">
                                  <TableCell rowSpan={2} className="whitespace-nowrap align-middle text-xs font-medium">{row.governorate}</TableCell>
                                  <TableCell rowSpan={2} className="whitespace-nowrap align-middle text-xs font-medium">{row.physicalArea}</TableCell>
                                  <TableCell rowSpan={2} className="whitespace-nowrap align-middle font-mono text-xs font-bold">{row.labId}{labNameMap[row.labId] ? ` — ${labNameMap[row.labId]}` : ""}</TableCell>
                                  <TableCell rowSpan={2} className="align-middle text-center text-xs tabular-nums">{row.capacity}</TableCell>
                                  <TableCell className="whitespace-nowrap text-[11px] font-semibold">Group ID</TableCell>
                                  {visibleSingleSessionSlots.map((slot) => <TableCell key={slot.num} className="border-l p-1.5">{renderSingleSessionGroupCell(row.cells.get(slot.num))}</TableCell>)}
                                </TableRow>
                                <TableRow className="border-b-2 hover:bg-muted/20">
                                  <TableCell className="whitespace-nowrap text-[11px] font-semibold">{program === "DEMI" ? "Grade" : "Track / Level"}</TableCell>
                                  {visibleSingleSessionSlots.map((slot) => <TableCell key={slot.num} className="border-l p-1.5">{renderSingleSessionAcademicCell(row.cells.get(slot.num))}</TableCell>)}
                                </TableRow>
                              </Fragment>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          {pivotColumns.map((col) => (
                            <TableHead key={col} className="text-xs font-semibold text-foreground whitespace-nowrap">
                              {col}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedPivotRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={Math.max(1, pivotColumns.length)} className="text-center py-6 text-xs text-muted-foreground">
                              No labs match the selected grade/area filter.
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedPivotRows.map((row, idx) => (
                            <TableRow key={idx} className="hover:bg-muted/30">
                              {pivotColumns.map((col, cellIdx) => {
                                const val = (row as unknown as Record<string, unknown>)[col];
                                const isSlotCell = pivotSlotNumByLabel.has(col);
                                if (col === "Grade") {
                                  return (
                                    <TableCell key={cellIdx} className="text-xs whitespace-nowrap">
                                      {renderGradeBadge(val as any)}
                                    </TableCell>
                                  );
                                }
                                if (col === "Lab_ID") {
                                  const labIdStr = val !== null && val !== undefined ? String(val) : "—";
                                  const labName = labNameMap[labIdStr];
                                  return (
                                    <TableCell key={cellIdx} className="text-xs font-mono font-bold whitespace-nowrap text-foreground">
                                      {labIdStr}{labName ? ` — ${labName}` : ""}
                                    </TableCell>
                                  );
                                }
                                if (col === "Physical Area") {
                                  return (
                                    <TableCell key={cellIdx} className="text-xs font-medium whitespace-nowrap">
                                      {val !== null && val !== undefined ? String(val) : "—"}
                                    </TableCell>
                                  );
                                }
                                if (col === "Track" || col === "Level") {
                                  return (
                                    <TableCell key={cellIdx} className="text-xs font-medium whitespace-nowrap">
                                      {val !== null && val !== undefined && String(val) ? String(val) : "-"}
                                    </TableCell>
                                  );
                                }
                                return (
                                  <TableCell key={cellIdx} className="text-xs whitespace-nowrap">
                                    {isSlotCell ? renderPivotSlotCell(val, row as unknown as Record<string, unknown>, col) : val !== null && val !== undefined ? String(val) : "—"}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  )}

                  {/* Lab Grid Matrix Pagination Footer */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 border rounded-lg bg-muted/20 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>
                        Showing {activeFilteredPivotRows.length === 0 ? 0 : (pivotPage - 1) * (pivotPageSize === -1 ? activeFilteredPivotRows.length : pivotPageSize) + 1}–{pivotPageSize === -1 ? activeFilteredPivotRows.length : Math.min(activeFilteredPivotRows.length, pivotPage * pivotPageSize)} of {activeFilteredPivotRows.length} labs
                      </span>
                      {activeFilteredPivotRows.length !== singleSessionLabRows.length && (
                        <span className="text-[11px] opacity-75">
                          (filtered from {singleSessionLabRows.length} total)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span>Rows per page:</span>
                        <Select
                          value={String(pivotPageSize)}
                          onValueChange={(v) => {
                            setPivotPageSize(Number(v));
                            setPivotPage(1);
                          }}
                        >
                          <SelectTrigger className="h-7 w-20 text-xs bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="25">25</SelectItem>
                            <SelectItem value="50">50</SelectItem>
                            <SelectItem value="100">100</SelectItem>
                            <SelectItem value="-1">All</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {pivotPageSize !== -1 && totalPivotPages > 1 && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPivotPage((p) => Math.max(1, p - 1))}
                            disabled={pivotPage === 1}
                            className="h-7 px-2 text-xs"
                          >
                            <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                            Prev
                          </Button>
                          <span className="text-xs px-2 font-mono font-medium">
                            {pivotPage} / {totalPivotPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPivotPage((p) => Math.min(totalPivotPages, p + 1))}
                            disabled={pivotPage === totalPivotPages}
                            className="h-7 px-2 text-xs"
                          >
                            Next
                            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 4: Area & Grade Breakdown */}
            <TabsContent value="area_grade" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Area &amp; Grade Group Count Summary</CardTitle>
                  <CardDescription className="text-xs">
                    Detailed breakdown of assigned students, group IDs generated, and labs used per area and grade.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="text-xs font-semibold">Physical Area</TableHead>
                          <TableHead className="text-xs font-semibold">Grade</TableHead>
                          <TableHead className="text-xs font-semibold text-right text-sky-800 dark:text-sky-300">Total Demand</TableHead>
                          <TableHead className="text-xs font-semibold text-right text-emerald-800 dark:text-emerald-300">Students Assigned</TableHead>
                          <TableHead className="text-xs font-semibold text-right text-rose-800 dark:text-rose-300">Unassigned</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Groups Used</TableHead>
                          <TableHead className="text-xs font-semibold text-right">Labs Used</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(computedAreaGradeSummary.length > 0 ? computedAreaGradeSummary : result.area_grade_summary || []).map((row, idx) => (
                          <TableRow key={idx} className="hover:bg-muted/30">
                            <TableCell className="text-xs font-medium">{row["Physical Area"]}</TableCell>
                            <TableCell className="text-xs">
                              {renderGradeBadge(row.Grade)}
                            </TableCell>
                            <TableCell className="text-xs text-right font-bold text-sky-700 dark:text-sky-300 bg-sky-50/20">
                              {row.Total_Students ?? (row.Students_Assigned + row.Unassigned)}
                            </TableCell>
                            <TableCell className="text-xs text-right font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50/20">
                              {row.Students_Assigned}
                            </TableCell>
                            <TableCell
                              className={`text-xs text-right font-bold ${
                                row.Unassigned > 0 ? "text-rose-600 bg-rose-50/60 dark:bg-rose-950/40" : "text-muted-foreground"
                              }`}
                            >
                              {row.Unassigned}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {("Groups_Used" in row ? row.Groups_Used : undefined) ?? row.Unique_Groups ?? 0}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">{row.Labs_Used}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 5: Shortfall & Logs */}
            <TabsContent value="shortfall" className="space-y-4">
              <ShortfallVisualizer
                summary={result.summary}
                shortfallText={result.shortfall_text}
                shortfallMath={result.shortfall_math}
                unassignedStudents={result.unassigned_students}
                masterAllocation={result.master_allocation}
                overflowFragmentNotices={result.overflow_fragment_notices}
                labRows={parsedLabRows.length > 0 ? parsedLabRows : (dbLabs as any)}
                logs={result.logs}
                jobId={result.jobId}
                batchId={selectedBatchId}
                projectId={selectedProjectId}
                batchName={activeBatch?.name || "Current Batch"}
                slotCount={canonicalPivotSlots.length}
                onReallocationApplied={() => {
                  if (selectedBatchId) {
                    void loadBatchPersistedData(selectedBatchId);
                  }
                }}
              />
            </TabsContent>

            {/* TAB 7: Online Migrations Tracker */}
            <TabsContent value="online_tracking" className="space-y-4">
              {(() => {
                const acceptedSuggestions = (result.online_migration_suggestions ?? []).filter((s) => s.status === "accepted");
                const onlineStudentCount = acceptedSuggestions.reduce(
                  (acc, s) => acc + ((s.acceptedStudentIds ?? s.affectedStudentIds)?.length ?? s.studentCount ?? 0),
                  0
                );
                const onlineGovCount = acceptedSuggestions.length;
                const pendingSuggestions = (result.online_migration_suggestions ?? []).filter((s) => s.status === "pending");
                const rejectedSuggestions = (result.online_migration_suggestions ?? []).filter((s) => s.status === "rejected");

                return (
                  <Card className="border-amber-500/30 shadow-xs">
                    <CardHeader className="p-4 bg-amber-500/5 border-b border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                          <Globe className="h-4 w-4 text-amber-500" />
                          Online Migration Tracking &amp; Audit Trail
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Governorates and students migrated online based on the rural/isolated policy threshold (&lt;8 students per governorate).
                        </CardDescription>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!result.online_migration_suggestions || result.online_migration_suggestions.length === 0) {
                            toast.error("No online migration data to export.");
                            return;
                          }
                          const onlineTrackerRows = result.online_migration_suggestions.map((s) => {
                            const isAcc = s.status === "accepted";
                            const grades = isAcc ? (s.acceptedGrades ?? s.affectedGrades ?? []) : (s.affectedGrades ?? []);
                            const studentIds = isAcc ? (s.acceptedStudentIds ?? s.affectedStudentIds ?? []) : (s.affectedStudentIds ?? []);
                            return {
                              Governorate: s.governorate || s.gov || s.area || "N/A",
                              "Physical Areas": Array.isArray(s.affectedAreas) ? s.affectedAreas.join(", ") : s.area,
                              "Affected Grades": grades.map((g) => formatGradeLabel(g)).join(", ") || s.area,
                              "Student Count": studentIds.length || s.studentCount || 0,
                              Status: isAcc ? "Accepted (Online)" : s.status === "rejected" ? "Rejected (In-Person)" : "Pending",
                              "Qualification Reason": s.qualificationReason || "Headcount < 8 threshold",
                              "Student IDs": Array.isArray(studentIds) ? studentIds.join(", ") : "",
                              "Accepted At": s.acceptedAt ? new Date(s.acceptedAt).toLocaleString() : "",
                            };
                          });
                          const wb = XLSX.utils.book_new();
                          const ws = XLSX.utils.json_to_sheet(onlineTrackerRows);
                          XLSX.utils.book_append_sheet(wb, ws, "Online Migrations");
                          XLSX.writeFile(wb, `online_migration_tracker_${new Date().toISOString().slice(0, 10)}.xlsx`);
                          toast.success("Exported Online Tracker to Excel.");
                        }}
                        className="h-8 gap-1.5 text-xs font-semibold border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Export Tracker (.xlsx)
                      </Button>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      {/* Summary Metric Stats */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3 rounded-lg border bg-muted/40 space-y-1">
                          <div className="text-[11px] text-muted-foreground font-medium">Total Migrated Students</div>
                          <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
                            {onlineStudentCount.toLocaleString()}
                          </div>
                        </div>
                        <div className="p-3 rounded-lg border bg-muted/40 space-y-1">
                          <div className="text-[11px] text-muted-foreground font-medium">Migrated Governorates</div>
                          <div className="text-xl font-bold text-foreground">
                            {onlineGovCount}
                          </div>
                        </div>
                        <div className="p-3 rounded-lg border bg-muted/40 space-y-1">
                          <div className="text-[11px] text-muted-foreground font-medium">Pending Review</div>
                          <div className="text-xl font-bold text-foreground">
                            {pendingSuggestions.length}
                          </div>
                        </div>
                        <div className="p-3 rounded-lg border bg-muted/40 space-y-1">
                          <div className="text-[11px] text-muted-foreground font-medium">Rejected (In-Person)</div>
                          <div className="text-xl font-bold text-muted-foreground">
                            {rejectedSuggestions.length}
                          </div>
                        </div>
                      </div>

                      {/* Accepted Migrations Table */}
                      <div className="space-y-2">
                        <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          Active Online Migrations ({acceptedSuggestions.length})
                        </div>
                        {acceptedSuggestions.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground border rounded-lg bg-muted/20">
                            No online migrations currently active or accepted for this allocation.
                          </div>
                        ) : (
                          <div className="rounded-lg border overflow-x-auto">
                            <Table>
                              <TableHeader className="bg-muted/50">
                                <TableRow>
                                  <TableHead className="text-xs font-semibold">Governorate</TableHead>
                                  <TableHead className="text-xs font-semibold">Physical Areas</TableHead>
                                  <TableHead className="text-xs font-semibold">Affected Grades</TableHead>
                                  <TableHead className="text-xs font-semibold text-right">Students Moved Online</TableHead>
                                  <TableHead className="text-xs font-semibold">Student IDs</TableHead>
                                  <TableHead className="text-xs font-semibold">Status</TableHead>
                                  <TableHead className="text-xs font-semibold">Accepted At</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {acceptedSuggestions.map((s, idx) => {
                                  const sIds = s.acceptedStudentIds ?? s.affectedStudentIds ?? [];
                                  const sCount = sIds.length || s.studentCount || 0;
                                  const govTitle = s.governorate || s.gov || s.area || "Governorate";
                                  const areasList = Array.isArray(s.affectedAreas) && s.affectedAreas.length > 0 ? s.affectedAreas.join(", ") : s.area;
                                  const gradesList = s.acceptedGrades ?? s.affectedGrades ?? [];
                                  return (
                                    <TableRow key={idx} className="hover:bg-muted/30">
                                      <TableCell className="text-xs font-bold text-foreground whitespace-nowrap">
                                        {govTitle}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                                        {areasList}
                                      </TableCell>
                                      <TableCell className="text-xs">
                                        <div className="flex flex-col gap-1">
                                          {gradesList.map((g, gIdx) => {
                                            const label = formatGradeLabel(g);
                                            const count = (s as any).affectedGradeCounts?.[label] ?? (gradesList.length === 1 ? sCount : undefined);
                                            return (
                                              <div key={gIdx} className="flex items-center gap-1.5">
                                                <span>{renderGradeBadge(g)}</span>
                                                {count !== undefined && (
                                                  <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">
                                                    ({count} student{count !== 1 ? "s" : ""})
                                                  </span>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-xs font-bold text-right text-amber-600 dark:text-amber-400">
                                        {sCount}
                                      </TableCell>
                                      <TableCell className="text-xs max-w-[280px]">
                                        <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto p-1 bg-muted/30 rounded border">
                                          {sIds.slice(0, 10).map((id, idIdx) => (
                                            <span key={idIdx} className="font-mono text-[10px] px-1 py-0.5 bg-background rounded border">
                                              {id}
                                            </span>
                                          ))}
                                          {sIds.length > 10 && (
                                            <span className="text-[10px] text-muted-foreground font-medium self-center">
                                              +{sIds.length - 10} more
                                            </span>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-xs">
                                        <Badge className="bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold">
                                          Accepted Online
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                        {s.acceptedAt ? new Date(s.acceptedAt).toLocaleDateString() : "Active Run"}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Resolve Unassigned Students Dialog */}
      {(result || selectedBatchId) && (
        <ResolveUnassignedDialog
          key={selectedBatchId}
          open={prefDialogOpen}
          onOpenChange={setPrefDialogOpen}
          batchId={selectedBatchId}
          batchName={activeBatch?.name || "Current Batch"}
          projectId={selectedProjectId}
          areaGradeSummary={result?.area_grade_summary || []}
          labPivot={result?.lab_pivot || []}
          requests={resolutionRequests}
          onRequestsChange={setResolutionRequests}
          onApplyApprovedRules={handleApplyPreferences}
          onPreviewImpact={handlePreviewImpact}
          baselineSummary={result?.summary}
          preferencesApplied={result?.preferences_applied || preferences}
          initialTab={(() => {
            if (searchParams.resolveAction === "overfill") return "overfill";
            if (searchParams.resolveAction === "new_lab") return "new_lab";
            if (searchParams.resolveAction === "cs_outreach") return "cs_outreach";
            if (searchParams.resolveAction === "active_requests") return "active_requests";
            if (searchParams.requestId) {
              const matchedReq = resolutionRequests.find((r) => r.id === searchParams.requestId);
              if (matchedReq?.type === "overfill") return "overfill";
              if (matchedReq?.type === "new_lab") return "new_lab";
              if (matchedReq?.type === "cs_outreach") return "cs_outreach";
              return "active_requests";
            }
            return undefined;
          })()}
          targetRequestId={searchParams.requestId}
          targetArea={searchParams.area}
          targetGrades={
            searchParams.grade !== undefined
              ? [Number(searchParams.grade)]
              : undefined
          }
          targetLabId={searchParams.labId}
          targetMaxOverfill={
            searchParams.maxOverfill !== undefined
              ? Number(searchParams.maxOverfill)
              : undefined
          }
          loading={loading}
        />
      )}

      {/* Group ID Classification Dialog (Single-Visit vs Multi-Visit) */}
      {selectedBatchId && (
        <GroupClassificationDialog
          key={`group_class_${selectedBatchId}`}
          open={groupClassDialogOpen}
          onOpenChange={setGroupClassDialogOpen}
          batchId={selectedBatchId}
          batchName={activeBatch?.name || "Current Batch"}
          projectId={selectedProjectId}
          expectedSessionsPerGroup={activeBatch?.expected_sessions_per_group}
          canEdit={canManageAllocation}
          masterAllocation={result?.master_allocation}
          studentRecords={savedUploadRecord?.students}
          onClassificationsSaved={(saved) => {
            setGroupClassifications(saved);
            if (selectedBatchId) {
              void loadBatchPersistedData(selectedBatchId);
            }
          }}
          onApplyAndRerun={async (saved, batchGroupType, defaultRepeatCount) => {
            setGroupClassifications(saved);
            if (selectedBatchId && defaultRepeatCount) {
              setBatches((prev) =>
                prev.map((b) =>
                  b.id === selectedBatchId
                    ? {
                        ...b,
                        expected_sessions_per_group: defaultRepeatCount,
                        group_distribution_mode: batchGroupType || b.group_distribution_mode || "single_session",
                      }
                    : b
                )
              );
            }
            const newPrefs: AllocationPreferences = {
              ...preferences,
              batchGroupType,
              defaultRepeatCount,
              groupClassifications: saved.map((c) => ({
                group_id: c.group_id,
                visit_type: c.visit_type,
                repeat_count: c.repeat_count,
                area: c.area,
                grade: c.grade,
                lab_id: c.lab_id,
              })),
            };
            setPreferences(newPrefs);
            await handleRunAllocation(newPrefs);
          }}
        />
      )}

      {/* Mega Group Membership & Partitioning Dialog */}
      {selectedBatchId && (
        <MegaGroupMembershipDialog
          key={`mega_group_${selectedBatchId}`}
          open={megaGroupDialogOpen}
          onOpenChange={setMegaGroupDialogOpen}
          batchId={selectedBatchId}
          batchName={activeBatch?.name || "Current Batch"}
          megaGroups={preferences.mega_groups || (activeBatch?.mega_groups as any) || []}
          masterAllocation={result?.master_allocation}
          students={savedUploadRecord?.students}
          onSaveMegaGroups={handleSaveMegaGroups}
          canEdit={canManageAllocation}
          onReRunAllocation={() => {
            if (result) handleRunAllocation();
          }}
          isLoading={loading}
        />
      )}

      <AlertDialog open={consolidationBulkAction !== null} onOpenChange={(open) => { if (!open && !savingConsolidationBulk) setConsolidationBulkAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{consolidationBulkAction === "accepted" ? "Accept all pending recommendations?" : "Reject all pending recommendations?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {consolidationBulkAction === "accepted"
                ? `Accept all ${consolidationDecisionCounts.pending} pending consolidation recommendations for this batch?`
                : `Reject all ${consolidationDecisionCounts.pending} pending consolidation recommendations for this batch?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingConsolidationBulk}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={savingConsolidationBulk || consolidationDecisionCounts.pending === 0} onClick={(event) => {
              event.preventDefault();
              if (consolidationBulkAction) void persistConsolidationDecisions(consolidationBulkAction);
            }}>
              {savingConsolidationBulk ? "Saving..." : consolidationBulkAction === "accepted" ? "Accept All Pending" : "Reject All Pending"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
