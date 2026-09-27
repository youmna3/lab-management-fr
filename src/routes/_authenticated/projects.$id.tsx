import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BatchTimeSlotPicker } from "@/components/BatchTimeSlotPicker";
import { BatchDayScheduleEditor } from "@/components/BatchDayScheduleEditor";
import { BatchBlockedDaysAndMegaGroups } from "@/components/BatchBlockedDaysAndMegaGroups";
import type { MegaGroupDefinition } from "@/lib/allocation-client";
import { SessionImportDialog } from "@/components/SessionImportDialog";
import { ProjectStudentRoster } from "@/components/ProjectStudentRoster";
import { AddNeedModal } from "@/components/AddNeedModal";
import * as XLSX from "xlsx";
import {
  fetchBatchAllocationOutput,
  getProjectUnassignedBatchId,
} from "@/lib/batch-allocation-storage";
import {
  calculateReplacementAvailability,
  deriveAllocationLabUsage,
  type AllocationLabUsage,
} from "@/lib/allocation-lab-needs";
import { saveBatchGroupSettings, fetchBatchGroupSettings } from "@/lib/batch-group-classification-storage";
import { assertMegaGroupDateRanges } from "@/lib/lab-allocation-runner/schedule";
import { formatLocalDateToIso, getCanonicalVisitCount } from "@/lib/project-timeline-template";
import { formatGradeLevel, type ProjectProgram } from "@/lib/project-grade-levels";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  DollarSign,
  Download,
  Filter,
  FileSpreadsheet,
  Grid,
  Layers,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserMinus,
  Users,
  X,
  XCircle,
} from "lucide-react";

import { cleanArabicString, normalizeArabic } from "@/lib/arabic";

const AREA_COORDS: Record<string, { lat: number; lng: number }> = {
  // Cairo
  "nasr city": { lat: 30.0561, lng: 31.3301 },
  "مدينة نصر": { lat: 30.0561, lng: 31.3301 },
  heliopolis: { lat: 30.0911, lng: 31.3236 },
  "مصر الجديدة": { lat: 30.0911, lng: 31.3236 },
  maadi: { lat: 29.9602, lng: 31.2569 },
  "المعادي": { lat: 29.9602, lng: 31.2569 },
  "new cairo": { lat: 30.0074, lng: 31.4913 },
  "القاهرة الجديدة": { lat: 30.0074, lng: 31.4913 },
  "5th settlement": { lat: 30.0074, lng: 31.4913 },
  "التجمع الخامس": { lat: 30.0074, lng: 31.4913 },
  "التجمع": { lat: 30.0074, lng: 31.4913 },
  downtown: { lat: 30.0444, lng: 31.2357 },
  "وسط البلد": { lat: 30.0444, lng: 31.2357 },
  shubra: { lat: 30.0833, lng: 31.25 },
  "شبرا": { lat: 30.0833, lng: 31.25 },
  cairo: { lat: 30.0444, lng: 31.2357 },
  "القاهرة": { lat: 30.0444, lng: 31.2357 },
  helwan: { lat: 29.8414, lng: 31.3008 },
  "حلوان": { lat: 29.8414, lng: 31.3008 },
  mokattam: { lat: 30.0194, lng: 31.2925 },
  "المقطم": { lat: 30.0194, lng: 31.2925 },
  "ain shams": { lat: 30.1306, lng: 31.3253 },
  "عين شمس": { lat: 30.1306, lng: 31.3253 },
  shorouk: { lat: 30.1264, lng: 31.6067 },
  "الشروق": { lat: 30.1264, lng: 31.6067 },
  badr: { lat: 30.1417, lng: 31.7378 },
  "بدر": { lat: 30.1417, lng: 31.7378 },
  rehab: { lat: 30.0594, lng: 31.4958 },
  "الرحاب": { lat: 30.0594, lng: 31.4958 },
  madinaty: { lat: 30.1089, lng: 31.6253 },
  "مدينتي": { lat: 30.1089, lng: 31.6253 },
  obour: { lat: 30.2289, lng: 31.4744 },
  "العبور": { lat: 30.2289, lng: 31.4744 },
  abbassia: { lat: 30.0683, lng: 31.2789 },
  "العباسية": { lat: 30.0683, lng: 31.2789 },
  marg: { lat: 30.1583, lng: 31.3361 },
  "المرج": { lat: 30.1583, lng: 31.3361 },
  mataria: { lat: 30.1228, lng: 31.3117 },
  "المطرية": { lat: 30.1228, lng: 31.3117 },
  zeitoun: { lat: 30.1039, lng: 31.3142 },
  "الزيتون": { lat: 30.1039, lng: 31.3142 },

  // Giza
  dokki: { lat: 30.0384, lng: 31.2118 },
  "الدقي": { lat: 30.0384, lng: 31.2118 },
  mohandessin: { lat: 30.0522, lng: 31.2001 },
  "المهندسين": { lat: 30.0522, lng: 31.2001 },
  haram: { lat: 29.9912, lng: 31.1578 },
  "الهرم": { lat: 29.9912, lng: 31.1578 },
  faisal: { lat: 29.998, lng: 31.162 },
  "فيصل": { lat: 29.998, lng: 31.162 },
  "6th of october": { lat: 29.9746, lng: 30.9575 },
  october: { lat: 29.9746, lng: 30.9575 },
  "6 أكتوبر": { lat: 29.9746, lng: 30.9575 },
  "أكتوبر": { lat: 29.9746, lng: 30.9575 },
  "السادس من أكتوبر": { lat: 29.9746, lng: 30.9575 },
  "sheikh zayed": { lat: 30.0469, lng: 30.9839 },
  zayed: { lat: 30.0469, lng: 30.9839 },
  "الشيخ زايد": { lat: 30.0469, lng: 30.9839 },
  "زايد": { lat: 30.0469, lng: 30.9839 },
  giza: { lat: 29.987, lng: 31.2118 },
  "الجيزة": { lat: 29.987, lng: 31.2118 },
  imbaba: { lat: 30.0767, lng: 31.2094 },
  "إمبابة": { lat: 30.0767, lng: 31.2094 },
  agouza: { lat: 30.0567, lng: 31.2167 },
  "العجوزة": { lat: 30.0567, lng: 31.2167 },
  omraneya: { lat: 29.9939, lng: 31.1969 },
  "العمرانية": { lat: 29.9939, lng: 31.1969 },
  "hadayek el ahram": { lat: 29.9819, lng: 31.1122 },
  "حدائق الأهرام": { lat: 29.9819, lng: 31.1122 },
  warraq: { lat: 30.1167, lng: 31.2167 },
  "الوراق": { lat: 30.1167, lng: 31.2167 },

  // Alexandria
  alexandria: { lat: 31.2001, lng: 29.9187 },
  "الإسكندرية": { lat: 31.2001, lng: 29.9187 },
  "الاسكندرية": { lat: 31.2001, lng: 29.9187 },
  smouha: { lat: 31.2156, lng: 29.9553 },
  "سموحة": { lat: 31.2156, lng: 29.9553 },
  miami: { lat: 31.2678, lng: 30.0028 },
  "ميامي": { lat: 31.2678, lng: 30.0028 },
  gleem: { lat: 31.2411, lng: 29.9667 },
  "جليم": { lat: 31.2411, lng: 29.9667 },
  "sidi beshr": { lat: 31.2581, lng: 29.9897 },
  "سيدي بشر": { lat: 31.2581, lng: 29.9897 },
  montaza: { lat: 31.2828, lng: 30.0156 },
  "المنتزة": { lat: 31.2828, lng: 30.0156 },
  "المنتزه": { lat: 31.2828, lng: 30.0156 },
  agami: { lat: 31.1067, lng: 29.7719 },
  "عجمي": { lat: 31.1067, lng: 29.7719 },
  "العجمي": { lat: 31.1067, lng: 29.7719 },
  raml: { lat: 31.2308, lng: 29.9583 },
  "الرمل": { lat: 31.2308, lng: 29.9583 },
  "borg el arab": { lat: 30.9167, lng: 29.5333 },
  "برج العرب": { lat: 30.9167, lng: 29.5333 },
  ameriya: { lat: 31.0264, lng: 29.8053 },
  "العامرية": { lat: 31.0264, lng: 29.8053 },

  // Delta & Canal
  banha: { lat: 30.466, lng: 31.1852 },
  "بنها": { lat: 30.466, lng: 31.1852 },
  "shubra el kheima": { lat: 30.1286, lng: 31.2422 },
  "شبرا الخيمة": { lat: 30.1286, lng: 31.2422 },
  qalyub: { lat: 30.1833, lng: 31.2056 },
  "قليوب": { lat: 30.1833, lng: 31.2056 },
  mansoura: { lat: 31.0409, lng: 31.3785 },
  "المنصورة": { lat: 31.0409, lng: 31.3785 },
  "mit ghamr": { lat: 30.7189, lng: 31.2625 },
  "ميت غمر": { lat: 30.7189, lng: 31.2625 },
  talkha: { lat: 31.0542, lng: 31.3781 },
  "طلخا": { lat: 31.0542, lng: 31.3781 },
  tanta: { lat: 30.7865, lng: 31.0004 },
  "طنطا": { lat: 30.7865, lng: 31.0004 },
  mahalla: { lat: 30.9697, lng: 31.1656 },
  "المحلة": { lat: 30.9697, lng: 31.1656 },
  "المحلة الكبرى": { lat: 30.9697, lng: 31.1656 },
  "kafr el zayat": { lat: 30.8258, lng: 30.8142 },
  "كفر الزيات": { lat: 30.8258, lng: 30.8142 },
  zagazig: { lat: 30.5877, lng: 31.502 },
  "الزقازيق": { lat: 30.5877, lng: 31.502 },
  "10th of ramadan": { lat: 30.3014, lng: 31.7431 },
  "العاشر من رمضان": { lat: 30.3014, lng: 31.7431 },
  bilbeis: { lat: 30.4208, lng: 31.5647 },
  "بلبيس": { lat: 30.4208, lng: 31.5647 },
  faqous: { lat: 30.7308, lng: 31.7972 },
  "فاقوس": { lat: 30.7308, lng: 31.7972 },
  ismailia: { lat: 30.5965, lng: 32.2715 },
  "الإسماعيلية": { lat: 30.5965, lng: 32.2715 },
  "الاسماعيلية": { lat: 30.5965, lng: 32.2715 },
  suez: { lat: 29.9668, lng: 32.5498 },
  "السويس": { lat: 29.9668, lng: 32.5498 },
  "port said": { lat: 31.2653, lng: 32.3019 },
  "بورسعيد": { lat: 31.2653, lng: 32.3019 },
  "بور سعيد": { lat: 31.2653, lng: 32.3019 },
  damietta: { lat: 31.4175, lng: 31.8144 },
  "دمياط": { lat: 31.4175, lng: 31.8144 },
  "new damietta": { lat: 31.4367, lng: 31.6617 },
  "دمياط الجديدة": { lat: 31.4367, lng: 31.6617 },
  "shebin el koom": { lat: 30.5592, lng: 31.0097 },
  "شبين الكوم": { lat: 30.5592, lng: 31.0097 },
  sadat: { lat: 30.3781, lng: 30.5281 },
  "السادات": { lat: 30.3781, lng: 30.5281 },
  damanhour: { lat: 31.0425, lng: 30.4686 },
  "دمنهور": { lat: 31.0425, lng: 30.4686 },
  "kafr el dawwar": { lat: 31.135, lng: 30.1308 },
  "كفر الدوار": { lat: 31.135, lng: 30.1308 },
  "kafr el sheikh": { lat: 31.1107, lng: 30.9388 },
  "كفر الشيخ": { lat: 31.1107, lng: 30.9388 },
  desouk: { lat: 31.1311, lng: 30.6481 },
  "دسوق": { lat: 31.1311, lng: 30.6481 },

  // Upper Egypt
  fayoum: { lat: 29.3084, lng: 30.8428 },
  "الفيوم": { lat: 29.3084, lng: 30.8428 },
  "beni suef": { lat: 29.0661, lng: 31.0994 },
  "بني سويف": { lat: 29.0661, lng: 31.0994 },
  "بنى سويف": { lat: 29.0661, lng: 31.0994 },
  minya: { lat: 28.0871, lng: 30.7618 },
  "المنيا": { lat: 28.0871, lng: 30.7618 },
  mallawi: { lat: 27.7314, lng: 30.8417 },
  "ملوي": { lat: 27.7314, lng: 30.8417 },
  assiut: { lat: 27.1783, lng: 31.1859 },
  "أسيوط": { lat: 27.1783, lng: 31.1859 },
  "اسيوط": { lat: 27.1783, lng: 31.1859 },
  sohag: { lat: 26.559, lng: 31.6957 },
  "سوهاج": { lat: 26.559, lng: 31.6957 },
  qena: { lat: 26.1551, lng: 32.716 },
  "قنا": { lat: 26.1551, lng: 32.716 },
  luxor: { lat: 25.6872, lng: 32.6396 },
  "الأقصر": { lat: 25.6872, lng: 32.6396 },
  "الاقصر": { lat: 25.6872, lng: 32.6396 },
  aswan: { lat: 24.0889, lng: 32.8998 },
  "أسوان": { lat: 24.0889, lng: 32.8998 },
  "اسوان": { lat: 24.0889, lng: 32.8998 },
  hurghada: { lat: 27.2579, lng: 33.8116 },
  "الغردقة": { lat: 27.2579, lng: 33.8116 },
  arish: { lat: 31.1317, lng: 33.7983 },
  "العريش": { lat: 31.1317, lng: 33.7983 },
  "sharm el sheikh": { lat: 27.9158, lng: 34.3299 },
  "شرم الشيخ": { lat: 27.9158, lng: 34.3299 },
  "marsa matrouh": { lat: 31.3543, lng: 27.2373 },
  "مرسى مطروح": { lat: 31.3543, lng: 27.2373 },
};

function normalizeAreaForComparison(area?: string | null): string {
  if (!area) return "";
  const cleaned = cleanArabicString(area)
    .trim()
    .replace(/^(مدينة|مركز|حي|قسم|منطقة|محافظة)\s+/i, "");
  return normalizeArabic(cleaned)
    .toLowerCase()
    .replace(/^(مدينه|مدينة|مركز|حي|قسم|منطقه|منطقة|محافظه|محافظة)/, "")
    .trim();
}

