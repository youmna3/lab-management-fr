import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABELS } from "@/hooks/useAuth";
import { logAuditAction } from "@/lib/audit-logging";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  DollarSign,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  Filter,
  Globe,
  Grid3X3,
  History,
  Layers,
  LayoutGrid,
  List,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Tables } from "@/integrations/supabase/types";
import { formatEGP } from "@/lib/format";
import { computeQualityScore, qualityBand, deriveLabSize, type AcQuality, type LabSize, type BathroomType } from "@/lib/quality";
import { calculateAssignmentPrice, formatSessionsByDate, getAssignmentScheduleSummary, type AssignmentSession } from "@/lib/assignment-schedule";
import { buildSessionImportPreview, normalizeLabCode, type SessionImportResult } from "@/lib/session-import";
import { normalizeTimeSlot } from "@/lib/time-slots";
import { parseSheet, parseSheetMatrix, fixMojibake, downloadCsv } from "@/lib/sheet";
import { normalizeArabic } from "@/lib/arabic";
import { EgyptLabCoverageMap } from "@/components/EgyptLabCoverageMap";
import { detectLabLocationAnomaly, detectAllLocationAnomalies, canAutoVerifyLab } from "@/lib/location-anomaly";

export const Route = createFileRoute("/_authenticated/lab-data")({
  validateSearch: (s: Record<string, unknown>): { gov?: string; area?: string; labId?: string; labCode?: string } => ({
    ...(typeof s.gov === "string" ? { gov: s.gov } : {}),
    ...(typeof s.area === "string" ? { area: s.area } : {}),
    ...(typeof s.labId === "string" ? { labId: s.labId } : {}),
    ...(typeof s.labCode === "string" ? { labCode: s.labCode } : {}),
  }),
  head: () => ({ meta: [{ title: "Lab Data – iSchool Lab Management" }] }),
  component: LabDataPage,
});

type Lab = Tables<"labs">;
type Quality = Tables<"lab_quality">;
type ProjectImport = Pick<Tables<"projects">, "id" | "name" | "code">;
type BatchImport = Pick<Tables<"batches">, "id" | "name" | "project_id" | "dates" | "time_slots" | "expected_sessions_per_group">;
type AssignmentImport = Tables<"assignments">;

interface AuditHistoryEntry {
  score: number;
  assessed_at: string;
  assessed_by?: string | null;
  notes?: string | null;
}

function extractScoreHistory(qualityItem: any): AuditHistoryEntry[] {
  if (!qualityItem) return [];
  if (Array.isArray(qualityItem.score_history) && qualityItem.score_history.length > 0) {
    return qualityItem.score_history;
  }
  if (typeof qualityItem.notes === "string") {
    const match = qualityItem.notes.match(/<!--AUDIT_HISTORY:(.*?)-->/s);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // ignore parse error
      }
    }
  }
  return [];
}

function getCleanNotes(rawNotes: string | null | undefined): string {
  if (!rawNotes) return "";
  return rawNotes.replace(/<!--AUDIT_HISTORY:.*?-->\s*/s, "").trim();
}

function encodeNotesWithHistory(cleanNotes: string | null | undefined, history: AuditHistoryEntry[]): string | null {
  const text = cleanNotes ? cleanNotes.trim() : "";
  if (!history || history.length === 0) {
    return text || null;
  }
  const tag = `<!--AUDIT_HISTORY:${JSON.stringify(history)}-->`;
  return text ? `${tag}\n${text}` : tag;
}

const LAB_DIRECTORY_LOAD_TIMEOUT_MS = 16_000;

async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Lab directory request timed out")), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Import maps ONLY the master identity columns from the camp sheet.
// (Domty / Water / Students / sessions live in the Project tab.)
const IMPORT_FIELDS: { key: string; label: string; required?: boolean; number?: boolean; aliases: string[] }[] = [
  { key: "lab_code", label: "Lab ID", required: true, aliases: ["Lab ID", "Lab Code", "lab_code", "ID", "كود المعمل"] },
  { key: "gov", label: "Governorate", aliases: ["Gov", "Governorate", "gov", "المحافظة"] },
  { key: "area", label: "Area", aliases: ["Area", "area", "المنطقة"] },
  { key: "capacity", label: "Lab Capacity", number: true, aliases: ["Lab Capacity", "Capacity", "capacity"] },
  { key: "vendor_name", label: "Vendor Name", aliases: ["Vendor Name", "Vendor", "vendor_name", "المورد"] },
  { key: "center_name", label: "Center Name", aliases: ["Center Name", "center_name", "المركز"] },
  { key: "name", label: "Lab Name", required: true, aliases: ["Lab Name", "lab_name", "اسم المعمل"] },
  { key: "address", label: "Address", aliases: ["Address", "address", "العنوان"] },
  { key: "maps_url", label: "Location (Google Maps)", aliases: ["Location (Google Maps)", "Location", "Location (Maps)", "Location(Google Maps)", "Maps", "maps_url", "Maps URL", "Google Maps", "الموقع"] },
  { key: "supervisor_name", label: "Supervisor name", aliases: ["اسم المشرف", "Supervisor", "Supervisor Name"] },
  { key: "supervisor_phone", label: "Supervisor phone", aliases: ["رقم المشرف", "Supervisor Phone"] },
  { key: "facilitator_name", label: "Facilitator name", aliases: ["اسم الميسر", "Facilitator", "Facilitator Name"] },
  { key: "facilitator_phone", label: "Facilitator phone", aliases: ["رقم الميسر", "Facilitator Phone"] },
  // Nearby Distance Fields
  { key: "nearby_rank", label: "Nearby Rank", number: true, aliases: ["Nearby Rank", "Nearby_Rank", "Nearby Lab Rank", "Nearby_Lab_Rank", "Rank", "rank", "ترتيب القرب"] },
  { key: "nearby_lab_id", label: "Nearby Lab ID", aliases: ["Nearby Lab ID", "Nearby_Lab_ID", "Nearby Lab Code", "Nearby Lab", "nearby_lab_id", "كود المعمل المجاور"] },
  { key: "nearby_lab_name", label: "Nearby Lab Name", aliases: ["Nearby Lab Name", "Nearby_Lab_Name", "Nearby Name", "nearby_lab_name", "اسم المعمل المجاور"] },
  { key: "nearby_area", label: "Nearby Area", aliases: ["Nearby Area", "Nearby_Area", "Nearby Physical Area", "nearby_area", "المنطقة المجاورة"] },
  { key: "nearby_location", label: "Nearby Location (Google Maps)", aliases: ["Nearby Location (Google Maps)", "Nearby Location", "Nearby Maps URL", "Nearby Maps", "nearby_location_url", "nearby_maps_url", "موقع المعمل المجاور"] },
  { key: "distance_km", label: "Distance (km)", number: true, aliases: ["Distance (km)", "Distance (KM)", "Distance(km)", "Distance_km", "Distance", "distance_km", "المسافة (كم)", "المسافة"] },
  { key: "distance_method", label: "Distance Method", aliases: ["Distance Method", "Distance_Method", "Method", "distance_method", "طريقة حساب المسافة"] },
  { key: "distance_status", label: "Distance Status", aliases: ["Distance Status", "Distance_Status", "Status", "distance_status", "حالة المسافة"] },
];
const NONE = "__none__";

const EMPTY_LAB = {
  lab_code: "",
  name: "",
  gov: "",
  area: "",
  center_name: "",
  address: "",
  maps_url: "",
  vendor_name: "",
  capacity: 0,
  session_price: 0,
  supervisor_name: "",
  supervisor_phone: "",
  facilitator_name: "",
  facilitator_phone: "",
  notes: "",
  is_active: true,
};

type QualityForm = {
  pc_count: number | "";
  pc_quality: number;
  lab_size: LabSize | "";
  seated_capacity: number | "";
  internet_quality: number;
  internet_speed_mbps: number | "";
  bathroom_type: BathroomType | "";
  bathroom_boys: boolean;
  bathroom_girls: boolean;
  chairs_quality: number;
  street_view: number;
  cleanliness: number;
  ac: AcQuality | "";
  ac_count: number | "";
  projector: boolean;
  has_instructor_pc: boolean;
  has_printer: boolean;
  security: boolean;
  extra_activities: number | "";
  parent_waiting_area: boolean;
  floor_number: number | "";
  has_elevator: boolean;
  video_url: string;
  image_urls: string[];
  notes: string;
};

interface LabUsageHistoryItem {
  id: string;
  session_date: string;
  session_time: string;
  session_group_id: string | null;
  batch_id: string;
  batch_name: string;
  project_name: string;
  project_code: string;
  program: string;
}

interface LabSurveyItem {
  id: string;
  overall_rating: number;
  pc_rating: number | null;
  internet_rating: number | null;
  facilities_rating: number | null;
  cleanliness_rating: number | null;
  feedback: string | null;
  created_at: string;
  batch_name?: string;
  project_name?: string;
}

const EMPTY_QUALITY: QualityForm = {
  pc_count: "",
  pc_quality: 0,
  lab_size: "",
  seated_capacity: "",
  internet_quality: 0,
  internet_speed_mbps: "",
  bathroom_type: "",
  bathroom_boys: false,
  bathroom_girls: false,
  chairs_quality: 0,
  street_view: 0,
  cleanliness: 0,
  ac: "",
  ac_count: "",
  projector: false,
  has_instructor_pc: false,
  has_printer: false,
  security: false,
  extra_activities: "",
  parent_waiting_area: false,
  floor_number: "",
  has_elevator: false,
  video_url: "",
  image_urls: ["", "", "", "", ""],
  notes: "",
};

function validationOf(l: { gov?: string | null; area?: string | null; name?: string | null; address?: string | null; maps_url?: string | null }): "ok" | "issues" {
  return l.gov && l.area && l.name && l.address && l.maps_url ? "ok" : "issues";
}

type SortField = string;
type SortOrder = "asc" | "desc";