function getLabNearbyList(labObj: any): any[] {
  if (Array.isArray(labObj?.nearby_labs) && labObj.nearby_labs.length > 0) return labObj.nearby_labs;
  if (Array.isArray(labObj?.nearbyLabs) && labObj.nearbyLabs.length > 0) return labObj.nearbyLabs;
  if (labObj?.notes && typeof labObj.notes === "string" && labObj.notes.includes("[NEARBY_LABS_JSON]:")) {
    try {
      const parsed = JSON.parse(labObj.notes.split("[NEARBY_LABS_JSON]:")[1]?.trim() || "[]");
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

function getEntryId(e: any): string {
  return String(e?.nearbyLabId || e?.nearby_lab_id || "").trim().toLowerCase();
}

function getEntryCode(e: any): string {
  return String(e?.nearbyLabCode || e?.nearby_lab_code || "").trim().toLowerCase();
}

function getEntryNameNorm(e: any): string {
  return normalizeArabic(cleanArabicString(String(e?.nearbyLabName || e?.nearby_lab_name || "")));
}

function getEntryDistance(e: any): number | null {
  const raw = e?.distanceKm ?? e?.distance_km ?? e?.distance;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw !== null && raw !== undefined) {
    const parsed = parseFloat(String(raw).replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getCoords(
  areaName?: string | null,
  lab?: Partial<Tables<"labs">> | null,
): { lat: number; lng: number } | null {
  if (lab?.lat && lab?.lng) return { lat: lab.lat, lng: lab.lng };
  if (!areaName) return null;
  const rawLower = areaName.toLowerCase().trim();
  const normalized = normalizeAreaForComparison(areaName);
  
  for (const [k, coords] of Object.entries(AREA_COORDS)) {
    const kRaw = k.toLowerCase().trim();
    const kNorm = normalizeAreaForComparison(k);
    if (
      rawLower === kRaw ||
      (normalized && kNorm && normalized === kNorm) ||
      (normalized.length > 2 && kNorm.length > 2 && (normalized.includes(kNorm) || kNorm.includes(normalized))) ||
      (rawLower.length > 2 && (rawLower.includes(kRaw) || kRaw.includes(rawLower)))
    ) {
      return coords;
    }
  }
  return null;
}

function getDistanceKm(
  lat1?: number | null,
  lng1?: number | null,
  lat2?: number | null,
  lng2?: number | null,
): number | null {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}
import type { Tables } from "@/integrations/supabase/types";
import { formatEGP } from "@/lib/format";
import { parseSheet, pick, downloadCsv } from "@/lib/sheet";
import {
  buildManualSchedulePayload,
  calculateAssignmentPrice,
  formatScheduleDate,
  formatSessionsByDate,
  getAssignmentScheduleSummary,
  MAX_SESSIONS_PER_DAY,
  validateManualSchedule,
  type AssignmentSession,
  type ManualScheduleDay,
} from "@/lib/assignment-schedule";
import {
  formatTimeSlot,
  getDayTimeSlots,
  flattenDayTimeSlots,
  isSupportedBatchTimeSlot,
  normalizeTimeSlot,
  normalizeTimeSlots,
} from "@/lib/time-slots";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Project – iSchool Lab Management" }] }),
  component: ProjectDetailPage,
});

type Project = Tables<"projects">;
type Batch = Tables<"batches">;
type Assignment = Tables<"assignments">;

const DEFAULT_BATCH_TIME_SLOTS = ["10:00", "12:30", "16:00", "19:30"];

type PendingBatchSlotUpdate = {
  batch: Batch;
  nextName: string;
  nextDates: string[];
  nextTimeSlots: string[];
  removedTimeSlots: string[];
  dateReplacements: Record<string, string>;
  affectedSessionCount: number;
};

function expandRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = new Date(sy, sm - 1, sd);
  const e = new Date(ey, em - 1, ed);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return out;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(formatLocalDateToIso(d));
  }
  return out;
}

function comparableTimeSlot(value: string): string {
  return normalizeTimeSlot(value) ?? value.trim().toLowerCase();
}

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["lab_manager", "operations", "administration"]);
  const canRevoke = hasAnyRole(["operations", "administration"]);
  const canManageBatch = hasAnyRole(["operations", "administration"]);
  const [project, setProject] = useState<Project | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [editBatchName, setEditBatchName] = useState("");
  const [editBatchDates, setEditBatchDates] = useState<string[]>([]);
  const [editBatchDaySlots, setEditBatchDaySlots] = useState<Record<string, string[]>>({});
  const [dateReplacements, setDateReplacements] = useState<Record<string, string>>({});
  const [pendingBatchSlotUpdate, setPendingBatchSlotUpdate] =
    useState<PendingBatchSlotUpdate | null>(null);
  const [savingBatch, setSavingBatch] = useState(false);

  // Per-batch student count map
  const [batchStudentCounts, setBatchStudentCounts] = useState<Record<string, number>>({});
  const [projectStudentCount, setProjectStudentCount] = useState(0);
  const [activeProjectTab, setActiveProjectTab] = useState<"batches" | "students">("students");
  const [projectNeeds, setProjectNeeds] = useState<Need[]>([]);
  const [projectAssignments, setProjectAssignments] = useState<Assignment[]>([]);
  const [projectLabs, setProjectLabs] = useState<Lab[]>([]);
  const [projectScores, setProjectScores] = useState<Record<string, number>>({});

  const todayIso = useMemo(() => new Date().toLocaleDateString("en-CA"), []);

  const [form, setForm] = useState({
    name: "",
    date_mode: "range" as "range" | "custom",
    start: "",
    end: "",
  });
  const [daySlots, setDaySlots] = useState<Record<string, string[]>>({});
  const [customDates, setCustomDates] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [newBatchGroupType, setNewBatchGroupType] = useState<"single_session" | "multi_session">("single_session");
  const [newBatchDefaultRepeatCount, setNewBatchDefaultRepeatCount] = useState<number>(2);
  const [newBatchBlockedDays, setNewBatchBlockedDays] = useState<string[]>([]);
  const [newBatchMegaGroups, setNewBatchMegaGroups] = useState<MegaGroupDefinition[]>([]);
  const [editBatchGroupType, setEditBatchGroupType] = useState<"single_session" | "multi_session">("single_session");
  const [editBatchDefaultRepeatCount, setEditBatchDefaultRepeatCount] = useState<number>(2);
  const [editBatchBlockedDays, setEditBatchBlockedDays] = useState<string[]>([]);
  const [editBatchMegaGroups, setEditBatchMegaGroups] = useState<MegaGroupDefinition[]>([]);

  const activeNewBatchDates = useMemo(() => {
    return form.date_mode === "range" ? expandRange(form.start, form.end) : customDates;
  }, [form.date_mode, form.start, form.end, customDates]);

  // Synchronize daySlots whenever active dates change
  useEffect(() => {
    if (activeNewBatchDates.length === 0) return;
    setDaySlots((prev) => {
      const next = { ...prev };
      let changed = false;
      activeNewBatchDates.forEach((d) => {
        if (!next[d]) {
          next[d] = [...DEFAULT_BATCH_TIME_SLOTS];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [activeNewBatchDates]);

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    if (activeProjectTab === "batches" && batches.length > 0) void loadProjectOperations();
  }, [activeProjectTab, id, batches.length]);

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    const [p, b] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      supabase.from("batches").select("*").eq("project_id", id).order("created_at"),
    ]);
    if (p.error) toast.error(p.error.message);
    setProject(p.data as Project | null);
    const list = (b.data ?? []) as Batch[];
    setBatches(list);
    if (!selected && list.length) setSelected(list[0].id);

    const { data: projectRoster } = await supabase
      .from("batch_student_uploads" as any)
      .select("student_count")
      .eq("batch_id", getProjectUnassignedBatchId(id))
      .maybeSingle();
    const rosterCount = Number((projectRoster as { student_count?: number } | null)?.student_count ?? 0);
    setProjectStudentCount(rosterCount);
    setBatchStudentCounts(Object.fromEntries(list.map((batch) => [batch.id, rosterCount])));

    if (!quiet) setLoading(false);
  }

  async function loadProjectOperations() {
    const batchIds = batches.map((item) => item.id);
    const [nRes, aRes, lRes, qRes] = await Promise.all([
      batchIds.length > 0
        ? supabase.from("batch_needs").select("*").in("batch_id", batchIds)
        : Promise.resolve({ data: [] }),
      batchIds.length > 0
        ? supabase.from("assignments").select("*").in("batch_id", batchIds)
        : Promise.resolve({ data: [] }),
      supabase.from("labs").select("*").eq("is_active", true),
      supabase.from("lab_quality").select("lab_id, quality_score"),
    ]);

    setProjectNeeds((nRes.data ?? []) as Need[]);
    setProjectAssignments((aRes.data ?? []) as Assignment[]);
    setProjectLabs((lRes.data ?? []) as Lab[]);
    const sc: Record<string, number> = {};
    for (const row of (qRes.data ?? []) as { lab_id: string; quality_score: number }[])
      sc[row.lab_id] = Number(row.quality_score);
    setProjectScores(sc);
  }

  const totalStudentsAcrossBatches = useMemo(() => {
    return projectStudentCount;
  }, [projectStudentCount]);

  const projectAnalytics = useMemo(() => {
    const currentBatchNeeds = selected
      ? projectNeeds.filter((n) => n.batch_id === selected)
      : projectNeeds;
    const currentBatchAssignments = selected
      ? projectAssignments.filter((a) => a.batch_id === selected)
      : projectAssignments;

    const totalRequiredLabs = currentBatchNeeds.reduce((sum, n) => sum + (n.labs_required || 0), 0);
    const activeAssignments = currentBatchAssignments.filter((a) => a.status !== "denied");
    const confirmedAssignments = currentBatchAssignments.filter((a) => a.status === "confirmed");
    const fulfillmentRate =
      totalRequiredLabs > 0
        ? Math.round((confirmedAssignments.length / totalRequiredLabs) * 100)
        : 0;

    const labMap = new Map<string, Lab>();
    for (const l of projectLabs) labMap.set(l.id, l);

    let totalEstimatedCost = 0;
    let totalSeatedCapacity = 0;
    let qualitySum = 0;
    let qualityCount = 0;

    for (const a of activeAssignments) {
      const l = labMap.get(a.lab_id);
      const price = Number(a.confirmed_price ?? l?.session_price ?? 0);
      totalEstimatedCost += price;
      if (l?.capacity) totalSeatedCapacity += Number(l.capacity);
      if (projectScores[a.lab_id] !== undefined) {
        qualitySum += projectScores[a.lab_id];
        qualityCount++;
      }
    }

    const avgQuality = qualityCount > 0 ? Math.round(qualitySum / qualityCount) : 0;

    return {
      totalRequiredLabs,
      confirmedCount: confirmedAssignments.length,
      fulfillmentRate,
      totalEstimatedCost,
      totalSeatedCapacity,
      avgQuality,
    };
  }, [projectNeeds, projectAssignments, projectLabs, projectScores, selected]);

  async function createBatch() {
    if (!canManageBatch) {
      return toast.error(
        "Unauthorized: Modifying batch schedules, calendar days, and operational time slots is restricted to Operations.",
      );
    }
    if (submitting) return;
    if (!form.name.trim()) return toast.error("Batch name required");
    const dates = form.date_mode === "range" ? expandRange(form.start, form.end) : customDates;
    if (!dates.length) return toast.error("Add at least one date");

    const todayStr = new Date().toLocaleDateString("en-CA");
    if (dates.some((d) => d < todayStr)) {
      return toast.error("Cannot select past dates. Please choose today or a future date.");
    }

    const time_slots = flattenDayTimeSlots(daySlots);
    if (time_slots.length === 0) {
      return toast.error("Please configure at least one time slot for the batch.");
    }

    setSubmitting(true);
    try {
      const canonicalVisits = getCanonicalVisitCount({
        mode: newBatchGroupType,
        repeatCount: newBatchDefaultRepeatCount,
      });
      assertMegaGroupDateRanges(dates, newBatchMegaGroups, newBatchBlockedDays, canonicalVisits);

      const insertPayload: Record<string, any> = {
        project_id: id,
        name: form.name.trim(),
        date_mode: form.date_mode,
        dates,
        time_slots,
        expected_sessions_per_group: canonicalVisits,
        blocked_days: newBatchBlockedDays,
        mega_groups: newBatchMegaGroups as any,
        status: "draft",
      };

      let { data, error } = await supabase
        .from("batches")
        .insert(insertPayload as any)
        .select("id")
        .single();

      if (error && (error.code === "42703" || (error as any).code === "PGRST204")) {
        const { blocked_days, mega_groups, ...basePayload } = insertPayload;
        const fallbackRes = await supabase
          .from("batches")
          .insert(basePayload as any)
          .select("id")
          .single();
        data = fallbackRes.data;
        error = fallbackRes.error;
      }

      if (error) return toast.error(error.message);

      toast.success("Batch created successfully");
      setOpen(false);

      if (data?.id) {
        setSelected(data.id);
        // Persist batch-level group settings & seed classification defaults
        try {
          await saveBatchGroupSettings(data.id, id, {
            batch_group_type: newBatchGroupType,
            default_repeat_count: canonicalVisits,
            blocked_days: newBatchBlockedDays,
            mega_groups: newBatchMegaGroups,
            classifications: [],
          });
        } catch (err) {
          console.warn("Could not save initial batch group settings:", err);
        }

      }

      setForm({
        name: "",
        date_mode: "range",
        start: "",
        end: "",
      });
      setCustomDates([]);
      setDaySlots({});
      setNewBatchGroupType("single_session");
      setNewBatchDefaultRepeatCount(2);
      setNewBatchBlockedDays([]);
      setNewBatchMegaGroups([]);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create batch");
    } finally {
      setSubmitting(false);
    }
  }

  async function openEditBatch(batch: Batch) {
    if (!canManageBatch) {
      return toast.error(
        "Unauthorized: Modifying batch schedules, calendar days, and operational time slots is restricted to Operations.",
      );
    }
    setEditBatchName(batch.name);
    const initialDates = Array.isArray(batch.dates) ? [...batch.dates].sort() : [];
    setEditBatchDates(initialDates);
    const slotsMap = getDayTimeSlots(initialDates, batch.time_slots || []);
    setEditBatchDaySlots(slotsMap);
    setDateReplacements({});

    let blockedDays = batch.blocked_days || [];
    let megaGroups = ((batch.mega_groups as any) || []) as MegaGroupDefinition[];
    let initialGroupType: "single_session" | "multi_session" = (batch.group_distribution_mode as any) || "single_session";
    let initialRepeatCount = batch.expected_sessions_per_group ? Number(batch.expected_sessions_per_group) : 2;

    try {
      const settings = await fetchBatchGroupSettings(batch.id);
      if (settings) {
        if (settings.blocked_days && settings.blocked_days.length > 0) {
          blockedDays = settings.blocked_days;
        }
        if (settings.mega_groups && settings.mega_groups.length > 0) {
          megaGroups = settings.mega_groups;
        }
        if (settings.batch_group_type) {
          initialGroupType = settings.batch_group_type as any;
        }
        if (settings.default_repeat_count) {
          initialRepeatCount = settings.default_repeat_count;
        }
      }
    } catch (e) {
      console.warn("Could not load batch settings for edit:", e);
    }

    setEditBatchGroupType(initialGroupType);
    setEditBatchDefaultRepeatCount(initialRepeatCount > 1 ? initialRepeatCount : 2);
    setEditBatchBlockedDays(blockedDays);
    setEditBatchMegaGroups(megaGroups);
    setEditingBatch(batch);
  }

  async function applyBatchSlotUpdate(update: PendingBatchSlotUpdate) {
    if (!canManageBatch) {
      return toast.error(
        "Unauthorized: Modifying batch schedules, calendar days, and operational time slots is restricted to Operations.",
      );
    }
    setSavingBatch(true);
    try {
      // 1. If any calendar dates were renamed/replaced, update assignment_sessions session_date
      if (update.dateReplacements) {
        for (const [oldDate, newDate] of Object.entries(update.dateReplacements)) {
          if (oldDate && newDate && oldDate !== newDate) {
            const { error: asgErr } = await supabase
              .from("assignment_sessions")
              .update({ session_date: newDate })
              .eq("batch_id", update.batch.id)
              .eq("session_date", oldDate);
            if (asgErr) {
              console.warn("Notice: Failed to migrate session_date in assignment_sessions:", asgErr);
            }
          }
        }
      }

      const canonicalVisits = getCanonicalVisitCount({
        mode: editBatchGroupType,
        repeatCount: editBatchDefaultRepeatCount,
      });
      assertMegaGroupDateRanges(
        update.nextDates,
        editBatchMegaGroups,
        editBatchBlockedDays,
        canonicalVisits,
      );

      const updatePayload: Record<string, any> = {
        name: update.nextName,
        dates: update.nextDates,
        time_slots: update.nextTimeSlots,
        group_distribution_mode: editBatchGroupType,
        expected_sessions_per_group: canonicalVisits,
        blocked_days: editBatchBlockedDays,
        mega_groups: editBatchMegaGroups as any,
      };

      let { error } = await supabase
        .from("batches")
        .update(updatePayload as any)
        .eq("id", update.batch.id);

      if (error && (error.code === "42703" || (error as any).code === "PGRST204")) {
        const { blocked_days, mega_groups, group_distribution_mode, expected_sessions_per_group, ...basePayload } = updatePayload;
        const fallbackRes = await supabase
          .from("batches")
          .update(basePayload as any)
          .eq("id", update.batch.id);
        error = fallbackRes.error;
      }

      if (error) throw error;

      try {
        await saveBatchGroupSettings(update.batch.id, id, {
          batch_group_type: editBatchGroupType,
          default_repeat_count: canonicalVisits,
          blocked_days: editBatchBlockedDays,
          mega_groups: editBatchMegaGroups,
        });
      } catch (err) {
        console.warn("Could not save batch group settings:", err);
      }

      toast.success("Batch calendar days and time slots updated successfully");
      setPendingBatchSlotUpdate(null);
      setEditingBatch(null);
      setEditBatchDates([]);
      setEditBatchDaySlots({});
      setDateReplacements({});
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update batch");
    } finally {
      setSavingBatch(false);
    }
  }

  async function saveBatchEdits() {
    if (!canManageBatch) {
      return toast.error(
        "Unauthorized: Modifying batch schedules, calendar days, and operational time slots is restricted to Operations.",
      );
    }
    if (!editingBatch || savingBatch) return;

    const nextName = editBatchName.trim();
    if (!nextName) return toast.error("Batch name required");

    const nextDates = [...editBatchDates].sort();
    if (nextDates.length === 0) {
      return toast.error("Batch must have at least one calendar day.");
    }

    const todayStr = new Date().toLocaleDateString("en-CA");
    if (nextDates.some((d) => d < todayStr)) {
      return toast.error("Cannot select past dates. Please choose today or future dates.");
    }

    const nextTimeSlots = flattenDayTimeSlots(editBatchDaySlots);
    if (nextTimeSlots.length === 0) {
      return toast.error("Please configure at least one time slot for the batch.");
    }

    const nextSlotKeys = new Set(nextTimeSlots.map(comparableTimeSlot));
    const removedTimeSlots = normalizeTimeSlots(editingBatch.time_slots, {
      preserveInvalid: true,
    }).filter((slot) => !nextSlotKeys.has(comparableTimeSlot(slot)));

    const update: PendingBatchSlotUpdate = {
      batch: editingBatch,
      nextName,
      nextDates,
      nextTimeSlots,
      removedTimeSlots,
      dateReplacements,
      affectedSessionCount: 0,
    };

    if (removedTimeSlots.length > 0) {
      setSavingBatch(true);
      const { data, error } = await supabase
        .from("assignment_sessions")
        .select("session_time")
        .eq("batch_id", editingBatch.id);
      setSavingBatch(false);

      if (error) {
        toast.error(error.message);
        return;
      }

      const removedSlotKeys = new Set(removedTimeSlots.map(comparableTimeSlot));
      update.affectedSessionCount = (data ?? []).filter((session) =>
        removedSlotKeys.has(comparableTimeSlot(session.session_time)),
      ).length;
    }

    if (update.affectedSessionCount > 0) {
      setPendingBatchSlotUpdate(update);
      return;
    }

    await applyBatchSlotUpdate(update);
  }

  async function deleteBatch(batchId: string, batchName: string) {
    if (!canManageBatch) {
      return toast.error("Unauthorized: Deleting batches is restricted to Operations.");
    }
    if (
      !confirm(
        `Are you sure you want to delete batch "${batchName}"? This will remove all lab needs and assignments under this batch.`,
      )
    )
      return;
    setLoading(true);
    await supabase.from("assignments").delete().eq("batch_id", batchId);
    await supabase.from("batch_needs").delete().eq("batch_id", batchId);
    const { error } = await supabase.from("batches").delete().eq("id", batchId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Batch "${batchName}" deleted.`);
      if (selected === batchId) setSelected(null);
      await load();
    }
    setLoading(false);
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!project) return <div className="text-sm text-muted-foreground">Project not found.</div>;

  const selectedBatch = batches.find((b) => b.id === selected) ?? null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          to="/projects"
          className="hover:text-primary transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Projects &amp; Intakes
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{project.name}</span>
      </div>
      {/* Main Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{project.name}</h1>
            <Badge className="bg-primary text-primary-foreground font-bold text-xs px-2.5 py-0.5">
              {project.program}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs font-bold">
              {project.code}
            </Badge>
            {project.intake_label && (
              <Badge variant="secondary" className="text-xs">
                Intake: {project.intake_label}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage scheduled batches, lab demand needs, automatic ranking &amp; assignment, and ops
            export.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load(true)} className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          {canManageBatch && (
            <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5 bg-primary">
              <Plus className="h-4 w-4" /> New Batch
            </Button>
          )}
        </div>
      </div>{" "}
      {/* 1. KPI ANALYTICS CARDS DIRECTLY UNDER PROJECT TITLE */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-[#0EAA3A]/20 bg-linear-to-br from-[#0EAA3A]/5 via-transparent to-transparent shadow-xs">
          <CardContent className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Fulfillment Rate
              </p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-bold tracking-tight text-[#0EAA3A]">
                  {projectAnalytics.fulfillmentRate}%
                </span>
                <span className="text-[11px] text-muted-foreground">
                  ({projectAnalytics.confirmedCount}/{projectAnalytics.totalRequiredLabs} confirmed)
                </span>
              </div>
            </div>
            <CheckCircle2 className="h-6 w-6 text-[#0EAA3A]/40" />
          </CardContent>
        </Card>

        <Card className="border-[#056FEC]/20 bg-linear-to-br from-[#056FEC]/5 via-transparent to-transparent shadow-xs">
          <CardContent className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Est. Total Budget
              </p>
              <div className="text-xl font-bold tracking-tight text-[#056FEC] dark:text-[#05ACFF] mt-1 truncate">
                {formatEGP(projectAnalytics.totalEstimatedCost)}
              </div>
            </div>
            <DollarSign className="h-6 w-6 text-[#056FEC]/40" />
          </CardContent>
        </Card>

        <Card className="border-[#05ACFF]/20 bg-linear-to-br from-[#05ACFF]/5 via-transparent to-transparent shadow-xs">
          <CardContent className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Total Student Seats
              </p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-bold tracking-tight text-[#05ACFF]">
                  {projectAnalytics.totalSeatedCapacity}
                </span>
                <span className="text-[11px] text-muted-foreground">capacity</span>
              </div>
            </div>
            <Users className="h-6 w-6 text-[#05ACFF]/40" />
          </CardContent>
        </Card>

        <Card className="border-[#FF7F1C]/20 bg-linear-to-br from-[#FF7F1C]/5 via-transparent to-transparent shadow-xs">
          <CardContent className="flex items-center justify-between p-3.5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Avg Lab Quality
              </p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-bold tracking-tight text-[#FF7F1C]">
                  {projectAnalytics.avgQuality}
                </span>
                <span className="text-[11px] text-muted-foreground">/ 100</span>
              </div>
            </div>
            <Star className="h-6 w-6 text-[#FF7F1C]/40" />
          </CardContent>
        </Card>
      </div>
      {/* 2. MAIN 2-TAB NAVIGATION (PROJECT/BATCH DATA vs STUDENTS) */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-muted/60 border border-border/60 shadow-2xs w-fit">
        <button
          type="button"
          onClick={() => setActiveProjectTab("batches")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeProjectTab === "batches"
              ? "bg-[#056FEC] text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Layers className="h-4 w-4" />
          <span>Project &amp; Batch Data</span>
          <Badge
            variant="secondary"
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
              activeProjectTab === "batches"
                ? "bg-white/20 text-white font-bold"
                : "bg-background text-foreground border border-border/50"
            }`}
          >
            {batches.length} {batches.length === 1 ? "Batch" : "Batches"}
          </Badge>
        </button>

        <button
          type="button"
          onClick={() => setActiveProjectTab("students")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeProjectTab === "students"
              ? "bg-[#056FEC] text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Student Demand &amp; Roster</span>
          <Badge
            variant="secondary"
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
              activeProjectTab === "students"
                ? "bg-white/20 text-white font-bold"
                : "bg-background text-foreground border border-border/50"
            }`}
          >
            {totalStudentsAcrossBatches.toLocaleString()} Students
          </Badge>
        </button>
      </div>
      {/* 3. TAB 1: PROJECT & BATCH DATA */}
      {activeProjectTab === "batches" && (
        <div className="space-y-6">
          {batches.length === 0 ? (
            <Card className="border-border/60 shadow-xs">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No batches created yet. Click <strong>"New Batch"</strong> above to define session
                dates and import lab demand.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Batches Quick Switcher Navbar (Above Batches Header) */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2 rounded-2xl bg-card border border-border/70 shadow-xs">
                <div className="flex items-center gap-2 overflow-x-auto py-1 px-1 scrollbar-thin max-w-full">
                  <div className="flex items-center gap-1.5 shrink-0 pr-2.5 border-r border-border/60">
                    <Layers className="h-4 w-4 text-[#056FEC]" />
                    <span className="text-xs font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                      Batches
                    </span>
                    <Badge className="bg-[#056FEC] text-white text-[10px] font-bold px-1.5 py-0 rounded-full">
                      {batches.length}
                    </Badge>
                  </div>

                  {batches.map((b) => {
                    const isSelected = selected === b.id;
                    const studentCount = batchStudentCounts[b.id] || 0;
                    const sortedDates = [...(b.dates || [])].sort();

                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelected(b.id)}
                        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                          isSelected
                            ? "bg-[#056FEC] text-white shadow-sm font-bold ring-2 ring-[#056FEC]/30"
                            : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 hover:border-border"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isSelected
                              ? "bg-white"
                              : b.status === "exported" || b.status === "ready"
                                ? "bg-[#0EAA3A]"
                                : b.status === "confirming" || b.status === "assigning"
                                  ? "bg-[#FF7F1C]"
                                  : "bg-slate-400"
                          }`}
                        />
                        <span className="truncate max-w-[130px]">{b.name}</span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                            isSelected
                              ? "bg-white/20 text-white font-bold"
                              : "bg-background text-muted-foreground border border-border/50"
                          }`}
                        >
                          {sortedDates.length}D ·{" "}
                          {studentCount > 0 ? `${studentCount.toLocaleString()} stu` : "0 stu"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {canManageBatch && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setOpen(true)}
                    className="h-8 text-xs gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold rounded-xl shadow-2xs self-end sm:self-auto shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" /> New Batch
                  </Button>
                )}
              </div>

              {/* Batches Section Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                      Project Batches &amp; Execution Schedules
                    </h2>
                    <Badge className="bg-[#056FEC] text-white font-bold text-xs px-2.5 py-0.5 rounded-full shadow-2xs">
                      {batches.length} {batches.length === 1 ? "Batch" : "Batches"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Select a cohort schedule below to inspect session days, student quotas, and
                    execute lab allocation.
                  </p>
                </div>
              </div>

              {/* Batches Cards Grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {batches.map((b) => {
                  const isSelected = selected === b.id;
                  const displayTimeSlots = normalizeTimeSlots(b.time_slots, {
                    preserveInvalid: true,
                  });

                  const statusColor =
                    b.status === "exported" || b.status === "ready"
                      ? "border-[#0EAA3A]/30 bg-[#0EAA3A]/10 text-[#0EAA3A]"
                      : b.status === "confirming" || b.status === "assigning"
                        ? "border-[#FF7F1C]/30 bg-[#FF7F1C]/10 text-[#FF7F1C]"
                        : "border-border/60 bg-muted/50 text-muted-foreground";

                  const statusDot =
                    b.status === "exported" || b.status === "ready"
                      ? "bg-[#0EAA3A]"
                      : b.status === "confirming" || b.status === "assigning"
                        ? "bg-[#FF7F1C]"
                        : "bg-slate-400";

                  const sortedDates = [...(b.dates || [])].sort();
                  const studentCount = batchStudentCounts[b.id] || 0;

                  return (
                    <Card
                      key={b.id}
                      onClick={() => setSelected(b.id)}
                      className={`cursor-pointer transition-all duration-200 rounded-2xl border relative flex flex-col justify-between group ${
                        isSelected
                          ? "border-[#056FEC] bg-[#056FEC]/[0.04] dark:bg-[#056FEC]/10 shadow-md ring-2 ring-[#056FEC]/35"
                          : "border-border/70 bg-card hover:border-[#056FEC]/40 hover:bg-muted/30 hover:shadow-xs hover:-translate-y-0.5"
                      }`}
                    >
                      <CardContent className="space-y-4 p-5">
                        {/* Top Row: Batch Name & Status Badges */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div
                              className="font-bold text-base text-[#1F2A55] dark:text-[#F7FAFF] group-hover:text-[#056FEC] transition-colors truncate"
                              title={b.name}
                            >
                              {b.name}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              Cohort ID:{" "}
                              <span className="font-mono text-foreground font-semibold">
                                {b.id.slice(0, 8)}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <Badge
                              variant="outline"
                              className={`px-2.5 py-0.5 font-semibold text-[11px] capitalize rounded-full ${statusColor}`}
                            >
                              <span
                                className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${statusDot}`}
                              />
                              {b.status === "exported" ? "Exported" : b.status || "Draft"}
                            </Badge>
                            {isSelected && (
                              <Badge className="bg-[#056FEC] text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-2xs">
                                Active
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Session Dates Preview */}
                        <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border/40">
                          <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 text-[#056FEC]" /> Session Calendar
                            </span>
                            <span className="font-mono text-foreground font-bold bg-background px-2 py-0.5 rounded-md border border-border/50 text-[10px]">
                              {sortedDates.length} {sortedDates.length === 1 ? "Day" : "Days"}
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {sortedDates.slice(0, 3).map((dStr) => {
                              let formattedDate = dStr;
                              try {
                                const dt = new Date(dStr);
                                if (!isNaN(dt.getTime())) {
                                  formattedDate = dt.toLocaleDateString("en-US", {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                  });
                                }
                              } catch {}

                              return (
                                <Badge
                                  key={dStr}
                                  variant="secondary"
                                  className="text-[11px] font-mono py-0.5 px-2 bg-background border border-border/60 text-foreground font-medium"
                                >
                                  {formattedDate}
                                </Badge>
                              );
                            })}
                            {sortedDates.length > 3 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-mono py-0.5 px-1.5 font-semibold text-muted-foreground bg-background"
                              >
                                +{sortedDates.length - 3} more
                              </Badge>
                            )}
                            {sortedDates.length === 0 && (
                              <span className="text-[11px] text-muted-foreground italic">
                                No session dates scheduled
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Key Metrics Grid (Students & Time Slots) */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                            <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-[#FF7F1C]" /> Students
                            </div>
                            <div className="text-sm font-bold text-foreground">
                              {studentCount > 0 ? (
                                <span>
                                  {studentCount.toLocaleString()}{" "}
                                  <span className="text-xs font-normal text-muted-foreground">
                                    available
                                  </span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground font-normal text-xs">
                                  No project roster
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                            <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-[#05ACFF]" /> Time Slots
                            </div>
                            <div
                              className="text-sm font-bold text-foreground truncate"
                              title={displayTimeSlots.map(formatTimeSlot).join(", ")}
                            >
                              {displayTimeSlots.length > 0 ? (
                                <span>
                                  {displayTimeSlots.length}{" "}
                                  <span className="text-xs font-normal text-muted-foreground">
                                    configured
                                  </span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground font-normal text-xs">
                                  Standard (7)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Card Footer: Status cue & Edit/Delete Controls */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
                          {isSelected ? (
                            <span className="flex items-center gap-1.5 font-bold text-[#056FEC] text-xs">
                              <CheckCircle2 className="h-4 w-4 text-[#056FEC]" /> Selected Workspace
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-muted-foreground group-hover:text-foreground transition-colors font-medium text-xs">
                              <span>Open Workspace</span>
                              <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                            </span>
                          )}

                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {canManageBatch && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditBatch(b)}
                                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-[#056FEC]/10 hover:text-[#056FEC]"
                                  title={`Edit ${b.name}`}
                                  aria-label={`Edit ${b.name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteBatch(b.id, b.name)}
                                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                  title={`Delete ${b.name}`}
                                  aria-label={`Delete ${b.name}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Selected Batch Workspace */}
              {selectedBatch && (
                <BatchWorkspace
                  key={selectedBatch.id}
                  project={project}
                  batch={selectedBatch}
                  canEdit={canEdit}
                  canManageBatch={canManageBatch}
                  onChanged={() => void load(true)}
                  onEditBatch={openEditBatch}
                />
              )}
            </div>
          )}
        </div>
      )}
      {/* 4. TAB 2: STUDENT DEMAND & ROSTER */}
      {activeProjectTab === "students" && project && (
        <ProjectStudentRoster
          project={project}
          batches={batches}
          canEdit={canEdit}
          canRevoke={canRevoke}
          onChanged={() => void load(true)}
        />
      )}
      {/* New batch dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New batch</DialogTitle>
            <DialogDescription>
              Define session dates and configurable time slots per day.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Batch name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Summer Camp 25–26 July"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Date mode</Label>
              <Select
                value={form.date_mode}
                onValueChange={(v) => setForm({ ...form, date_mode: v as "range" | "custom" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="range">Range (from → to)</SelectItem>
                  <SelectItem value="custom">Custom days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.date_mode === "range" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>From</Label>
                  <Input
                    type="date"
                    min={todayIso}
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>To</Label>
                  <Input
                    type="date"
                    min={form.start || todayIso}
                    value={form.end}
                    onChange={(e) => setForm({ ...form, end: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label>Add days (today or future dates)</Label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    min={todayIso}
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (
                        customInput &&
                        customInput >= todayIso &&
                        !customDates.includes(customInput)
                      ) {
                        setCustomDates([...customDates, customInput].sort());
                        setCustomInput("");
                      } else if (customInput && customInput < todayIso) {
                        toast.error("Cannot select past dates.");
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {customDates.map((d) => (
                    <Badge key={d} variant="secondary" className="gap-1">
                      {d}
                      <button
                        type="button"
                        onClick={() => setCustomDates(customDates.filter((x) => x !== d))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label>Day-by-Day Time Slots</Label>
              <BatchDayScheduleEditor
                dates={activeNewBatchDates}
                daySlots={daySlots}
                onChange={setDaySlots}
                onDatesChange={
                  form.date_mode === "custom"
                    ? (newDates, newSlots) => {
                        setCustomDates(newDates);
                        setDaySlots(newSlots);
                      }
                    : undefined
                }
                allowDateEditing={form.date_mode === "custom"}
                disabled={submitting}
              />
            </div>

            {/* Batch Group Distribution Mode & Weekly Sessions */}
            <div className="grid gap-2 p-3 rounded-lg border border-border/80 bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                  <Repeat className="h-3.5 w-3.5 text-purple-500" />
                  Batch Group Type & Weekly Sessions
                </Label>
                <Badge
                  variant={newBatchGroupType === "multi_session" ? "secondary" : "outline"}
                  className={`text-[10px] font-semibold gap-1 ${
                    newBatchGroupType === "multi_session"
                      ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300 dark:border-purple-700"
                      : "text-muted-foreground"
                  }`}
                >
                  {newBatchGroupType === "multi_session"
                    ? `Multi-Session (${newBatchDefaultRepeatCount}x)`
                    : "Single-Session (1x)"}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <div className="grid gap-1">
                  <Label className="text-[11px] text-muted-foreground">Distribution Mode</Label>
                  <Select
                    value={newBatchGroupType}
                    onValueChange={(v: "single_session" | "multi_session") => setNewBatchGroupType(v)}
                  >
                    <SelectTrigger className="h-8 text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single_session" className="text-xs">
                        Single-Session Group (SG) • 1 visit/wk
                      </SelectItem>
                      <SelectItem value="multi_session" className="text-xs">
                        Multi-Session • Multi-day weekly
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {newBatchGroupType === "multi_session" && (
                  <div className="grid gap-1">
                    <Label className="text-[11px] text-muted-foreground">Default Sessions / Group</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={2}
                        max={7}
                        value={newBatchDefaultRepeatCount}
                        onChange={(e) =>
                          setNewBatchDefaultRepeatCount(Math.max(2, parseInt(e.target.value) || 2))
                        }
                        className="h-8 text-xs font-bold text-center bg-background"
                      />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">sessions / wk</span>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Pre-populates the default weekly visits in Group Classification & the Lab Allocation solver.
              </p>
            </div>

            {/* Blocked Days & Mega Groups */}
            <BatchBlockedDaysAndMegaGroups
              program={(project.program || "DECI") as ProjectProgram}
              dates={activeNewBatchDates}
              distributionMode={newBatchGroupType}
              sessionsPerGroup={newBatchGroupType === "multi_session" ? newBatchDefaultRepeatCount : 1}
              blockedDays={newBatchBlockedDays}
              onBlockedDaysChange={(days) => {
                setNewBatchBlockedDays(days);
                setDaySlots((prev) => {
                  const next = { ...prev };
                  days.forEach((d) => {
                    next[d] = [];
                  });
                  return next;
                });
              }}
              megaGroups={newBatchMegaGroups}
              onMegaGroupsChange={setNewBatchMegaGroups}
              disabled={submitting}
            />

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={createBatch}
              disabled={
                submitting ||
                activeNewBatchDates.length === 0 ||
                !form.name.trim() ||
                Object.values(daySlots).every((s) => s.length === 0)
              }
            >
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Edit batch dialog */}
      <Dialog
        open={Boolean(editingBatch)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !savingBatch) {
            setEditingBatch(null);
            setPendingBatchSlotUpdate(null);
          }
        }}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit batch</DialogTitle>
            <DialogDescription>
              Update the batch name and configure time slots per day. Existing schedules are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-batch-name">Batch name</Label>
              <Input
                id="edit-batch-name"
                value={editBatchName}
                onChange={(event) => setEditBatchName(event.target.value)}
                disabled={savingBatch}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Day-by-Day Calendar Days &amp; Time Slots</Label>
              <p className="text-[11px] text-muted-foreground leading-tight -mt-0.5">
                Click any day to edit or swap the assigned calendar date (e.g. switch Thursday to
                Wednesday), or use &quot;Add Day&quot; to expand the batch schedule.
              </p>
              <BatchDayScheduleEditor
                dates={editBatchDates}
                daySlots={editBatchDaySlots}
                onChange={setEditBatchDaySlots}
                onDatesChange={(newDates, newDaySlots) => {
                  setEditBatchDates(newDates);
                  setEditBatchDaySlots(newDaySlots);
                }}
                onDateChange={(oldDate, newDate) => {
                  setDateReplacements((prev) => ({ ...prev, [oldDate]: newDate }));
                }}
                allowDateEditing={true}
                disabled={savingBatch}
              />
            </div>

            {/* Blocked Days & Mega Groups */}
            <BatchBlockedDaysAndMegaGroups
              program={(project.program || "DECI") as ProjectProgram}
              dates={editBatchDates}
              distributionMode={editBatchGroupType}
              sessionsPerGroup={editBatchGroupType === "multi_session" ? editBatchDefaultRepeatCount : 1}
              blockedDays={editBatchBlockedDays}
              onBlockedDaysChange={(days) => {
                setEditBatchBlockedDays(days);
                setEditBatchDaySlots((prev) => {
                  const next = { ...prev };
                  days.forEach((d) => {
                    next[d] = [];
                  });
                  return next;
                });
              }}
              megaGroups={editBatchMegaGroups}
              onMegaGroupsChange={setEditBatchMegaGroups}
              disabled={savingBatch}
            />

            {/* Batch Distribution Mode & Expected Repeat Visits */}
            <div className="grid gap-2 p-3 rounded-lg border border-purple-200/70 dark:border-purple-900/50 bg-purple-50/20 dark:bg-purple-950/10">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5 text-purple-950 dark:text-purple-200">
                  <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                  Group Distribution Mode
                </Label>
                <Badge
                  variant={editBatchGroupType === "multi_session" ? "secondary" : "outline"}
                  className={`text-[10px] font-semibold gap-1 ${
                    editBatchGroupType === "multi_session"
                      ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300 dark:border-purple-700"
                      : "text-muted-foreground"
                  }`}
                >
                  {editBatchGroupType === "multi_session"
                    ? `Multi-Session (${editBatchDefaultRepeatCount}x)`
                    : "Single-Session (1x)"}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <div className="grid gap-1">
                  <Label className="text-[11px] text-muted-foreground">Distribution Mode</Label>
                  <Select
                    value={editBatchGroupType}
                    onValueChange={(v: "single_session" | "multi_session") => setEditBatchGroupType(v)}
                    disabled={savingBatch}
                  >
                    <SelectTrigger className="h-8 text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single_session" className="text-xs">
                        Single-Session Group (SG) • 1 visit/wk
                      </SelectItem>
                      <SelectItem value="multi_session" className="text-xs">
                        Multi-Session • Multi-day weekly
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {editBatchGroupType === "multi_session" && (
                  <div className="grid gap-1">
                    <Label className="text-[11px] text-muted-foreground">Default Sessions / Group</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={2}
                        max={7}
                        value={editBatchDefaultRepeatCount}
                        onChange={(e) =>
                          setEditBatchDefaultRepeatCount(Math.max(2, parseInt(e.target.value) || 2))
                        }
                        className="h-8 text-xs font-bold text-center bg-background"
                        disabled={savingBatch}
                      />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">sessions / wk</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingBatch(null)}
              disabled={savingBatch}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveBatchEdits()}
              disabled={
                savingBatch ||
                !editBatchName.trim() ||
                Object.values(editBatchDaySlots).every((s) => s.length === 0)
              }
            >
              {savingBatch ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(pendingBatchSlotUpdate)}
        onOpenChange={(nextOpen) => !nextOpen && setPendingBatchSlotUpdate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove time slots used by schedules?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBatchSlotUpdate?.affectedSessionCount ?? 0} existing session
              {(pendingBatchSlotUpdate?.affectedSessionCount ?? 0) === 1 ? " uses " : "s use "}
              {pendingBatchSlotUpdate?.removedTimeSlots.map(formatTimeSlot).join(", ")}. Saving
              removes these choices from the batch, but does not delete or alter the existing
              sessions. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingBatch}>Keep time slots</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingBatch}
              onClick={() => {
                if (pendingBatchSlotUpdate) {
                  void applyBatchSlotUpdate(pendingBatchSlotUpdate);
                }
              }}
            >
              {savingBatch ? "Saving..." : "Remove from batch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =====================================================================
// Batch workspace: needs -> auto-assign -> confirm/deny -> export
// =====================================================================
type Lab = Tables<"labs">;
type Need = Tables<"batch_needs">;
type RankCriteria = {
  quality: boolean;
  price: boolean;
  seats: boolean;
};

function BatchWorkspace({
  project,
  batch,
  canEdit,
  canManageBatch,
  onChanged,
  onEditBatch,
}: {
  project: Project;
  batch: Batch;
  canEdit: boolean;
  canManageBatch: boolean;
  onChanged: () => void;
  onEditBatch?: (batch: Batch) => void;
}) {
  const batchDates = useMemo(
    () => (Array.isArray(batch.dates) ? [...batch.dates].sort() : []),
    [batch.dates],
  );
  const batchTimeSlots = useMemo(
    () => normalizeTimeSlots(batch.time_slots, { preserveInvalid: true }),
    [batch.time_slots],
  );
  const needsFileRef = useRef<HTMLInputElement>(null);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentSessions, setAssignmentSessions] = useState<AssignmentSession[]>([]);
  const [allAssignmentSessions, setAllAssignmentSessions] = useState<AssignmentSession[]>([]);
  const [allActiveAssignments, setAllActiveAssignments] = useState<Array<Pick<Assignment, "id" | "lab_id" | "batch_id" | "status" | "source" | "is_current_allocation">>>([]);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [allocationLabUsage, setAllocationLabUsage] = useState<AllocationLabUsage[]>([]);
  const [allocationStudentTotal, setAllocationStudentTotal] = useState(0);
  const [incidents, setIncidents] = useState<Array<Pick<Tables<"lab_incidents">, "id" | "lab_id" | "severity" | "reported_at">>>([]);
  const [reserved, setReserved] = useState<Set<string>>(new Set());
  const [rankCriteria, setRankCriteria] = useState<RankCriteria>({
    quality: true,
    price: true,
    seats: true,
  });
  const [loading, setLoading] = useState(true);

  // Search & Governorate Grouping state
  const [govFilter, setGovFilter] = useState("all");
  const [areaSearch, setAreaSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [operationalTab, setOperationalTab] = useState<"action" | "all" | "exceptions">("action");
  const [operationalView, setOperationalView] = useState<"labs" | "governorates">("labs");
  const [labSearch, setLabSearch] = useState("");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [incidentFilter, setIncidentFilter] = useState("all");
  const [conflictFilter, setConflictFilter] = useState("all");
  const [opsPage, setOpsPage] = useState(1);
  const [opsPageSize, setOpsPageSize] = useState(50);
  const [expandedGovernors, setExpandedGovernors] = useState<Set<string>>(new Set());
  const [detailAssignmentId, setDetailAssignmentId] = useState<string | null>(null);

  const [confirmFor, setConfirmFor] = useState<Assignment | null>(null);
  const [confirmPrice, setConfirmPrice] = useState(0);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [pickerNeed, setPickerNeed] = useState<Need | null>(null);
  const [addNeedModalOpen, setAddNeedModalOpen] = useState(false);
  const [denialFor, setDenialFor] = useState<Assignment | null>(null);
  const [denialReason, setDenialReason] = useState("");
  const [replacementFor, setReplacementFor] = useState<Assignment | null>(null);
  const syncedAllocationRunByBatchRef = useRef<Map<string, string>>(new Map());

  // Incident & Survey dialog state
  const [incidentLab, setIncidentLab] = useState<Lab | null>(null);
  const [incidentListLab, setIncidentListLab] = useState<Lab | null>(null);
  const [incidentDetails, setIncidentDetails] = useState<Tables<"lab_incidents">[]>([]);
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentCategory, setIncidentCategory] = useState("pc");
  const [incidentSeverity, setIncidentSeverity] = useState("medium");
  const [incidentDesc, setIncidentDesc] = useState("");
  const [submittingIncident, setSubmittingIncident] = useState(false);

  const [surveyLab, setSurveyLab] = useState<Lab | null>(null);
  const [surveyOverall, setSurveyOverall] = useState(5);
  const [surveyPc, setSurveyPc] = useState(5);
  const [surveyInternet, setSurveyInternet] = useState(5);
  const [surveyCleanliness, setSurveyCleanliness] = useState(5);
  const [surveyFacilities, setSurveyFacilities] = useState(5);
  const [surveyFeedback, setSurveyFeedback] = useState("");
  const [submittingSurvey, setSubmittingSurvey] = useState(false);

  const [scheduleFor, setScheduleFor] = useState<Assignment | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ManualScheduleDay[]>([]);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [sessionImportOpen, setSessionImportOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id]);

  async function loadAll(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const [n, a, sessionRes, l, q, otherA, otherB, incidentRes, allocation] = await Promise.all([
        supabase.from("batch_needs").select("*").eq("batch_id", batch.id),
        supabase.from("assignments").select("*").eq("batch_id", batch.id),
        supabase.from("assignment_sessions").select("*").eq("batch_id", batch.id),
        supabase.from("labs").select("*").eq("is_active", true),
        supabase.from("lab_quality").select("lab_id, quality_score"),
        supabase
          .from("assignments")
          .select("id, lab_id, batch_id, status, source, is_current_allocation")
          .in("status", ["pending", "confirmed"]),
        supabase.from("batches").select("id, dates"),
        supabase.from("lab_incidents").select("id, lab_id, severity, reported_at").eq("batch_id", batch.id).eq("project_id", project.id),
        fetchBatchAllocationOutput(batch.id).catch((error) => {
          console.warn("Saved allocation could not be loaded for operational lab needs:", error);
          return null;
        }),
      ]);
      if (n.error) toast.error(n.error.message);
      setNeeds((n.data ?? []) as Need[]);
      setAssignments((a.data ?? []) as Assignment[]);
      const loadedSessions = (Array.isArray(sessionRes.data) ? sessionRes.data : []) as AssignmentSession[];
      setAllAssignmentSessions(loadedSessions);
      setAssignmentSessions(loadedSessions.filter((session) => session.batch_id === batch.id));
      setAllActiveAssignments((otherA.data ?? []) as Array<Pick<Assignment, "id" | "lab_id" | "batch_id" | "status" | "source" | "is_current_allocation">>);
      const rawLabs = (l.data ?? []) as Lab[];
      const loadedLabs = rawLabs.map((lab: any) => {
        let nearby: any[] = [];
        if (Array.isArray(lab.nearby_labs) && lab.nearby_labs.length > 0) {
          nearby = lab.nearby_labs;
        } else if (Array.isArray(lab.nearbyLabs) && lab.nearbyLabs.length > 0) {
          nearby = lab.nearbyLabs;
        } else if (lab.notes && typeof lab.notes === "string" && lab.notes.includes("[NEARBY_LABS_JSON]:")) {
          try {
            const parsed = JSON.parse(lab.notes.split("[NEARBY_LABS_JSON]:")[1]?.trim() || "[]");
            if (Array.isArray(parsed)) nearby = parsed;
          } catch {}
        }
        return {
          ...lab,
          nearby_labs: nearby,
          nearbyLabs: nearby,
        };
      });
      setLabs(loadedLabs);
      const sc: Record<string, number> = {};
      for (const row of (q.data ?? []) as { lab_id: string; quality_score: number }[])
        sc[row.lab_id] = Number(row.quality_score);
      setScores(sc);
      setIncidents((incidentRes.data ?? []) as Array<Pick<Tables<"lab_incidents">, "id" | "lab_id" | "severity" | "reported_at">>);

      const authoritativeUsage = allocation && allocation.sync_status !== "offline" && allocation.run_id
        ? deriveAllocationLabUsage(allocation)
        : [];
      setAllocationLabUsage(authoritativeUsage);
      setAllocationStudentTotal(allocation?.summary?.total_students ?? 0);
      if (canEdit && allocation?.run_id && allocation.sync_status !== "offline"
        && syncedAllocationRunByBatchRef.current.get(batch.id) !== allocation.run_id) {
        try {
          // Wrap reconciliation with a 6-second timeout to prevent UI hangs
          const reconcilePromise = reconcileAllocationLabs(
            allocation.run_id,
            authoritativeUsage,
            (n.data ?? []) as Need[],
            (a.data ?? []) as Assignment[],
            loadedSessions.filter((session) => session.batch_id === batch.id),
            loadedLabs,
          );
          const timeoutPromise = new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error("Allocation synchronization timed out")), 6000)
          );
          const changed = await Promise.race([reconcilePromise, timeoutPromise]);
          syncedAllocationRunByBatchRef.current.set(batch.id, allocation.run_id);
          if (changed) {
            await loadAll(true);
            return;
          }
        } catch (error) {
          syncedAllocationRunByBatchRef.current.set(batch.id, allocation.run_id);
          console.warn("Allocation synchronization notice:", error);
        }
      }

      // Reserved lab ids = labs held (pending/confirmed) by another overlapping batch
      const datesByBatch = new Map<string, string[]>();
      for (const b of (otherB.data ?? []) as { id: string; dates: string[] }[])
        datesByBatch.set(b.id, b.dates ?? []);
      const myDates = new Set(batchDates);
      const res = new Set<string>();
      for (const row of (otherA.data ?? []) as { lab_id: string; batch_id: string; source: string; is_current_allocation: boolean }[]) {
        if (row.batch_id === batch.id) continue;
        if (row.source === "allocation" && row.is_current_allocation === false) continue;
        const ds = datesByBatch.get(row.batch_id) ?? [];
        if (ds.some((d) => myDates.has(d))) res.add(row.lab_id);
      }
      setReserved(res);
    } catch (err) {
      console.error("Failed to load batch data:", err);
      toast.error(err instanceof Error ? err.message : "Failed to load batch data");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function reconcileAllocationLabs(
    runId: string,
    usages: AllocationLabUsage[],
    existingNeeds: Need[],
    existingAssignments: Assignment[],
    existingSessions: AssignmentSession[],
    availableLabs: Lab[],
  ): Promise<boolean> {
    if (!usages.length) return false;

    // Fast O(N) bypass: Check if all allocated lab usages already have a corresponding assignment row in this batch
    const labByCode = new Map(availableLabs.map((l) => [l.lab_code?.toLowerCase().trim(), l]));
    const isAlreadyReconciled = usages.every((usage) => {
      const lab = labByCode.get(usage.labCode?.toLowerCase().trim());
      if (!lab) return true;
      const asg = existingAssignments.find((a) => a.lab_id === lab.id);
      if (!asg) return false;
      return Boolean(asg.allocation_run_id === runId || asg.is_current_allocation || asg.status === "denied" || asg.status === "confirmed");
    });

    if (isAlreadyReconciled) {
      return false;
    }

    await Promise.all([
      supabase.from("batch_needs").update({ is_current_allocation: false }).eq("batch_id", batch.id).eq("source", "allocation"),
      supabase.from("assignments").update({ is_current_allocation: false }).eq("batch_id", batch.id).eq("source", "allocation"),
    ]);

    const needGroups = new Map<string, { gov: string; area: string; labsRequired: number }>();
    usages.forEach((usage) => {
      const key = `${usage.governorate}\u0000${usage.physicalArea}`;
      const current = needGroups.get(key) ?? { gov: usage.governorate, area: usage.physicalArea, labsRequired: 0 };
      current.labsRequired += 1;
      needGroups.set(key, current);
    });

    const needByKey = new Map<string, Need>();
    const needsToInsert: any[] = [];
    for (const group of needGroups.values()) {
      const key = `${group.gov}\u0000${group.area}`;
      const existing = existingNeeds.find((need) => need.source === "allocation" && need.gov === group.gov && need.area === group.area);
      if (existing) {
        needByKey.set(key, { ...existing, labs_required: group.labsRequired, is_current_allocation: true });
        void supabase.from("batch_needs").update({ labs_required: group.labsRequired, allocation_run_id: runId, is_current_allocation: true }).eq("id", existing.id);
      } else {
        needsToInsert.push({
          batch_id: batch.id,
          gov: group.gov,
          area: group.area,
          labs_required: group.labsRequired,
          source: "allocation",
          allocation_run_id: runId,
          is_current_allocation: true,
        });
      }
    }

    if (needsToInsert.length > 0) {
      const { data: insertedNeeds } = await supabase.from("batch_needs").insert(needsToInsert).select("*");
      if (insertedNeeds) {
        (insertedNeeds as Need[]).forEach((need) => {
          needByKey.set(`${need.gov}\u0000${need.area}`, need);
        });
      }
    }

    const toInsertAssignments: any[] = [];
    const toUpdateAssignments: Array<{ id: string; payload: any; usage: AllocationLabUsage; lab: Lab }> = [];

    for (const usage of usages) {
      const lab = labByCode.get(usage.labCode?.toLowerCase().trim());
      if (!lab) continue;

      const need = needByKey.get(`${usage.governorate}\u0000${usage.physicalArea}`);
      const assignment = existingAssignments.find((item) => item.lab_id === lab.id);

      const isDeniedAndReplaced = assignment?.status === "denied" && existingAssignments.some((cand) => cand.replaces_assignment_id === assignment?.id);
      if (isDeniedAndReplaced) {
        continue;
      }
      if (assignment) {
        const isDenied = assignment.status === "denied";
        toUpdateAssignments.push({
          id: assignment.id,
          payload: {
            need_id: need?.id ?? assignment.need_id,
            allocation_run_id: runId,
            is_current_allocation: !isDenied,
          },
          usage,
          lab,
        });
      } else {
        toInsertAssignments.push({
          batch_id: batch.id,
          need_id: need?.id ?? null,
          lab_id: lab.id,
          status: "pending",
          days: usage.occupiedDays,
          sessions_per_day: 0,
          time_slots: usage.timeSlots,
          source: "allocation",
          allocation_run_id: runId,
          is_current_allocation: true,
          usage,
          lab,
        });
      }
    }

    // Process updates and inserts
    const sessionsToInsert: any[] = [];
    const assignmentIdsToDeleteSessions: string[] = [];

    if (toInsertAssignments.length > 0) {
      const cleanInserts = toInsertAssignments.map(({ usage, lab, ...rest }) => rest);
      const { data: insertedRows, error: insErr } = await supabase.from("assignments").insert(cleanInserts).select("*");
      if (insErr) {
        console.warn("[Reconcile] Error inserting assignments:", insErr);
      } else if (insertedRows) {
        const insertedByLabId = new Map(insertedRows.map((r) => [r.lab_id, r.id]));
        toInsertAssignments.forEach((item) => {
          const asgId = insertedByLabId.get(item.lab.id);
          if (asgId && item?.usage?.sessions?.length) {
            item.usage.sessions.forEach((session: any) => {
              sessionsToInsert.push({
                assignment_id: asgId,
                batch_id: batch.id,
                lab_id: item.lab.id,
                session_date: session.date,
                session_time: session.time,
                session_group_id: session.groupIds.join(", ") || null,
                source: "allocation",
              });
            });
          }
        });
      }
    }

    if (toUpdateAssignments.length > 0) {
      const chunkSize = 25;
      for (let i = 0; i < toUpdateAssignments.length; i += chunkSize) {
        const chunk = toUpdateAssignments.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async ({ id, payload, usage, lab }) => {
            await supabase.from("assignments").update(payload).eq("id", id);
            const currentSessions = existingSessions.filter((session) => session.assignment_id === id);
            const userEditedSchedule = currentSessions.some((session) => session.source === "manual" || session.source === "import");
            if (!userEditedSchedule) {
              assignmentIdsToDeleteSessions.push(id);
              if (usage.sessions?.length) {
                usage.sessions.forEach((session) => {
                  sessionsToInsert.push({
                    assignment_id: id,
                    batch_id: batch.id,
                    lab_id: lab.id,
                    session_date: session.date,
                    session_time: session.time,
                    session_group_id: session.groupIds.join(", ") || null,
                    source: "allocation",
                  });
                });
              }
            }
          }),
        );
      }
    }

    if (assignmentIdsToDeleteSessions.length > 0) {
      const delChunkSize = 100;
      for (let i = 0; i < assignmentIdsToDeleteSessions.length; i += delChunkSize) {
        const chunk = assignmentIdsToDeleteSessions.slice(i, i + delChunkSize);
        await supabase.from("assignment_sessions").delete().in("assignment_id", chunk);
      }
    }

    if (sessionsToInsert.length > 0) {
      // Strict session deduplication by (batch_id, lab_id, session_date, session_time)
      const seenLabSlot = new Set<string>();
      const seenGroupSlot = new Set<string>();
      const dedupedSessions: any[] = [];
      for (const s of sessionsToInsert) {
        const labKey = `${s.batch_id}\u0000${s.lab_id}\u0000${s.session_date}\u0000${s.session_time}`;
        if (seenLabSlot.has(labKey)) continue;
        seenLabSlot.add(labKey);

        if (s.session_group_id) {
          const groupKey = `${s.batch_id}\u0000${s.session_date}\u0000${s.session_time}\u0000${s.session_group_id}`;
          if (seenGroupSlot.has(groupKey)) continue;
          seenGroupSlot.add(groupKey);
        }
        dedupedSessions.push(s);
      }

      const sessChunkSize = 250;
      for (let i = 0; i < dedupedSessions.length; i += sessChunkSize) {
        const chunk = dedupedSessions.slice(i, i + sessChunkSize);
        const { error: sessErr } = await supabase.from("assignment_sessions").insert(chunk);
        if (sessErr) {
          console.warn("[Reconcile] Sessions insert notice:", sessErr);
        }
      }
    }

    return true;
  }

  const labById = useMemo(() => {
    const m = new Map<string, Lab>();
    for (const l of labs) m.set(l.id, l);
    return m;
  }, [labs]);

  const allocationUsageByLabId = useMemo(() => {
    const byCode = new Map(allocationLabUsage.map((usage) => [usage.labCode, usage]));
    return new Map(labs.map((lab) => [lab.id, lab.lab_code ? byCode.get(lab.lab_code) : undefined]));
  }, [allocationLabUsage, labs]);

  const incidentsByLabId = useMemo(() => {
    const map = new Map<string, Array<Pick<Tables<"lab_incidents">, "id" | "lab_id" | "severity" | "reported_at">>>();
    incidents.forEach((incident) => map.set(incident.lab_id, [...(map.get(incident.lab_id) ?? []), incident]));
    return map;
  }, [incidents]);

  const sessionsByAssignment = useMemo(() => {
    const map = new Map<string, AssignmentSession[]>();
    for (const session of assignmentSessions) {
      const existing = map.get(session.assignment_id);
      if (existing) existing.push(session);
      else map.set(session.assignment_id, [session]);
    }
    return map;
  }, [assignmentSessions]);

  const assignmentSummaries = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getAssignmentScheduleSummary>>();
    assignments.forEach((assignment) => {
      map.set(
        assignment.id,
        getAssignmentScheduleSummary(
          assignment,
          batch,
          sessionsByAssignment.get(assignment.id) ?? [],
        ),
      );
    });
    return map;
  }, [assignments, batch, sessionsByAssignment]);

  const assignedLabIds = useMemo(() => new Set(assignments.map((a) => a.lab_id)), [assignments]);

  const assignmentsByNeed = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const k = a.need_id ?? "none";
      const arr = m.get(k);
      if (arr) arr.push(a);
      else m.set(k, [a]);
    }
    return m;
  }, [assignments]);

  const needsById = useMemo(() => new Map(needs.map((need) => [need.id, need])), [needs]);

  const availableGovs = useMemo(() => {
    const set = new Set<string>();
    for (const n of needs) if (n.gov) set.add(n.gov);
    return Array.from(set).sort();
  }, [needs]);

  const groupedNeeds = useMemo(() => {
    let filtered = needs;

    if (govFilter !== "all") {
      filtered = filtered.filter((n) => n.gov === govFilter);
    }

    if (areaSearch.trim()) {
      const q = areaSearch.trim().toLowerCase();
      filtered = filtered.filter(
        (n) =>
          (n.gov && n.gov.toLowerCase().includes(q)) ||
          (n.area && n.area.toLowerCase().includes(q)),
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((n) => {
        const rows = assignmentsByNeed.get(n.id) ?? [];
        const active = rows.filter((a) => a.status !== "denied");
        const confirmed = rows.filter((a) => a.status === "confirmed").length;
        const critical = active.length < n.labs_required;

        if (statusFilter === "critical") return critical;
        if (statusFilter === "unfilled") return active.length < n.labs_required;
        if (statusFilter === "confirmed") return confirmed >= n.labs_required;
        if (statusFilter === "pending") return rows.some((a) => a.status === "pending");
        return true;
      });
    }

    const map = new Map<string, Need[]>();
    for (const n of filtered) {
      const g = n.gov || "Unassigned Governorate";
      const arr = map.get(g) ?? [];
      arr.push(n);
      map.set(g, arr);
    }

    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [needs, govFilter, areaSearch, statusFilter, assignmentsByNeed]);

  // ---------- Analytics Dashboard Metrics ----------
  const analytics = useMemo(() => {
    const totalRequiredLabs = needs.reduce((sum, n) => sum + (n.labs_required || 0), 0);
    const activeAssignments = assignments.filter((a) => a.status !== "denied");
    const confirmedAssignments = assignments.filter((a) => a.status === "confirmed");
    const pendingAssignments = assignments.filter((a) => a.status === "pending");

    const fulfillmentRate =
      totalRequiredLabs > 0
        ? Math.round((confirmedAssignments.length / totalRequiredLabs) * 100)
        : 0;

    let totalEstimatedCost = 0;
    let totalSeatedCapacity = 0;
    let qualitySum = 0;
    let qualityCount = 0;

    for (const a of activeAssignments) {
      const l = labById.get(a.lab_id);
      const summary = assignmentSummaries.get(a.id) ?? getAssignmentScheduleSummary(a, batch, []);
      const price = Number(a.confirmed_price ?? l?.session_price ?? 0);
      totalEstimatedCost += calculateAssignmentPrice(price, summary);

      if (l?.capacity) {
        totalSeatedCapacity += Number(l.capacity);
      }
      if (scores[a.lab_id] !== undefined) {
        qualitySum += scores[a.lab_id];
        qualityCount++;
      }
    }

    const avgQuality = qualityCount > 0 ? Math.round(qualitySum / qualityCount) : 0;

    let unfulfilledAreasCount = 0;
    for (const n of needs) {
      const nActive = (assignmentsByNeed.get(n.id) ?? []).filter((a) => a.status !== "denied");
      if (nActive.length < n.labs_required) {
        unfulfilledAreasCount++;
      }
    }

    return {
      totalRequiredLabs,
      confirmedCount: confirmedAssignments.length,
      pendingCount: pendingAssignments.length,
      activeCount: activeAssignments.length,
      fulfillmentRate,
      totalEstimatedCost,
      totalSeatedCapacity,
      avgQuality,
      unfulfilledAreasCount,
      allocationStudentTotal,
      totalSessions: allocationLabUsage.reduce((sum, usage) => sum + usage.totalSessions, 0),
      incidentCount: incidents.length,
      replacementRequired: assignments.filter((assignment) => assignment.status === "denied" && !assignments.some((candidate) => candidate.replaces_assignment_id === assignment.id)).length,
    };
  }, [needs, assignments, labById, scores, batch, assignmentsByNeed, assignmentSummaries, allocationStudentTotal, allocationLabUsage, incidents]);

  const operationalRows = useMemo(() => {
    const replacementByDeniedId = new Map(
      assignments.filter((assignment) => assignment.replaces_assignment_id)
        .map((assignment) => [assignment.replaces_assignment_id!, assignment]),
    );
    const sessionOwners = new Map<string, Set<string>>();
    assignmentSessions.forEach((session) => {
      const key = `${session.lab_id}\u0000${session.session_date}\u0000${normalizeTimeSlot(session.session_time)}`;
      const owners = sessionOwners.get(key) ?? new Set<string>();
      owners.add(session.assignment_id);
      sessionOwners.set(key, owners);
    });

    const rows = assignments.map((assignment) => {
      const lab = labById.get(assignment.lab_id);
      const need = assignment.need_id ? needsById.get(assignment.need_id) : undefined;
      const usage = allocationUsageByLabId.get(assignment.lab_id);
      const summary = assignmentSummaries.get(assignment.id) ?? getAssignmentScheduleSummary(assignment, batch, []);
      const labIncidents = incidentsByLabId.get(assignment.lab_id) ?? [];
      const replacement = replacementByDeniedId.get(assignment.id);
      const replacementLab = replacement ? labById.get(replacement.lab_id) : null;
      const hasScheduleConflict = (sessionsByAssignment.get(assignment.id) ?? []).some((session) => {
        const key = `${session.lab_id}\u0000${session.session_date}\u0000${normalizeTimeSlot(session.session_time)}`;
        return (sessionOwners.get(key)?.size ?? 0) > 1;
      });
      const price = Number(assignment.confirmed_price ?? lab?.session_price ?? 0);
      const status = assignment.status === "denied" && replacement
        ? "replaced"
        : assignment.source === "allocation" && !assignment.is_current_allocation
          ? "no_longer_required"
          : assignment.status === "confirmed"
            ? "confirmed"
            : assignment.status === "denied"
              ? "replacement_required"
              : "pending";
      return {
        assignment,
        lab,
        need,
        usage,
        summary,
        incidents: labIncidents,
        status,
        replacementLab,
        hasScheduleConflict,
        governorate: lab?.gov || need?.gov || usage?.governorate || "Unassigned",
        area: lab?.area || need?.area || usage?.physicalArea || "Unassigned",
        uniqueStudents: usage?.uniqueStudents ?? 0,
        seatVisits: usage?.seatVisits ?? 0,
        sessions: usage?.totalSessions ?? summary.totalSessions,
        firstDate: usage?.firstDate || summary.sessionsByDate[0]?.date || "",
        lastDate: usage?.lastDate || summary.sessionsByDate.at(-1)?.date || "",
        qualityScore: scores[assignment.lab_id],
        price,
        totalCost: calculateAssignmentPrice(price, summary),
      };
    });
    const oneRowPerPhysicalLab = new Map<string, (typeof rows)[number]>();
    const rowPriority = (row: (typeof rows)[number]) => {
      const activeStatusPriority = row.status === "confirmed" ? 30 : row.status === "pending" ? 20 : 10;
      if (row.assignment.source === "allocation" && row.assignment.is_current_allocation) return 400 + activeStatusPriority;
      if (row.status === "confirmed") return 300;
      if (row.status === "pending") return 200;
      if (row.status === "replacement_required") return 100;
      if (row.status === "replaced") return 50;
      return 0;
    };
    rows.forEach((row) => {
      const existing = oneRowPerPhysicalLab.get(row.assignment.lab_id);
      if (!existing || rowPriority(row) > rowPriority(existing)) {
        oneRowPerPhysicalLab.set(row.assignment.lab_id, row);
      }
    });
    return Array.from(oneRowPerPhysicalLab.values());
  }, [assignments, assignmentSessions, labById, needsById, allocationUsageByLabId, assignmentSummaries, batch, incidentsByLabId, sessionsByAssignment, scores]);

  const currentAllocationAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.source === "allocation" && assignment.is_current_allocation),
    [assignments],
  );
  const allAllocatedLabs = operationalRows;
  const needsActionLabs = useMemo(() => allAllocatedLabs.filter((row) =>
    row.status === "pending"
    || row.status === "replacement_required"
    || row.incidents.length > 0,
  ), [allAllocatedLabs]);
  const confirmedLabs = useMemo(() => allAllocatedLabs.filter((row) => row.status === "confirmed"), [allAllocatedLabs]);
  const operationalKpis = useMemo(() => {
    const assessed = allAllocatedLabs.filter((row) => row.qualityScore !== undefined);
    return {
      confirmed: confirmedLabs.length,
      pending: allAllocatedLabs.filter((row) => row.status === "pending").length,
      replacementRequired: allAllocatedLabs.filter((row) => row.status === "replacement_required").length,
      replaced: allAllocatedLabs.filter((row) => row.status === "replaced").length,
      sessions: allAllocatedLabs.reduce((sum, row) => sum + row.sessions, 0),
      estimatedCost: allAllocatedLabs.reduce((sum, row) => sum + row.totalCost, 0),
      averageQuality: assessed.length ? Math.round(assessed.reduce((sum, row) => sum + (row.qualityScore ?? 0), 0) / assessed.length) : 0,
      incidents: allAllocatedLabs.reduce((sum, row) => sum + row.incidents.length, 0),
    };
  }, [allAllocatedLabs]);

  const filteredOperationalRows = useMemo(() => {
    const query = labSearch.trim().toLowerCase();
    const tabRows = operationalTab === "action" ? needsActionLabs : allAllocatedLabs;
    return tabRows.filter((row) => {
      if (query && !`${row.lab?.lab_code ?? ""} ${row.lab?.name ?? ""}`.toLowerCase().includes(query)) return false;
      if (govFilter !== "all" && row.governorate !== govFilter) return false;
      if (areaSearch && row.area !== areaSearch) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (qualityFilter === "assessed" && row.qualityScore === undefined) return false;
      if (qualityFilter === "not_assessed" && row.qualityScore !== undefined) return false;
      if (incidentFilter === "yes" && row.incidents.length === 0) return false;
      if (incidentFilter === "no" && row.incidents.length > 0) return false;
      if (conflictFilter === "yes" && !row.hasScheduleConflict) return false;
      if (conflictFilter === "no" && row.hasScheduleConflict) return false;
      return true;
    });
  }, [allAllocatedLabs, needsActionLabs, labSearch, operationalTab, govFilter, areaSearch, statusFilter, qualityFilter, incidentFilter, conflictFilter]);

  const operationalExceptions = useMemo(() => needs.map((need) => {
    const assigned = (assignmentsByNeed.get(need.id) ?? []).filter((assignment) => assignment.status !== "denied").length;
    return { need, assigned, missing: Math.max(0, need.labs_required - assigned) };
  }).filter((item) => item.missing > 0), [needs, assignmentsByNeed]);

  const operationalAreas = useMemo(() => Array.from(new Set(operationalRows
    .filter((row) => govFilter === "all" || row.governorate === govFilter)
    .map((row) => row.area))).sort(), [operationalRows, govFilter]);

  const operationalGovernors = useMemo(() => Array.from(new Set(operationalRows.map((row) => row.governorate))).sort(), [operationalRows]);

  const operationalPageCount = Math.max(1, Math.ceil(filteredOperationalRows.length / opsPageSize));
  const visibleOperationalRows = useMemo(() => filteredOperationalRows.slice((opsPage - 1) * opsPageSize, opsPage * opsPageSize), [filteredOperationalRows, opsPage, opsPageSize]);
  const detailRow = operationalRows.find((row) => row.assignment.id === detailAssignmentId) ?? null;

  useEffect(() => setOpsPage(1), [operationalTab, labSearch, govFilter, areaSearch, statusFilter, qualityFilter, incidentFilter, conflictFilter, opsPageSize]);
  useEffect(() => {
    if (opsPage > operationalPageCount) setOpsPage(operationalPageCount);
  }, [opsPage, operationalPageCount]);

  // ---------- Governorate x Day / Activity Heatmap Data ----------
  const heatmapData = useMemo(() => {
    const govSet = new Set<string>();
    for (const n of needs) if (n.gov) govSet.add(n.gov);
    for (const a of assignments) {
      const l = labById.get(a.lab_id);
      if (l?.gov) govSet.add(l.gov);
    }
    const govsList = Array.from(govSet).sort();
    const datesList = batchDates;

    const matrix: Record<
      string,
      Record<string, { confirmed: number; pending: number; needed: number }>
    > = {};

    for (const g of govsList) {
      matrix[g] = {};
      for (const d of datesList) {
        matrix[g][d] = { confirmed: 0, pending: 0, needed: 0 };
      }
    }

    for (const n of needs) {
      if (!n.gov || !matrix[n.gov]) continue;
      for (const d of datesList) {
        matrix[n.gov][d].needed += n.labs_required || 0;
      }
    }

    for (const a of assignments) {
      if (a.status === "denied") continue;
      const l = labById.get(a.lab_id);
      if (!l?.gov || !matrix[l.gov]) continue;
      for (const d of datesList) {
        if (a.status === "confirmed") matrix[l.gov][d].confirmed++;
        else if (a.status === "pending") matrix[l.gov][d].pending++;
      }
    }

    return { govsList, datesList, matrix };
  }, [needs, assignments, labById, batchDates]);

  function rankCandidates(
    gov: string,
    area: string,
  ): Array<Lab & { score: number; compositeScore: number }> {
    const cands = labs
      .filter(
        (l) => l.gov === gov && l.area === area && !reserved.has(l.id) && !assignedLabIds.has(l.id),
      )
      .map((l) => ({ ...l, score: scores[l.id] ?? 0 }));

    if (!cands.length) return [];

    let minPrice = Infinity,
      maxPrice = -Infinity;
    let minSeats = Infinity,
      maxSeats = -Infinity;
    for (const c of cands) {
      const price = Number(c.session_price ?? 0);
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;

      const seats = Number(c.capacity ?? 0);
      if (seats < minSeats) minSeats = seats;
      if (seats > maxSeats) maxSeats = seats;
    }

    const evaluated = cands.map((c) => {
      let total = 0;
      let count = 0;

      // Quality factor (0..1) with neutral baseline (50/100 for unassessed)
      if (rankCriteria.quality) {
        const qScore = scores[c.id] !== undefined && scores[c.id] !== null ? scores[c.id] : 50;
        total += Math.min(1, Math.max(0, qScore / 100));
        count++;
      }

      // Best Price factor (lower price = higher 0..1 score)
      if (rankCriteria.price) {
        const range = maxPrice - minPrice;
        const normPrice = range > 0 ? 1 - (Number(c.session_price ?? 0) - minPrice) / range : 1;
        total += normPrice;
        count++;
      }

      // Seats Capacity factor (more seats = higher 0..1 score)
      if (rankCriteria.seats) {
        const range = maxSeats - minSeats;
        const normSeats = range > 0 ? (Number(c.capacity ?? 0) - minSeats) / range : 1;
        total += normSeats;
        count++;
      }

      const compositeScore = count > 0 ? (total / count) * 100 : 0;
      return { ...c, compositeScore };
    });

    evaluated.sort((a, b) => b.compositeScore - a.compositeScore);
    return evaluated;
  }

  function rankNearbyCandidates(
    gov: string,
    targetArea: string,
  ): Array<Lab & { score: number; compositeScore: number; distanceKm: number | null }> {
    const areaRefLab = labs.find((l) => l.gov === gov && l.area === targetArea);
    const targetCoords = getCoords(targetArea, areaRefLab);
    const targetAreaNorm = normalizeAreaForComparison(targetArea);

    const cands = labs
      .filter(
        (l) =>
          l.gov === gov &&
          l.area !== targetArea &&
          !reserved.has(l.id) &&
          !assignedLabIds.has(l.id),
      )
      .map((l) => {
        const labCoords = getCoords(l.area, l);
        const refNearbyList = getLabNearbyList(areaRefLab);
        const destNearbyList = getLabNearbyList(l);
        const lAreaNorm = normalizeAreaForComparison(l.area);

        let distanceKm: number | null = null;
        if (targetAreaNorm && lAreaNorm && targetAreaNorm === lAreaNorm) {
          distanceKm = 0.0;
        }

        if (distanceKm === null) {
          const directMatch = refNearbyList.find((n: any) => {
            const nId = getEntryId(n);
            const nCode = getEntryCode(n);
            return (nId && (nId === l.id || nId === l.lab_code)) || (nCode && nCode === l.lab_code);
          }) ?? destNearbyList.find((n: any) => {
            const nId = getEntryId(n);
            const nCode = getEntryCode(n);
            return (nId && (nId === areaRefLab?.id || nId === areaRefLab?.lab_code)) || (nCode && nCode === areaRefLab?.lab_code);
          });

          if (directMatch) {
            distanceKm = getEntryDistance(directMatch);
          }
        }

        if (distanceKm === null && targetCoords && labCoords) {
          distanceKm = getDistanceKm(targetCoords.lat, targetCoords.lng, labCoords.lat, labCoords.lng);
        }
        return { ...l, score: scores[l.id] ?? 50, distanceKm };
      });

    if (!cands.length) return [];

    let minPrice = Infinity,
      maxPrice = -Infinity;
    let minSeats = Infinity,
      maxSeats = -Infinity;
    for (const c of cands) {
      const price = Number(c.session_price ?? 0);
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;

      const seats = Number(c.capacity ?? 0);
      if (seats < minSeats) minSeats = seats;
      if (seats > maxSeats) maxSeats = seats;
    }

    const evaluated = cands.map((c) => {
      let total = 0;
      let count = 0;

      if (rankCriteria.quality) {
        const qScore = scores[c.id] !== undefined && scores[c.id] !== null ? scores[c.id] : 50;
        total += Math.min(1, Math.max(0, qScore / 100));
        count++;
      }

      if (rankCriteria.price) {
        const range = maxPrice - minPrice;
        const normPrice = range > 0 ? 1 - (Number(c.session_price ?? 0) - minPrice) / range : 1;
        total += normPrice;
        count++;
      }

      if (rankCriteria.seats) {
        const range = maxSeats - minSeats;
        const normSeats = range > 0 ? (Number(c.capacity ?? 0) - minSeats) / range : 1;
        total += normSeats;
        count++;
      }

      const compositeScore = count > 0 ? (total / count) * 100 : 0;
      return { ...c, compositeScore };
    });

    evaluated.sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      return b.compositeScore - a.compositeScore;
    });

    return evaluated;
  }

  function rankReplacementCandidates(denied: Assignment) {
    const deniedLab = labById.get(denied.lab_id);
    const usage = allocationLabUsage.find((item) => item.labCode === deniedLab?.lab_code);

    // Prefer assignment sessions -> allocationLabUsage sessions -> batch.dates & batch.time_slots
    let requiredSessions = (sessionsByAssignment.get(denied.id) ?? []).map((session) => ({
      date: session.session_date,
      time: session.session_time,
    }));
    if (requiredSessions.length === 0 && usage?.sessions && usage.sessions.length > 0) {
      requiredSessions = usage.sessions.map((s) => ({ date: s.date, time: s.time }));
    }
    if (requiredSessions.length === 0 && batchDates.length > 0) {
      const slots = batchTimeSlots.length > 0 ? batchTimeSlots : (usage?.timeSlots && usage.timeSlots.length > 0 ? usage.timeSlots : DEFAULT_BATCH_TIME_SLOTS);
      requiredSessions = batchDates.flatMap((date) => slots.map((time) => ({ date, time })));
    }

    const activeById = new Map(allActiveAssignments
      .filter((assignment) => assignment.id !== denied.id && !(assignment.source === "allocation" && !assignment.is_current_allocation))
      .map((assignment) => [assignment.id, assignment]));
    const deniedCoords = getCoords(deniedLab?.area, deniedLab);
    const deniedAreaNorm = normalizeAreaForComparison(deniedLab?.area);
    const deniedNearby = getLabNearbyList(deniedLab);
    const deniedIdLower = String(deniedLab?.id || "").trim().toLowerCase();
    const deniedCodeLower = String(deniedLab?.lab_code || "").trim().toLowerCase();
    const deniedNameNorm = normalizeArabic(cleanArabicString(String(deniedLab?.name || "")));

    return labs
      .filter((lab) => lab.id !== denied.lab_id && lab.is_active && !assignedLabIds.has(lab.id))
      .map((lab) => {
        const occupiedSessions = allAssignmentSessions
          .filter((session) => session.lab_id === lab.id && activeById.has(session.assignment_id))
          .map((session) => ({ date: session.session_date, time: session.session_time }));
        const availability = calculateReplacementAvailability(requiredSessions, occupiedSessions);

        const labIdLower = String(lab.id || "").trim().toLowerCase();
        const labCodeLower = String(lab.lab_code || "").trim().toLowerCase();
        const labNameNorm = normalizeArabic(cleanArabicString(String(lab.name || "")));
        const candNearby = getLabNearbyList(lab);
        const candidateAreaNorm = normalizeAreaForComparison(lab.area);

        let distanceKm: number | null = null;

        // Auto-resolve to 0.0 km when candidate and denied lab share the exact same physical area
        if (deniedAreaNorm && candidateAreaNorm && deniedAreaNorm === candidateAreaNorm) {
          distanceKm = 0.0;
        }

        // 1. Forward lookup in denied lab's nearby_labs
        if (distanceKm === null) {
          let matchEntry = deniedNearby.find((entry: any) => {
            const nId = getEntryId(entry);
            const nCode = getEntryCode(entry);
            const nName = getEntryNameNorm(entry);
            return Boolean(
              (nId && (nId === labIdLower || nId === labCodeLower)) ||
              (nCode && nCode === labCodeLower) ||
              (!nId && !nCode && nName && labNameNorm && nName === labNameNorm)
            );
          });

          // 2. Reverse lookup in candidate lab's nearby_labs
          if (!matchEntry) {
            matchEntry = candNearby.find((entry: any) => {
              const nId = getEntryId(entry);
              const nCode = getEntryCode(entry);
              const nName = getEntryNameNorm(entry);
              return Boolean(
                (nId && (nId === deniedIdLower || nId === deniedCodeLower)) ||
                (nCode && nCode === deniedCodeLower) ||
                (!nId && !nCode && nName && deniedNameNorm && nName === deniedNameNorm)
              );
            });
          }

          if (matchEntry) {
            const d = getEntryDistance(matchEntry);
            if (d !== null) distanceKm = d;
          }
        }

        // 3. Coordinate-based distance fallback
        const candidateCoords = getCoords(lab.area, lab);
        if (distanceKm === null && deniedCoords && candidateCoords) {
          distanceKm = getDistanceKm(deniedCoords.lat, deniedCoords.lng, candidateCoords.lat, candidateCoords.lng);
        }

        const requiredCapacity = usage?.requiredSessionCapacity ?? Number(deniedLab?.capacity ?? 0);
        return {
          ...lab,
          qualityScore: scores[lab.id] ?? null,
          distanceKm,
          requiredCapacity,
          capacitySufficient: Number(lab.capacity) >= requiredCapacity,
          ...availability,
        };
      })
      .sort((a, b) => {
        const availabilityOrder = { available: 0, partially_conflicted: 1, unavailable: 2 };
        const effectiveQualityA = a.qualityScore !== null && a.qualityScore !== undefined ? Number(a.qualityScore) : 50;
        const effectiveQualityB = b.qualityScore !== null && b.qualityScore !== undefined ? Number(b.qualityScore) : 50;
        return availabilityOrder[a.status] - availabilityOrder[b.status]
          || Number(b.capacitySufficient) - Number(a.capacitySufficient)
          || (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)
          || (effectiveQualityB - effectiveQualityA)
          || Number(a.session_price ?? 0) - Number(b.session_price ?? 0);
      });
  }

  // ---------- Needs import ----------
  async function importNeeds(file: File) {
    try {
      const rows = await parseSheet(file);
      const mapped = rows
        .map((r) => ({
          batch_id: batch.id,
          gov: pick(r, ["Gov", "Governorate", "gov", "المحافظة"]),
          area: pick(r, ["Area", "area", "المنطقة"]),
          labs_required:
            Number(pick(r, ["Labs required", "Labs", "labs_required", "count", "العدد"])) || 1,
        }))
        .filter((r) => r.gov && r.area);
      if (!mapped.length) return toast.error("No rows found (need Gov, Area, Labs required).");
      const { error } = await supabase.from("batch_needs").insert(mapped);
      if (error) return toast.error(error.message);
      toast.success(`Imported ${mapped.length} area need(s).`);
      await loadAll(true);
    } catch (e) {
      toast.error(`Parse error: ${(e as Error).message}`);
    } finally {
      if (needsFileRef.current) needsFileRef.current.value = "";
    }
  }

  function addNeed() {
    setAddNeedModalOpen(true);
  }

  // ---------- Auto-assign ----------
  async function autoAssign() {
    const used = new Set(assignedLabIds);
    const defaultDays = batchDates.length || 1;
    const toInsert: Array<{
      batch_id: string;
      need_id: string;
      lab_id: string;
      status: "pending";
      days: number;
    }> = [];
    for (const need of needs) {
      const already = assignments.filter(
        (a) => a.need_id === need.id && a.status !== "denied",
      ).length;
      const remaining = need.labs_required - already;
      if (remaining <= 0) continue;
      const cands = rankCandidates(need.gov, need.area).filter((c) => !used.has(c.id));
      for (const c of cands.slice(0, remaining)) {
        toInsert.push({
          batch_id: batch.id,
          need_id: need.id,
          lab_id: c.id,
          status: "pending",
          days: defaultDays,
        });
        used.add(c.id);
      }
    }
    if (!toInsert.length) return toast.info("Nothing to assign (needs met or no free labs).");
    const { error } = await supabase.from("assignments").insert(toInsert);
    if (error) return toast.error(error.message);
    await supabase.from("batches").update({ status: "assigning" }).eq("id", batch.id);
    toast.success(`Assigned ${toInsert.length} lab(s) as pending.`);
    await loadAll(true);
    onChanged();
  }

  // ---------- Bulk Confirm All Pending ----------
  async function confirmAllPending() {
    const pendings = assignments.filter((a) => a.status === "pending");
    if (!pendings.length) return toast.info("No pending assignments to confirm.");
    if (
      !confirm(
        `Are you sure you want to confirm all ${pendings.length} pending lab assignment(s) at default session prices?`,
      )
    )
      return;

    let count = 0;
    for (const a of pendings) {
      const lab = labById.get(a.lab_id);
      const price = Number(a.confirmed_price ?? lab?.session_price ?? 0);
      const { error } = await supabase
        .from("assignments")
        .update({ status: "confirmed", confirmed_price: price })
        .eq("id", a.id);
      if (!error) count++;
    }
    toast.success(`Successfully confirmed ${count} lab assignment(s).`);
    await loadAll(true);
    onChanged();
  }

  // ---------- Confirm / Deny ----------
  function openConfirm(a: Assignment) {
    const lab = labById.get(a.lab_id);
    setConfirmPrice(Number(a.confirmed_price ?? lab?.session_price ?? 0));
    setConfirmFor(a);
  }
  async function doConfirm() {
    if (!confirmFor || confirmSaving) return;
    if (!canEdit) {
      toast.error("View only - insufficient permission to confirm labs.");
      return;
    }
    const targetId = confirmFor.id;
    const newPrice = confirmPrice;
    if (!Number.isFinite(newPrice) || newPrice < 0) {
      toast.error("Session price must be a finite number greater than or equal to 0.");
      return;
    }
    if (import.meta.env.DEV) console.log("[Confirm Lab] start", { assignmentId: targetId, price: newPrice });
    setConfirmSaving(true);
    try {
      const { data, error } = await supabase
        .from("assignments")
        .update({ status: "confirmed", confirmed_price: newPrice })
        .eq("id", targetId)
        .select("*")
        .maybeSingle();
      if (import.meta.env.DEV) console.log("[Confirm Lab] result", {
        assignmentId: targetId,
        returnedId: data?.id,
        status: data?.status,
        error,
      });
      if (error) throw error;
      if (!data || data.id !== targetId || data.status !== "confirmed") {
        throw new Error("Confirmation was not saved. Check assignment permissions.");
      }
      setAssignments((previous) => previous.map((assignment) => assignment.id === targetId ? data as Assignment : assignment));
      setConfirmFor(null);
      toast.success("Lab confirmed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Confirmation was not saved.");
    } finally {
      setConfirmSaving(false);
    }
  }
  function openDeny(a: Assignment) {
    setDenialFor(a);
    setDenialReason("");
  }

  async function openIncidentList(lab: Lab) {
    const { data, error } = await supabase.from("lab_incidents").select("*")
      .eq("batch_id", batch.id).eq("project_id", project.id).eq("lab_id", lab.id)
      .order("reported_at", { ascending: false });
    if (error) {
      toast.error(`Could not load incidents: ${error.message}`);
      return;
    }
    setIncidentDetails((data ?? []) as Tables<"lab_incidents">[]);
    setIncidentListLab(lab);
  }

  async function submitDeny() {
    if (!denialFor) return;
    const target = denialFor;
    const reason = denialReason.trim();
    setDenialFor(null);
    setDenialReason("");

    const { error } = await supabase
      .from("assignments")
      .update({ status: "denied", denied_reason: reason })
      .eq("id", target.id);
    if (error) return toast.error(error.message);
    setAssignments((previous) => previous.map((assignment) => assignment.id === target.id ? { ...assignment, status: "denied", denied_reason: reason } : assignment));
    const need = needs.find((n) => n.id === target.need_id) ?? null;
    if (need) {
      await prepareReplacement(target, need);
    }
  }

  async function prepareReplacement(assignment: Assignment, need: Need) {
    const { data, error } = await supabase.from("assignment_sessions").select("*");
    if (error) {
      toast.error(`Could not load replacement availability: ${error.message}`);
      return;
    }
    setAllAssignmentSessions((data ?? []) as AssignmentSession[]);
    setReplacementFor(assignment);
    setPickerNeed(need);
  }
  async function removeAssignment(a: Assignment) {
    setAssignments((prev) => prev.filter((item) => item.id !== a.id));
    setAssignmentSessions((prev) => prev.filter((item) => item.assignment_id !== a.id));
    setAllAssignmentSessions((prev) => prev.filter((item) => item.assignment_id !== a.id));
    const { error } = await supabase.from("assignments").delete().eq("id", a.id);
    if (error) return toast.error(error.message);
    void loadAll(true);
  }
  async function assignCandidate(need: Need, labId: string) {
    let replacementSessions = replacementFor ? (sessionsByAssignment.get(replacementFor.id) ?? []) : [];
    if (replacementFor && replacementSessions.length === 0) {
      const { data: dbSessions } = await supabase
        .from("assignment_sessions")
        .select("*")
        .eq("assignment_id", replacementFor.id);
      if (dbSessions && dbSessions.length > 0) {
        replacementSessions = dbSessions as AssignmentSession[];
      }
    }

    const defaultDays = replacementSessions.length
      ? new Set(replacementSessions.map((session) => session.session_date)).size
      : batchDates.length || 1;
    const { data: inserted, error } = await supabase
      .from("assignments")
      .insert({
        batch_id: batch.id,
        need_id: need.id,
        lab_id: labId,
        status: "pending",
        days: defaultDays,
        sessions_per_day: 0,
        source: replacementFor ? "allocation" : "manual",
        allocation_run_id: replacementFor?.allocation_run_id ?? null,
        is_current_allocation: Boolean(replacementFor?.is_current_allocation),
        replaces_assignment_id: replacementFor?.id ?? null,
      })
      .select("*")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (replacementFor && inserted) {
      // Mark replaced assignment as no longer current allocation in DB
      await supabase
        .from("assignments")
        .update({ is_current_allocation: false })
        .eq("id", replacementFor.id);

      // Delete old session rows from replacementFor and inserted to prevent unique constraint collisions on assignment_sessions_group_slot_idx
      const { error: deleteOldError } = await supabase
        .from("assignment_sessions")
        .delete()
        .in("assignment_id", [replacementFor.id, inserted.id]);
      if (deleteOldError) {
        console.error("Failed to clear old sessions for replaced assignment:", deleteOldError);
        await supabase.from("assignments").delete().eq("id", inserted.id);
        toast.error(`Failed to reassign sessions: ${deleteOldError.message}`);
        return;
      }

      if (replacementSessions.length) {
        const payload = replacementSessions.map((session) => ({
          assignment_id: inserted.id,
          batch_id: batch.id,
          lab_id: labId,
          session_date: session.session_date,
          session_time: session.session_time,
          session_group_id: session.session_group_id ?? null,
          source: "replacement" as const,
        }));

        const { error: sessionError } = await supabase.from("assignment_sessions").insert(payload);
        if (sessionError) {
          // Atomic rollback: clean up inserted assignment, revert replaced is_current_allocation, and restore all original sessions to replacementFor
          await supabase.from("assignments").delete().eq("id", inserted.id);
          await supabase.from("assignments").update({ is_current_allocation: true }).eq("id", replacementFor.id);
          const restorePayload = replacementSessions.map((session) => ({
            assignment_id: replacementFor.id,
            batch_id: session.batch_id || batch.id,
            lab_id: replacementFor.lab_id,
            session_date: session.session_date,
            session_time: session.session_time,
            session_group_id: session.session_group_id ?? null,
            source: session.source || "allocation",
          }));
          await supabase.from("assignment_sessions").insert(restorePayload);
          toast.error(`Failed to assign replacement sessions: ${sessionError.message}`);
          return;
        }
      }
    }
    toast.success("Lab assigned as pending!");
    if (inserted) {
      setAssignments((previous) => [
        ...previous.map((a) => (a.id === replacementFor?.id ? { ...a, is_current_allocation: false } : a)),
        inserted as Assignment,
      ]);
      if (replacementFor) {
        const { data: createdSessions } = await supabase.from("assignment_sessions").select("*").eq("assignment_id", inserted.id);
        const rows = (createdSessions ?? []) as AssignmentSession[];
        setAssignmentSessions((previous) => [
          ...previous.filter((s) => s.assignment_id !== replacementFor.id && s.assignment_id !== inserted.id),
          ...rows,
        ]);
        setAllAssignmentSessions((previous) => [
          ...previous.filter((s) => s.assignment_id !== replacementFor.id && s.assignment_id !== inserted.id),
          ...rows,
        ]);
      }
    }
    setReplacementFor(null);
    setPickerNeed(null);
    void loadAll(true);
    onChanged();
  }

  function openScheduleEditor(assignment: Assignment) {
    const currentSessions = sessionsByAssignment.get(assignment.id) ?? [];
    const draftByDate = new Map<string, string[]>();

    currentSessions.forEach((session) => {
      const slots = draftByDate.get(session.session_date) ?? [];
      const sessionTime = normalizeTimeSlot(session.session_time) ?? session.session_time.trim();
      draftByDate.set(
        session.session_date,
        normalizeTimeSlots([...slots, sessionTime], { preserveInvalid: true }),
      );
    });

    if (draftByDate.size === 0) {
      const legacySummary = getAssignmentScheduleSummary(assignment, batch, []);
      legacySummary.sessionsByDate.forEach((item) => {
        draftByDate.set(
          item.date,
          Array.from(
            { length: item.sessions },
            (_, index) => batchTimeSlots[index] ?? `Session ${index + 1}`,
          ),
        );
      });
    }

    const nextDraft = [...draftByDate.entries()]
      .map(([date, selectedSlots]) => ({
        date,
        selectedSlots: normalizeTimeSlots(selectedSlots, { preserveInvalid: true }),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    setScheduleDraft(
      nextDraft.length
        ? nextDraft
        : [
            {
              date: batchDates[0] ?? "",
              selectedSlots: batchTimeSlots[0] ? [batchTimeSlots[0]] : [],
            },
          ],
    );
    setScheduleFor(assignment);
  }

  function addScheduleDay() {
    const nextDate = batchDates.find((date) => !scheduleDraft.some((draft) => draft.date === date));
    if (!nextDate) {
      toast.error("All configured batch dates are already in this schedule.");
      return;
    }
    setScheduleDraft((prev) => [
      ...prev,
      { date: nextDate, selectedSlots: batchTimeSlots[0] ? [batchTimeSlots[0]] : [] },
    ]);
  }

  function updateScheduleDraftDate(index: number, date: string) {
    setScheduleDraft((prev) =>
      prev.map((row, rowIndex) => (rowIndex === index ? { ...row, date } : row)),
    );
  }

  function toggleScheduleSlot(index: number, slot: string) {
    setScheduleDraft((prev) =>
      prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const selectedSlots = normalizeTimeSlots(row.selectedSlots, { preserveInvalid: true });
        if (!selectedSlots.includes(slot) && selectedSlots.length >= MAX_SESSIONS_PER_DAY) {
          toast.error("A schedule date can have a maximum of 4 time slots.");
          return row;
        }
        const nextSelectedSlots = selectedSlots.includes(slot)
          ? selectedSlots.filter((item) => item !== slot)
          : normalizeTimeSlots([...selectedSlots, slot], { preserveInvalid: true });
        return { ...row, selectedSlots: nextSelectedSlots };
      }),
    );
  }

  function removeScheduleDraftRow(index: number) {
    setScheduleDraft((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }

  async function saveScheduleEditor() {
    if (!scheduleFor) return;
    const validation = validateManualSchedule(scheduleDraft, batchTimeSlots, batchDates);
    if (validation.errors.length > 0) {
      toast.error(validation.errors[0]);
      return;
    }
    setSavingSchedule(true);
    try {
      const payload = buildManualSchedulePayload(scheduleDraft, batchTimeSlots, batchDates);
      const { error } = await supabase.rpc("replace_assignment_schedule", {
        _assignment_id: scheduleFor.id,
        _sessions: payload,
        _source: "manual",
      });
      if (error) throw error;
      toast.success("Schedule updated");
      setScheduleFor(null);
      await loadAll(true);
      onChanged();
    } catch (e: any) {
      toast.error(e.message || "Failed to update schedule");
    } finally {
      setSavingSchedule(false);
    }
  }

  // ---------- Export ----------
  async function exportToOps() {
    const confirmed = assignments.filter((a) => a.status === "confirmed");
    if (!confirmed.length) return toast.error("No confirmed labs to export.");
    const rows = confirmed.map((a) => {
      const l = labById.get(a.lab_id);
      const summary = assignmentSummaries.get(a.id) ?? getAssignmentScheduleSummary(a, batch, []);
      return {
        "Lab ID": l?.lab_code ?? "",
        "Lab Name": l?.name ?? "",
        Gov: l?.gov ?? "",
        Area: l?.area ?? "",
        Vendor: l?.vendor_name ?? "",
        Capacity: l?.capacity ?? 0,
        "Confirmed Price (EGP)": Number(a.confirmed_price ?? 0),
        "Scheduled Days": summary.totalDays,
        "Total Sessions": summary.totalSessions,
        "Sessions By Date": formatSessionsByDate(summary),
        "Time Slots": summary.sessionTimes.join(" | "),
        Supervisor: l?.supervisor_name ?? "",
        "Sup. Phone": l?.supervisor_phone ?? "",
        Facilitator: l?.facilitator_name ?? "",
        "Fac. Phone": l?.facilitator_phone ?? "",
      };
    });
    downloadCsv(`ops-${batch.name.replace(/\s+/g, "-").toLowerCase()}.csv`, rows);
    await supabase.from("batches").update({ status: "exported" }).eq("id", batch.id);
    toast.success("Exported to Ops sheet.");
    await loadAll(true);
    onChanged();
  }

  const scheduleDraftSummary = useMemo(() => {
    return validateManualSchedule(scheduleDraft, batchTimeSlots, batchDates);
  }, [scheduleDraft, batchTimeSlots, batchDates]);

  // Batch student filters and pagination
  if (loading) return <div className="text-sm text-muted-foreground">Loading batch…</div>;

  const rawScheduleEditorUnitPrice = scheduleFor
    ? Number(scheduleFor.confirmed_price ?? labById.get(scheduleFor.lab_id)?.session_price ?? 0)
    : 0;
  const scheduleEditorUnitPrice = Number.isFinite(rawScheduleEditorUnitPrice)
    ? Math.max(0, rawScheduleEditorUnitPrice)
    : 0;

  const scheduleSlotOptions = batchTimeSlots.map((value) => ({ value, available: true }));
  const canAddScheduleDay = batchDates.some(
    (date) => !scheduleDraft.some((draft) => draft.date === date),
  );

  return (
    <div className="space-y-6">
      {/* Schedule & Time Slots Setup Card */}
      <Card className="shadow-xs bg-card border-border/70">
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-[#056FEC]/10 p-1.5 text-[#056FEC] dark:text-[#05ACFF]">
                  <Layers className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-bold">Schedule Setup: {batch.name}</CardTitle>
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] uppercase border-[#056FEC]/30 text-[#056FEC]"
                >
                  {batch.status || "Draft"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Operational calendar dates and configured time slots per day for this cohort.
              </p>
            </div>

            {canManageBatch && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEditBatch?.(batch)}
                className="h-8 text-xs gap-1.5 rounded-xl font-semibold border-border/70 shadow-2xs"
                title="Configure batch session dates and day-by-day time slots"
              >
                <Pencil className="h-3.5 w-3.5 text-[#056FEC]" /> Edit Batch &amp; Slots
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-0">
          <div className="p-4 rounded-xl border bg-muted/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[#056FEC] dark:text-[#05ACFF]" />
                <span className="text-xs font-bold text-foreground">
                  Schedule &amp; Slots: {batchDates.length} Days · {batchTimeSlots.length} Slots
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {batchTimeSlots.map((slot) => (
                  <Badge
                    key={slot}
                    variant="outline"
                    className="font-mono text-xs py-0.5 px-2 bg-background border-[#056FEC]/30 text-[#056FEC] font-semibold"
                  >
                    {formatTimeSlot(slot)}
                  </Badge>
                ))}
                {batchTimeSlots.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">
                    Standard 4 daily shifts
                  </span>
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground flex flex-col items-start md:items-end gap-1 shrink-0 border-t md:border-t-0 md:border-l border-border/50 pt-2 md:pt-0 md:pl-4">
              <span className="font-semibold text-foreground">
                {formatScheduleDate(batchDates[0] || "—")} to{" "}
                {formatScheduleDate(batchDates[batchDates.length - 1] || "—")}
              </span>
              <span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded border border-border/40">
                {batchDates.length} calendar days scheduled
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Governorate x Day Activity Heatmap Matrix */}
      {heatmapData.govsList.length > 0 && (
        <Collapsible open={heatmapOpen} onOpenChange={setHeatmapOpen}>
          <Card className="border-border/60 shadow-xs">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#056FEC] dark:text-[#05ACFF]" />
                  <div>
                    <div className="text-sm font-semibold">
                      Governorate &amp; Daily Activity Heatmap
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {heatmapData.govsList.length} governorates across{" "}
                      {heatmapData.datesList.length} days · {analytics.unfulfilledAreasCount}{" "}
                      unfilled areas
                    </div>
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${heatmapOpen ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-wrap gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#056FEC]" /> Confirmed
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FFBB1C]" /> Pending
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Unfilled Need
                </span>
              </div>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-40 font-semibold">Governorate</TableHead>
                        {heatmapData.datesList.map((d, idx) => (
                          <TableHead key={d} className="text-center font-mono text-xs">
                            Day {idx + 1}
                            <div className="text-[10px] text-muted-foreground font-normal">{d}</div>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {heatmapData.govsList.map((gov) => {
                        return (
                          <TableRow key={gov}>
                            <TableCell className="font-medium text-xs">{gov}</TableCell>
                            {heatmapData.datesList.map((d) => {
                              const cell = heatmapData.matrix[gov]?.[d] ?? {
                                confirmed: 0,
                                pending: 0,
                                needed: 0,
                              };
                              const isFullyConfirmed =
                                cell.needed > 0 && cell.confirmed >= cell.needed;
                              const isPendingAssigned = cell.pending > 0;
                              const isUnfilled = cell.needed > cell.confirmed + cell.pending;

                              return (
                                <TableCell key={d} className="p-2 text-center">
                                  {cell.needed === 0 ? (
                                    <span className="text-xs text-muted-foreground/30">—</span>
                                  ) : isFullyConfirmed ? (
                                    <Badge className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-mono text-xs px-2 py-0.5">
                                      {cell.confirmed}/{cell.needed} Labs
                                    </Badge>
                                  ) : isPendingAssigned ? (
                                    <Badge
                                      variant="outline"
                                      className="border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200 font-mono text-xs px-2 py-0.5"
                                    >
                                      {cell.confirmed + cell.pending}/{cell.needed} Pending
                                    </Badge>
                                  ) : isUnfilled ? (
                                    <Badge
                                      variant="destructive"
                                      className="font-mono text-xs px-2 py-0.5"
                                    >
                                      {cell.confirmed}/{cell.needed} Unfilled
                                    </Badge>
                                  ) : (
                                    <span className="text-xs font-mono">
                                      {cell.confirmed}/{cell.needed}
                                    </span>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-9">
        {[
          { label: "Allocated Physical Labs", value: allAllocatedLabs.length, filter: () => { setOperationalTab("all"); setStatusFilter("all"); } },
          { label: "Confirmed", value: operationalKpis.confirmed, filter: () => { setOperationalTab("all"); setStatusFilter("confirmed"); } },
          { label: "Pending", value: operationalKpis.pending, filter: () => { setOperationalTab("all"); setStatusFilter("pending"); } },
          { label: "Replacement Required", value: operationalKpis.replacementRequired, filter: () => { setOperationalTab("all"); setStatusFilter("replacement_required"); } },
          { label: "Total Students", value: analytics.allocationStudentTotal },
          { label: "Total Sessions", value: operationalKpis.sessions },
          { label: "Estimated Cost", value: formatEGP(operationalKpis.estimatedCost) },
          { label: "Avg Quality", value: operationalKpis.averageQuality ? `${operationalKpis.averageQuality}/100` : "Not Assessed", filter: () => { setOperationalTab("all"); setQualityFilter("assessed"); } },
          { label: "Incidents", value: operationalKpis.incidents, filter: () => { setOperationalTab("all"); setIncidentFilter("yes"); } },
        ].map(({ label, value, filter }) => <button type="button" key={label} disabled={!filter} onClick={filter} className="border-l-2 border-primary px-3 py-2 text-left disabled:cursor-default"><div className="text-[11px] text-muted-foreground">{label}</div><div className="text-lg font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</div></button>)}
      </div>

      {/* Allocated Labs & Operational Approval Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[#056FEC]" />
          <div>
            <div className="text-base font-bold text-foreground flex items-center gap-2">
              <span>Allocated Labs &amp; Operational Approval</span>
              <Badge variant="outline" className="font-mono text-xs">
                {needs.length} Areas · {analytics.totalRequiredLabs} Labs Required
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Latest synced allocation labs, operational decisions, schedules, quality, and incidents.
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={needsFileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importNeeds(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => needsFileRef.current?.click()}
              className="h-8.5 text-xs gap-1.5 font-medium"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#056FEC]" />
              Advanced: Import Needs
            </Button>
            <Button
              size="sm"
              onClick={addNeed}
              className="h-8.5 text-xs gap-1.5 font-semibold bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Advanced: Add Need
            </Button>
          </div>
        )}
      </div>

      <Card className="border-border/70 shadow-xs">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
              <Button size="sm" variant={operationalTab === "action" ? "default" : "ghost"} onClick={() => { setOperationalTab("action"); setStatusFilter("all"); }}>Needs Action ({needsActionLabs.length})</Button>
              <Button size="sm" variant={operationalTab === "all" ? "default" : "ghost"} onClick={() => { setOperationalTab("all"); setStatusFilter("all"); }}>All Allocated Labs ({allAllocatedLabs.length})</Button>
              <Button size="sm" variant={operationalTab === "exceptions" ? "default" : "ghost"} onClick={() => { setOperationalTab("exceptions"); setStatusFilter("all"); }}>Operational Exceptions ({operationalExceptions.length})</Button>
            </div>
            {operationalTab !== "exceptions" && <div className="flex rounded-md border p-1">
              <Button size="sm" variant={operationalView === "labs" ? "secondary" : "ghost"} onClick={() => setOperationalView("labs")}><Grid className="mr-1 h-4 w-4" /> Labs</Button>
              <Button size="sm" variant={operationalView === "governorates" ? "secondary" : "ghost"} onClick={() => setOperationalView("governorates")}><MapPin className="mr-1 h-4 w-4" /> Group by Governorate</Button>
            </div>}
          </div>

          {operationalTab !== "exceptions" && <>
            <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-7">
              <div className="relative md:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={labSearch} onChange={(event) => setLabSearch(event.target.value)} placeholder="Search Lab ID / Name" /></div>
              <Select value={govFilter} onValueChange={(value) => { setGovFilter(value); setAreaSearch(""); }}><SelectTrigger><SelectValue placeholder="Governorate" /></SelectTrigger><SelectContent><SelectItem value="all">All Governorates</SelectItem>{operationalGovernors.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
              <Select value={areaSearch || "all"} onValueChange={(value) => setAreaSearch(value === "all" ? "" : value)}><SelectTrigger><SelectValue placeholder="Physical Area" /></SelectTrigger><SelectContent><SelectItem value="all">All Areas</SelectItem>{operationalAreas.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
              <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); if (value === "confirmed") setOperationalTab("all"); }}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="pending">Pending Review</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="replacement_required">Replacement Required</SelectItem><SelectItem value="replaced">Replaced</SelectItem><SelectItem value="no_longer_required">No Longer Required</SelectItem></SelectContent></Select>
              <Select value={qualityFilter} onValueChange={setQualityFilter}><SelectTrigger><SelectValue placeholder="Quality" /></SelectTrigger><SelectContent><SelectItem value="all">All Quality</SelectItem><SelectItem value="assessed">Assessed</SelectItem><SelectItem value="not_assessed">Not Assessed</SelectItem></SelectContent></Select>
              <div className="flex gap-2"><Select value={incidentFilter} onValueChange={setIncidentFilter}><SelectTrigger><SelectValue placeholder="Incidents" /></SelectTrigger><SelectContent><SelectItem value="all">Any Incident</SelectItem><SelectItem value="yes">Has Incident</SelectItem><SelectItem value="no">No Incidents</SelectItem></SelectContent></Select><Select value={conflictFilter} onValueChange={setConflictFilter}><SelectTrigger><SelectValue placeholder="Conflicts" /></SelectTrigger><SelectContent><SelectItem value="all">Any Schedule</SelectItem><SelectItem value="yes">Has Conflict</SelectItem><SelectItem value="no">No Conflict</SelectItem></SelectContent></Select></div>
            </div>

            {operationalView === "labs" ? <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Lab ID / Name</TableHead><TableHead>Governorate</TableHead><TableHead>Area</TableHead><TableHead className="text-right">Students</TableHead><TableHead className="text-right">Capacity</TableHead><TableHead className="text-right">Sessions</TableHead><TableHead>Occupied Dates</TableHead><TableHead className="text-right">Price / Session</TableHead><TableHead className="text-right">Estimated Total</TableHead><TableHead className="text-right">Quality</TableHead><TableHead className="text-right">Incidents</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {visibleOperationalRows.length === 0 ? <TableRow><TableCell colSpan={13} className="py-10 text-center text-muted-foreground">No allocated labs match these filters.</TableCell></TableRow> : visibleOperationalRows.map((row) => <TableRow key={row.assignment.id} className="cursor-pointer" onClick={() => setDetailAssignmentId(row.assignment.id)}>
                    <TableCell><Badge variant={row.status === "replacement_required" ? "destructive" : row.status === "confirmed" ? "default" : row.status === "replaced" ? "outline" : "secondary"} className={row.status === "replaced" ? "border-muted-foreground/40 text-muted-foreground" : undefined}>{row.status === "pending" ? "Pending Review" : row.status === "confirmed" ? "Confirmed" : row.status === "replacement_required" ? "Replacement Required" : row.status === "replaced" ? (row.replacementLab ? `Replaced (${row.replacementLab.lab_code})` : "Replaced") : "No Longer Required"}</Badge>{row.hasScheduleConflict && <Badge variant="destructive" className="mt-1 block w-fit">Conflict</Badge>}</TableCell>
                    <TableCell><div className="font-mono font-semibold text-primary">{row.lab?.lab_code || "-"}</div><div className="max-w-44 truncate text-xs text-muted-foreground" title={row.lab?.name}>{row.lab?.name || "Unknown lab"}</div></TableCell>
                    <TableCell>{row.governorate}</TableCell><TableCell>{row.area}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.uniqueStudents.toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{row.lab?.capacity ?? "-"}</TableCell><TableCell className="text-right tabular-nums">{row.sessions}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{row.firstDate ? `${formatScheduleDate(row.firstDate)} - ${formatScheduleDate(row.lastDate || row.firstDate)}` : "Not scheduled"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatEGP(row.price)}</TableCell><TableCell className="text-right whitespace-nowrap font-medium">{formatEGP(row.totalCost)}</TableCell>
                    <TableCell className="text-right">{row.qualityScore === undefined ? "Not Assessed" : `${row.qualityScore.toFixed(0)}/100`}</TableCell><TableCell className="text-right">{row.incidents.length}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setDetailAssignmentId(row.assignment.id); }}>Review</Button></TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </div> : <div className="space-y-2">{operationalGovernors.map((governorate) => {
              const governorRows = filteredOperationalRows.filter((row) => row.governorate === governorate);
              if (!governorRows.length) return null;
              const expanded = expandedGovernors.has(governorate);
              return <div key={governorate} className="rounded-md border"><button type="button" className="flex w-full items-center justify-between p-3 text-left" onClick={() => setExpandedGovernors((previous) => { const next = new Set(previous); if (next.has(governorate)) next.delete(governorate); else next.add(governorate); return next; })}><span className="font-semibold">{governorate}</span><span className="flex items-center gap-3 text-xs text-muted-foreground">{governorRows.length} labs · {governorRows.filter((row) => row.status === "pending").length} pending · {governorRows.filter((row) => row.status === "confirmed").length} confirmed · {governorRows.filter((row) => row.status === "replacement_required").length} replacement {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span></button>{expanded && <div className="border-t p-2">{governorRows.slice(0, opsPageSize).map((row) => <button type="button" key={row.assignment.id} className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left hover:bg-muted" onClick={() => setDetailAssignmentId(row.assignment.id)}><span><span className="font-mono font-medium text-primary">{row.lab?.lab_code}</span> <span className="text-sm">{row.lab?.name}</span></span><span className="text-xs text-muted-foreground">{row.area} · {row.uniqueStudents} students · {row.sessions} sessions</span></button>)}</div>}</div>;
            })}</div>}

            {operationalView === "labs" && <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><div className="text-muted-foreground">Showing {filteredOperationalRows.length ? (opsPage - 1) * opsPageSize + 1 : 0}-{Math.min(opsPage * opsPageSize, filteredOperationalRows.length)} of {filteredOperationalRows.length} labs</div><div className="flex items-center gap-2"><Select value={String(opsPageSize)} onValueChange={(value) => setOpsPageSize(Number(value))}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25 rows</SelectItem><SelectItem value="50">50 rows</SelectItem><SelectItem value="100">100 rows</SelectItem></SelectContent></Select><Button size="sm" variant="outline" disabled={opsPage === 1} onClick={() => setOpsPage((page) => page - 1)}>Previous</Button><span>Page {opsPage} of {operationalPageCount}</span><Button size="sm" variant="outline" disabled={opsPage === operationalPageCount} onClick={() => setOpsPage((page) => page + 1)}>Next</Button></div></div>}
          </>}

          {operationalTab === "exceptions" && <div className="space-y-2">{operationalExceptions.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No operational exceptions.</div> : operationalExceptions.map(({ need, assigned, missing }) => <div key={need.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><div className="font-medium">{need.gov} / {need.area}</div><div className="text-sm text-muted-foreground">{need.labs_required} labs required · {assigned} assigned · {missing} still required</div></div>{canEdit && <Button size="sm" variant="outline" onClick={() => setPickerNeed(need)}>Find Lab</Button>}</div>)}</div>}
        </CardContent>
      </Card>

      {/* Grouped Needs by Governorate */}
      {false && (groupedNeeds.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground space-y-3">
            <p>
              No demand needs match your active filters or none have been added to this batch yet.
            </p>
            {canEdit && (
              <Button
                size="sm"
                onClick={addNeed}
                className="h-8 text-xs gap-1.5 font-semibold bg-[#056FEC] hover:bg-[#043FAD] text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add First Area Need
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        groupedNeeds.map(([govName, areaNeeds]) => (
          <div key={govName} className="space-y-3 pt-2">
            {/* Governorate Group Header */}
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <span>{govName} Governorate</span>
                <Badge variant="secondary" className="text-[11px] font-medium font-mono">
                  {areaNeeds.length} Area(s)
                </Badge>
              </h3>
            </div>

            <div className="space-y-3">
              {areaNeeds.map((need) => {
                const rows = assignmentsByNeed.get(need.id) ?? [];
                const active = rows.filter((a) => a.status !== "denied");
                const confirmed = rows.filter((a) => a.status === "confirmed").length;
                const candidates = rankCandidates(need.gov, need.area);
                const critical = active.length < need.labs_required && candidates.length === 0;
                const nearbyCandidates = critical ? rankNearbyCandidates(need.gov, need.area) : [];
                const topNearby = nearbyCandidates[0] ?? null;

                return (
                  <Card key={need.id} className={critical ? "border-amber-500/40 shadow-xs" : ""}>
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span>{need.area} Area</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            ({confirmed}/{need.labs_required} confirmed · {active.length} assigned)
                          </span>
                        </CardTitle>

                        <div className="flex items-center gap-2">
                          {critical && (
                            <Badge variant="destructive" className="gap-1 text-xs">
                              <AlertTriangle className="h-3 w-3" /> High-Critical Area
                            </Badge>
                          )}
                          {canEdit && (
                            <Button
                              size="sm"
                              variant={critical ? "outline" : "ghost"}
                              onClick={() => setPickerNeed(need)}
                            >
                              <Plus className="mr-1 h-4 w-4" />{" "}
                              {critical ? "Find nearby labs" : "Add candidate"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    {/* Critical Banner */}
                    {critical && (
                      <div className="mx-4 mb-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          <div>
                            <span className="font-semibold text-amber-900 dark:text-amber-200">
                              High-Critical Area:{" "}
                            </span>
                            <span className="text-muted-foreground">0 labs in {need.area}. </span>
                            {topNearby ? (
                              <span>
                                Nearest recommended lab:{" "}
                                <strong className="text-foreground">{topNearby.name}</strong>{" "}
                                {topNearby.distanceKm !== null ? (
                                  <Badge
                                    variant="secondary"
                                    className="font-mono text-[10px] py-0 px-1 ml-1 bg-amber-500/20 text-amber-900 dark:text-amber-200"
                                  >
                                    📍 {topNearby.distanceKm} km away ({topNearby.area})
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1 ml-1">
                                    {topNearby.area}
                                  </Badge>
                                )}
                              </span>
                            ) : (
                              <span>No free labs found in {need.gov}.</span>
                            )}
                          </div>
                        </div>
                        {topNearby && canEdit && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-amber-500/40 hover:bg-amber-500/20"
                            onClick={() => assignCandidate(need, topNearby.id)}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" /> Quick Add {topNearby.name}
                          </Button>
                        )}
                      </div>
                    )}

                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="text-xs">
                              <TableHead>Lab Name &amp; ID</TableHead>
                              <TableHead className="text-right">Quality</TableHead>
                              <TableHead className="text-right">Seats</TableHead>
                              <TableHead className="text-right">Price</TableHead>
                              <TableHead>Status &amp; Replaced Flags</TableHead>
                              <TableHead className="min-w-64 text-right">
                                <div>Schedule</div>
                                <div className="text-xs font-normal text-muted-foreground">
                                  Days, sessions, and dates
                                </div>
                              </TableHead>
                              {canEdit && <TableHead className="w-32"></TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={canEdit ? 7 : 6}
                                  className="py-4 text-center text-sm text-muted-foreground"
                                >
                                  No labs assigned for {need.area}. Click{" "}
                                  <strong>"Add Candidate"</strong> or run{" "}
                                  <strong>"Auto-assign"</strong> above.
                                </TableCell>
                              </TableRow>
                            ) : (
                              rows.map((a) => {
                                const l = labById.get(a.lab_id);
                                const summary =
                                  assignmentSummaries.get(a.id) ??
                                  getAssignmentScheduleSummary(a, batch, []);
                                const usage = allocationUsageByLabId.get(a.lab_id);
                                const labIncidents = incidentsByLabId.get(a.lab_id) ?? [];
                                const latestIncident = [...labIncidents].sort((left, right) => String(right.reported_at).localeCompare(String(left.reported_at)))[0];
                                const totalCost = calculateAssignmentPrice(Number(a.confirmed_price ?? l?.session_price ?? 0), summary);
                                const isLabReplacedOrInactive =
                                  l?.status === "replaced" ||
                                  l?.status === "suspended" ||
                                  l?.status === "deactivated" ||
                                  l?.is_active === false;

                                return (
                                  <TableRow
                                    key={a.id}
                                    className={a.status === "denied" ? "opacity-50" : ""}
                                  >
                                    <TableCell>
                                      <div className="font-medium text-foreground">
                                        {l?.name ?? "—"}
                                      </div>
                                      <div className="font-mono text-xs text-primary">
                                        {l?.lab_code}
                                      </div>
                                      {usage && <div className="mt-1 text-[11px] text-muted-foreground">{usage.uniqueStudents.toLocaleString()} students · {usage.seatVisits.toLocaleString()} seat visits · {usage.groupIds.length} groups</div>}
                                      <div className="text-[11px] text-muted-foreground">{l?.gov || need.gov} · {l?.area || need.area} · {labIncidents.length} incidents{latestIncident ? ` · latest ${latestIncident.severity}` : ""}</div>
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold">
                                      {scores[a.lab_id] === undefined ? <span className="font-sans text-[11px] font-normal text-muted-foreground">Not Assessed</span> : `${scores[a.lab_id].toFixed(0)}/100`}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                      {l?.capacity ?? "—"}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold text-[#056FEC] dark:text-[#05ACFF]">
                                      <div>{formatEGP(a.confirmed_price ?? l?.session_price ?? 0)}/session</div>
                                      <div className="text-[11px] font-normal text-muted-foreground">{formatEGP(totalCost)} total</div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex flex-col gap-1 items-start">
                                        {a.status === "confirmed" ? (
                                          <Badge className="gap-1 bg-[#056FEC] hover:bg-[#043FAD] text-white text-[11px]">
                                            <CheckCircle2 className="h-3 w-3" /> Confirmed
                                          </Badge>
                                        ) : a.status === "denied" ? (
                                          <Badge variant="outline">Denied</Badge>
                                        ) : (
                                          <Badge
                                            variant="secondary"
                                            className="bg-amber-500/10 text-amber-700 border-amber-500/30"
                                          >
                                            Pending
                                          </Badge>
                                        )}

                                        {isLabReplacedOrInactive && (
                                          <Badge
                                            variant="destructive"
                                            className="gap-1 text-[10px] animate-pulse"
                                          >
                                            <AlertTriangle className="h-3 w-3" /> Replaced /
                                            Inactive ({l?.status})
                                          </Badge>
                                        )}
                                        {a.source === "allocation" && !a.is_current_allocation && <Badge variant="outline" className="text-[10px]">No longer required</Badge>}
                                        {a.status === "denied" && !assignments.some((candidate) => candidate.replaces_assignment_id === a.id) && <Badge variant="destructive" className="text-[10px]">Replacement Required</Badge>}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex min-w-60 flex-col items-end gap-2 text-right">
                                        <div className="flex flex-wrap justify-end gap-1.5">
                                          <Badge
                                            variant="secondary"
                                            className="text-sm font-semibold"
                                          >
                                            {summary.totalDays}{" "}
                                            {summary.totalDays === 1 ? "day" : "days"}
                                          </Badge>
                                          <Badge
                                            variant="outline"
                                            className="border-primary/30 text-sm font-semibold text-primary"
                                          >
                                            {summary.totalSessions}{" "}
                                            {summary.totalSessions === 1 ? "session" : "sessions"}
                                          </Badge>
                                        </div>
                                        <div className="max-w-72 text-sm leading-5 text-muted-foreground">
                                          {summary.sessionsByDate.length
                                            ? formatSessionsByDate(summary)
                                            : "No sessions scheduled"}
                                        </div>
                                        {usage && <div className="text-[11px] text-muted-foreground">{usage.firstDate ? `${formatScheduleDate(usage.firstDate)} → ${formatScheduleDate(usage.lastDate || usage.firstDate)}` : "Dates unavailable"} · Slots: {usage.timeSlots.map(formatTimeSlot).join(", ") || "—"}</div>}
                                        {a.status === "confirmed" && canEdit && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8 text-xs"
                                            onClick={() => openScheduleEditor(a)}
                                          >
                                            Edit Schedule
                                          </Button>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {a.status === "pending" ? (
                                        <div className="flex justify-end gap-1">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openConfirm(a)}
                                          >
                                            Confirm
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => openDeny(a)}
                                          >
                                            Deny
                                          </Button>
                                          {l && <Button size="icon" variant="ghost" title="Add Incident" onClick={() => setIncidentLab(l)}><AlertTriangle className="h-4 w-4 text-amber-600" /></Button>}
                                          {l && labIncidents.length > 0 && <Button size="sm" variant="ghost" onClick={() => void openIncidentList(l)}>View Incidents</Button>}
                                          <Button size="sm" variant="ghost" asChild><Link to="/lab-data" search={{ labId: (a.lab_id || l?.id) || undefined, labCode: l?.lab_code || undefined }}>{scores[a.lab_id] === undefined ? "Add Quality" : "Update Quality"}</Link></Button>
                                        </div>
                                      ) : (
                                        <div className="flex items-center justify-end gap-1">
                                          {a.status === "denied" && canEdit && (
                                            <Button size="sm" variant="destructive" onClick={() => { setReplacementFor(a); setPickerNeed(need); }}>Replace</Button>
                                          )}
                                          {isLabReplacedOrInactive && canEdit && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="h-7 text-[11px] border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50"
                                              onClick={() => setPickerNeed(need)}
                                            >
                                              Swap Lab
                                            </Button>
                                          )}
                                          {l && (
                                            <>
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                title="Report Incident"
                                                className="h-8 w-8 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                                                onClick={() => setIncidentLab(l)}
                                              >
                                                <AlertTriangle className="h-4 w-4" />
                                              </Button>
                                              <Button size="sm" variant="ghost" asChild><Link to="/lab-data" search={{ labId: (a.lab_id || l?.id) || undefined, labCode: l?.lab_code || undefined }}>{scores[a.lab_id] === undefined ? "Add Quality" : "Update Quality"}</Link></Button>
                                              {labIncidents.length > 0 && <Button size="sm" variant="ghost" onClick={() => void openIncidentList(l)}>View Incidents</Button>}
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                title="Post-Usage Survey"
                                                className="h-8 w-8 text-[#FF7F1C] hover:bg-[#FF7F1C]/10"
                                                onClick={() => setSurveyLab(l)}
                                              >
                                                <Star className="h-4 w-4 fill-[#FF7F1C]" />
                                              </Button>
                                            </>
                                          )}
                                          {canEdit && (
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              title="Remove lab from batch"
                                              className="h-8 w-8 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                              onClick={() => removeAssignment(a)}
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </Button>
                                          )}
                                        </div>
                                      )}
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
                );
              })}
            </div>
          </div>
        ))
      ))}

      <Dialog open={Boolean(detailRow)} onOpenChange={(open) => !open && setDetailAssignmentId(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {detailRow && <>
            <DialogHeader><DialogTitle>{detailRow.lab?.lab_code} · {detailRow.lab?.name}</DialogTitle><DialogDescription>{detailRow.governorate} / {detailRow.area}</DialogDescription></DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border p-4"><div className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Lab Summary</div><dl className="grid grid-cols-2 gap-2 text-sm"><dt>Lab ID</dt><dd className="text-right font-mono">{detailRow.lab?.lab_code}</dd><dt>Capacity</dt><dd className="text-right">{detailRow.lab?.capacity}</dd><dt>Status</dt><dd className="text-right">{detailRow.status.replaceAll("_", " ")}</dd><dt>Schedule conflict</dt><dd className="text-right">{detailRow.hasScheduleConflict ? "Yes" : "No"}</dd></dl></div>
              <div className="rounded-md border p-4"><div className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Allocation</div><dl className="grid grid-cols-2 gap-2 text-sm"><dt>Unique Students</dt><dd className="text-right">{detailRow.uniqueStudents.toLocaleString()}</dd><dt>Seat Visits</dt><dd className="text-right">{detailRow.seatVisits.toLocaleString()}</dd><dt>Sessions</dt><dd className="text-right">{detailRow.sessions}</dd><dt>Occupied</dt><dd className="text-right">{detailRow.firstDate ? `${formatScheduleDate(detailRow.firstDate)} - ${formatScheduleDate(detailRow.lastDate || detailRow.firstDate)}` : "Not scheduled"}</dd><dt>Time Slots</dt><dd className="text-right">{detailRow.usage?.timeSlots.map(formatTimeSlot).join(", ") || "-"}</dd></dl></div>
              <div className="rounded-md border p-4"><div className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Financial</div><dl className="grid grid-cols-2 gap-2 text-sm"><dt>Price / Session</dt><dd className="text-right">{formatEGP(detailRow.price)}</dd><dt>Total Sessions</dt><dd className="text-right">{detailRow.sessions}</dd><dt>Estimated Total</dt><dd className="text-right font-semibold">{formatEGP(detailRow.totalCost)}</dd></dl></div>
              <div className="rounded-md border p-4"><div className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Quality & Incidents</div><dl className="grid grid-cols-2 gap-2 text-sm"><dt>Quality</dt><dd className="text-right">{detailRow.qualityScore === undefined ? "Not Assessed" : `${detailRow.qualityScore.toFixed(0)}/100`}</dd><dt>Incidents</dt><dd className="text-right">{detailRow.incidents.length}</dd></dl><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><Link to="/lab-data" search={{ labId: (detailRow.assignment.lab_id || detailRow.lab?.id) || undefined, labCode: detailRow.lab?.lab_code || undefined }}>{detailRow.qualityScore === undefined ? "Add Quality" : "Update Quality"}</Link></Button>{detailRow.lab && <Button size="sm" variant="outline" className="text-[#FF7F1C] border-[#FF7F1C]/40 hover:bg-[#FF7F1C]/10" onClick={() => setSurveyLab(detailRow.lab!)}><Star className="mr-1.5 h-3.5 w-3.5 fill-[#FF7F1C]" />Rate Batch / Survey</Button>}{detailRow.lab && <Button size="sm" variant="outline" onClick={() => setIncidentLab(detailRow.lab!)}>Add Incident</Button>}{detailRow.lab && detailRow.incidents.length > 0 && <Button size="sm" variant="ghost" onClick={() => void openIncidentList(detailRow.lab!)}>View Incidents</Button>}</div></div>
            </div>
            {canEdit ? <DialogFooter><Button variant="outline" onClick={() => setDetailAssignmentId(null)}>Close</Button>{detailRow.assignment.status === "pending" && <Button variant="outline" onClick={() => { setDetailAssignmentId(null); openDeny(detailRow.assignment); }}>Deny / Replace</Button>}{detailRow.assignment.status === "denied" && <Button variant="destructive" onClick={() => { setDetailAssignmentId(null); if (detailRow.need) void prepareReplacement(detailRow.assignment, detailRow.need); }}>Find Replacement</Button>}{detailRow.assignment.status === "pending" && <Button onClick={() => { setDetailAssignmentId(null); openConfirm(detailRow.assignment); }}>Confirm Lab</Button>}</DialogFooter> : <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">View only - insufficient permission to modify allocation decisions.</div>}
          </>}
        </DialogContent>
      </Dialog>

      <SessionImportDialog
        open={sessionImportOpen}
        onOpenChange={setSessionImportOpen}
        project={project}
        batch={batch}
        onImported={async () => {
          await loadAll(true);
          onChanged();
        }}
      />

      <Dialog open={Boolean(scheduleFor)} onOpenChange={(open) => !open && setScheduleFor(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Schedule</DialogTitle>
            <DialogDescription>
              {scheduleFor ? labById.get(scheduleFor.lab_id)?.name : "Confirmed lab"} · Select up to
              four configured time slots for each date.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 rounded-xl border bg-muted/20 p-3 text-xs sm:grid-cols-3">
              <div>
                <div className="text-muted-foreground">Scheduled days</div>
                <div className="mt-1 font-mono text-lg font-bold text-foreground">
                  {scheduleDraftSummary.totalDays}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Total sessions</div>
                <div className="mt-1 font-mono text-lg font-bold text-foreground">
                  {scheduleDraftSummary.totalSessions}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Calculated price</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#056FEC] dark:text-[#05ACFF]">
                  {formatEGP(scheduleEditorUnitPrice * scheduleDraftSummary.totalSessions)}
                </div>
              </div>
            </div>

            {scheduleDraftSummary.errors.length > 0 && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                <div className="font-semibold">Schedule needs attention</div>
                <div className="mt-1">{scheduleDraftSummary.errors[0]}</div>
              </div>
            )}

            <div className="space-y-3">
              {scheduleDraft.map((row, index) => (
                <div
                  key={`${row.date || "row"}-${index}`}
                  className="rounded-xl border bg-card p-3 shadow-xs"
                >
                  <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[190px_1fr_auto] lg:items-start">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Date</Label>
                      <Select
                        value={row.date}
                        onValueChange={(value) => updateScheduleDraftDate(index, value)}
                      >
                        <SelectTrigger className="w-full bg-background">
                          <SelectValue placeholder="Select date" />
                        </SelectTrigger>
                        <SelectContent>
                          {batchDates.map((date) => (
                            <SelectItem
                              key={date}
                              value={date}
                              disabled={scheduleDraft.some(
                                (draft, rowIndex) => rowIndex !== index && draft.date === date,
                              )}
                            >
                              {formatScheduleDate(date)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="text-xs font-medium text-muted-foreground">
                        {row.selectedSlots.length} of {MAX_SESSIONS_PER_DAY} slots selected
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Available time slots</Label>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {scheduleSlotOptions.map((slot, slotIndex) => {
                          const selected = slot.available && row.selectedSlots.includes(slot.value);
                          const selectionDisabled =
                            !selected && row.selectedSlots.length >= MAX_SESSIONS_PER_DAY;
                          return (
                            <label
                              key={`${slot.value}-${slotIndex}`}
                              className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                                slot.available && !selectionDisabled
                                  ? selected
                                    ? "cursor-pointer border-primary bg-primary/10 text-primary"
                                    : "cursor-pointer bg-background hover:border-primary/50"
                                  : "cursor-not-allowed bg-muted/40 text-muted-foreground opacity-60"
                              }`}
                            >
                              <Checkbox
                                checked={selected}
                                disabled={!slot.available || selectionDisabled}
                                onCheckedChange={() =>
                                  slot.available &&
                                  !selectionDisabled &&
                                  toggleScheduleSlot(index, slot.value)
                                }
                              />
                              <span dir="auto">
                                {slot.available ? formatTimeSlot(slot.value) : "Unavailable"}
                              </span>
                            </label>
                          );
                        })}
                        {scheduleSlotOptions.length === 0 && (
                          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">
                            Edit this batch and select at least one available time slot.
                          </div>
                        )}
                      </div>
                      {row.selectedSlots.some((slot) => !batchTimeSlots.includes(slot)) && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 dark:border-rose-900 dark:bg-rose-950/30">
                          <div className="text-xs font-semibold text-rose-700 dark:text-rose-200">
                            Unavailable saved slots
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {row.selectedSlots
                              .filter((slot) => !batchTimeSlots.includes(slot))
                              .map((slot, slotIndex) => (
                                <Button
                                  key={`${slot}-${slotIndex}`}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 border-rose-300 bg-background text-xs text-rose-700"
                                  onClick={() => toggleScheduleSlot(index, slot)}
                                  title={`Remove unavailable slot ${slot}`}
                                >
                                  {formatTimeSlot(slot)} <X className="ml-1 h-3 w-3" />
                                </Button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 self-end text-rose-600 hover:bg-rose-50 lg:self-start dark:hover:bg-rose-950/30"
                      onClick={() => removeScheduleDraftRow(index)}
                      title="Remove date"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {(scheduleDraftSummary.rowErrors[index] ?? []).length > 0 && (
                    <div className="mt-2 text-sm text-rose-600 dark:text-rose-300">
                      {(scheduleDraftSummary.rowErrors[index] ?? []).join(" ")}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Price uses the actual session count, not a shared sessions-per-day multiplier.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addScheduleDay}
                disabled={!canAddScheduleDay}
              >
                <Plus className="mr-1 h-4 w-4" /> Add day
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setScheduleFor(null)}
              disabled={savingSchedule}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveScheduleEditor()}
              disabled={savingSchedule || scheduleDraftSummary.errors.length > 0}
            >
              {savingSchedule ? "Saving..." : "Save Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <Dialog open={!!confirmFor} onOpenChange={(o) => { if (!o && !confirmSaving) setConfirmFor(null); }}>
        <DialogContent className="max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void doConfirm();
            }}
          >
            <DialogHeader>
              <DialogTitle>Confirm lab</DialogTitle>
              <DialogDescription>
                {confirmFor && labById.get(confirmFor.lab_id)?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5 my-4">
              <Label>Session price (EGP)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={confirmPrice}
                disabled={confirmSaving}
                onChange={(e) => setConfirmPrice(Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void doConfirm();
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Default from lab. Edit if price changed, then press{" "}
                <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">Enter</kbd> to
                confirm.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmFor(null)} disabled={confirmSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={confirmSaving || !canEdit || !Number.isFinite(confirmPrice) || confirmPrice < 0}>{confirmSaving ? "Confirming..." : "Confirm"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Candidate picker */}
      <Dialog open={!!pickerNeed} onOpenChange={(open) => { if (!open) { setPickerNeed(null); setReplacementFor(null); } }}>
        <DialogContent className="max-w-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {replacementFor ? "Select Replacement Lab" : "Free labs"} — {pickerNeed?.gov} · {pickerNeed?.area}
            </DialogTitle>
            <DialogDescription>
              {replacementFor ? "Ranked by exact schedule availability, capacity, distance, quality, then price. " : <>Ranked by composite score:{" "}
              {[
                rankCriteria.quality && "Quality",
                rankCriteria.price && "Price",
                rankCriteria.seats && "Seats",
              ]
                .filter(Boolean)
                .join(" + ") || "Default"}
              . Reserved/assigned labs are hidden.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto">
            {pickerNeed &&
              (() => {
                if (replacementFor) {
                  const replacements = rankReplacementCandidates(replacementFor);
                  if (!replacements.length) {
                    return <div className="space-y-2 py-8 text-center"><div className="font-semibold text-destructive">Replacement Required</div><div className="text-xs text-muted-foreground">No suitable existing lab is available.</div><Button variant="outline" asChild><Link to="/lab-data">Request / Add New Lab</Link></Button></div>;
                  }
                  return (
                    <Table>
                      <TableHeader><TableRow><TableHead>Lab</TableHead><TableHead>Availability</TableHead><TableHead>Distance</TableHead><TableHead>Quality</TableHead><TableHead className="whitespace-nowrap">Capacity (Req/Cap)</TableHead><TableHead>Price</TableHead><TableHead /></TableRow></TableHeader>
                      <TableBody>{replacements.map((candidate) => (
                        <TableRow key={candidate.id}>
                          <TableCell><div className="text-xs font-medium">{candidate.name}</div><div className="font-mono text-[11px] text-muted-foreground">{candidate.lab_code} · {candidate.gov} · {candidate.area}</div></TableCell>
                          <TableCell><Badge variant={candidate.status === "available" ? "default" : candidate.status === "unavailable" ? "destructive" : "secondary"}>{candidate.status === "available" ? `Available ${candidate.availableSessions}/${candidate.requiredSessions}` : `${candidate.availableSessions}/${candidate.requiredSessions} · ${candidate.conflicts.length} conflicts`}</Badge></TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{candidate.distanceKm === null ? "Distance unavailable" : `${candidate.distanceKm.toFixed(1)} km`}</TableCell>
                          <TableCell className="text-xs">{candidate.qualityScore === null ? "Not Assessed" : `${candidate.qualityScore.toFixed(0)}/100`}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap font-medium"><span className={candidate.capacitySufficient ? "text-emerald-700" : "text-destructive"}>{candidate.requiredCapacity}/{candidate.capacity}</span></TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{formatEGP(candidate.session_price)}/session</TableCell>
                          <TableCell><Button size="sm" disabled={candidate.status === "unavailable" || !candidate.capacitySufficient} onClick={() => assignCandidate(pickerNeed, candidate.id)}>Select Replacement</Button></TableCell>
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                  );
                }
                const cands = rankCandidates(pickerNeed.gov, pickerNeed.area);
                if (!cands.length) {
                  const nearbyCands = rankNearbyCandidates(pickerNeed.gov, pickerNeed.area);
                  if (!nearbyCands.length) {
                    return (
                      <div className="py-6 text-center text-sm text-red-600 space-y-1">
                        <p className="font-semibold">No free candidates — High-Critical Area.</p>
                        <p className="text-xs text-muted-foreground">
                          No available labs found in {pickerNeed.area} or neighboring areas in{" "}
                          {pickerNeed.gov}.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-900 dark:text-amber-200">
                        <p className="font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-4 w-4" /> High-Critical Area (0 labs in{" "}
                          {pickerNeed.area})
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          Showing nearest available free labs in neighboring areas across{" "}
                          <span className="font-semibold">{pickerNeed.gov}</span>:
                        </p>
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Lab &amp; Nearby Area</TableHead>
                            <TableHead className="text-right">Distance</TableHead>
                            <TableHead className="text-right">Quality</TableHead>
                            <TableHead className="text-right">Seats</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {nearbyCands.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell>
                                <div className="font-medium text-xs">{c.name}</div>
                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <span className="font-mono">{c.lab_code}</span>
                                  <span>·</span>
                                  <Badge variant="outline" className="text-[10px] py-0 px-1">
                                    {c.area}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {c.distanceKm !== null ? (
                                  <Badge
                                    variant="secondary"
                                    className="gap-1 font-mono text-[10px]"
                                  >
                                    <MapPin className="h-3 w-3 text-[#056FEC]" />
                                    {c.distanceKm} km
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-[11px]">
                                    {c.area}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                {c.score.toFixed(0)}
                              </TableCell>
                              <TableCell className="text-right text-xs">{c.capacity}</TableCell>
                              <TableCell className="text-right text-xs">
                                {formatEGP(c.session_price)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => assignCandidate(pickerNeed, c.id)}
                                >
                                  Add
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                }

                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lab</TableHead>
                        <TableHead className="text-right">Quality</TableHead>
                        <TableHead className="text-right">Seats</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cands.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <div className="font-medium text-xs">{c.name}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {c.lab_code}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs">{c.score.toFixed(0)}</TableCell>
                          <TableCell className="text-right text-xs">{c.capacity}</TableCell>
                          <TableCell className="text-right text-xs">
                            {formatEGP(c.session_price)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => assignCandidate(pickerNeed, c.id)}
                            >
                              Add
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(incidentListLab)} onOpenChange={(open) => !open && setIncidentListLab(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Incidents: {incidentListLab?.name}</DialogTitle>
            <DialogDescription>Incidents recorded for this lab in the current project and batch.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {incidentDetails.map((incident) => (
                <div key={incident.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{incident.title}</div>
                    <div className="flex gap-2">
                      <Badge variant="outline">{incident.category}</Badge>
                      <Badge variant={incident.severity === "critical" || incident.severity === "high" ? "destructive" : "secondary"}>{incident.severity}</Badge>
                    </div>
                  </div>
                  {incident.description && <p className="mt-2 text-sm text-muted-foreground">{incident.description}</p>}
                  <div className="mt-2 text-xs text-muted-foreground">{new Date(incident.reported_at).toLocaleString()}</div>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Incident Modal for Batch Lab */}
      <Dialog open={Boolean(incidentLab)} onOpenChange={(open) => !open && setIncidentLab(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Report Incident:{" "}
              {incidentLab?.name}
            </DialogTitle>
            <DialogDescription>
              Report an operational failure or issue encountered during this batch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Incident Title</Label>
              <Input
                placeholder="e.g. Internet breakdown / AC failure"
                value={incidentTitle}
                onChange={(e) => setIncidentTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={incidentCategory} onValueChange={setIncidentCategory}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pc">PC / Hardware</SelectItem>
                    <SelectItem value="internet">Internet / Network</SelectItem>
                    <SelectItem value="ac">Air Conditioning (AC)</SelectItem>
                    <SelectItem value="cleanliness">Cleanliness</SelectItem>
                    <SelectItem value="facility">Facility / Furniture</SelectItem>
                    <SelectItem value="supervisor">Supervisor / Staff</SelectItem>
                    <SelectItem value="other">Other Issue</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Severity</Label>
                <Select value={incidentSeverity} onValueChange={setIncidentSeverity}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low Impact</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical / Blocker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Input
                placeholder="Detailed description..."
                value={incidentDesc}
                onChange={(e) => setIncidentDesc(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIncidentLab(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={submittingIncident}
              onClick={async () => {
                if (!incidentLab || !incidentTitle.trim()) return toast.error("Title required");
                setSubmittingIncident(true);
                try {
                  const { data: userRes } = await supabase.auth.getUser();
                  const { data: createdIncident, error } = await supabase.from("lab_incidents").insert({
                    lab_id: incidentLab.id,
                    batch_id: batch.id,
                    project_id: batch.project_id,
                    title: incidentTitle.trim(),
                    category: incidentCategory,
                    severity: incidentSeverity,
                    description: incidentDesc.trim() || null,
                    reported_by: userRes.user?.id || null,
                  }).select("id, lab_id, severity, reported_at").single();
                  if (error) throw error;
                  if (createdIncident) setIncidents((previous) => [...previous, createdIncident]);
                  toast.success("Incident logged successfully.");
                  setIncidentLab(null);
                  setIncidentTitle("");
                  setIncidentDesc("");
                } catch (err: any) {
                  toast.error(err.message || "Failed to log incident");
                } finally {
                  setSubmittingIncident(false);
                }
              }}
            >
              {submittingIncident ? "Submitting..." : "Submit Incident"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-Usage Survey Modal for Batch Lab */}
      <Dialog open={Boolean(surveyLab)} onOpenChange={(open) => !open && setSurveyLab(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500 fill-amber-500/20" /> Post-Usage Survey:{" "}
              {surveyLab?.name}
            </DialogTitle>
            <DialogDescription>Submit feedback after completion of lab sessions.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Overall Rating (1 to 5 Stars)</Label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setSurveyOverall(star)}
                    className="p-1 text-amber-500 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`h-6 w-6 ${star <= surveyOverall ? "fill-amber-500" : "text-muted stroke-muted-foreground"}`}
                    />
                  </button>
                ))}
                <span className="text-xs font-bold text-foreground ml-2">{surveyOverall} / 5</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <Label className="text-xs">PC Performance</Label>
                <Select value={String(surveyPc)} onValueChange={(v) => setSurveyPc(Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Stars
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Internet Speed</Label>
                <Select
                  value={String(surveyInternet)}
                  onValueChange={(v) => setSurveyInternet(Number(v))}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Stars
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Cleanliness</Label>
                <Select
                  value={String(surveyCleanliness)}
                  onValueChange={(v) => setSurveyCleanliness(Number(v))}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Stars
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Facilities</Label>
                <Select
                  value={String(surveyFacilities)}
                  onValueChange={(v) => setSurveyFacilities(Number(v))}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Stars
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Feedback &amp; Comments</Label>
              <Input
                placeholder="Session observations..."
                value={surveyFeedback}
                onChange={(e) => setSurveyFeedback(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSurveyLab(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-[#056FEC] hover:bg-[#043FAD] text-white"
              disabled={submittingSurvey}
              onClick={async () => {
                if (!surveyLab) return;
                setSubmittingSurvey(true);
                try {
                  const { data: userRes } = await supabase.auth.getUser();
                  const { error } = await supabase.from("lab_post_surveys").insert({
                    lab_id: surveyLab.id,
                    batch_id: batch.id,
                    project_id: batch.project_id,
                    overall_rating: surveyOverall,
                    pc_rating: surveyPc,
                    internet_rating: surveyInternet,
                    cleanliness_rating: surveyCleanliness,
                    facilities_rating: surveyFacilities,
                    feedback: surveyFeedback.trim() || null,
                    submitted_by: userRes.user?.id || null,
                  });
                  if (error) throw error;
                  toast.success("Post-usage survey submitted.");
                  setSurveyLab(null);
                  setSurveyFeedback("");
                } catch (err: any) {
                  toast.error(err.message || "Failed to submit survey");
                } finally {
                  setSubmittingSurvey(false);
                }
              }}
            >
              {submittingSurvey ? "Submitting..." : "Submit Survey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Need Modal */}
      <AddNeedModal
        open={addNeedModalOpen}
        onOpenChange={setAddNeedModalOpen}
        batchId={batch.id}
        batchName={batch.name}
        onNeedAdded={() => void loadAll(true)}
      />

      {/* Denial Reason Dialog */}
      <Dialog open={!!denialFor} onOpenChange={(o) => !o && setDenialFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deny Lab Assignment</DialogTitle>
            <DialogDescription>
              Provide an optional reason for denying{" "}
              <strong>{denialFor && labById.get(denialFor.lab_id)?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs font-semibold">Reason for Denial</Label>
            <Input
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              placeholder="e.g. Lab unavailable on selected shifts, price dispute..."
              className="text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDenialFor(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={submitDeny}>
              Confirm Denial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