function SortableHead({
  title,
  field,
  currentField,
  currentOrder,
  onSort,
  align = "left",
}: {
  title: string;
  field: SortField;
  currentField: SortField;
  currentOrder: SortOrder;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
}) {
  const active = currentField === field;
  return (
    <TableHead
      className={`cursor-pointer select-none font-semibold hover:bg-accent/60 transition-colors ${
        align === "right" ? "text-right" : ""
      }`}
      onClick={() => onSort(field)}
    >
      <div className={`flex items-center gap-1.5 ${align === "right" ? "justify-end" : "justify-start"}`}>
        <span>{title}</span>
        {active ? (
          currentOrder === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-[#056FEC] dark:text-[#05ACFF]" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-[#056FEC] dark:text-[#05ACFF]" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/40 opacity-40 hover:opacity-100" />
        )}
      </div>
    </TableHead>
  );
}

function LabDataPage() {
  const { gov: govParam, labId: labIdParam, labCode: labCodeParam } = Route.useSearch();
  const { hasAnyRole, isAdmin, user, roles } = useAuth();
  const currentActorName = (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "User";
  const currentActorRole = roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "User";
  const canEdit = hasAnyRole(["lab_manager", "administration"]);
  const fileRef = useRef<HTMLInputElement>(null);
  const sessionFileRef = useRef<HTMLInputElement>(null);

  const [labs, setLabs] = useState<Lab[]>([]);
  const [quality, setQuality] = useState<Record<string, Quality>>({});
  const [projects, setProjects] = useState<ProjectImport[]>([]);
  const [batches, setBatches] = useState<BatchImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [gov, setGov] = useState(govParam ?? "all");
  const [area, setArea] = useState("all");
  const [vendor, setVendor] = useState("all");
  const [center, setCenter] = useState("all");
  const [validation, setValidation] = useState("all");
  const [verification, setVerification] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");

  // Column Header Sorting State
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  // Pagination State
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // View mode and interactive selection state
  const [viewMode, setViewMode] = useState<"split" | "table" | "map">("split");
  const [selectedLab, setSelectedLab] = useState<Lab | null>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

  useEffect(() => {
    if (!loading && labs.length > 0 && (labIdParam || labCodeParam)) {
      const paramId = (labIdParam ?? "").trim().toLowerCase();
      const paramCode = (labCodeParam ?? "").trim().toLowerCase();
      const target = labs.find(
        (l) =>
          (paramId && l.id.toLowerCase() === paramId) ||
          (paramId && l.lab_code?.trim().toLowerCase() === paramId) ||
          (paramCode && l.lab_code?.trim().toLowerCase() === paramCode) ||
          (paramCode && l.id.toLowerCase() === paramCode)
      );
      if (target) {
        setSelectedLab(target);
        setQuickViewOpen(true);
      }
    }
  }, [loading, labs, labIdParam, labCodeParam]);

  const [labOpen, setLabOpen] = useState(false);
  const [editing, setEditing] = useState<Lab | null>(null);
  const [labForm, setLabForm] = useState({ ...EMPTY_LAB });

  const [qOpen, setQOpen] = useState(false);
  const [qLab, setQLab] = useState<Lab | null>(null);
  const [qForm, setQForm] = useState<QualityForm>({ ...EMPTY_QUALITY });

  const [verifyLab, setVerifyLab] = useState<Lab | null>(null);
  const [verifyNote, setVerifyNote] = useState("");

  // Import (column matching)
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, unknown>[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);

  const videoFileRef = useRef<HTMLInputElement>(null);
  const priceFileRef = useRef<HTMLInputElement>(null);

  const [sessionImportOpen, setSessionImportOpen] = useState(false);
  const [sessionImportProjectId, setSessionImportProjectId] = useState("");
  const [sessionImportBatchId, setSessionImportBatchId] = useState("");
  const [sessionImportMode, setSessionImportMode] = useState<"merge" | "replace">("merge");
  const [sessionImportPreview, setSessionImportPreview] = useState<SessionImportResult | null>(null);
  const [sessionImportFileName, setSessionImportFileName] = useState("");
  const [sessionPreviewing, setSessionPreviewing] = useState(false);
  const [sessionImporting, setSessionImporting] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");

  // Diff Review Modal state
  type LabDiffItem = {
    lab_code: string;
    existingLab: Lab;
    updatedData: Record<string, any>;
    diffs: { field: string; label: string; oldValue: any; newValue: any }[];
  };
  const [diffReviewOpen, setDiffReviewOpen] = useState(false);
  const [diffItems, setDiffItems] = useState<LabDiffItem[]>([]);
  const [newLabsToInsert, setNewLabsToInsert] = useState<any[]>([]);
  const [selectedDiffIndices, setSelectedDiffIndices] = useState<Set<number>>(new Set());
  const [submittingDiffs, setSubmittingDiffs] = useState(false);

  // Status & Replacement Modal state
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [replaceTargetLab, setReplaceTargetLab] = useState<Lab | null>(null);
  const [newLabStatus, setNewLabStatus] = useState<string>("active");
  const [replacementLabId, setReplacementLabId] = useState<string>("");
  const [deactivationReason, setDeactivationReason] = useState("");
  const [submittingReplace, setSubmittingReplace] = useState(false);

  // Lab Usage History & Quality Surveys State
  const [usageHistory, setUsageHistory] = useState<LabUsageHistoryItem[]>([]);
  const [labSurveys, setLabSurveys] = useState<LabSurveyItem[]>([]);
  const [labIncidents, setLabIncidents] = useState<Array<{ id: string; severity: string; title: string; category: string; reported_at: string }>>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!selectedLab?.id) {
      setUsageHistory([]);
      setLabSurveys([]);
      setLabIncidents([]);
      return;
    }

    let isMounted = true;
    async function loadLabHistory() {
      if (!selectedLab?.id) return;
      setLoadingHistory(true);
      try {
        const [sessRes, asgRes, surveyRes, incidentRes] = await Promise.all([
          supabase
            .from("assignment_sessions")
            .select(`
              id,
              session_date,
              session_time,
              session_group_id,
              batch_id,
              batches (
                id,
                name,
                dates,
                projects (
                  id,
                  name,
                  code,
                  program
                )
              )
            `)
            .eq("lab_id", selectedLab.id)
            .order("session_date", { ascending: false }),
          supabase
            .from("assignments")
            .select(`
              id,
              status,
              days,
              time_slots,
              created_at,
              batch_id,
              batches (
                id,
                name,
                dates,
                projects (
                  id,
                  name,
                  code,
                  program
                )
              )
            `)
            .eq("lab_id", selectedLab.id),
          supabase
            .from("lab_post_surveys")
            .select(`
              id,
              overall_rating,
              pc_rating,
              internet_rating,
              facilities_rating,
              cleanliness_rating,
              feedback,
              created_at,
              batch_id,
              batches (
                name
              ),
              projects (
                name
              )
            `)
            .eq("lab_id", selectedLab.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("lab_incidents")
            .select("id, severity, title, category, reported_at")
            .eq("lab_id", selectedLab.id)
            .order("reported_at", { ascending: false }),
        ]);

        if (!isMounted) return;

        const historyItems: LabUsageHistoryItem[] = [];

        // Add session records
        if (sessRes.data && sessRes.data.length > 0) {
          for (const row of sessRes.data as any[]) {
            const batchObj = row.batches;
            const projObj = batchObj?.projects;
            historyItems.push({
              id: row.id,
              session_date: row.session_date || "",
              session_time: row.session_time || "10:00 - 12:00",
              session_group_id: row.session_group_id || null,
              batch_id: row.batch_id,
              batch_name: batchObj?.name || "Batch",
              project_name: projObj?.name || "Project",
              project_code: projObj?.code || "",
              program: projObj?.program || "",
            });
          }
        }

        // If assignment_sessions has no rows but assignments has rows, synthesize entries from assignment dates
        if (historyItems.length === 0 && asgRes.data && asgRes.data.length > 0) {
          for (const asg of asgRes.data as any[]) {
            const batchObj = asg.batches;
            const projObj = batchObj?.projects;
            const dates = Array.isArray(batchObj?.dates) ? batchObj.dates : [asg.created_at?.slice(0, 10) || ""];
            const slots = Array.isArray(asg.time_slots) && asg.time_slots.length > 0 ? asg.time_slots : ["10:00 - 12:00"];
            for (const d of dates) {
              for (const s of slots) {
                historyItems.push({
                  id: `${asg.id}_${d}_${s}`,
                  session_date: d,
                  session_time: s,
                  session_group_id: null,
                  batch_id: asg.batch_id,
                  batch_name: batchObj?.name || "Batch",
                  project_name: projObj?.name || "Project",
                  project_code: projObj?.code || "",
                  program: projObj?.program || "",
                });
              }
            }
          }
        }

        // Sort most recent first
        historyItems.sort((a, b) => (b.session_date || "").localeCompare(a.session_date || ""));

        setUsageHistory(historyItems);

        if (surveyRes.data) {
          const surveys: LabSurveyItem[] = (surveyRes.data as any[]).map((s) => ({
            id: s.id,
            overall_rating: Number(s.overall_rating) || 0,
            pc_rating: s.pc_rating != null ? Number(s.pc_rating) : null,
            internet_rating: s.internet_rating != null ? Number(s.internet_rating) : null,
            facilities_rating: s.facilities_rating != null ? Number(s.facilities_rating) : null,
            cleanliness_rating: s.cleanliness_rating != null ? Number(s.cleanliness_rating) : null,
            feedback: s.feedback,
            created_at: s.created_at,
            batch_name: s.batches?.name,
            project_name: s.projects?.name,
          }));
          setLabSurveys(surveys);
        }

        if (incidentRes.data) {
          setLabIncidents(incidentRes.data as Array<{ id: string; severity: string; title: string; category: string; reported_at: string }>);
        } else {
          setLabIncidents([]);
        }
      } catch (err) {
        console.error("Failed to load lab usage history:", err);
      } finally {
        if (isMounted) setLoadingHistory(false);
      }
    }

    void loadLabHistory();

    return () => {
      isMounted = false;
    };
  }, [selectedLab?.id]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [l, qy, projectRes, batchRes] = await withTimeout(Promise.all([
        supabase.from("labs").select("*").order("lab_code", { nullsFirst: false }),
        supabase.from("lab_quality").select("*"),
        supabase.from("projects").select("id, name, code").order("code"),
        supabase.from("batches").select("id, name, project_id, dates, time_slots, expected_sessions_per_group").order("created_at"),
      ]), LAB_DIRECTORY_LOAD_TIMEOUT_MS);
      const failedQueries = [l.error, qy.error, projectRes.error, batchRes.error].filter(Boolean);
      if (failedQueries.length > 0) {
        console.error("Failed to load lab directory data", failedQueries);
        setLoadError("The lab data service is temporarily unavailable. Please try again.");
      }
      const rawLabs = (l.data ?? []) as Lab[];
      const hydratedLabs = rawLabs.map((lab: any) => {
        let nearby = Array.isArray(lab.nearby_labs) ? lab.nearby_labs : [];
        if (nearby.length === 0 && lab.notes && typeof lab.notes === "string" && lab.notes.includes("[NEARBY_LABS_JSON]:")) {
          try {
            const parsed = JSON.parse(lab.notes.split("[NEARBY_LABS_JSON]:")[1]?.trim() || "[]");
            if (Array.isArray(parsed)) nearby = parsed;
          } catch {}
        }
        return {
          ...lab,
          nearby_labs: nearby,
        };
      });
      setLabs(hydratedLabs as Lab[]);
      const map: Record<string, Quality> = {};
      for (const row of (qy.data ?? []) as Quality[]) map[row.lab_id] = row;
      setQuality(map);
      setProjects((projectRes.data ?? []) as ProjectImport[]);
      setBatches((batchRes.data ?? []) as BatchImport[]);
    } catch (error) {
      console.error("Failed to load lab directory data", error);
      setLoadError("The lab data service did not respond. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const uniq = (vals: (string | null)[]) => Array.from(new Set(vals.filter(Boolean) as string[])).sort();
  const govs = useMemo(() => uniq(labs.map((l) => l.gov)), [labs]);
  const areas = useMemo(() => uniq(labs.filter((l) => gov === "all" || l.gov === gov).map((l) => l.area)), [labs, gov]);
  const vendors = useMemo(() => uniq(labs.map((l) => l.vendor_name)), [labs]);
  const centers = useMemo(() => uniq(labs.map((l) => l.center_name)), [labs]);
  const centerCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of labs) if (l.center_name) m[l.center_name] = (m[l.center_name] ?? 0) + 1;
    return m;
  }, [labs]);

  const sessionImportBatches = useMemo(
    () => batches.filter((batch) => batch.project_id === sessionImportProjectId),
    [batches, sessionImportProjectId],
  );

  const selectedSessionImportBatch = useMemo(
    () => batches.find((batch) => batch.id === sessionImportBatchId) ?? null,
    [batches, sessionImportBatchId],
  );

  // Pre-filter by governorate passed from the Egypt map (?gov=)
  useEffect(() => {
    if (!govParam || !labs.length) return;
    const norm = normalizeArabic(govParam);
    const match = govs.find((g) => normalizeArabic(g) === norm);
    if (match) setGov(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [govParam, labs.length]);

  useEffect(() => {
    if (!projects.length) return;
    if (!sessionImportProjectId) {
      setSessionImportProjectId(projects[0].id);
    }
  }, [projects, sessionImportProjectId]);

  useEffect(() => {
    if (!sessionImportProjectId) return;
    const nextBatchId = sessionImportBatches[0]?.id ?? "";
    if (!sessionImportBatchId || !sessionImportBatches.some((batch) => batch.id === sessionImportBatchId)) {
      setSessionImportBatchId(nextBatchId);
      setSessionImportPreview(null);
      setSessionImportFileName("");
    }
  }, [sessionImportBatchId, sessionImportBatches, sessionImportProjectId]);

  useEffect(() => {
    setSessionImportPreview(null);
    setSessionImportFileName("");
  }, [sessionImportBatchId, sessionImportMode]);

  const filtered = useMemo(() => {
    const normGov = gov !== "all" ? normalizeArabic(gov) : "";
    const normArea = area !== "all" ? normalizeArabic(area) : "";
    const rows = labs.filter((l) => {
      if (gov !== "all" && normalizeArabic(l.gov) !== normGov) return false;
      if (area !== "all" && normalizeArabic(l.area) !== normArea) return false;
      if (vendor !== "all" && l.vendor_name !== vendor) return false;
      if (center !== "all" && l.center_name !== center) return false;
      if (validation !== "all" && l.validation_status !== validation) return false;
      if (statusFilter !== "all") {
        const st = l.status || (l.is_active ? "active" : "deactivated");
        if (st !== statusFilter) return false;
      }
      if (verification !== "all") {
        const v = l.maps_verified;
        if (verification === "anomalies" && !detectLabLocationAnomaly(l)) return false;
        if (verification === "unverified" && v !== null && v !== undefined) return false;
        if (verification === "verified" && v !== true) return false;
        if (verification === "mismatch" && v !== false) return false;
      }
      if (qualityFilter !== "all") {
        const qy = quality[l.id];
        if (qualityFilter === "none" && qy) return false;
        if (qualityFilter !== "none") {
          if (!qy) return false;
          if (qualityBand(Number(qy.quality_score)) !== qualityFilter) return false;
        }
      }
      if (q) {
        const normQ = normalizeArabic(q);
        const hay = normalizeArabic(`${l.lab_code ?? ""} ${l.name ?? ""} ${l.area ?? ""} ${l.center_name ?? ""} ${l.address ?? ""}`);
        const hayLower = `${l.lab_code ?? ""} ${l.name ?? ""} ${l.area ?? ""} ${l.center_name ?? ""} ${l.address ?? ""}`.toLowerCase();
        if (!hay.includes(normQ) && !hayLower.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    const score = (l: Lab) => Number(quality[l?.id]?.quality_score ?? -1);
    rows.sort((a, b) => {
      let comp = 0;
      switch (sortField) {
        case "name":
          comp = (a.name ?? "").localeCompare(b.name ?? "");
          break;
        case "center":
          comp = (a.center_name ?? "").localeCompare(b.center_name ?? "");
          break;
        case "gov":
          comp = (a.gov ?? "").localeCompare(b.gov ?? "") || (a.area ?? "").localeCompare(b.area ?? "");
          break;
        case "area":
          comp = (a.area ?? "").localeCompare(b.area ?? "");
          break;
        case "vendor":
          comp = (a.vendor_name ?? "").localeCompare(b.vendor_name ?? "");
          break;
        case "quality":
          comp = score(a) - score(b);
          break;
        case "price":
          comp = Number(a.session_price ?? 0) - Number(b.session_price ?? 0);
          break;
        case "capacity":
          comp = Number(a.capacity ?? 0) - Number(b.capacity ?? 0);
          break;
        case "validation":
          comp = (a.validation_status ?? "").localeCompare(b.validation_status ?? "");
          break;
        case "verification":
          comp = Number(b.maps_verified === true) - Number(a.maps_verified === true);
          break;
        case "code":
        default:
          comp = (a.lab_code ?? "").localeCompare(b.lab_code ?? "");
          break;
      }
      return sortOrder === "asc" ? comp : -comp;
    });
    return rows;
  }, [labs, quality, gov, area, vendor, center, validation, statusFilter, verification, qualityFilter, q, sortField, sortOrder]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  // Auto-reset pagination to Page 1 when any filter or sort order changes
  useEffect(() => {
    setPage(1);
  }, [q, gov, area, vendor, center, validation, verification, qualityFilter, sortField, sortOrder]);

  const totalPages = Math.ceil(filtered.length / (pageSize || 25)) || 1;
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRows = useMemo(() => {
    return filtered.slice(startIndex, endIndex);
  }, [filtered, startIndex, endIndex]);

  const anomalyCount = useMemo(() => detectAllLocationAnomalies(labs).length, [labs]);
  const unassessedCount = labs.filter((l) => !quality[l.id]).length;
  const issuesCount = labs.filter((l) => l.validation_status === "issues").length;
  const unverifiedCount = labs.filter((l) => l.maps_verified === null || l.maps_verified === undefined).length;
  const mismatchCount = labs.filter((l) => l.maps_verified === false).length;

  const totalCapacity = useMemo(() => labs.reduce((sum, l) => sum + (l.capacity || 0), 0), [labs]);
  const activeCount = useMemo(() => labs.filter((l) => l.is_active || l.status === "active").length, [labs]);
  const verifiedCount = useMemo(() => labs.filter((l) => l.maps_verified === true).length, [labs]);
  const avgQualityScore = useMemo(() => {
    const scores = Object.values(quality)
      .map((q) => Number(q.quality_score))
      .filter((s) => !isNaN(s) && s > 0);
    if (!scores.length) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [quality]);
  const assessedCount = useMemo(() => Object.keys(quality).length, [quality]);

  const activeFiltersCount = useMemo(() => {
    let c = 0;
    if (q) c++;
    if (gov !== "all") c++;
    if (area !== "all") c++;
    if (vendor !== "all") c++;
    if (center !== "all") c++;
    if (validation !== "all") c++;
    if (verification !== "all") c++;
    if (qualityFilter !== "all") c++;
    if (statusFilter !== "all") c++;
    return c;
  }, [q, gov, area, vendor, center, validation, verification, qualityFilter, statusFilter]);
  const sessionPreviewRows = sessionImportPreview?.previewRows ?? [];
  const sessionPreviewValidCount = sessionPreviewRows.filter((row) => row.status === "Valid").length;
  const sessionPreviewWarningCount = sessionPreviewRows.filter((row) => row.status === "Warning").length;
  const sessionPreviewErrorCount = sessionPreviewRows.filter((row) => row.status === "Error").length;

  // ---------- Import: parse -> open column-matching dialog ----------
  async function onFilePicked(file: File) {
    try {
      const rows = await parseSheet(file);
      if (!rows.length) return toast.error("The file has no rows.");
      const headers = Object.keys(rows[0]);
      const auto: Record<string, string> = {};
      for (const f of IMPORT_FIELDS) {
        const found = headers.find((h) => f.aliases.some((a) => a.toLowerCase() === h.trim().toLowerCase()));
        auto[f.key] = found ?? NONE;
      }
      setImportRows(rows);
      setImportHeaders(headers);
      setMapping(auto);
      setImportOpen(true);
    } catch (e) {
      toast.error(`Failed to parse file: ${(e as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function mappedValue(row: Record<string, unknown>, key: string): string {
    const h = mapping[key];
    if (!h || h === NONE) return "";
    return fixMojibake(String(row[h] ?? "").trim());
  }

  async function runImport() {
    if (!mapping.lab_code || mapping.lab_code === NONE) return toast.error("Map the Lab ID column (needed to avoid duplicates).");
    if (!mapping.name || mapping.name === NONE) return toast.error("Map the Lab Name column.");
    setImporting(true);
    try {
      const labMap = new Map<string, any>();
      const nearbyMap = new Map<string, any[]>();

      for (const r of importRows) {
        const lab_code = mappedValue(r, "lab_code");
        const gv = mappedValue(r, "gov");
        const ar = mappedValue(r, "area");
        const name = mappedValue(r, "name") || lab_code || "(no name)";
        const address = mappedValue(r, "address");
        const maps_url = mappedValue(r, "maps_url");

        if (!lab_code && (!name || name === "(no name)")) continue;
        const codeKey = (lab_code || name).trim().toLowerCase();

        if (!labMap.has(codeKey)) {
          labMap.set(codeKey, {
            lab_code: lab_code || null,
            gov: gv || null,
            area: ar || null,
            name,
            center_name: mappedValue(r, "center_name") || null,
            address: address || null,
            maps_url: maps_url || null,
            vendor_name: mappedValue(r, "vendor_name") || null,
            capacity: Number(mappedValue(r, "capacity")) || 0,
            supervisor_name: mappedValue(r, "supervisor_name") || null,
            supervisor_phone: mappedValue(r, "supervisor_phone") || null,
            facilitator_name: mappedValue(r, "facilitator_name") || null,
            facilitator_phone: mappedValue(r, "facilitator_phone") || null,
            validation_status: validationOf({ gov: gv, area: ar, name, address, maps_url }),
            nearby_labs: [],
          });
          nearbyMap.set(codeKey, []);
        }

        // Process nearby distance columns on this row
        const nRankRaw = mappedValue(r, "nearby_rank");
        const nLabId = mappedValue(r, "nearby_lab_id");
        const nLabName = mappedValue(r, "nearby_lab_name");
        const nArea = mappedValue(r, "nearby_area");
        const nLocation = mappedValue(r, "nearby_location");
        const nDistRaw = mappedValue(r, "distance_km");
        const nMethod = mappedValue(r, "distance_method");
        const nStatus = mappedValue(r, "distance_status");

        if (nLabId || nDistRaw || nArea) {
          const parsedRank = parseInt(nRankRaw, 10);
          const parsedDist = parseFloat(nDistRaw.replace(/,/g, ""));
          const currentList = nearbyMap.get(codeKey)!;

          const item: any = {
            rank: Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : currentList.length + 1,
            nearbyLabId: nLabId || "",
            ...(nLabName ? { nearbyLabName: nLabName } : {}),
            ...(nArea ? { nearbyArea: nArea } : {}),
            ...(nLocation ? { nearbyLocationUrl: nLocation } : {}),
            distanceKm: Number.isFinite(parsedDist) ? parsedDist : 0,
            ...(nMethod ? { distanceMethod: nMethod } : {}),
            ...(nStatus ? { distanceStatus: nStatus } : {}),
          };

          // Prevent exact duplicate nearby entries for the same primary lab (do not drop distinct labs with same distance/area)
          const alreadyHas = currentList.some((n) => {
            if (nLabId && n.nearbyLabId) {
              return n.nearbyLabId.toLowerCase() === nLabId.toLowerCase();
            }
            if (!nLabId && !n.nearbyLabId && nLabName && n.nearbyLabName) {
              return n.nearbyLabName === nLabName;
            }
            return false;
          });

          if (!alreadyHas) {
            currentList.push(item);
          }
        }
      }

      // Helper to preserve notes with encoded nearby_labs
      const encodeNotes = (origNotes: string | null | undefined, nearbyList: any[]) => {
        const base = (origNotes || "").split("[NEARBY_LABS_JSON]:")[0].trim();
        if (!nearbyList || nearbyList.length === 0) return base || null;
        return base ? `${base}\n[NEARBY_LABS_JSON]:${JSON.stringify(nearbyList)}` : `[NEARBY_LABS_JSON]:${JSON.stringify(nearbyList)}`;
      };

      // Attach sorted nearby_labs and encoded notes to each mapped lab
      for (const [codeKey, labObj] of labMap.entries()) {
        const nearbyList = nearbyMap.get(codeKey) || [];
        if (nearbyList.length > 0) {
          nearbyList.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.distanceKm - b.distanceKm;
          });
          labObj.nearby_labs = nearbyList;
          labObj.notes = encodeNotes(labObj.notes, nearbyList);
        }
      }

      const deduplicatedMapped = Array.from(labMap.values());

      const existingByCode = new Map<string, Lab>();
      labs.forEach((l) => {
        if (l.lab_code) existingByCode.set(l.lab_code.trim().toLowerCase(), l);
      });

      const itemsWithDiffs: LabDiffItem[] = [];
      const brandNewLabs: typeof deduplicatedMapped = [];

      deduplicatedMapped.forEach((imp) => {
        if (!imp.lab_code) {
          brandNewLabs.push(imp);
          return;
        }

        const existing = existingByCode.get(imp.lab_code.trim().toLowerCase());
        if (!existing) {
          brandNewLabs.push(imp);
          return;
        }

        const diffs: { field: string; label: string; oldValue: any; newValue: any }[] = [];
        const check = (key: string, label: string, oldV: any, newV: any) => {
          const oldStr = String(oldV ?? "").trim();
          const newStr = String(newV ?? "").trim();
          if (newStr && oldStr !== newStr) {
            diffs.push({ field: key, label, oldValue: oldStr || "(empty)", newValue: newStr });
          }
        };

        check("name", "Lab Name", existing.name, imp.name);
        check("gov", "Governorate", existing.gov, imp.gov);
        check("area", "Area", existing.area, imp.area);
        check("center_name", "Center Name", existing.center_name, imp.center_name);
        check("address", "Address", existing.address, imp.address);
        check("maps_url", "Location (Maps)", existing.maps_url, imp.maps_url);
        check("vendor_name", "Vendor Name", existing.vendor_name, imp.vendor_name);
        if (imp.capacity > 0 && Number(existing.capacity) !== imp.capacity) {
          diffs.push({ field: "capacity", label: "Capacity", oldValue: existing.capacity, newValue: imp.capacity });
        }
        check("supervisor_name", "Supervisor Name", existing.supervisor_name, imp.supervisor_name);
        check("supervisor_phone", "Supervisor Phone", existing.supervisor_phone, imp.supervisor_phone);
        check("facilitator_name", "Facilitator Name", existing.facilitator_name, imp.facilitator_name);
        check("facilitator_phone", "Facilitator Phone", existing.facilitator_phone, imp.facilitator_phone);

        const oldNearbyCount = Array.isArray(existing.nearby_labs) ? (existing.nearby_labs as any[]).length : 0;
        const newNearbyCount = Array.isArray(imp.nearby_labs) ? imp.nearby_labs.length : 0;
        if (newNearbyCount > 0 && (oldNearbyCount !== newNearbyCount || JSON.stringify(existing.nearby_labs) !== JSON.stringify(imp.nearby_labs))) {
          diffs.push({
            field: "nearby_labs",
            label: "Nearby Labs Distance Matrix",
            oldValue: `${oldNearbyCount} nearby labs recorded`,
            newValue: `${newNearbyCount} ranked nearby labs mapped`,
          });
          // Ensure notes is updated with encoded nearby list
          imp.notes = encodeNotes(existing.notes, imp.nearby_labs);
        }

        if (diffs.length > 0) {
          itemsWithDiffs.push({
            lab_code: imp.lab_code,
            existingLab: existing,
            updatedData: imp,
            diffs,
          });
        }
      });

      if (itemsWithDiffs.length > 0) {
        setDiffItems(itemsWithDiffs);
        setNewLabsToInsert(brandNewLabs);
        setSelectedDiffIndices(new Set(itemsWithDiffs.map((_, i) => i)));
        setImportOpen(false);
        setDiffReviewOpen(true);
      } else if (brandNewLabs.length > 0) {
        let { error } = await supabase.from("labs").insert(brandNewLabs as any);
        if (error && String(error.message || "").includes("nearby_labs")) {
          const fallbackLabs = brandNewLabs.map(({ nearby_labs, ...rest }) => rest);
          const retry = await supabase.from("labs").insert(fallbackLabs as any);
          error = retry.error;
        }
        if (error) throw error;
        toast.success(`Imported ${brandNewLabs.length} new labs.`);
        setImportOpen(false);
        await load();
      } else {
        toast.info("All imported labs match current database records with no changes.");
        setImportOpen(false);
      }
    } catch (e: any) {
      toast.error(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }

  async function submitDiffUpdates(submitAll: boolean = true) {
    setSubmittingDiffs(true);
    try {
      let updatedCount = 0;
      const targets = submitAll
        ? diffItems
        : diffItems.filter((_, idx) => selectedDiffIndices.has(idx));

      for (const item of targets) {
        let { error } = await supabase
          .from("labs")
          .update(item.updatedData as never)
          .eq("id", item.existingLab.id);
        if (error && String(error.message || "").includes("nearby_labs")) {
          const { nearby_labs, ...rest } = item.updatedData as any;
          const retry = await supabase.from("labs").update(rest as never).eq("id", item.existingLab.id);
          error = retry.error;
        }
        if (!error) updatedCount++;
      }

      let insertedCount = 0;
      if (newLabsToInsert.length > 0) {
        let { error } = await supabase.from("labs").insert(newLabsToInsert as any);
        if (error && String(error.message || "").includes("nearby_labs")) {
          const fallbackLabs = newLabsToInsert.map(({ nearby_labs, ...rest }) => rest);
          const retry = await supabase.from("labs").insert(fallbackLabs as any);
          error = retry.error;
        }
        if (!error) insertedCount = newLabsToInsert.length;
      }

      toast.success(`Updated ${updatedCount} lab(s) and inserted ${insertedCount} new lab(s).`);
      setDiffReviewOpen(false);
      setDiffItems([]);
      setNewLabsToInsert([]);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Failed to update labs.");
    } finally {
      setSubmittingDiffs(false);
    }
  }

  async function handleImportLabVideos(file: File) {
    try {
      const rows = await parseSheet(file);
      if (!rows.length) return toast.error("File is empty.");

      const existingByCode = new Map<string, Lab>();
      labs.forEach((l) => {
        if (l.lab_code) existingByCode.set(l.lab_code.trim().toLowerCase(), l);
      });

      let updatedCount = 0;
      for (const r of rows) {
        const keys = Object.keys(r);
        if (keys.length < 2) continue;
        const codeVal = fixMojibake(String(r[keys[0]] ?? "").trim());
        const videoVal = fixMojibake(String(r[keys[1]] ?? "").trim());

        if (!codeVal || !videoVal) continue;
        const lab = existingByCode.get(codeVal.toLowerCase());
        if (!lab) continue;

        const { error } = await supabase
          .from("lab_quality")
          .upsert({ lab_id: lab.id, video_url: videoVal }, { onConflict: "lab_id" });
        if (!error) updatedCount++;
      }

      toast.success(`Successfully imported video links for ${updatedCount} labs!`);
      await load();
    } catch (e: any) {
      toast.error(`Video import failed: ${e.message}`);
    } finally {
      if (videoFileRef.current) videoFileRef.current.value = "";
    }
  }

  async function handleImportLabPrices(file: File) {
    try {
      const rows = await parseSheet(file);
      if (!rows.length) return toast.error("File is empty.");

      const existingByCode = new Map<string, Lab>();
      labs.forEach((l) => {
        if (l.lab_code) existingByCode.set(l.lab_code.trim().toLowerCase(), l);
      });

      let updatedCount = 0;
      for (const r of rows) {
        const keys = Object.keys(r);
        if (keys.length < 2) continue;
        const codeVal = fixMojibake(String(r[keys[0]] ?? "").trim());
        const priceVal = Number(r[keys[1]]);

        if (!codeVal || isNaN(priceVal) || priceVal < 0) continue;
        const lab = existingByCode.get(codeVal.toLowerCase());
        if (!lab) continue;

        const { error } = await supabase
          .from("labs")
          .update({ session_price: priceVal })
          .eq("id", lab.id);
        if (!error) updatedCount++;
      }

      toast.success(`Successfully updated session prices for ${updatedCount} labs!`);
      await load();
    } catch (e: any) {
      toast.error(`Price import failed: ${e.message}`);
    } finally {
      if (priceFileRef.current) priceFileRef.current.value = "";
    }
  }

  function resetSessionImportState() {
    setSessionImportPreview(null);
    setSessionImportFileName("");
    if (sessionFileRef.current) sessionFileRef.current.value = "";
  }

  function openSessionImportDialog() {
    resetSessionImportState();
    setSessionImportOpen(true);
  }

  async function handlePreviewSessionImport(file: File) {
    if (!selectedSessionImportBatch) {
      toast.error("Select a project and batch first.");
      if (sessionFileRef.current) sessionFileRef.current.value = "";
      return;
    }

    setSessionPreviewing(true);
    try {
      const matrix = await parseSheetMatrix(file);
      if (!matrix.length) throw new Error("The file has no rows.");

      const { data: assignmentData, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("batch_id", selectedSessionImportBatch.id)
        .neq("status", "denied");

      if (assignmentError) throw assignmentError;

      const assignments = (assignmentData ?? []) as AssignmentImport[];
      const assignmentIds = assignments.map((assignment) => assignment.id);

      const { data: sessionData, error: sessionError } = assignmentIds.length
        ? await supabase.from("assignment_sessions").select("*").eq("batch_id", selectedSessionImportBatch.id)
        : { data: [] as AssignmentSession[], error: null };

      if (sessionError) throw sessionError;

      const sessionsByAssignment = new Map<string, AssignmentSession[]>();
      for (const session of (sessionData ?? []) as AssignmentSession[]) {
        const existing = sessionsByAssignment.get(session.assignment_id);
        if (existing) existing.push(session);
        else sessionsByAssignment.set(session.assignment_id, [session]);
      }

      const labsById = new Map<string, Lab>();
      const labsByCode = new Map<string, { labId: string; labName: string; unitPrice: number }>();
      labs.forEach((lab) => {
        labsById.set(lab.id, lab);
        if (lab.lab_code) {
          labsByCode.set(normalizeLabCode(lab.lab_code), {
            labId: lab.id,
            labName: lab.name ?? lab.lab_code,
            unitPrice: Number(lab.session_price ?? 0),
          });
        }
      });

      const assignmentsByLabCode = new Map<
        string,
        {
          assignmentId: string;
          existingSessionKeys: Set<string>;
          labId: string;
          labName: string;
          unitPrice: number;
          currentSummary: ReturnType<typeof getAssignmentScheduleSummary>;
        }
      >();

      assignments.forEach((assignment) => {
        const lab = labsById.get(assignment.lab_id);
        if (!lab?.lab_code) return;
        const currentSessions = sessionsByAssignment.get(assignment.id) ?? [];
        assignmentsByLabCode.set(normalizeLabCode(lab.lab_code), {
          assignmentId: assignment.id,
          existingSessionKeys: new Set(
            currentSessions.map((session: any) => {
              const sessionTime = normalizeTimeSlot(session.session_time) ?? session.session_time;
              return `${session.session_date}|${sessionTime}`;
            }),
          ),
          labId: assignment.lab_id,
          labName: lab.name ?? lab.lab_code,
          unitPrice: Number(assignment.confirmed_price ?? lab.session_price ?? 0),
          currentSummary: getAssignmentScheduleSummary(
            assignment,
            selectedSessionImportBatch,
            currentSessions,
          ),
        });
      });

      const preview = buildSessionImportPreview(matrix, {
        batchId: selectedSessionImportBatch.id,
        batchDates: selectedSessionImportBatch.dates ?? [],
        batchTimeSlots: selectedSessionImportBatch.time_slots ?? [],
        importMode: sessionImportMode,
        expectedSessionsPerGroup: selectedSessionImportBatch.expected_sessions_per_group ?? null,
        assignmentsByLabCode,
        labsByLabCode: labsByCode,
      });

      setSessionImportPreview(preview);
      setSessionImportFileName(file.name);
      toast.success(`Preview ready for ${file.name}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to build session import preview");
    } finally {
      setSessionPreviewing(false);
      if (sessionFileRef.current) sessionFileRef.current.value = "";
    }
  }

  function downloadSessionImportIssues() {
    if (!sessionImportPreview) return;
    const rows = sessionImportPreview.previewRows
      .filter((row) => row.issues.length > 0)
      .map((row) => ({
        "File Row": row.rowNumber,
        "Lab ID": row.labCode,
        "Matched Lab": row.matchedLabName,
        Status: row.status,
        "Scheduled Days": row.scheduledDays,
        "Sessions By Date": row.sessionsByDate.map((item) => `${item.date}: ${item.sessions}`).join(" | "),
        "Total Sessions": row.totalSessions,
        "Current Price": row.currentCalculatedPrice,
        "New Price": row.newCalculatedPrice,
        Issues: row.issues.map((issue) => `${issue.level.toUpperCase()}: ${issue.message}`).join(" | "),
      }));

    if (!rows.length) {
      toast.info("There are no warnings or errors to export.");
      return;
    }

    downloadCsv(`session-import-issues-${selectedSessionImportBatch?.name ?? "batch"}.csv`, rows);
  }

  async function importValidSessionRows() {
    if (!sessionImportPreview || !selectedSessionImportBatch) return;
    if (!sessionImportPreview.validRows.length) {
      toast.error("There are no valid rows to import.");
      return;
    }

    setSessionImporting(true);
    try {
      const { error } = await supabase.rpc("import_assignment_sessions", {
        _batch_id: selectedSessionImportBatch.id,
        _file_name: sessionImportFileName || "session-import",
        _import_mode: sessionImportMode,
        _target_assignment_ids: sessionImportPreview.targetAssignmentIds,
        _sessions: sessionImportPreview.validSessions,
      });

      if (error) throw error;

      toast.success(
        `Imported ${sessionImportPreview.validSessions.length} session(s) across ${sessionImportPreview.validRows.length} lab row(s).`,
      );
      setSessionImportOpen(false);
      resetSessionImportState();
    } catch (e: any) {
      toast.error(e.message || "Failed to import sessions");
    } finally {
      setSessionImporting(false);
    }
  }

  // ---------- CSV Template & Current Data Export Helpers ----------
  function downloadMasterLabsTemplate() {
    const templateRow = [
      {
        "Lab ID": "LAB-101",
        "Lab Name": "Sample Lab Name",
        Governorate: "Cairo",
        Area: "Nasr City",
        "Vendor Name": "Sample Vendor",
        "Center Name": "Training Center A",
        Address: "123 Main Street",
        "Location (Google Maps)": "https://maps.google.com/?q=30.0,31.0",
        "Supervisor Name": "Ahmed Hassan",
        "Supervisor Phone": "01000000000",
        "Facilitator Name": "Mohamed Ali",
        "Facilitator Phone": "01100000000",
        "Lab Capacity": 25,
      },
    ];
    downloadCsv("template-master-labs.csv", templateRow);
    toast.success("Downloaded Master Labs CSV template.");
  }

  function exportMasterLabsCurrentData() {
    if (!labs.length) return toast.info("No lab records to export.");
    const rows = labs.map((l) => ({
      "Lab ID": l.lab_code || "",
      "Lab Name": fixMojibake(l.name),
      Governorate: fixMojibake(l.gov || ""),
      Area: fixMojibake(l.area || ""),
      "Vendor Name": fixMojibake(l.vendor_name || ""),
      "Center Name": fixMojibake(l.center_name || ""),
      Address: fixMojibake(l.address || ""),
      "Location (Google Maps)": l.maps_url || "",
      "Supervisor Name": fixMojibake(l.supervisor_name || ""),
      "Supervisor Phone": l.supervisor_phone || "",
      "Facilitator Name": fixMojibake(l.facilitator_name || ""),
      "Facilitator Phone": l.facilitator_phone || "",
      "Lab Capacity": l.capacity || 0,
    }));
    downloadCsv("export-master-labs-current.csv", rows);
    toast.success(`Exported ${rows.length} master lab records.`);
  }

  function downloadVideosTemplate() {
    const templateRow = [
      {
        "Lab ID": "LAB-101",
        "Video Box URL": "https://box.com/s/sample_video_link",
      },
    ];
    downloadCsv("template-lab-videos.csv", templateRow);
    toast.success("Downloaded Lab Videos CSV template.");
  }

  function exportVideosCurrentData() {
    if (!labs.length) return toast.info("No lab records to export.");
    const rows = labs.map((l) => {
      const qy = quality[l.id];
      return {
        "Lab ID": l.lab_code || "",
        "Lab Name": fixMojibake(l.name),
        "Video Box URL": (qy as any)?.video_url || "",
      };
    });
    downloadCsv("export-lab-videos-current.csv", rows);
    toast.success(`Exported video link data for ${rows.length} labs.`);
  }

  function downloadPricesTemplate() {
    const templateRow = [
      {
        "Lab ID": "LAB-101",
        "Session Price (EGP)": 1500,
      },
    ];
    downloadCsv("template-lab-prices.csv", templateRow);
    toast.success("Downloaded Lab Prices CSV template.");
  }

  function exportPricesCurrentData() {
    if (!labs.length) return toast.info("No lab records to export.");
    const rows = labs.map((l) => ({
      "Lab ID": l.lab_code || "",
      "Lab Name": fixMojibake(l.name),
      Governorate: fixMojibake(l.gov || ""),
      "Session Price (EGP)": l.session_price || 0,
    }));
    downloadCsv("export-lab-prices-current.csv", rows);
    toast.success(`Exported session prices for ${rows.length} labs.`);
  }

  async function handleSaveLabStatus() {
    if (!replaceTargetLab) return;
    setSubmittingReplace(true);
    try {
      const isReplaced = newLabStatus === "replaced";
      const payload: Record<string, any> = {
        status: newLabStatus,
        is_active: newLabStatus === "active",
        deactivation_reason: deactivationReason.trim() || null,
      };

      if (isReplaced) {
        if (!replacementLabId) {
          toast.error("Please select a replacement lab.");
          setSubmittingReplace(false);
          return;
        }
        payload.replaced_by_lab_id = replacementLabId;
        payload.replaced_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("labs")
        .update(payload as never)
        .eq("id", replaceTargetLab.id);

      if (error) throw error;
      toast.success(`Lab status updated to ${newLabStatus.toUpperCase()}`);

      // Audit Trail Log
      logAuditAction({
        userId: user?.id,
        userName: currentActorName,
        userEmail: user?.email,
        userRole: currentActorRole,
        tab: "Lab Data",
        section: "Lab Status Dialog",
        actionType: "STATUS_CHANGE",
        actionTitle: `Changed lab "${replaceTargetLab.name}" status to "${newLabStatus.toUpperCase()}"`,
        entityType: "lab",
        entityId: replaceTargetLab.id,
        oldValue: {
          status: replaceTargetLab.status,
          is_active: replaceTargetLab.is_active,
          deactivation_reason: replaceTargetLab.deactivation_reason,
        },
        newValue: payload,
        isRestorable: true,
      });

      setReplaceModalOpen(false);
      setReplaceTargetLab(null);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Failed to update lab status");
    } finally {
      setSubmittingReplace(false);
    }
  }

  // ---------- Lab create/edit ----------
  function openCreate() { setEditing(null); setLabForm({ ...EMPTY_LAB }); setLabOpen(true); }
  function openEdit(l: Lab) {
    setEditing(l);
    setLabForm({
      lab_code: l.lab_code ?? "", name: l.name ?? "", gov: l.gov ?? "", area: l.area ?? "",
      center_name: l.center_name ?? "", address: l.address ?? "", maps_url: l.maps_url ?? "",
      vendor_name: l.vendor_name ?? "", capacity: l.capacity ?? 0, session_price: Number(l.session_price ?? 0),
      supervisor_name: l.supervisor_name ?? "", supervisor_phone: l.supervisor_phone ?? "",
      facilitator_name: l.facilitator_name ?? "", facilitator_phone: l.facilitator_phone ?? "",
      notes: l.notes ?? "", is_active: l.is_active,
    });
    setLabOpen(true);
  }
  async function saveLab() {
    if (!labForm.name.trim()) return toast.error("Lab name is required");
    const payload = { ...labForm, lab_code: labForm.lab_code.trim() || null, name: labForm.name.trim(), validation_status: validationOf(labForm) };
    const res = editing
      ? await supabase.from("labs").update(payload).eq("id", editing.id)
      : await supabase.from("labs").insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success(editing ? "Lab updated" : "Lab created");

    // Audit Trail Log
    logAuditAction({
      userId: user?.id,
      userName: currentActorName,
      userEmail: user?.email,
      userRole: currentActorRole,
      tab: "Lab Data",
      section: "Lab Form Modal",
      actionType: editing ? "UPDATE" : "CREATE",
      actionTitle: `${editing ? "Updated" : "Created"} lab "${payload.name}" (${payload.area})`,
      entityType: "lab",
      entityId: editing?.id || payload.name,
      oldValue: editing || null,
      newValue: payload,
      isRestorable: true,
    });

    setLabOpen(false);
    void load();
  }
  async function removeLab(id: string) {
    if (!confirm("Delete this lab?")) return;
    const target = labs.find((l) => l.id === id);
    const { error } = await supabase.from("labs").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Lab deleted");

    // Audit Trail Log
    logAuditAction({
      userId: user?.id,
      userName: currentActorName,
      userEmail: user?.email,
      userRole: currentActorRole,
      tab: "Lab Data",
      section: "Labs Table",
      actionType: "DELETE",
      actionTitle: `Deleted lab "${target?.name || id}"`,
      entityType: "lab",
      entityId: id,
      oldValue: target || null,
      newValue: null,
      isRestorable: true,
    });

    void load();
  }

  // ---------- Quality ----------
  function openQuality(l: Lab) {
    setQLab(l);
    const e = quality[l.id];
    const existingImgs = (e as any)?.image_urls as string[] | undefined;
    const paddedImgs = Array.isArray(existingImgs)
      ? [...existingImgs, "", "", "", "", ""].slice(0, 5)
      : ["", "", "", "", ""];

    setQForm(e ? {
      pc_count: (e as any).pc_count ?? l.capacity ?? "",
      pc_quality: e.pc_quality ?? 0,
      seated_capacity: (e as any).seated_capacity ?? l.capacity ?? "",
      lab_size: ((e as any).lab_size as LabSize) ?? deriveLabSize(l.capacity, (e as any).pc_count),
      internet_quality: e.internet_quality ?? 0,
      internet_speed_mbps: (e as any).internet_speed_mbps ?? "",
      bathroom_type: ((e as any).bathroom_type as BathroomType) ?? (e.bathroom_boys && e.bathroom_girls ? "separate" : "mixed"),
      bathroom_boys: e.bathroom_boys ?? false,
      bathroom_girls: e.bathroom_girls ?? false,
      chairs_quality: e.chairs_quality ?? 0,
      street_view: e.street_view ?? 0,
      cleanliness: e.cleanliness ?? 0,
      ac: (e.ac as AcQuality) ?? "",
      ac_count: (e as any).ac_count ?? "",
      projector: e.projector ?? false,
      has_instructor_pc: (e as any).has_instructor_pc ?? false,
      has_printer: (e as any).has_printer ?? false,
      security: e.security ?? false,
      extra_activities: e.extra_activities ?? "",
      parent_waiting_area: (e as any).parent_waiting_area ?? false,
      floor_number: (e as any).floor_number ?? "",
      has_elevator: (e as any).has_elevator ?? false,
      video_url: (e as any).video_url ?? "",
      image_urls: paddedImgs,
      notes: getCleanNotes(e.notes),
    } : {
      ...EMPTY_QUALITY,
      pc_count: l.capacity || "",
      seated_capacity: l.capacity || "",
      lab_size: deriveLabSize(l.capacity, 0),
    });
    setQOpen(true);
  }
  const liveScore = useMemo(() => computeQualityScore(qForm as never), [qForm]);
  async function saveQuality() {
    if (!qLab) return;
    const cleanImgs = (qForm.image_urls || []).map((u) => u.trim()).filter(Boolean).slice(0, 5);

    const parseOptionalInt = (v: any) => {
      if (v === "" || v === null || v === undefined) return null;
      const n = Number(v);
      return isNaN(n) ? null : Math.round(n);
    };
    const parseRating = (v: any) => {
      const n = Number(v);
      return !isNaN(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
    };

    // Historical Technical Audit Tracking:
    // Append previous technical score to score history before updating
    const existingQ = quality[qLab.id];
    const prevHistory: AuditHistoryEntry[] = extractScoreHistory(existingQ);
    if (existingQ && existingQ.quality_score != null && existingQ.assessed_at) {
      prevHistory.push({
        score: Number(existingQ.quality_score),
        assessed_at: existingQ.assessed_at,
        assessed_by: existingQ.assessed_by ?? null,
        notes: getCleanNotes(existingQ.notes) || null,
      });
    }

    const cleanUserNotes = qForm.notes?.trim() || "";
    const notesWithHistory = encodeNotesWithHistory(cleanUserNotes, prevHistory);

    const payload = {
      lab_id: qLab.id,
      pc_count: parseOptionalInt(qForm.pc_count),
      pc_quality: parseRating(qForm.pc_quality),
      lab_size: qForm.lab_size || deriveLabSize(parseOptionalInt(qForm.seated_capacity), parseOptionalInt(qForm.pc_count)),
      seated_capacity: parseOptionalInt(qForm.seated_capacity),
      internet_quality: parseRating(qForm.internet_quality),
      internet_speed_mbps: parseOptionalInt(qForm.internet_speed_mbps),
      bathroom_type: qForm.bathroom_type || "separate",
      bathroom_boys: Boolean(qForm.bathroom_boys),
      bathroom_girls: Boolean(qForm.bathroom_girls),
      chairs_quality: parseRating(qForm.chairs_quality),
      street_view: parseRating(qForm.street_view),
      cleanliness: parseRating(qForm.cleanliness),
      ac: (qForm.ac && ["yes", "no", "partial"].includes(qForm.ac) ? qForm.ac : "no") as AcQuality,
      ac_count: parseOptionalInt(qForm.ac_count),
      projector: Boolean(qForm.projector),
      has_instructor_pc: Boolean(qForm.has_instructor_pc),
      has_printer: Boolean(qForm.has_printer),
      security: Boolean(qForm.security),
      extra_activities: parseOptionalInt(qForm.extra_activities) ?? 0,
      parent_waiting_area: Boolean(qForm.parent_waiting_area),
      floor_number: parseOptionalInt(qForm.floor_number) ?? 0,
      has_elevator: Boolean(qForm.has_elevator),
      video_url: qForm.video_url?.trim() || null,
      image_urls: cleanImgs,
      notes: notesWithHistory,
      quality_score: liveScore,
      assessed_by: user?.id ?? null,
      assessed_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("lab_quality").upsert(payload as never, { onConflict: "lab_id" });
    if (error) return toast.error(error.message);
    toast.success("Quality assessment saved");
    setQOpen(false);
    void load();
  }

  // ---------- Maps verification ----------
  function openVerify(l: Lab) { setVerifyLab(l); setVerifyNote(l.maps_verified_note ?? ""); }
  async function saveVerification(verified: boolean) {
    if (!verifyLab) return;
    const { error } = await supabase.from("labs").update({
      maps_verified: verified, maps_verified_note: verifyNote || null,
      maps_verified_at: new Date().toISOString(), maps_verified_by: user?.id ?? null,
    }).eq("id", verifyLab.id);
    if (error) return toast.error(error.message);
    toast.success(verified ? "Location verified" : "Flagged as mismatch");
    setVerifyLab(null); setVerifyNote("");
    void load();
  }

  function resetFilters() {
    setQ(""); setGov("all"); setArea("all"); setVendor("all"); setCenter("all");
    setValidation("all"); setVerification("all"); setQualityFilter("all");
  }

  async function fixAllEncodingsInDatabase() {
    setLoading(true);
    try {
      const corrupted = labs.filter((l) => {
        return (
          (l.name && /[\u00C0-\u00FF]/.test(l.name)) ||
          (l.center_name && /[\u00C0-\u00FF]/.test(l.center_name)) ||
          (l.gov && /[\u00C0-\u00FF]/.test(l.gov)) ||
          (l.area && /[\u00C0-\u00FF]/.test(l.area)) ||
          (l.address && /[\u00C0-\u00FF]/.test(l.address))
        );
      });

      if (!corrupted.length) {
        toast.info("No Arabic encoding issues found in database records.");
        return;
      }

      let fixedCount = 0;
      for (const lab of corrupted) {
        const payload = {
          name: fixMojibake(lab.name),
          center_name: lab.center_name ? fixMojibake(lab.center_name) : null,
          gov: lab.gov ? fixMojibake(lab.gov) : null,
          area: lab.area ? fixMojibake(lab.area) : null,
          address: lab.address ? fixMojibake(lab.address) : null,
          vendor_name: lab.vendor_name ? fixMojibake(lab.vendor_name) : null,
        };
        const { error } = await supabase.from("labs").update(payload).eq("id", lab.id);
        if (!error) fixedCount++;
      }
      toast.success(`Repaired Arabic text encoding for ${fixedCount} lab records.`);
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function autoVerifyLocations() {
    const eligible = labs.filter((l) => l.maps_verified !== true && canAutoVerifyLab(l));
    if (!eligible.length) {
      toast.info("No unverified labs match auto-verification criteria.");
      return;
    }

    setLoading(true);
    let count = 0;
    for (const lab of eligible) {
      const { error } = await supabase
        .from("labs")
        .update({
          maps_verified: true,
          maps_verified_note: "Auto-verified via location matching engine",
        })
        .eq("id", lab.id);
      if (!error) count++;
    }

    toast.success(`Successfully auto-verified ${count} lab location pins!`);
    setLoading(false);
    void load();
  }

  return (
    <div className="space-y-5">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[#1F2A55] dark:text-[#F7FAFF]">
              Lab Data Directory
            </h1>
            <Badge className="bg-[#056FEC] text-white font-bold text-[10px]">
              {labs.length} Facilities
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Master directory of lab facilities across Egypt — capacities, session prices (EGP), quality audit ratings, and GPS verified locations.
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFilePicked(e.target.files[0])} />
            <input ref={videoFileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && handleImportLabVideos(e.target.files[0])} />
            <input ref={priceFileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && handleImportLabPrices(e.target.files[0])} />
            <input ref={sessionFileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handlePreviewSessionImport(e.target.files[0])} />

            <Link to="/lab-allocation">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 border-[#056FEC]/40 text-[#056FEC] dark:text-[#05ACFF] hover:bg-[#056FEC]/10 font-semibold rounded-xl text-xs">
                <Cpu className="h-3.5 w-3.5" /> Lab Allocation Engine
              </Button>
            </Link>

            {/* Templates & Data Hub Dropdown (Orange Secondary) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="h-8 gap-1.5 bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white font-bold rounded-xl text-xs shadow-xs">
                  <Download className="h-3.5 w-3.5" />
                  <span>Import &amp; Export Hub</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                  Data Exports
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={exportMasterLabsCurrentData} className="text-xs cursor-pointer">
                  <Download className="mr-2 h-4 w-4 text-[#056FEC]" /> Export Current Labs CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadMasterLabsTemplate} className="text-xs cursor-pointer">
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" /> Download Blank Labs Template
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportPricesCurrentData} className="text-xs cursor-pointer">
                  <DollarSign className="mr-2 h-4 w-4 text-emerald-600" /> Export Session Prices CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportVideosCurrentData} className="text-xs cursor-pointer">
                  <Video className="mr-2 h-4 w-4 text-blue-600" /> Export Video Links CSV
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                  Batch Imports
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => fileRef.current?.click()} className="text-xs cursor-pointer">
                  <Upload className="mr-2 h-4 w-4 text-[#056FEC]" /> Import Labs CSV (Master)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openSessionImportDialog} className="text-xs cursor-pointer">
                  <Calendar className="mr-2 h-4 w-4 text-[#FF7F1C]" /> Import Batch Sessions
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => priceFileRef.current?.click()} className="text-xs cursor-pointer">
                  <DollarSign className="mr-2 h-4 w-4 text-emerald-600" /> Import Lab Prices (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => videoFileRef.current?.click()} className="text-xs cursor-pointer">
                  <Video className="mr-2 h-4 w-4 text-blue-600" /> Import Lab Videos (CSV)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Primary Action: Add Lab (iSchool Blue) */}
            <Button size="sm" onClick={openCreate} className="h-8 gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold rounded-xl text-xs shadow-xs">
              <Plus className="h-3.5 w-3.5" /> Add Lab
            </Button>
          </div>
        )}
      </div>

      {/* Unified KPI Summary Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Total Labs */}
        <Card className="shadow-xs border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Total Labs
              </div>
              <div className="text-2xl font-black text-foreground mt-0.5">
                {labs.length}
              </div>
              <div className="text-[11px] text-[#056FEC] dark:text-[#05ACFF] font-medium mt-0.5 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> {verifiedCount} verified • {activeCount} active
              </div>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF] flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        {/* Governorates */}
        <Card className="shadow-xs border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Gov Coverage
              </div>
              <div className="text-2xl font-black text-foreground mt-0.5">
                {govs.length} <span className="text-sm font-semibold text-muted-foreground">/ 27</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {new Set(labs.map((l) => l.area).filter(Boolean)).size} physical areas reached
              </div>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-[#05ACFF]/15 text-[#05ACFF] flex items-center justify-center shrink-0">
              <Globe className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        {/* Total Capacity */}
        <Card className="shadow-xs border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Seated Capacity
              </div>
              <div className="text-2xl font-black text-foreground mt-0.5">
                {totalCapacity.toLocaleString()}
              </div>
              <div className="text-[11px] text-[#FF7F1C] font-semibold mt-0.5">
                Seats &amp; workstations
              </div>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-[#FF7F1C]/15 text-[#FF7F1C] flex items-center justify-center shrink-0">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        {/* Quality Audit */}
        <Card className="shadow-xs border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Quality Rating
              </div>
              <div className="text-2xl font-black text-foreground mt-0.5">
                {avgQualityScore > 0 ? `${avgQualityScore.toFixed(0)}/100` : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {assessedCount} of {labs.length} facilities audited
              </div>
            </div>
            <div className="h-11 w-11 rounded-2xl bg-[#FFD700]/20 text-[#B4810B] dark:text-[#FFD700] flex items-center justify-center shrink-0">
              <Star className="h-5 w-5 fill-current" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actionable Health & Filter Chips Strip */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-2xl bg-card border border-border/70 text-xs shadow-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-[#1F2A55] dark:text-[#F7FAFF] text-xs flex items-center gap-1.5 mr-1">
            <ShieldCheck className="h-4 w-4 text-[#056FEC]" /> Network Health:
          </span>

          <button
            onClick={() => setVerification(verification === "anomalies" ? "all" : "anomalies")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold text-xs transition-all ${
              verification === "anomalies"
                ? "bg-[#DE1F1F] text-white shadow-xs"
                : anomalyCount > 0
                ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 border border-rose-500/25"
                : "bg-muted text-muted-foreground opacity-60"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {anomalyCount} Location Anomalies
          </button>

          <button
            onClick={() => setQualityFilter(qualityFilter === "none" ? "all" : "none")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold text-xs transition-all ${
              qualityFilter === "none"
                ? "bg-[#FF7F1C] text-white shadow-xs"
                : unassessedCount > 0
                ? "bg-[#FF7F1C]/10 text-[#FF7F1C] hover:bg-[#FF7F1C]/20 border border-[#FF7F1C]/25"
                : "bg-muted text-muted-foreground opacity-60"
            }`}
          >
            <Star className="h-3.5 w-3.5" />
            {unassessedCount} Needs Quality Audit
          </button>

          <button
            onClick={() => setValidation(validation === "issues" ? "all" : "issues")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold text-xs transition-all ${
              validation === "issues"
                ? "bg-amber-500 text-white shadow-xs"
                : issuesCount > 0
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/25"
                : "bg-muted text-muted-foreground opacity-60"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {issuesCount} Data Issues
          </button>

          <button
            onClick={() => setVerification(verification === "unverified" ? "all" : "unverified")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl font-bold text-xs transition-all ${
              verification === "unverified"
                ? "bg-[#056FEC] text-white shadow-xs"
                : unverifiedCount > 0
                ? "bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF] hover:bg-[#056FEC]/20 border border-[#056FEC]/25"
                : "bg-muted text-muted-foreground opacity-60"
            }`}
          >
            <MapPin className="h-3.5 w-3.5" />
            {unverifiedCount} Pins Unverified
          </button>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={autoVerifyLocations}
              disabled={loading}
              className="h-7 text-[11px] font-semibold text-[#056FEC] dark:text-[#05ACFF] hover:bg-[#056FEC]/10 gap-1 rounded-lg"
              title="Automatically verify pins that match governorate & city bounding boxes"
            >
              <Sparkles className="h-3 w-3 text-[#056FEC]" /> Auto-Verify Pins
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={fixAllEncodingsInDatabase}
              disabled={loading}
              className="h-7 text-[11px] font-semibold text-muted-foreground hover:text-foreground gap-1 rounded-lg"
              title="Repair any mojibake / corrupted Arabic text strings"
            >
              <RefreshCw className="h-3 w-3" /> Fix Arabic Text
            </Button>
          </div>
        )}
      </div>

      {/* Unified Command Bar & Filters */}
      <div className="p-3.5 rounded-2xl bg-card border border-border/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search and Cascading Location */}
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search lab ID, name, center, area..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8 pr-7 h-9 text-xs bg-background rounded-xl"
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Governorate Filter */}
            <FilterSelect
              value={gov}
              onChange={(v) => {
                setGov(v);
                setArea("all");
              }}
              allLabel="All Governorates"
              options={govs}
              width="w-40"
            />

            {/* Cascading Area Filter */}
            <FilterSelect
              value={area}
              onChange={setArea}
              allLabel="All Areas"
              options={areas}
              width="w-40"
            />

            {/* More Filters Popover */}
            <Popover open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-9 text-xs gap-1.5 rounded-xl font-semibold ${
                    activeFiltersCount > 0 ? "border-[#056FEC] text-[#056FEC]" : ""
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span>Filters</span>
                  {activeFiltersCount > 0 && (
                    <Badge className="h-4 px-1 text-[10px] bg-[#056FEC] text-white font-bold ml-0.5">
                      {activeFiltersCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-4 space-y-3.5 text-xs">
                <div className="font-bold text-foreground text-sm flex items-center justify-between pb-1 border-b">
                  <span>Filter Facilities</span>
                  {activeFiltersCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={resetFilters} className="h-6 text-[11px] text-muted-foreground hover:text-destructive p-1">
                      Reset
                    </Button>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground">Vendor</Label>
                  <FilterSelect value={vendor} onChange={setVendor} allLabel="All Vendors" options={vendors} width="w-full" />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground">Center</Label>
                  <FilterSelect value={center} onChange={setCenter} allLabel="All Centers" options={centers} width="w-full" />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground">Operational Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="active">Active Only</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="deactivated">Deactivated</SelectItem>
                      <SelectItem value="replaced">Replaced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground">Quality Rating</Label>
                  <Select value={qualityFilter} onValueChange={setQualityFilter}>
                    <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All quality tiers</SelectItem>
                      <SelectItem value="high">High (75+)</SelectItem>
                      <SelectItem value="medium">Medium (50–74)</SelectItem>
                      <SelectItem value="low">Low (&lt;50)</SelectItem>
                      <SelectItem value="none">Needs assessment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground">GPS Pin Status</Label>
                  <Select value={verification} onValueChange={setVerification}>
                    <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All pins</SelectItem>
                      <SelectItem value="anomalies">⚠️ Anomalies Only ({anomalyCount})</SelectItem>
                      <SelectItem value="verified">Verified Pins</SelectItem>
                      <SelectItem value="unverified">Unverified</SelectItem>
                      <SelectItem value="mismatch">Mismatch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </PopoverContent>
            </Popover>

            {/* Reset All Action */}
            {activeFiltersCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-9 text-xs text-muted-foreground hover:text-destructive gap-1 rounded-xl"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </Button>
            )}
          </div>

          {/* View Mode Switcher Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-xl border border-border/60 self-end md:self-auto shrink-0">
            <Button
              variant={viewMode === "split" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("split")}
              className={`h-7 text-xs font-semibold gap-1.5 rounded-lg transition-all ${
                viewMode === "split" ? "bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs" : "text-muted-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Split View</span>
            </Button>
            <Button
              variant={viewMode === "table" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("table")}
              className={`h-7 text-xs font-semibold gap-1.5 rounded-lg transition-all ${
                viewMode === "table" ? "bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs" : "text-muted-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Table View</span>
            </Button>
            <Button
              variant={viewMode === "map" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("map")}
              className={`h-7 text-xs font-semibold gap-1.5 rounded-lg transition-all ${
                viewMode === "map" ? "bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs" : "text-muted-foreground"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Full Map</span>
            </Button>
          </div>
        </div>
      </div>

      {/* VIEW MODE 1: SPLIT VIEW (Map + Live Lab Cards side-by-side) */}
      {viewMode === "split" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Interactive Map */}
          <div className="lg:col-span-7 sticky top-4 space-y-3">
            <EgyptLabCoverageMap
              labs={filtered}
              selectedGov={gov}
              onSelectGov={(g) => {
                setGov(g);
                setArea("all");
              }}
              selectedLabId={selectedLab?.id}
              onSelectLab={(l) => {
                setSelectedLab(l);
                setQuickViewOpen(true);
              }}
              hideMetrics
              compact
            />
          </div>

          {/* Right Column: Live Lab Feed */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1 text-xs">
              <span className="font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                {filtered.length} Labs {gov !== "all" ? `in ${gov}` : "found"}
              </span>
              <span className="text-muted-foreground text-[11px]">
                Showing {filtered.length === 0 ? 0 : startIndex + 1}–{Math.min(endIndex, filtered.length)}
              </span>
            </div>

            {/* Lab Cards List */}
            <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
              {loadError ? (
                <Alert variant="destructive">
                  <AlertTitle>Unable to load facilities</AlertTitle>
                  <AlertDescription className="mt-2 flex items-center justify-between gap-4">
                    <span>{loadError}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : loading ? (
                <Card className="p-8 text-center text-sm text-muted-foreground shadow-xs">
                  Loading facilities…
                </Card>
              ) : filtered.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground shadow-xs">
                  No labs match your filters. Use <strong>Import CSV</strong> or clear filters.
                </Card>
              ) : (
                paginatedRows.map((l) => {
                  const qy = quality[l.id];
                  const shared = l.center_name ? centerCounts[l.center_name] ?? 1 : 1;
                  const st = l.status || (l.is_active ? "active" : "deactivated");
                  const isSelected = selectedLab?.id === l.id;
                  const anomaly = detectLabLocationAnomaly(l);

                  return (
                    <div
                      key={l.id}
                      onClick={() => {
                        setSelectedLab(l);
                      }}
                      onDoubleClick={() => {
                        setSelectedLab(l);
                        setQuickViewOpen(true);
                      }}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#056FEC] bg-[#056FEC]/5 ring-2 ring-[#056FEC]/25 shadow-md"
                          : "border-border/80 bg-card hover:border-[#056FEC]/40 hover:bg-muted/30 shadow-xs"
                      }`}
                    >
                      {/* Top Badges Row */}
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] font-bold text-[#056FEC] dark:text-[#05ACFF] bg-[#056FEC]/10 px-2 py-0.5 rounded-lg border border-[#056FEC]/25">
                            {l.lab_code || "—"}
                          </span>
                          {st === "active" && (
                            <Badge variant="outline" className="bg-[#056FEC]/10 text-[#056FEC] border-[#056FEC]/25 text-[10px] py-0 font-semibold">
                              Active
                            </Badge>
                          )}
                          {st === "suspended" && (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/25 text-[10px] py-0 font-semibold">
                              Suspended
                            </Badge>
                          )}
                          {st === "deactivated" && (
                            <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-500/25 text-[10px] py-0 font-semibold">
                              Deactivated
                            </Badge>
                          )}
                          {st === "replaced" && (
                            <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/25 text-[10px] py-0 font-semibold">
                              Replaced
                            </Badge>
                          )}
                          {anomaly && (
                            <Badge
                              variant="outline"
                              className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 text-[10px] py-0"
                              title={`${anomaly.title}: ${anomaly.description}`}
                            >
                              ⚠️ {anomaly.title}
                            </Badge>
                          )}
                        </div>

                        {qy ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF7F1C] bg-[#FF7F1C]/10 px-2 py-0.5 rounded-lg border border-[#FF7F1C]/25">
                            <Star className="h-3 w-3 fill-current" /> {Number(qy.quality_score).toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Unrated</span>
                        )}
                      </div>

                      {/* Lab Name */}
                      <h4 className="font-bold text-sm text-foreground truncate" dir="auto">
                        {fixMojibake(l.name)}
                      </h4>

                      {/* Location & Center */}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 truncate" dir="auto">
                        <MapPin className="h-3.5 w-3.5 text-[#056FEC] shrink-0" />
                        <span className="font-medium text-foreground">{fixMojibake(l.gov || "—")}</span>
                        <span>•</span>
                        <span>{fixMojibake(l.area || "Main Area")}</span>
                        {l.center_name && (
                          <>
                            <span>•</span>
                            <span className="truncate text-muted-foreground">({fixMojibake(l.center_name)})</span>
                          </>
                        )}
                      </div>

                      {/* Capacity, Price & Actions Footer */}
                      <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-border/60 text-xs">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-foreground">
                            {l.capacity} <span className="text-muted-foreground font-normal text-[11px]">seats</span>
                          </span>
                          <span className="font-bold text-[#056FEC] dark:text-[#05ACFF]">
                            {formatEGP(l.session_price)}
                          </span>
                          <PinBadge state={l.maps_verified} />
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-[#056FEC]"
                            title="Quick Details Sheet"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedLab(l);
                              setQuickViewOpen(true);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {canEdit && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-[#FF7F1C]"
                                title="Change Status / Replace"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReplaceTargetLab(l);
                                  setNewLabStatus(l.status || "active");
                                  setReplacementLabId(l.replaced_by_lab_id || "");
                                  setDeactivationReason(l.deactivation_reason || "");
                                  setReplaceModalOpen(true);
                                }}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-[#056FEC]"
                                title="Quality Audit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openQuality(l);
                                }}
                              >
                                <Star className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="Edit Lab"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(l);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-card border border-border/70 text-xs">
              <span className="text-[11px] text-muted-foreground font-medium">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODE 2: TABLE VIEW (Full Width Master Data Grid) */}
      {viewMode === "table" && (
        <Card className="shadow-xs border-border/80">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <SortableHead title="Code" field="code" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <SortableHead title="Lab Name" field="name" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <SortableHead title="Center" field="center" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <SortableHead title="Gov" field="gov" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <SortableHead title="Area" field="area" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <SortableHead title="Vendor" field="vendor" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <SortableHead title="Cap." field="capacity" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} align="right" />
                    <SortableHead title="Session Price" field="price" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} align="right" />
                    <SortableHead title="Quality" field="quality" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <TableHead className="text-center">Status</TableHead>
                    <SortableHead title="Data" field="validation" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <SortableHead title="Pin" field="verification" currentField={sortField} currentOrder={sortOrder} onSort={toggleSort} />
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={13} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={13} className="py-8 text-center text-sm text-muted-foreground">No labs match. Use <strong>Import CSV</strong> to load the lab sheet.</TableCell></TableRow>
                  ) : (
                    paginatedRows.map((l) => {
                      const qy = quality[l.id];
                      const shared = l.center_name ? centerCounts[l.center_name] ?? 1 : 1;
                      const st = l.status || (l.is_active ? "active" : "deactivated");
                      return (
                        <TableRow key={l.id} className={`hover:bg-muted/40 transition-colors ${st === "deactivated" ? "opacity-60" : ""}`}>
                          <TableCell className="font-mono text-xs font-bold text-[#056FEC]">{l.lab_code ?? "—"}</TableCell>
                          <TableCell className="max-w-[190px]">
                            <div
                              className="truncate font-semibold cursor-pointer hover:text-[#056FEC] hover:underline"
                              dir="auto"
                              onClick={() => {
                                setSelectedLab(l);
                                setQuickViewOpen(true);
                              }}
                            >
                              {fixMojibake(l.name)}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[170px]">
                            <div className="truncate text-sm" dir="auto">{l.center_name ? fixMojibake(l.center_name) : "—"}</div>
                            {shared > 1 && <span className="text-[10px] text-[#056FEC] font-semibold">{shared} labs here</span>}
                          </TableCell>
                          <TableCell className="text-sm" dir="auto">{l.gov ? fixMojibake(l.gov) : "—"}</TableCell>
                          <TableCell className="text-sm" dir="auto">{l.area ? fixMojibake(l.area) : "—"}</TableCell>
                          <TableCell className="text-sm" dir="auto">{l.vendor_name ? fixMojibake(l.vendor_name) : "—"}</TableCell>
                          <TableCell className="text-right font-semibold">{l.capacity}</TableCell>
                          <TableCell className="text-right font-mono font-bold text-[#056FEC]">{formatEGP(l.session_price)}</TableCell>
                          <TableCell>{qy ? <QualityBadge score={Number(qy.quality_score)} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-center">
                            {st === "active" && <Badge variant="outline" className="bg-[#056FEC]/10 text-[#056FEC] border-[#056FEC]/20 text-[11px] font-semibold">Active</Badge>}
                            {st === "suspended" && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[11px] font-semibold">Suspended</Badge>}
                            {st === "deactivated" && <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-500/20 text-[11px] font-semibold">Deactivated</Badge>}
                            {st === "replaced" && <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-[11px] font-semibold">Replaced</Badge>}
                          </TableCell>
                          <TableCell>
                            {l.validation_status === "issues"
                              ? <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">Issues</Badge>
                              : <Badge variant="secondary">OK</Badge>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => canEdit && openVerify(l)} title="Verify map location" className="inline-flex"><PinBadge state={l.maps_verified} /></button>
                              {(() => {
                                const anomaly = detectLabLocationAnomaly(l);
                                if (!anomaly) return null;
                                return (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 text-[10px] py-0 cursor-pointer"
                                    title={`${anomaly.title}: ${anomaly.description}`}
                                    onClick={() => canEdit && openVerify(l)}
                                  >
                                    ⚠️ {anomaly.title}
                                  </Badge>
                                );
                              })()}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Quick Details"
                                onClick={() => {
                                  setSelectedLab(l);
                                  setQuickViewOpen(true);
                                }}
                              >
                                <Eye className="h-4 w-4 text-muted-foreground hover:text-[#056FEC]" />
                              </Button>
                              {canEdit && (
                                <>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    title="Change Status & Replace Lab"
                                    onClick={() => {
                                      setReplaceTargetLab(l);
                                      setNewLabStatus(l.status || "active");
                                      setReplacementLabId(l.replaced_by_lab_id || "");
                                      setDeactivationReason(l.deactivation_reason || "");
                                      setReplaceModalOpen(true);
                                    }}
                                  >
                                    <RefreshCw className="h-4 w-4 text-[#FF7F1C]" />
                                  </Button>
                                  <Button size="icon" variant="ghost" title="Quality" onClick={() => openQuality(l)}><Star className="h-4 w-4" /></Button>
                                  <Button size="icon" variant="ghost" title="Edit" onClick={() => openEdit(l)}><Pencil className="h-4 w-4" /></Button>
                                  {isAdmin && <Button size="icon" variant="ghost" title="Delete" onClick={() => removeLab(l.id)}><Trash2 className="h-4 w-4" /></Button>}
                                </>
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

            {/* Pagination Controls Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t bg-card text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>Rows per page:</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-20 text-xs rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
                <span className="ml-2 font-medium text-foreground">
                  Showing {filtered.length === 0 ? 0 : startIndex + 1}–{Math.min(endIndex, filtered.length)} of {filtered.length} labs
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                  title="First Page"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  title="Previous Page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-3 font-semibold text-xs">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  title="Next Page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-xl"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                  title="Last Page"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* VIEW MODE 3: FULL MAP VIEW */}
      {viewMode === "map" && (
        <div className="space-y-4">
          <EgyptLabCoverageMap
            labs={filtered}
            selectedGov={gov}
            onSelectGov={(selectedGovName) => {
              setGov(selectedGovName);
              setArea("all");
            }}
            selectedLabId={selectedLab?.id}
            onSelectLab={(l) => {
              setSelectedLab(l);
              setQuickViewOpen(true);
            }}
          />
        </div>
      )}

      {/* Lab Quick Details Slide-Over Drawer */}
      <Sheet open={quickViewOpen} onOpenChange={setQuickViewOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-6 overflow-y-auto space-y-5">
          {selectedLab ? (
            <>
              <SheetHeader className="space-y-2 pb-3 border-b">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-[#056FEC] bg-[#056FEC]/10 px-2 py-0.5 rounded-lg border border-[#056FEC]/25">
                    {selectedLab.lab_code || "—"}
                  </span>
                  <Badge variant="outline" className="text-[10px] uppercase font-bold text-[#056FEC] border-[#056FEC]/30">
                    {selectedLab.status || (selectedLab.is_active ? "Active" : "Deactivated")}
                  </Badge>
                  {detectLabLocationAnomaly(selectedLab) && (
                    <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700 text-[10px] py-0 font-bold">
                      ⚠️ Anomaly Detected
                    </Badge>
                  )}
                </div>
                <SheetTitle className="text-xl font-bold text-foreground" dir="auto">
                  {fixMojibake(selectedLab.name)}
                </SheetTitle>
                <SheetDescription className="text-xs flex items-center gap-1.5" dir="auto">
                  <MapPin className="h-3.5 w-3.5 text-[#056FEC] shrink-0" />
                  <span>{fixMojibake(selectedLab.gov || "—")}</span>
                  <span>•</span>
                  <span>{fixMojibake(selectedLab.area || "Main Area")}</span>
                  {selectedLab.center_name && (
                    <span className="text-muted-foreground">({fixMojibake(selectedLab.center_name)})</span>
                  )}
                </SheetDescription>
              </SheetHeader>

              {/* Quick Specs 3-card grid */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl bg-muted/50 border text-center space-y-0.5">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase">Capacity</div>
                  <div className="text-lg font-black text-foreground">{selectedLab.capacity || 0}</div>
                  <div className="text-[10px] text-muted-foreground">Workstations</div>
                </div>
                <div className="p-3 rounded-xl bg-muted/50 border text-center space-y-0.5">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase">Price</div>
                  <div className="text-sm font-bold text-[#056FEC] dark:text-[#05ACFF]">{formatEGP(selectedLab.session_price)}</div>
                  <div className="text-[10px] text-muted-foreground">Per session</div>
                </div>
                <div className="p-3 rounded-xl bg-muted/50 border text-center space-y-0.5">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase">Quality</div>
                  <div className="text-lg font-black text-[#FF7F1C]">
                    {quality[selectedLab.id]?.quality_score ? Number(quality[selectedLab.id].quality_score).toFixed(0) : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Audit Score</div>
                </div>
              </div>

              {/* Usage History & Quality Timeline Section */}
              <div className="p-4 rounded-xl border bg-card space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-[#056FEC]" />
                    <span className="font-bold text-sm text-foreground">Usage History &amp; Quality Timeline</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-mono font-semibold">
                    {usageHistory.length} Session{usageHistory.length !== 1 ? "s" : ""}
                  </Badge>
                </div>

                {/* Primary Quality Metric: Technical Audit Score */}
                <div className="p-3.5 rounded-xl border bg-muted/40 space-y-2">
                  <div className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[#FF7F1C]">
                      <Sparkles className="h-4 w-4" /> Technical Audit Score
                    </span>
                    {quality[selectedLab.id]?.assessed_at && (
                      <span className="text-[11px] text-muted-foreground font-normal font-mono">
                        Audited {new Date(quality[selectedLab.id].assessed_at!).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between">
                    <div className="text-2xl font-black text-[#FF7F1C]">
                      {quality[selectedLab.id]?.quality_score != null ? (
                        <span>{Number(quality[selectedLab.id].quality_score).toFixed(0)} <span className="text-sm font-normal text-muted-foreground">/ 100</span></span>
                      ) : (
                        <span className="text-muted-foreground text-sm font-normal">Unassessed</span>
                      )}
                    </div>
                    {quality[selectedLab.id]?.quality_score != null && (
                      <Badge variant="outline" className="text-xs font-mono font-semibold border-[#FF7F1C]/40 bg-[#FF7F1C]/10 text-[#FF7F1C]">
                        Active Rating
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Facility hardware, internet reliability, cleanliness, AC &amp; room specs.
                  </div>
                </div>

                {/* Past Bookings Timeline Table */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[#056FEC]" /> Past Bookings &amp; Cohorts
                  </div>

                  {loadingHistory ? (
                    <div className="py-6 text-center text-xs text-muted-foreground animate-pulse">
                      Loading lab booking history...
                    </div>
                  ) : usageHistory.length === 0 ? (
                    <div className="p-4 text-center rounded-lg border bg-muted/20 text-xs text-muted-foreground">
                      No past batch bookings or sessions recorded for this facility yet.
                    </div>
                  ) : (
                    <div className="rounded-lg border overflow-hidden max-h-64 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-muted/50 sticky top-0">
                          <TableRow>
                            <TableHead className="text-[11px] font-semibold py-1.5 px-2.5">Date</TableHead>
                            <TableHead className="text-[11px] font-semibold py-1.5 px-2">Project &amp; Batch</TableHead>
                            <TableHead className="text-[11px] font-semibold py-1.5 px-2">Time Slot</TableHead>
                            <TableHead className="text-[11px] font-semibold py-1.5 px-2">Assigned Group</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {usageHistory.map((item) => (
                            <TableRow key={item.id} className="hover:bg-muted/30">
                              <TableCell className="text-[11px] font-mono font-medium py-2 px-2.5 whitespace-nowrap">
                                {item.session_date || "—"}
                              </TableCell>
                              <TableCell className="text-[11px] py-2 px-2">
                                <div className="font-semibold text-foreground truncate max-w-[120px]" title={item.project_name}>
                                  {item.project_name}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={item.batch_name}>
                                  {item.batch_name}
                                </div>
                              </TableCell>
                              <TableCell className="text-[11px] font-mono py-2 px-2 whitespace-nowrap text-muted-foreground">
                                {item.session_time}
                              </TableCell>
                              <TableCell className="text-[11px] font-mono font-semibold py-2 px-2 whitespace-nowrap text-[#056FEC] dark:text-[#05ACFF]">
                                {item.session_group_id || "Standard Cohort"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Technical Quality Audit History & Audit Trail Section */}
                <div className="space-y-2 pt-3 border-t">
                  <div className="text-xs font-semibold text-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-[#FF7F1C]" /> Technical Audit History &amp; Ratings
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {quality[selectedLab.id]?.quality_score != null ? "Assessed" : "Unassessed"}
                    </Badge>
                  </div>

                  {quality[selectedLab.id]?.quality_score == null ? (
                    <div className="space-y-2">
                      <div className="p-3 text-center rounded-lg border bg-muted/20 text-xs text-muted-foreground">
                        No technical quality assessment recorded yet. Click "Run Quality Assessment" above to audit this lab.
                      </div>
                      {labIncidents.length > 0 && (
                        <div className="flex items-center justify-between p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs">
                          <span className="text-muted-foreground text-[11px]">Facility Incident Log</span>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-semibold gap-1 border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 shrink-0"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {labIncidents.length} incident{labIncidents.length !== 1 ? "s" : ""} reported
                          </Badge>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {/* Summary Banner for Current Technical Audit Score */}
                      {(() => {
                        const currentScore = Number(quality[selectedLab.id].quality_score).toFixed(0);
                        const hist: AuditHistoryEntry[] = extractScoreHistory(quality[selectedLab.id]);
                        const totalAudits = 1 + hist.length;

                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-[#FF7F1C]/10 border border-[#FF7F1C]/25 text-xs">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 font-bold text-[#FF7F1C]">
                                <Sparkles className="h-3.5 w-3.5" />
                                <span>Quality Score: {currentScore} / 100</span>
                              </div>
                              <span className="text-muted-foreground text-[11px]">
                                ({totalAudits} audit{totalAudits !== 1 ? "s" : ""} on record)
                              </span>
                            </div>

                            {labIncidents.length > 0 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-semibold gap-1 border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 shrink-0"
                              >
                                <AlertTriangle className="h-3 w-3" />
                                {labIncidents.length} incident{labIncidents.length !== 1 ? "s" : ""} reported
                              </Badge>
                            )}
                          </div>
                        );
                      })()}

                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {/* Current Assessment Card */}
                        <div className="p-2.5 rounded-lg border bg-muted/30 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold text-foreground flex items-center gap-1.5">
                              <span>Latest Technical Audit</span>
                              <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                                Current
                              </Badge>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-black text-[#FF7F1C] font-mono text-sm">
                                {Number(quality[selectedLab.id].quality_score).toFixed(0)} / 100
                              </span>
                              <span className="text-[10px] text-muted-foreground block">
                                {quality[selectedLab.id].assessed_at ? new Date(quality[selectedLab.id].assessed_at!).toLocaleDateString() : "Active"}
                              </span>
                            </div>
                          </div>

                          {/* Specification Badges */}
                          <div className="flex flex-wrap gap-1 text-[10px]">
                            {quality[selectedLab.id].pc_count != null && (
                              <span className="px-1.5 py-0.5 rounded bg-background border font-mono">
                                PCs: {quality[selectedLab.id].pc_count}
                              </span>
                            )}
                            {quality[selectedLab.id].internet_speed_mbps != null && (
                              <span className="px-1.5 py-0.5 rounded bg-background border font-mono">
                                Net: {quality[selectedLab.id].internet_speed_mbps} Mbps
                              </span>
                            )}
                            {quality[selectedLab.id].ac && (
                              <span className="px-1.5 py-0.5 rounded bg-background border font-mono capitalize">
                                AC: {quality[selectedLab.id].ac}
                              </span>
                            )}
                            {quality[selectedLab.id].cleanliness != null && (
                              <span className="px-1.5 py-0.5 rounded bg-background border font-mono">
                                Clean: {quality[selectedLab.id].cleanliness}/5
                              </span>
                            )}
                          </div>

                          {getCleanNotes(quality[selectedLab.id].notes) && (
                            <p className="text-[11px] text-muted-foreground italic bg-background/60 p-1.5 rounded border">
                              "{getCleanNotes(quality[selectedLab.id].notes)}"
                            </p>
                          )}
                        </div>

                        {/* Prior Historical Audits */}
                        {(() => {
                          const hist: AuditHistoryEntry[] = extractScoreHistory(quality[selectedLab.id]);
                          if (!hist || hist.length === 0) return null;

                          return [...hist].reverse().map((entry, idx) => (
                            <div key={idx} className="p-2.5 rounded-lg border bg-muted/20 space-y-1 text-xs opacity-90">
                              <div className="flex items-center justify-between">
                                <div className="font-semibold text-muted-foreground">
                                  Prior Audit #{hist.length - idx}
                                </div>
                                <div className="text-right shrink-0">
                                  <span className="font-bold text-foreground font-mono">
                                    {Number(entry.score).toFixed(0)} / 100
                                  </span>
                                  <span className="text-[10px] text-muted-foreground block">
                                    {entry.assessed_at ? new Date(entry.assessed_at).toLocaleDateString() : "Archived"}
                                  </span>
                                </div>
                              </div>
                              {entry.notes && (
                                <p className="text-[10px] text-muted-foreground italic bg-background/40 p-1 rounded border">
                                  "{entry.notes}"
                                </p>
                              )}
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Location & Map Pin Verification */}
              <div className="p-3.5 rounded-xl border bg-card space-y-2 text-xs">
                <div className="font-bold text-foreground flex items-center justify-between">
                  <span>Location Details</span>
                  <PinBadge state={selectedLab.maps_verified} />
                </div>
                {selectedLab.address && (
                  <p className="text-muted-foreground" dir="auto">
                    {fixMojibake(selectedLab.address)}
                  </p>
                )}
                {selectedLab.vendor_name && (
                  <div className="text-muted-foreground">
                    Vendor: <strong className="text-foreground">{fixMojibake(selectedLab.vendor_name)}</strong>
                  </div>
                )}
                {selectedLab.maps_url ? (
                  <Button size="sm" variant="outline" asChild className="w-full text-xs h-8 gap-1.5 rounded-xl mt-1 border-[#056FEC]/40 text-[#056FEC]">
                    <a href={selectedLab.maps_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" /> Open in Google Maps
                    </a>
                  </Button>
                ) : (
                  <div className="text-rose-600 text-[11px]">No Google Maps URL configured.</div>
                )}
              </div>

              {/* Technical Specifications Breakdown (if audited) */}
              {quality[selectedLab.id] && (
                <div className="p-3.5 rounded-xl border bg-card space-y-2.5 text-xs">
                  <div className="font-bold text-foreground">Facility Specifications</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>PC Count: <strong>{(quality[selectedLab.id] as any)?.pc_count || selectedLab.capacity}</strong></div>
                    <div>Internet: <strong>{(quality[selectedLab.id] as any)?.internet_speed_mbps || "—"} Mbps</strong></div>
                    <div>AC: <strong className="capitalize">{(quality[selectedLab.id] as any)?.ac || "—"}</strong></div>
                    <div>Bathrooms: <strong className="capitalize">{(quality[selectedLab.id] as any)?.bathroom_type || "—"}</strong></div>
                    <div>Projector: <strong>{(quality[selectedLab.id] as any)?.projector ? "Yes" : "No"}</strong></div>
                    <div>Instructor PC: <strong>{(quality[selectedLab.id] as any)?.has_instructor_pc ? "Yes" : "No"}</strong></div>
                  </div>
                </div>
              )}

              {/* Quick Action Buttons */}
              <div className="space-y-2 pt-2 border-t">
                {canEdit && (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        setQuickViewOpen(false);
                        openEdit(selectedLab);
                      }}
                      className="w-full h-9 bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold rounded-xl text-xs"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit Lab Information
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setQuickViewOpen(false);
                        openQuality(selectedLab);
                      }}
                      className="w-full h-9 bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white font-bold rounded-xl text-xs"
                    >
                      <Star className="h-3.5 w-3.5 mr-1.5" /> Run Quality Assessment
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuickViewOpen(false);
                        setReplaceTargetLab(selectedLab);
                        setNewLabStatus(selectedLab.status || "active");
                        setReplacementLabId(selectedLab.replaced_by_lab_id || "");
                        setDeactivationReason(selectedLab.deactivation_reason || "");
                        setReplaceModalOpen(true);
                      }}
                      className="w-full h-9 rounded-xl text-xs font-semibold"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-[#FF7F1C]" /> Change Status / Replace Lab
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Select a facility to view complete details.
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={sessionImportOpen}
        onOpenChange={(open) => {
          setSessionImportOpen(open);
          if (!open) resetSessionImportState();
        }}
      >
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Sessions</DialogTitle>
            <DialogDescription>
              Preview batch schedule rows from CSV or Excel, validate them against the selected batch, then import only the valid rows.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Project</Label>
              <Select value={sessionImportProjectId} onValueChange={setSessionImportProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name} ({project.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Batch</Label>
              <Select value={sessionImportBatchId} onValueChange={setSessionImportBatchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select batch" />
                </SelectTrigger>
                <SelectContent>
                  {sessionImportBatches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Import mode</Label>
              <Select value={sessionImportMode} onValueChange={(value) => setSessionImportMode(value as "merge" | "replace")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">Merge only new sessions</SelectItem>
                  <SelectItem value="replace">Replace schedules for labs in file</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-xs">
            <div className="space-y-1">
              <div className="font-semibold text-foreground">
                {selectedSessionImportBatch?.name ?? "No batch selected"}
              </div>
              <div className="text-muted-foreground">
                Dates: {(selectedSessionImportBatch?.dates ?? []).join(", ") || "No batch dates"}
              </div>
              <div className="text-muted-foreground">
                Expected sessions/group: {selectedSessionImportBatch?.expected_sessions_per_group ?? "Validation disabled"}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => sessionFileRef.current?.click()}
                disabled={!selectedSessionImportBatch || sessionPreviewing}
              >
                <Upload className="mr-1 h-4 w-4" />
                {sessionPreviewing ? "Building preview..." : sessionImportFileName ? "Choose another file" : "Choose file"}
              </Button>
              {sessionImportPreview && (
                <Button type="button" variant="outline" size="sm" onClick={downloadSessionImportIssues}>
                  <Download className="mr-1 h-4 w-4" /> Export issues
                </Button>
              )}
            </div>
          </div>

          {sessionImportPreview ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Preview rows</div>
                    <div className="mt-1 text-2xl font-bold">{sessionPreviewRows.length}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Valid</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-600">{sessionPreviewValidCount}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Warnings</div>
                    <div className="mt-1 text-2xl font-bold text-amber-600">{sessionPreviewWarningCount}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Errors</div>
                    <div className="mt-1 text-2xl font-bold text-rose-600">{sessionPreviewErrorCount}</div>
                  </CardContent>
                </Card>
              </div>

              <div className="rounded-md border">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File row</TableHead>
                        <TableHead>Lab ID</TableHead>
                        <TableHead>Matched lab</TableHead>
                        <TableHead className="text-right">Scheduled days</TableHead>
                        <TableHead>Sessions by date</TableHead>
                        <TableHead className="text-right">Total sessions</TableHead>
                        <TableHead className="text-right">Current price</TableHead>
                        <TableHead className="text-right">New price</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessionPreviewRows.map((row) => (
                        <TableRow key={`${row.rowNumber}-${row.normalizedLabCode || "blank"}`}>
                          <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{row.labCode || "—"}</TableCell>
                          <TableCell>
                            <div className="font-medium">{row.matchedLabName || "—"}</div>
                            {row.issues.length > 0 && (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {row.issues.map((issue) => `${issue.level.toUpperCase()}: ${issue.message}`).join(" | ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">{row.scheduledDays}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.sessionsByDate.length
                              ? row.sessionsByDate.map((item) => `${item.date}: ${item.sessions}`).join(" | ")
                              : "No sessions"}
                          </TableCell>
                          <TableCell className="text-right font-mono">{row.totalSessions}</TableCell>
                          <TableCell className="text-right font-mono">{formatEGP(row.currentCalculatedPrice)}</TableCell>
                          <TableCell className="text-right font-mono">{formatEGP(row.newCalculatedPrice)}</TableCell>
                          <TableCell>
                            {row.status === "Valid" && <Badge className="bg-emerald-600 text-white">Valid</Badge>}
                            {row.status === "Warning" && (
                              <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
                                Warning
                              </Badge>
                            )}
                            {row.status === "Error" && <Badge variant="destructive">Error</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Choose a batch and file to build the preview. No database writes happen until you confirm the valid rows.
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSessionImportOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void importValidSessionRows()}
              disabled={!sessionImportPreview || !sessionImportPreview.validRows.length || sessionImporting}
            >
              {sessionImporting ? "Importing..." : "Import valid rows only"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import column-matching dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Match columns</DialogTitle>
            <DialogDescription>
              {importRows.length} rows detected. Confirm which sheet column feeds each field, then import. Only master
              columns are imported — Domty, Water, and sessions are handled in the Project tab.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-2 items-center gap-2">
                <Label className="text-xs">
                  {f.label}{f.required && <span className="text-red-500"> *</span>}
                </Label>
                <Select value={mapping[f.key] ?? NONE} onValueChange={(v) => setMapping({ ...mapping, [f.key]: v })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— none —</SelectItem>
                    {importHeaders.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {/* Preview */}
          <div className="rounded-md border">
            <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">Preview (first 3 rows)</div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Code</TableHead>
                    <TableHead className="text-xs">Name</TableHead>
                    <TableHead className="text-xs">Gov</TableHead>
                    <TableHead className="text-xs">Area</TableHead>
                    <TableHead className="text-xs">Vendor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importRows.slice(0, 3).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{mappedValue(r, "lab_code") || "—"}</TableCell>
                      <TableCell className="text-xs" dir="auto">{mappedValue(r, "name") || "—"}</TableCell>
                      <TableCell className="text-xs" dir="auto">{mappedValue(r, "gov") || "—"}</TableCell>
                      <TableCell className="text-xs" dir="auto">{mappedValue(r, "area") || "—"}</TableCell>
                      <TableCell className="text-xs">{mappedValue(r, "vendor_name") || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={runImport} disabled={importing}>{importing ? "Importing…" : `Import ${importRows.length} rows`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lab create/edit dialog */}
      <Dialog open={labOpen} onOpenChange={setLabOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit lab" : "New lab"}</DialogTitle>
            <DialogDescription>All prices are in EGP.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lab code"><Input value={labForm.lab_code} onChange={(e) => setLabForm({ ...labForm, lab_code: e.target.value })} /></Field>
              <Field label="Lab name *"><Input value={labForm.name} onChange={(e) => setLabForm({ ...labForm, name: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Governorate"><Input value={labForm.gov} onChange={(e) => setLabForm({ ...labForm, gov: e.target.value })} /></Field>
              <Field label="Area"><Input value={labForm.area} onChange={(e) => setLabForm({ ...labForm, area: e.target.value })} /></Field>
            </div>
            <Field label="Center name"><Input value={labForm.center_name} onChange={(e) => setLabForm({ ...labForm, center_name: e.target.value })} /></Field>
            <Field label="Address"><Input value={labForm.address} onChange={(e) => setLabForm({ ...labForm, address: e.target.value })} /></Field>
            <Field label="Google Maps link"><Input value={labForm.maps_url} onChange={(e) => setLabForm({ ...labForm, maps_url: e.target.value })} placeholder="https://maps.app.goo.gl/…" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Vendor"><Input value={labForm.vendor_name} onChange={(e) => setLabForm({ ...labForm, vendor_name: e.target.value })} /></Field>
              <Field label="Capacity (seats)"><Input type="number" value={labForm.capacity} onChange={(e) => setLabForm({ ...labForm, capacity: Number(e.target.value) })} /></Field>
              <Field label="Session price (EGP)"><Input type="number" step="0.01" value={labForm.session_price} onChange={(e) => setLabForm({ ...labForm, session_price: Number(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supervisor name"><Input value={labForm.supervisor_name} onChange={(e) => setLabForm({ ...labForm, supervisor_name: e.target.value })} /></Field>
              <Field label="Supervisor phone"><Input value={labForm.supervisor_phone} onChange={(e) => setLabForm({ ...labForm, supervisor_phone: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Facilitator name"><Input value={labForm.facilitator_name} onChange={(e) => setLabForm({ ...labForm, facilitator_name: e.target.value })} /></Field>
              <Field label="Facilitator phone"><Input value={labForm.facilitator_phone} onChange={(e) => setLabForm({ ...labForm, facilitator_phone: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><Textarea value={labForm.notes} onChange={(e) => setLabForm({ ...labForm, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabOpen(false)}>Cancel</Button>
            <Button onClick={saveLab}>{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quality dialog */}
      <Dialog open={qOpen} onOpenChange={setQOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
              Comprehensive Quality Assessment
            </DialogTitle>
            <DialogDescription dir="auto">
              {qLab?.name} — {qLab?.gov} ({qLab?.area})
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
            {/* Top Score Banner */}
            <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-[#056FEC]/10 via-[#05ACFF]/10 to-[#056FEC]/5 border border-[#056FEC]/20 p-4 shadow-xs">
              <div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-[#056FEC] text-white font-semibold shadow-xs">Quality Index</Badge>
                  <span className="text-xs text-muted-foreground font-medium">Weighted Quality Rating</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Calculated from workstations, AC, connectivity, facilities & safety</div>
              </div>
              <div className="text-right">
                <span className="text-3xl font-black text-[#056FEC] dark:text-[#05ACFF]">{liveScore.toFixed(0)}</span>
                <span className="text-sm font-semibold text-[#056FEC]/80 dark:text-[#05ACFF]/80"> / 100</span>
              </div>
            </div>

            {/* Card 1: Workstations, Capacity & Size */}
            <div className="rounded-lg border bg-card p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#056FEC] dark:text-[#05ACFF] flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-[#056FEC]" />
                  1. Seated Capacity, PCs & Lab Size
                </span>
                <Badge variant="outline" className="text-[10px]">Hardware & Space</Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Seated Capacity (Seats)">
                  <Input
                    type="number"
                    min={0}
                    value={qForm.seated_capacity}
                    onChange={(e) => {
                      const seats = Number(e.target.value);
                      setQForm({
                        ...qForm,
                        seated_capacity: seats,
                        lab_size: deriveLabSize(seats, Number(qForm.pc_count) || 0),
                      });
                    }}
                  />
                </Field>

                <Field label="Number of PCs">
                  <Input type="number" min={0} value={qForm.pc_count} onChange={(e) => setQForm({ ...qForm, pc_count: Number(e.target.value) })} />
                </Field>

                <Field label="Lab Size">
                  <Select value={qForm.lab_size} onValueChange={(v) => setQForm({ ...qForm, lab_size: v as LabSize })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Small (&lt;15 seats)</SelectItem>
                      <SelectItem value="medium">Medium (15–25 seats)</SelectItem>
                      <SelectItem value="large">Large (&gt;25 seats)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <RatingField label="PC Spec & Quality" value={qForm.pc_quality} onChange={(v) => setQForm({ ...qForm, pc_quality: v })} />
              </div>
            </div>

            {/* Card 2: Climate, Connectivity & Floor Level */}
            <div className="rounded-lg border bg-card p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <Upload className="h-4 w-4 text-blue-600" />
                  2. Climate, Internet & Access
                </span>
                <Badge variant="outline" className="text-[10px]">Cooling & Speed</Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="AC Status">
                  <Select value={qForm.ac} onValueChange={(v) => setQForm({ ...qForm, ac: v as AcQuality })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes (Full AC)</SelectItem>
                      <SelectItem value="partial">Partial AC</SelectItem>
                      <SelectItem value="no">No AC</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="AC Units Count">
                  <Input type="number" min={0} value={qForm.ac_count} onChange={(e) => setQForm({ ...qForm, ac_count: Number(e.target.value) })} />
                </Field>
                <RatingField label="Internet Quality" value={qForm.internet_quality} onChange={(v) => setQForm({ ...qForm, internet_quality: v })} />
                <Field label="Speed (Mbps)">
                  <Input type="number" min={0} value={qForm.internet_speed_mbps} onChange={(e) => setQForm({ ...qForm, internet_speed_mbps: Number(e.target.value) })} />
                </Field>
              </div>

              {/* Floor Number & Elevator */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t">
                <Field label="Floor Level">
                  <Select value={String(qForm.floor_number)} onValueChange={(v) => setQForm({ ...qForm, floor_number: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Ground Floor (0)</SelectItem>
                      <SelectItem value="1">1st Floor</SelectItem>
                      <SelectItem value="2">2nd Floor</SelectItem>
                      <SelectItem value="3">3rd Floor</SelectItem>
                      <SelectItem value="4">4th Floor or Higher</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <ToggleField label="Elevator Available" value={qForm.has_elevator} onChange={(v) => setQForm({ ...qForm, has_elevator: v })} />
              </div>
            </div>

            {/* Card 3: Restrooms & Parent Waiting Area */}
            <div className="rounded-lg border bg-card p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-cyan-600" />
                  3. Restrooms & Parent Waiting Area
                </span>
                <Badge variant="outline" className="text-[10px]">Amenities & Comfort</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Bathroom Type">
                  <Select value={qForm.bathroom_type} onValueChange={(v) => {
                    const bt = v as BathroomType;
                    const bBoys = bt === "separate" || bt === "mixed" || bt === "boys_only";
                    const bGirls = bt === "separate" || bt === "mixed" || bt === "girls_only";
                    setQForm({ ...qForm, bathroom_type: bt, bathroom_boys: bBoys, bathroom_girls: bGirls });
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="separate">Separate (Boys & Girls)</SelectItem>
                      <SelectItem value="mixed">Mixed Bathroom</SelectItem>
                      <SelectItem value="boys_only">Boys Only</SelectItem>
                      <SelectItem value="girls_only">Girls Only</SelectItem>
                      <SelectItem value="none">No Bathroom</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <ToggleField label="Boys Restroom" value={qForm.bathroom_boys} onChange={(v) => setQForm({ ...qForm, bathroom_boys: v })} />
                <ToggleField label="Girls Restroom" value={qForm.bathroom_girls} onChange={(v) => setQForm({ ...qForm, bathroom_girls: v })} />
              </div>

              <div className="pt-1 border-t">
                <ToggleField label="Parent Waiting Area Available" value={qForm.parent_waiting_area} onChange={(v) => setQForm({ ...qForm, parent_waiting_area: v })} />
              </div>
            </div>

            {/* Card 4: Display, Printing & Onsite Equipment */}
            <div className="rounded-lg border bg-card p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  4. Display Screens, Printing & Security
                </span>
                <Badge variant="outline" className="text-[10px]">Equipment & Safety</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <RatingField label="Chairs Comfort" value={qForm.chairs_quality} onChange={(v) => setQForm({ ...qForm, chairs_quality: v })} />
                <RatingField label="Hygiene & Cleanliness" value={qForm.cleanliness} onChange={(v) => setQForm({ ...qForm, cleanliness: v })} />
                <RatingField label="Street View / Access" value={qForm.street_view} onChange={(v) => setQForm({ ...qForm, street_view: v })} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t">
                <ToggleField label="Projector / Screen Display" value={qForm.projector} onChange={(v) => setQForm({ ...qForm, projector: v })} />
                <ToggleField label="PC Connected to Screen" value={qForm.has_instructor_pc} onChange={(v) => setQForm({ ...qForm, has_instructor_pc: v })} />
                <ToggleField label="Printer Available" value={qForm.has_printer} onChange={(v) => setQForm({ ...qForm, has_printer: v })} />
              </div>

              <div className="pt-1 border-t">
                <ToggleField label="Security Guard & Onsite Cameras" value={qForm.security} onChange={(v) => setQForm({ ...qForm, security: v })} />
              </div>
            </div>

            {/* Card 5: Video Link & Lab Inspection Photo Gallery (Up to 5 Images) */}
            <div className="rounded-lg border bg-card p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                  <ExternalLink className="h-4 w-4 text-purple-600" />
                  5. Inspection Video & Photos (Up to 5 Images)
                </span>
                <Badge variant="outline" className="text-[10px]">Media Audit</Badge>
              </div>

              <div className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label="Lab Video Link (YouTube / Drive / MP4)">
                      <Input
                        value={qForm.video_url}
                        onChange={(e) => setQForm({ ...qForm, video_url: e.target.value })}
                        placeholder="https://youtube.com/watch?v=... or https://drive.google.com/..."
                      />
                    </Field>
                  </div>
                  {qForm.video_url.trim() && (
                    <a href={qForm.video_url} target="_blank" rel="noreferrer">
                      <Button variant="outline" size="sm" className="h-9 text-xs">
                        <ExternalLink className="mr-1 h-3.5 w-3.5" /> Watch Video
                      </Button>
                    </a>
                  )}
                </div>

                <Label className="text-xs font-medium block pt-2">Lab Photos URLs (up to 5 images)</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <Input
                      key={idx}
                      value={qForm.image_urls[idx] ?? ""}
                      onChange={(e) => {
                        const newImgs = [...qForm.image_urls];
                        newImgs[idx] = e.target.value;
                        setQForm({ ...qForm, image_urls: newImgs });
                      }}
                      placeholder={`Photo URL #${idx + 1} (https://...)`}
                      className="text-xs"
                    />
                  ))}
                </div>

                {/* Photo Thumbnail Gallery Preview */}
                {qForm.image_urls.some((u) => u.trim()) && (
                  <div className="pt-2">
                    <span className="text-[11px] text-muted-foreground font-medium block mb-1.5">Photo Gallery Preview</span>
                    <div className="grid grid-cols-5 gap-2">
                      {qForm.image_urls.map((url, idx) => {
                        const trimmed = url.trim();
                        if (!trimmed) return null;
                        return (
                          <div key={idx} className="relative aspect-video rounded border overflow-hidden bg-muted group">
                            <img
                              src={trimmed}
                              alt={`Lab photo ${idx + 1}`}
                              className="h-full w-full object-cover transition-transform group-hover:scale-105"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                            <a
                              href={trimmed}
                              target="_blank"
                              rel="noreferrer"
                              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] font-bold"
                            >
                              View
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card 6: Extra Activities & Audit Notes */}
            <div className="rounded-lg border bg-card p-3.5 space-y-3">
              <Field label="Extra Activities Space (activities count)">
                <Input type="number" min={0} value={qForm.extra_activities} onChange={(e) => setQForm({ ...qForm, extra_activities: Number(e.target.value) })} />
              </Field>
              <Field label="Inspector Notes & Observations">
                <Textarea value={qForm.notes} onChange={(e) => setQForm({ ...qForm, notes: e.target.value })} placeholder="Detailed audit notes, issues, or recommended upgrades..." className="min-h-[80px]" />
              </Field>
            </div>
          </div>

          <DialogFooter className="border-t pt-3">
            <Button variant="outline" onClick={() => setQOpen(false)}>Cancel</Button>
            <Button onClick={saveQuality} className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-xs">Save Quality Assessment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maps verification dialog */}
      <Dialog open={!!verifyLab} onOpenChange={(o) => !o && setVerifyLab(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Verify map location</DialogTitle>
            <DialogDescription>
              Open the pin and confirm it matches — right street, right center, inside the area, and the area inside the governorate.
            </DialogDescription>
          </DialogHeader>
          {verifyLab && (
            <div className="space-y-3">
              <dl className="grid grid-cols-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Governorate</dt><dd className="col-span-2 font-medium" dir="auto">{verifyLab.gov ?? "—"}</dd>
                <dt className="text-muted-foreground">Area</dt><dd className="col-span-2 font-medium" dir="auto">{verifyLab.area ?? "—"}</dd>
                <dt className="text-muted-foreground">Center</dt><dd className="col-span-2" dir="auto">{verifyLab.center_name ?? "—"}</dd>
                <dt className="text-muted-foreground">Address</dt><dd className="col-span-2" dir="auto">{verifyLab.address ?? "—"}</dd>
              </dl>
              {verifyLab.center_name && (centerCounts[verifyLab.center_name] ?? 1) > 1 && (
                <p className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">This center hosts {centerCounts[verifyLab.center_name]} labs — they should share this location.</p>
              )}
              {verifyLab.maps_url ? (
                <a href={verifyLab.maps_url} target="_blank" rel="noreferrer">
                  <Button variant="outline" className="w-full"><ExternalLink className="mr-1 h-4 w-4" /> Open Google Maps pin</Button>
                </a>
              ) : <p className="text-sm text-amber-600">No map link on this lab.</p>}
              <Field label="Verification note (optional)"><Textarea value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="e.g. pin is 200m off / correct" /></Field>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50 dark:text-red-300" onClick={() => saveVerification(false)}><AlertTriangle className="mr-1 h-4 w-4" /> Mismatch</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => saveVerification(true)}><CheckCircle2 className="mr-1 h-4 w-4" /> Verified</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV RE-IMPORT DIFF REVIEW DIALOG */}
      <Dialog open={diffReviewOpen} onOpenChange={setDiffReviewOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <RefreshCw className="h-5 w-5 text-primary" /> Review &amp; Compare Lab Data Updates
            </DialogTitle>
            <DialogDescription>
              {diffItems.length} lab(s) have modified field data in the imported sheet compared to the database.
              {newLabsToInsert.length > 0 && ` (${newLabsToInsert.length} new labs will also be added.)`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="text-xs">
                    <TableHead className="w-28">Lab ID</TableHead>
                    <TableHead>Lab Name</TableHead>
                    <TableHead>Field Changed</TableHead>
                    <TableHead className="text-rose-600 dark:text-rose-400">Current Database Value</TableHead>
                    <TableHead className="text-emerald-600 dark:text-emerald-400">Imported CSV Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diffItems.flatMap((item) =>
                    item.diffs.map((d, dIdx) => (
                      <TableRow key={`${item.lab_code}-${d.field}-${dIdx}`} className="text-xs">
                        <TableCell className="font-mono font-semibold text-primary">
                          {item.lab_code}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">
                          {item.existingLab.name}
                        </TableCell>
                        <TableCell className="font-semibold text-muted-foreground">
                          {d.label}
                        </TableCell>
                        <TableCell className="font-mono text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/30">
                          {String(d.oldValue)}
                        </TableCell>
                        <TableCell className="font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/30">
                          {String(d.newValue)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => setDiffReviewOpen(false)}>
              Cancel Import
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              disabled={submittingDiffs}
              onClick={() => submitDiffUpdates(true)}
            >
              <CheckCircle2 className="h-4 w-4" />
              {submittingDiffs ? "Saving Updates..." : "Submit All Updates"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LAB STATUS & REPLACEMENT MODAL */}
      <Dialog open={replaceModalOpen} onOpenChange={setReplaceModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <RefreshCw className="h-5 w-5 text-blue-600" /> Manage Lab Status &amp; Replacement
            </DialogTitle>
            <DialogDescription>
              {replaceTargetLab?.name} ({replaceTargetLab?.lab_code || "No ID"})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Select Lab Status</Label>
              <Select value={newLabStatus} onValueChange={setNewLabStatus}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="deactivated">Deactivated</SelectItem>
                  <SelectItem value="replaced">Replaced (Link to new lab)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newLabStatus === "replaced" && (
              <div className="space-y-1.5 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
                <Label className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Select Replacement Lab
                </Label>
                <Select value={replacementLabId} onValueChange={setReplacementLabId}>
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Choose replacing lab..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {labs
                      .filter((l) => l.id !== replaceTargetLab?.id && l.is_active)
                      .map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name} ({l.lab_code || "No ID"}) — {l.gov}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Deactivation / Replacement Reason</Label>
              <Textarea
                placeholder="Reason for suspension, deactivation, or replacement..."
                value={deactivationReason}
                onChange={(e) => setDeactivationReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReplaceModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={submittingReplace}
              onClick={handleSaveLabStatus}
            >
              {submittingReplace ? "Saving..." : "Save Status & Replacement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
function RatingField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}
function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      {label}<Switch checked={value} onCheckedChange={onChange} />
    </label>
  );
}
function QualityBadge({ score }: { score: number }) {
  const band = qualityBand(score);
  const cls = band === "high" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
    : band === "medium" ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
    : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{score.toFixed(0)}</span>;
}
function PinBadge({ state }: { state: boolean | null | undefined }) {
  if (state === true) return <MapPin className="h-4 w-4 text-emerald-600" />;
  if (state === false) return <MapPin className="h-4 w-4 text-red-600" />;
  return <MapPin className="h-4 w-4 text-muted-foreground/50" />;
}
function MiniStat({ label, value, tone = "muted", onClick }: { label: string; value: number; tone?: "ok" | "warn" | "muted"; onClick?: () => void }) {
  const toneCls = tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "";
  return (
    <button onClick={onClick} className="rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent" disabled={!onClick}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${toneCls}`}>{value}</div>
    </button>
  );
}
function FilterSelect({ value, onChange, allLabel, options, width = "w-48" }: { value: string; onChange: (v: string) => void; allLabel: string; options: string[]; width?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={width}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
