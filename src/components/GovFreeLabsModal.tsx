import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  MapPin,
  Users,
  Search,
  Check,
  Send,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  PhoneCall,
  Layers,
  AlertCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Filter,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getGovForArea,
  cleanArabicString,
  normalizeArabic,
  normalizeAreaCanonical,
  EGYPT_AREA_TO_GOV,
} from "@/lib/arabic";
import {
  saveBatchResolutionRequest,
} from "@/lib/batch-allocation-storage";
import { useAuth } from "@/hooks/useAuth";
import type { UnassignedStudentRow, MasterAllocationRow } from "@/lib/allocation-client";
import { loadLabCapacity, type LabRow } from "@/lib/lab-allocation-runner/parse";
import { formatGradeLevel, sortGradeLevels } from "@/lib/project-grade-levels";

export interface LabCapacityItem {
  id: string;
  name: string;
  lab_code?: string;
  area: string;
  gov: string;
  capacity_per_session: number;
  total_capacity: number;
  assigned_students: number;
  total_free_capacity: number;
  grade_free_capacity: Record<number, number>;
  active_free_capacity: number;
  empty_slots: number;
  occupied_slots: number;
  is_same_area: boolean;
  distanceKm?: number | null;
  distanceRank?: number | null;
  distanceMethod?: string | null;
  originUsed?: string | null;
  distanceTrace?: string | null;
  quality_rating?: number | null;
  price_per_session?: number | null;
  availability: "free" | "occupied" | "pending";
  unavailable_reason?: string;
}

interface GovFreeLabsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortfallArea: string;
  unassignedStudents?: UnassignedStudentRow[];
  masterAllocation?: MasterAllocationRow[];
  labRows?: LabRow[];
  allLabs?: any[];
  batchId?: string;
  projectId?: string | null;
  batchName?: string;
  onSuccess?: () => void;
  slotCount?: number;
}

/**
 * Checks if a lab matches a MasterAllocationRow by id, code, or name
 */
function matchesLab(row: MasterAllocationRow, lab: any): boolean {
  const rLabId = String(row.Lab_ID || (row as any)["Lab ID"] || (row as any).lab_id || "").trim();
  const rLabName = String((row as any)["Lab Name"] || (row as any).lab_name || "").trim();
  const labId = String(lab.id || "").trim();
  const labCode = String(lab.lab_code || "").trim();
  const labName = String(lab.name || "").trim();

  if (labId && (rLabId.toLowerCase() === labId.toLowerCase() || rLabName.toLowerCase() === labId.toLowerCase())) return true;
  if (labCode && (rLabId.toLowerCase() === labCode.toLowerCase() || rLabName.toLowerCase() === labCode.toLowerCase())) return true;
  if (labName && (rLabId.toLowerCase() === labName.toLowerCase() || rLabName.toLowerCase() === labName.toLowerCase())) return true;

  // Normalized Arabic matching
  const normRLabId = normalizeArabic(cleanArabicString(rLabId));
  const normRLabName = normalizeArabic(cleanArabicString(rLabName));
  const normLabName = normalizeArabic(cleanArabicString(labName));

  if (normLabName && (normRLabId === normLabName || normRLabName === normLabName)) return true;
  if (labCode && (normRLabId === normalizeArabic(cleanArabicString(labCode)) || normRLabName === normalizeArabic(cleanArabicString(labCode)))) return true;

  return false;
}

/**
 * Parses slot index for a MasterAllocationRow dynamically based on batch slot count
 */
function getSlotIndex(row: MasterAllocationRow, totalSlots: number = 7): number {
  if (typeof row.Slot_Num === "number" && row.Slot_Num >= 1) {
    if (row.Slot_Num <= totalSlots) return row.Slot_Num;
    return ((row.Slot_Num - 1) % totalSlots) + 1;
  }
  if (row.Slot_Num !== undefined && row.Slot_Num !== null) {
    const parsedNum = Number(row.Slot_Num);
    if (parsedNum >= 1) {
      if (parsedNum <= totalSlots) return parsedNum;
      return ((parsedNum - 1) % totalSlots) + 1;
    }
  }

  // Extract trailing slot number from Slot_Key (e.g. "L241_3" -> 3, "Thu_1" -> 1, "Slot_4" -> 4)
  if (row.Slot_Key) {
    const keyStr = String(row.Slot_Key);
    const trailingMatch = keyStr.match(/_(\d+)$/) || keyStr.match(/[_-]s?(\d+)$/i) || keyStr.match(/slot[_-]?(\d+)/i);
    if (trailingMatch) {
      const parsed = parseInt(trailingMatch[1], 10);
      if (parsed >= 1 && parsed <= totalSlots) return parsed;
      if (parsed > totalSlots) return ((parsed - 1) % totalSlots) + 1;
    }
  }

  const day = String(row.Day || "").toLowerCase();
  const session = String(row.Session || "").toLowerCase();
  const timeSlot = String(row.Time_Slot || row.Slot_Label || "").toLowerCase();

  if (day.includes("fri") || day.includes("جمع")) {
    if (session.includes("3") || session.includes("three") || timeSlot.includes("6") || session.includes("evening")) return Math.min(7, totalSlots);
    if (session.includes("2") || session.includes("two") || timeSlot.includes("3") || session.includes("afternoon")) return Math.min(6, totalSlots);
    if (session.includes("1") || session.includes("one") || timeSlot.includes("9") || session.includes("morning")) return Math.min(5, totalSlots);
    return Math.min(5, totalSlots);
  }

  if (day.includes("thu") || day.includes("خميس")) {
    if (session.includes("4") || session.includes("four") || timeSlot.includes("6") || session.includes("evening")) return Math.min(4, totalSlots);
    if (session.includes("3") || session.includes("three") || timeSlot.includes("3")) return Math.min(3, totalSlots);
    if (session.includes("2") || session.includes("two") || timeSlot.includes("12") || session.includes("afternoon")) return Math.min(2, totalSlots);
    if (session.includes("1") || session.includes("one") || timeSlot.includes("9") || session.includes("morning")) return 1;
    return 1;
  }

  return 1;
}

/**
 * Comprehensive check if a lab belongs to the target governorate
 */
function isLabInGov(lab: any, targetGov: string): boolean {
  if (!targetGov) return false;
  const normTarget = normalizeArabic(normalizeAreaCanonical(getGovForArea(targetGov) || targetGov));

  // 1. Direct gov column check
  if (lab.gov) {
    const normLabGov = normalizeArabic(normalizeAreaCanonical(getGovForArea(lab.gov) || lab.gov));
    if (normLabGov === normTarget || normLabGov.includes(normTarget) || normTarget.includes(normLabGov)) {
      return true;
    }
  }

  // 2. Direct governorate column check
  if (lab.governorate) {
    const normLabGov = normalizeArabic(normalizeAreaCanonical(getGovForArea(lab.governorate) || lab.governorate));
    if (normLabGov === normTarget || normLabGov.includes(normTarget) || normTarget.includes(normLabGov)) {
      return true;
    }
  }

  // 3. Area column check
  if (lab.area) {
    const govFromArea = getGovForArea(lab.area);
    if (govFromArea) {
      const normGovFromArea = normalizeArabic(normalizeAreaCanonical(govFromArea));
      if (normGovFromArea === normTarget) return true;
    }
    const normArea = normalizeArabic(lab.area);
    for (const [knownArea, knownGov] of Object.entries(EGYPT_AREA_TO_GOV)) {
      const normKnownArea = normalizeArabic(knownArea);
      const normKnownGov = normalizeArabic(normalizeAreaCanonical(knownGov));
      if (normKnownGov === normTarget && (normArea.includes(normKnownArea) || normKnownArea.includes(normArea))) {
        return true;
      }
    }
  }

  // 4. City column check
  if (lab.city) {
    const govFromCity = getGovForArea(lab.city);
    if (govFromCity) {
      const normGovFromCity = normalizeArabic(normalizeAreaCanonical(govFromCity));
      if (normGovFromCity === normTarget) return true;
    }
    const normCity = normalizeArabic(lab.city);
    for (const [knownArea, knownGov] of Object.entries(EGYPT_AREA_TO_GOV)) {
      const normKnownArea = normalizeArabic(knownArea);
      const normKnownGov = normalizeArabic(normalizeAreaCanonical(knownGov));
      if (normKnownGov === normTarget && (normCity.includes(normKnownArea) || normKnownArea.includes(normCity))) {
        return true;
      }
    }
  }

  // 5. Address column check
  if (lab.address) {
    const normAddress = normalizeArabic(lab.address);
    if (normAddress.includes(normTarget)) return true;
  }

  return false;
}

/**
 * Checks if a lab belongs to the shortfall area itself (to exclude it from candidates and include in shortfall origin)
 */
function isLabInShortfallArea(lab: any, shortfallArea: string, targetGov?: string): boolean {
  if (!shortfallArea) return false;
  const normShortfall = normalizeArabic(cleanArabicString(shortfallArea));
  const normArea = normalizeArabic(cleanArabicString(lab.area || lab.Area || ""));
  const normCity = normalizeArabic(cleanArabicString(lab.city || ""));

  // Check governorate match if provided
  if (targetGov && !isLabInGov(lab, targetGov)) {
    return false;
  }

  return normArea === normShortfall || normCity === normShortfall;
}

export function GovFreeLabsModal({
  open,
  onOpenChange,
  shortfallArea,
  unassignedStudents = [],
  masterAllocation = [],
  labRows,
  allLabs,
  batchId,
  projectId,
  batchName = "Current Batch",
  onSuccess,
  slotCount: propSlotCount,
}: GovFreeLabsModalProps) {
  const { user } = useAuth();
  const currentUserName = (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "Operations User";

  const [loadingLabs, setLoadingLabs] = useState(false);
  const [dbLabs, setDbLabs] = useState<any[]>([]);
  const [selectedLabId, setSelectedLabId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [operationsNote, setOperationsNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<number | "ALL">("ALL");
  const [requiredSessions, setRequiredSessions] = useState<Array<{ date: string; time: string; slot_num: number }>>([]);
  const [busySlotsByLabId, setBusySlotsByLabId] = useState<Map<string, Set<string>>>(new Map());
  const [pendingSlotsByLabId, setPendingSlotsByLabId] = useState<Map<string, Set<string>>>(new Map());
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);
  const [candidatePage, setCandidatePage] = useState(1);
  const [studentPage, setStudentPage] = useState(1);
  const candidateCalculationCountRef = useRef(0);

  const wasOpenRef = useRef(false);
  const sourceDataRef = useRef({ masterAllocation, labRows, allLabs });
  sourceDataRef.current = { masterAllocation, labRows, allLabs };

  useEffect(() => {
    if (import.meta.env.DEV) console.log("[GovFreeLabsModal] mounted", { area: shortfallArea });
    // Conditional mounting gives each intentional open a fresh component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1. Resolve canonical governorate of the shortfall area
  const resolvedGov = useMemo(() => {
    return getGovForArea(shortfallArea) || shortfallArea;
  }, [shortfallArea]);

  // 2. Filter unassigned students for this specific shortfall area
  const areaUnassignedStudents = useMemo(() => {
    return unassignedStudents.filter((u) => {
      const uArea = String(u["Physical Area"] || "").trim();
      return (
        normalizeArabic(uArea) === normalizeArabic(shortfallArea) ||
        uArea.toLowerCase() === shortfallArea.toLowerCase()
      );
    });
  }, [unassignedStudents, shortfallArea]);
  const areaStudentsRef = useRef(areaUnassignedStudents);
  areaStudentsRef.current = areaUnassignedStudents;

  // Available grades among unassigned students in this shortfall area
  const shortfallGrades = useMemo<number[]>(() => {
    const set = new Set<number>();
    areaUnassignedStudents.forEach((s) => {
      const g = Number(s.Grade) || 4;
      set.add(g);
    });
    return sortGradeLevels(set);
  }, [areaUnassignedStudents]);
  const shortfallCountByGrade = useMemo(() => {
    const counts = new Map<number, number>();
    for (const student of areaUnassignedStudents) {
      const grade = Number(student.Grade) || 4;
      counts.set(grade, (counts.get(grade) || 0) + 1);
    }
    return counts;
  }, [areaUnassignedStudents]);
  const areaStudentById = useMemo(
    () => new Map(areaUnassignedStudents.map((student) => [student.S_ID, student])),
    [areaUnassignedStudents]
  );

  // 3. Fetch all active labs across the governorate
  useEffect(() => {
    if (!open) return;

    async function loadGovLabs() {
      setLoadingLabs(true);
      try {
        let labsData: any[] = [];

        // Helper to extract nearby labs from array or encoded notes
        const extractNearby = (l: any): any[] => {
          if (Array.isArray(l.nearby_labs) && l.nearby_labs.length > 0) return l.nearby_labs;
          if (Array.isArray(l.nearbyLabs) && l.nearbyLabs.length > 0) return l.nearbyLabs;
          if (typeof l.notes === "string" && l.notes.includes("[NEARBY_LABS_JSON]:")) {
            try {
              const parsed = JSON.parse(l.notes.split("[NEARBY_LABS_JSON]:")[1]?.trim() || "[]");
              if (Array.isArray(parsed)) return parsed;
            } catch {}
          }
          return [];
        };

        // If labRows passed in props (e.g. from solver file upload), prefer them as they include fresh distance data
        const currentLabRows = sourceDataRef.current.labRows;
        const currentAllLabs = sourceDataRef.current.allLabs;
        const currentMasterAllocation = sourceDataRef.current.masterAllocation;
        if (currentLabRows && currentLabRows.length > 0) {
          labsData = currentLabRows.map((l) => {
            const nearby = extractNearby(l);
            return {
              id: l["Lab ID"],
              lab_code: l["Lab ID"],
              name: l["Lab Name"] || l.name || l["Lab ID"],
              area: l.Area,
              gov: l.Gov || l.Governorate || getGovForArea(l.Area),
              capacity: l["Lab Capacity"],
              is_active: true,
              nearby_labs: nearby,
              nearbyLabs: nearby,
            };
          });
        } else if (currentAllLabs && currentAllLabs.length > 0) {
          labsData = currentAllLabs.map((l) => {
            const nearby = extractNearby(l);
            return {
              id: l.id || l.lab_code || l["Lab ID"],
              lab_code: l.lab_code || l["Lab ID"] || l.id,
              name: l.name || l["Lab Name"] || l.id,
              area: l.area || l.Area || l.city,
              gov: l.gov || l.Gov || l.Governorate || getGovForArea(l.area || l.Area),
              capacity: Number(l.capacity || l["Lab Capacity"] || 20),
              is_active: l.is_active !== false,
              nearby_labs: nearby,
              nearbyLabs: nearby,
            };
          });
        } else {
          const { data, error } = await supabase.from("labs").select("*");
          if (!error && data && data.length > 0) {
            // Keep all active labs (is_active !== false and not deactivated)
            labsData = data
              .filter((l: any) => l.is_active !== false && l.status !== "deactivated")
              .map((l: any) => {
                const nearby = extractNearby(l);
                return {
                  ...l,
                  nearby_labs: nearby,
                  nearbyLabs: nearby,
                };
              });
          }
        }

        // Fallback: If DB has 0 labs (local dev / sample mode), load nationwide benchmark
        if (labsData.length === 0) {
          try {
            const resp = await fetch("/sample-files/egypt_labs_benchmark.xlsx");
            if (resp.ok) {
              const buf = await resp.arrayBuffer();
              const benchmarkLabFile = new File([buf], "egypt_labs_benchmark.xlsx");
              const parsed = await loadLabCapacity(benchmarkLabFile);
              labsData = parsed.map((l) => {
                const nearby = extractNearby(l);
                return {
                  id: l["Lab ID"],
                  lab_code: l["Lab ID"],
                  name: l["Lab Name"] || l.name || l["Lab ID"],
                  area: l.Area,
                  gov: l.Gov || l.Governorate || getGovForArea(l.Area),
                  capacity: l["Lab Capacity"],
                  is_active: true,
                  nearby_labs: nearby,
                  nearbyLabs: nearby,
                };
              });
            }
          } catch (fbErr) {
            console.warn("Fallback benchmark labs fetch failed:", fbErr);
          }
        }

        // Also merge any labs from masterAllocation that might not be in dbLabs
        if (currentMasterAllocation && currentMasterAllocation.length > 0) {
          const knownIds = new Set(labsData.map((l) => String(l.id || l.lab_code).toLowerCase()));
          currentMasterAllocation.forEach((row) => {
            const rowLabId = String(row.Lab_ID || (row as any)["Lab ID"] || "").trim();
            if (rowLabId && !knownIds.has(rowLabId.toLowerCase())) {
              knownIds.add(rowLabId.toLowerCase());
              labsData.push({
                id: rowLabId,
                lab_code: rowLabId,
                name: (row as any)["Lab Name"] || rowLabId,
                area: row["Physical Area"] || "",
                gov: getGovForArea(row["Physical Area"]),
                capacity: Number(row.Lab_Capacity) || 25,
                is_active: true,
                nearby_labs: [],
                nearbyLabs: [],
              });
            }
          });
        }

        setDbLabs(labsData);
      } catch (err) {
        console.warn("Failed to load labs for gov modal:", err);
        setDbLabs([]);
      } finally {
        setLoadingLabs(false);
      }
    }

    loadGovLabs();
  }, [open, resolvedGov, shortfallArea]);

  // Load the requested schedule and all relevant cross-project reservations once.
  // Candidate evaluation below is then entirely local (no per-lab queries).
  useEffect(() => {
    if (!open || !batchId || dbLabs.length === 0) return;
    const requestedBatchId = batchId;
    let cancelled = false;
    setAvailabilityLoaded(false);
    const slotKey = (date: string, time: string) => `${date}@${String(time).trim().toLowerCase()}`;
    async function loadAvailability() {
      const { data: batch, error: batchError } = await supabase
        .from("batches")
        .select("dates,time_slots")
        .eq("id", requestedBatchId)
        .single();
      if (batchError) throw batchError;
      const dates = Array.isArray((batch as any)?.dates) ? (batch as any).dates : [];
      const times = Array.isArray((batch as any)?.time_slots) ? (batch as any).time_slots : [];
      const schedule: Array<{ date: string; time: string; slot_num: number }> = [];
      let slotNum = 1;
      for (const date of dates) for (const rawTime of times) {
        const [embeddedDate, embeddedTime] = String(rawTime).includes("@") ? String(rawTime).split("@", 2) : [date, rawTime];
        schedule.push({ date: embeddedDate || date, time: embeddedTime || String(rawTime), slot_num: slotNum++ });
      }

      const labIds = dbLabs
        .filter((lab) => isLabInGov(lab, resolvedGov) && !isLabInShortfallArea(lab, shortfallArea, resolvedGov))
        .map((lab) => lab.id)
        .filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
      const busy = new Map<string, Set<string>>();
      if (labIds.length > 0 && dates.length > 0) {
        const { data: sessions, error } = await supabase
          .from("assignment_sessions")
          .select("lab_id,session_date,session_time,batch_id,assignments!inner(status)")
          .in("lab_id", labIds)
          .gte("session_date", [...dates].sort()[0])
          .lte("session_date", [...dates].sort().at(-1)!);
        if (error) throw error;
        for (const session of (sessions || []) as any[]) {
          if (!["pending", "confirmed", "replacement_pending"].includes(String(session.assignments?.status))) continue;
          const id = String(session.lab_id);
          if (!busy.has(id)) busy.set(id, new Set());
          busy.get(id)!.add(slotKey(session.session_date, session.session_time));
        }
      }

      const pending = new Map<string, Set<string>>();
      const { data: requests, error: requestError } = await supabase
        .from("batch_resolution_requests" as any)
        .select("id,batch_id,status,lab_id,nearby_lab_metadata")
        .eq("type", "nearby_lab")
        .in("status", ["pending", "approved"]);
      if (requestError) throw requestError;
      for (const request of (requests || []) as any[]) {
        const metadata = request.nearby_lab_metadata || {};
        const id = String(metadata.lab_uuid || request.lab_id || "");
        if (!pending.has(id)) pending.set(id, new Set());
        for (const session of metadata.required_sessions || []) pending.get(id)!.add(slotKey(session.date, session.time));
      }
      if (!cancelled) {
        setRequiredSessions(schedule);
        setBusySlotsByLabId(busy);
        setPendingSlotsByLabId(pending);
        setAvailabilityLoaded(true);
      }
    }
    loadAvailability().catch((error) => {
      console.error("Failed to load cross-project lab availability:", error);
      toast.error(`Could not verify lab availability: ${error.message || error}`);
      if (!cancelled) setAvailabilityLoaded(true);
    });
    return () => { cancelled = true; };
  }, [open, batchId, dbLabs, resolvedGov, shortfallArea]);

  // 4. Initialize selections when modal opens
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    if (justOpened) {
      const openingStudents = areaStudentsRef.current;
      if (import.meta.env.DEV) {
        console.log("[GovFreeLabsModal] initialize", {
          area: shortfallArea,
          studentCount: openingStudents.length,
        });
      }
      setSelectedStudentIds(new Set());
      setSelectedLabId("");
      setOperationsNote("");
      setSelectedGradeFilter("ALL");
    }
    wasOpenRef.current = open;
  }, [open, shortfallArea]);

  // Derive authoritative slot count from props or master allocation
  const derivedSlotCount = useMemo(() => {
    if (typeof propSlotCount === "number" && propSlotCount > 0) return propSlotCount;
    if (masterAllocation && masterAllocation.length > 0) {
      const maxSlot = Math.max(...masterAllocation.map((r) => r.Slot_Num || 0), 0);
      if (maxSlot > 0) return maxSlot;
    }
    return 7;
  }, [propSlotCount, masterAllocation]);

  const requiredScheduleKeys = useMemo(
    () => requiredSessions.map((session) => `${session.date}@${session.time.trim().toLowerCase()}`).sort(),
    [requiredSessions]
  );
  const requiredScheduleKey = useMemo(() => requiredScheduleKeys.join("|"), [requiredScheduleKeys]);

  const governorateLabs = useMemo(
    () => dbLabs.filter((lab) => isLabInGov(lab, resolvedGov) && !isLabInShortfallArea(lab, shortfallArea, resolvedGov)),
    [dbLabs, resolvedGov, shortfallArea]
  );

  // Index the large allocation once. Candidate evaluation can then resolve a lab's
  // rows in O(1) by UUID, code, name, or normalized Arabic name.
  const allocationRowsByLabKey = useMemo(() => {
    const map = new Map<string, MasterAllocationRow[]>();
    const add = (key: string, row: MasterAllocationRow) => {
      if (!key) return;
      const normalized = key.trim().toLowerCase();
      const rows = map.get(normalized);
      if (rows) rows.push(row);
      else map.set(normalized, [row]);
    };
    for (const row of masterAllocation) {
      const id = String(row.Lab_ID || (row as any)["Lab ID"] || (row as any).lab_id || "");
      const name = String((row as any)["Lab Name"] || (row as any).lab_name || "");
      add(id, row);
      add(name, row);
      add(normalizeArabic(cleanArabicString(id)), row);
      add(normalizeArabic(cleanArabicString(name)), row);
    }
    return map;
  }, [masterAllocation]);

  // Identify shortfall area's actual origin lab(s)
  const shortfallLabs = useMemo(() => {
    const studentOriginLabIds = new Set<string>();
    areaUnassignedStudents.forEach((s) => {
      const origLab = s.Lab_ID || (s as any)["Lab ID"] || (s as any).original_lab || (s as any)["Location ID"] || (s as any).lab_id;
      if (origLab) studentOriginLabIds.add(String(origLab).trim().toLowerCase());
    });

    return dbLabs.filter((lab) => {
      const isAreaLab = isLabInShortfallArea(lab, shortfallArea, resolvedGov);
      const labIdLower = String(lab.id || "").trim().toLowerCase();
      const labCodeLower = String(lab.lab_code || "").trim().toLowerCase();
      const isStudentOrigin = studentOriginLabIds.has(labIdLower) || studentOriginLabIds.has(labCodeLower);
      return isAreaLab || isStudentOrigin;
    });
  }, [dbLabs, shortfallArea, resolvedGov, areaUnassignedStudents]);

  // Determine the single authoritative origin lab tied to the unassigned students
  const primaryOriginLab = useMemo(() => {
    const studentOriginLabIds = new Set<string>();
    areaUnassignedStudents.forEach((s) => {
      const origLab = s.Lab_ID || (s as any)["Lab ID"] || (s as any).original_lab || (s as any)["Location ID"] || (s as any).lab_id;
      if (origLab) studentOriginLabIds.add(String(origLab).trim().toLowerCase());
    });

    // 1. Direct origin lab from unassigned students
    if (studentOriginLabIds.size > 0) {
      for (const sId of studentOriginLabIds) {
        const match = shortfallLabs.find((l) => {
          const lId = String(l.id || "").trim().toLowerCase();
          const lCode = String(l.lab_code || "").trim().toLowerCase();
          return lId === sId || lCode === sId;
        });
        if (match) return match;
      }
    }
    // 2. Grade-matched origin lab from master allocation in this area
    const targetGrade = typeof selectedGradeFilter === "number" ? selectedGradeFilter : shortfallGrades[0];
    if (targetGrade && masterAllocation && masterAllocation.length > 0) {
      const gradeLab = shortfallLabs.find((l) =>
        masterAllocation.some((m) => matchesLab(m, l) && Number(m.Grade) === targetGrade)
      );
      if (gradeLab) return gradeLab;
    }
    // 3. Fallback to primary physical lab in shortfall area
    return shortfallLabs[0] || null;
  }, [areaUnassignedStudents, shortfallLabs, selectedGradeFilter, shortfallGrades, masterAllocation]);

  // 5. Calculate Grade-Aware Capacity and filter out labs with 0 free capacity for relevant shortfall grade(s)
  const govLabsList = useMemo<LabCapacityItem[]>(() => {
    if (batchId && !availabilityLoaded) return [];
    candidateCalculationCountRef.current += 1;
    const TOTAL_SLOTS = derivedSlotCount;

    const computedList = governorateLabs
      .map((lab) => {
        const capPerSession = Number(lab.capacity || (lab as any)["Lab Capacity"] || 20);
        const totalMaxCap = capPerSession * TOTAL_SLOTS;

        // Group master allocation rows for this lab by slot 1..TOTAL_SLOTS
        const lookupKeys = [lab.id, lab.lab_code, lab.name]
          .flatMap((value) => {
            const raw = String(value || "");
            return [raw.trim().toLowerCase(), normalizeArabic(cleanArabicString(raw))];
          })
          .filter(Boolean);
        const labRows = Array.from(new Set(lookupKeys.flatMap((key) => allocationRowsByLabKey.get(key) || [])));
        const assignedTotal = labRows.length;
        const totalFreeCapacity = Math.max(0, totalMaxCap - assignedTotal);

        const slotMap: Record<number, { students: MasterAllocationRow[]; grade?: number }> = {};
        for (let s = 1; s <= TOTAL_SLOTS; s++) {
          slotMap[s] = { students: [] };
        }
        for (const row of labRows) {
          const slot = slotMap[getSlotIndex(row, TOTAL_SLOTS)];
          if (!slot) continue;
          slot.students.push(row);
          if (slot.grade === undefined) slot.grade = Number(row.Grade) || 4;
        }

        // Calculate direct remaining capacity per grade from partially occupied slots
        const directGradeRemaining: Record<number, number> = { 4: 0, 5: 0, 6: 0 };
        let emptySlots = 0;
        let occupiedSlots = 0;

        for (let s = 1; s <= TOTAL_SLOTS; s++) {
          const slot = slotMap[s];
          if (slot.students.length === 0) {
            emptySlots += 1;
          } else {
            occupiedSlots += 1;
            const g = slot.grade || 4;
            const remaining = Math.max(0, capPerSession - slot.students.length);
            directGradeRemaining[g] = (directGradeRemaining[g] || 0) + remaining;
          }
        }

        // Free capacity per grade: direct remaining in grade's slots, strictly capped by remaining total lab capacity
        const gradeFreeCap: Record<number, number> = {
          4: Math.min(directGradeRemaining[4] || 0, totalFreeCapacity),
          5: Math.min(directGradeRemaining[5] || 0, totalFreeCapacity),
          6: Math.min(directGradeRemaining[6] || 0, totalFreeCapacity),
        };

        // Active free capacity based on selected grade filter or primary shortfall grade
        let activeFree = 0;
        if (typeof selectedGradeFilter === "number") {
          activeFree = gradeFreeCap[selectedGradeFilter] || 0;
        } else if (shortfallGrades.length === 1) {
          activeFree = gradeFreeCap[shortfallGrades[0]] || 0;
        } else if (shortfallGrades.length > 1) {
          activeFree = Math.min(
            totalFreeCapacity,
            shortfallGrades.reduce((sum, g) => sum + (gradeFreeCap[g] || 0), 0)
          );
        } else {
          activeFree = totalFreeCapacity;
        }

        // Resolve proximity distance from the authoritative shortfall origin lab to this candidate destination lab
        let resolvedDist: number | null = null;
        let resolvedRank: number | null = null;
        let resolvedMethod: string | null = null;
        let resolvedOrigin: string | null = null;
        let resolvedTrace: string = "NO_MATCH";

        const labIdLower = String(lab.id || "").trim().toLowerCase();
        const labCodeLower = String(lab.lab_code || "").trim().toLowerCase();
        const labNameNorm = normalizeArabic(cleanArabicString(String(lab.name || "")));

        const getNearbyList = (l: any): any[] => {
          if (Array.isArray(l.nearby_labs) && l.nearby_labs.length > 0) return l.nearby_labs;
          if (Array.isArray(l.nearbyLabs) && l.nearbyLabs.length > 0) return l.nearbyLabs;
          if (typeof l.notes === "string" && l.notes.includes("[NEARBY_LABS_JSON]:")) {
            try {
              const parsed = JSON.parse(l.notes.split("[NEARBY_LABS_JSON]:")[1]?.trim() || "[]");
              if (Array.isArray(parsed)) return parsed;
            } catch {}
          }
          return [];
        };

        // Order origin labs: Primary authoritative lab first, then any secondary origin labs solely as fallback
        const orderedOriginLabs = primaryOriginLab
          ? [primaryOriginLab, ...shortfallLabs.filter((l) => l.id !== primaryOriginLab.id)]
          : shortfallLabs;

        // 1. PRIMARY FORWARD LOOKUP: Check origin lab's nearby_labs for candidate lab
        for (const sfLab of orderedOriginLabs) {
          const nearbyList = getNearbyList(sfLab);
          
          // Strict Tier 1: ID Match on origin lab
          const idMatchEntry = nearbyList.find((n: any) => {
            const nId = String(n.nearbyLabId || "").trim().toLowerCase();
            return Boolean(nId && (nId === labIdLower || nId === labCodeLower));
          });

          if (idMatchEntry) {
            const dKm = typeof idMatchEntry.distanceKm === "number"
              ? idMatchEntry.distanceKm
              : parseFloat(String(idMatchEntry.distanceKm ?? "").replace(/[^\d.]/g, ""));
            if (Number.isFinite(dKm)) {
              resolvedDist = dKm;
              resolvedRank = Number.isFinite(idMatchEntry.rank) ? Number(idMatchEntry.rank) : null;
              resolvedMethod = idMatchEntry.distanceMethod || "forward_id";
              resolvedOrigin = sfLab.lab_code || sfLab.id;
              resolvedTrace = `forward_id(origin=${sfLab.lab_code || sfLab.id} -> match=${idMatchEntry.nearbyLabId}, d=${dKm}km)`;
              break; // Authoritative match found - do not search further or minimize
            }
          }

          // Strict Tier 2: Name Match ONLY if nearbyLabId is absent/blank
          const nameMatchEntry = nearbyList.find((n: any) => {
            const nId = String(n.nearbyLabId || "").trim().toLowerCase();
            const nNameNorm = normalizeArabic(cleanArabicString(String(n.nearbyLabName || "")));
            return Boolean(!nId && nNameNorm && labNameNorm && nNameNorm === labNameNorm);
          });

          if (nameMatchEntry) {
            const dKm = typeof nameMatchEntry.distanceKm === "number"
              ? nameMatchEntry.distanceKm
              : parseFloat(String(nameMatchEntry.distanceKm ?? "").replace(/[^\d.]/g, ""));
            if (Number.isFinite(dKm)) {
              resolvedDist = dKm;
              resolvedRank = Number.isFinite(nameMatchEntry.rank) ? Number(nameMatchEntry.rank) : null;
              resolvedMethod = nameMatchEntry.distanceMethod || "forward_name";
              resolvedOrigin = sfLab.lab_code || sfLab.id;
              resolvedTrace = `forward_name(origin=${sfLab.lab_code || sfLab.id} -> matchName="${nameMatchEntry.nearbyLabName}", d=${dKm}km)`;
              break; // Match found - do not search further or minimize
            }
          }
        }

        // 2. FALLBACK: Reverse lookup if candidate lab lists the origin lab
        if (resolvedDist === null) {
          const destNearbyList = getNearbyList(lab);
          for (const sfLab of orderedOriginLabs) {
            const sfIdLower = String(sfLab.id || "").trim().toLowerCase();
            const sfCodeLower = String(sfLab.lab_code || "").trim().toLowerCase();
            const sfNameNorm = normalizeArabic(cleanArabicString(String(sfLab.name || "")));

            const idMatchEntry = destNearbyList.find((n: any) => {
              const nId = String(n.nearbyLabId || "").trim().toLowerCase();
              return Boolean(nId && (nId === sfIdLower || nId === sfCodeLower));
            });

            if (idMatchEntry) {
              const dKm = typeof idMatchEntry.distanceKm === "number"
                ? idMatchEntry.distanceKm
                : parseFloat(String(idMatchEntry.distanceKm ?? "").replace(/[^\d.]/g, ""));
              if (Number.isFinite(dKm)) {
                resolvedDist = dKm;
                resolvedRank = Number.isFinite(idMatchEntry.rank) ? Number(idMatchEntry.rank) : null;
                resolvedMethod = idMatchEntry.distanceMethod || "reverse_id";
                resolvedOrigin = `rev:${sfLab.lab_code || sfLab.id}`;
                resolvedTrace = `reverse_id(candidate=${lab.lab_code || lab.id} lists origin=${sfLab.lab_code || sfLab.id}, d=${dKm}km)`;
                break;
              }
            }

            const nameMatchEntry = destNearbyList.find((n: any) => {
              const nId = String(n.nearbyLabId || "").trim().toLowerCase();
              const nNameNorm = normalizeArabic(cleanArabicString(String(n.nearbyLabName || "")));
              return Boolean(!nId && nNameNorm && sfNameNorm && nNameNorm === sfNameNorm);
            });

            if (nameMatchEntry) {
              const dKm = typeof nameMatchEntry.distanceKm === "number"
                ? nameMatchEntry.distanceKm
                : parseFloat(String(nameMatchEntry.distanceKm ?? "").replace(/[^\d.]/g, ""));
              if (Number.isFinite(dKm)) {
                resolvedDist = dKm;
                resolvedRank = Number.isFinite(nameMatchEntry.rank) ? Number(nameMatchEntry.rank) : null;
                resolvedMethod = nameMatchEntry.distanceMethod || "reverse_name";
                resolvedOrigin = `rev:${sfLab.lab_code || sfLab.id}`;
                resolvedTrace = `reverse_name(candidate=${lab.lab_code || lab.id} lists originName="${nameMatchEntry.nearbyLabName}", d=${dKm}km)`;
                break;
              }
            }
          }
        }

        // 3. Fallback to direct distance fields on destination lab object if already computed
        if (resolvedDist === null && typeof lab.distanceKm === "number" && Number.isFinite(lab.distanceKm)) {
          resolvedDist = lab.distanceKm;
          resolvedRank = lab.distanceRank ?? lab.rank ?? null;
          resolvedMethod = lab.distanceMethod || "direct_prop";
          resolvedOrigin = "direct";
          resolvedTrace = `direct_prop(lab.distanceKm=${lab.distanceKm}km)`;
        }

        return {
          id: lab.id || lab.lab_code,
          name: lab.name || `Lab ${lab.lab_code || lab.id}`,
          lab_code: lab.lab_code || undefined,
          area: lab.area || lab.city || resolvedGov,
          gov: lab.gov || resolvedGov,
          capacity_per_session: capPerSession,
          total_capacity: totalMaxCap,
          assigned_students: assignedTotal,
          total_free_capacity: totalFreeCapacity,
          grade_free_capacity: gradeFreeCap,
          active_free_capacity: activeFree,
          empty_slots: emptySlots,
          occupied_slots: occupiedSlots,
          is_same_area: false,
          distanceKm: resolvedDist,
          distanceRank: resolvedRank,
          distanceMethod: resolvedMethod,
          originUsed: resolvedOrigin,
          distanceTrace: resolvedTrace,
          quality_rating: Number(lab.quality_rating ?? lab.quality ?? 0) || null,
          price_per_session: Number(lab.price_per_session ?? lab.session_price ?? lab.price ?? 0) || null,
          availability: (() => {
            const ids = [String(lab.id || ""), String(lab.lab_code || "")];
            if (ids.some((id) => requiredScheduleKeys.some((key) => busySlotsByLabId.get(id)?.has(key)))) return "occupied" as const;
            if (ids.some((id) => requiredScheduleKeys.some((key) => pendingSlotsByLabId.get(id)?.has(key)))) return "pending" as const;
            return "free" as const;
          })(),
        };
      });

    // Filter the destination lab list to only show labs that have available capacity for the shortfall grade(s)
    return computedList
      .filter((lab) => {
        if (typeof selectedGradeFilter === "number") {
          return (lab.grade_free_capacity[selectedGradeFilter] || 0) > 0;
        }
        if (shortfallGrades.length > 0) {
          return shortfallGrades.some((g) => (lab.grade_free_capacity[g] || 0) > 0);
        }
        return lab.total_free_capacity > 0;
      })
      .sort((a, b) => {
        if (a.availability !== b.availability) return a.availability === "free" ? -1 : b.availability === "free" ? 1 : 0;
        const hasDistA = typeof a.distanceKm === "number" && Number.isFinite(a.distanceKm);
        const hasDistB = typeof b.distanceKm === "number" && Number.isFinite(b.distanceKm);

        if (hasDistA && hasDistB) {
          if (Math.abs(a.distanceKm! - b.distanceKm!) > 0.001) {
            return a.distanceKm! - b.distanceKm!;
          }
          if (a.distanceRank && b.distanceRank && a.distanceRank !== b.distanceRank) {
            return a.distanceRank - b.distanceRank;
          }
          return (Number(b.quality_rating) - Number(a.quality_rating)) || (b.active_free_capacity - a.active_free_capacity) || (Number(a.price_per_session) - Number(b.price_per_session));
        }

        if (hasDistA && !hasDistB) return -1;
        if (!hasDistA && hasDistB) return 1;

        return (Number(b.quality_rating) - Number(a.quality_rating)) || (b.active_free_capacity - a.active_free_capacity) || (Number(a.price_per_session) - Number(b.price_per_session));
      });
  }, [batchId, availabilityLoaded, governorateLabs, resolvedGov, allocationRowsByLabKey, selectedGradeFilter, shortfallGrades, derivedSlotCount, primaryOriginLab, shortfallLabs, requiredScheduleKey, requiredScheduleKeys, busySlotsByLabId, pendingSlotsByLabId]);

  // Filtered labs by search query
  const filteredGovLabs = useMemo(() => {
    if (!searchQuery.trim()) return govLabsList;
    const q = searchQuery.toLowerCase().trim();
    return govLabsList.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.area.toLowerCase().includes(q) ||
        (l.lab_code && l.lab_code.toLowerCase().includes(q))
    );
  }, [govLabsList, searchQuery]);

  const CANDIDATES_PER_PAGE = 20;
  const candidatePageCount = Math.max(1, Math.ceil(filteredGovLabs.length / CANDIDATES_PER_PAGE));
  const paginatedGovLabs = useMemo(() => {
    const start = (candidatePage - 1) * CANDIDATES_PER_PAGE;
    return filteredGovLabs.slice(start, start + CANDIDATES_PER_PAGE);
  }, [filteredGovLabs, candidatePage]);

  useEffect(() => {
    setCandidatePage(1);
  }, [searchQuery, govLabsList]);

  useEffect(() => {
    if (!import.meta.env.DEV || !open) return;
    console.log("[GovFreeLabsModal] candidate summary", {
      totalLabs: dbLabs.length,
      governorateLabs: governorateLabs.length,
      availableLabs: govLabsList.filter((lab) => lab.availability === "free").length,
      conflictedLabs: govLabsList.filter((lab) => lab.availability !== "free").length,
      filteredOut: governorateLabs.length - govLabsList.length,
      calculations: candidateCalculationCountRef.current,
      requiredScheduleKey,
    });
  }, [open, dbLabs.length, governorateLabs.length, govLabsList, requiredScheduleKey]);

  // Filtered students by grade filter
  const displayedStudents = useMemo(() => {
    if (!selectedLabId) return [];
    if (selectedGradeFilter === "ALL") return areaUnassignedStudents;
    return areaUnassignedStudents.filter((s) => Number(s.Grade) === selectedGradeFilter);
  }, [areaUnassignedStudents, selectedGradeFilter, selectedLabId]);

  const STUDENTS_PER_PAGE = 50;
  const studentPageCount = Math.max(1, Math.ceil(displayedStudents.length / STUDENTS_PER_PAGE));
  const paginatedStudents = useMemo(() => {
    const start = (studentPage - 1) * STUDENTS_PER_PAGE;
    return displayedStudents.slice(start, start + STUDENTS_PER_PAGE);
  }, [displayedStudents, studentPage]);

  useEffect(() => {
    setStudentPage(1);
  }, [selectedLabId, selectedGradeFilter]);

  // Selected destination lab object
  const selectedDestLab = useMemo(() => {
    return govLabsList.find((l) => l.id === selectedLabId);
  }, [govLabsList, selectedLabId]);

  // Selected students list
  const selectedStudents = useMemo(() => {
    const selected = [] as UnassignedStudentRow[];
    for (const id of selectedStudentIds) {
      const student = areaStudentById.get(id);
      if (!student) continue;
      if (selectedGradeFilter !== "ALL" && Number(student.Grade) !== selectedGradeFilter) continue;
      selected.push(student);
    }
    return selected;
  }, [areaStudentById, selectedStudentIds, selectedGradeFilter]);

  // Selected students count breakdown by grade
  const selectedCountsByGrade = useMemo<Record<number, number>>(() => {
    const counts: Record<number, number> = {};
    for (const s of selectedStudents) {
      const g = Number(s.Grade);
      if (!Number.isFinite(g)) continue;
      counts[g] = (counts[g] || 0) + 1;
    }
    return counts;
  }, [selectedStudents]);

  // Capacity validation status for selected destination lab
  const capacityValidation = useMemo(() => {
    if (!selectedDestLab) {
      return { isOverCapacity: false, errors: [], totalExcess: 0 };
    }

    const errors: { grade: number; selected: number; available: number; excess: number }[] = [];
    let totalExcess = 0;

    for (const g of shortfallGrades) {
      const selected = selectedCountsByGrade[g] || 0;
      const available = selectedDestLab.grade_free_capacity[g] || 0;
      if (selected > available) {
        const excess = selected - available;
        errors.push({ grade: g, selected, available, excess });
      }
    }

    if (selectedStudents.length > selectedDestLab.total_free_capacity) {
      totalExcess = selectedStudents.length - selectedDestLab.total_free_capacity;
    }

    const isOverCapacity = errors.length > 0 || totalExcess > 0;

    return { isOverCapacity, errors, totalExcess };
  }, [selectedDestLab, selectedCountsByGrade, selectedStudents]);

  // Automatically reset selected lab if it gets filtered out
  const govLabIdKey = useMemo(() => govLabsList.map((lab) => lab.id).sort().join("\u0000"), [govLabsList]);
  useEffect(() => {
    if (selectedLabId && !govLabIdKey.split("\u0000").includes(selectedLabId)) {
      setSelectedLabId("");
    }
  }, [govLabIdKey, selectedLabId]);

  // Smart Lab Selection Handler: auto-fits selection when selecting a lab if currently over-capacity
  const handleSelectLab = (labId: string) => {
    const lab = govLabsList.find((l) => l.id === labId);
    if (!lab) return;
    if (lab.availability !== "free") {
      toast.error(lab.availability === "pending" ? "Pending approval for another project" : "This lab is occupied during the required schedule");
      return;
    }
    setSelectedLabId(labId);
    if (requiredSessions.length === 0) {
      toast.error("This batch has no configured dates and time slots to reserve.");
      return;
    }

    const candidateStudents = selectedGradeFilter === "ALL"
      ? areaUnassignedStudents
      : areaUnassignedStudents.filter((student) => Number(student.Grade) === selectedGradeFilter);
    const effectiveSelectedIds = selectedStudentIds.size > 0
      ? selectedStudentIds
      : new Set(candidateStudents.map((student) => student.S_ID));

    // If currently selected students exceed this lab's capacity, auto-fit to this lab's capacity
    const remainingBudget: Record<number, number> = {
      4: lab.grade_free_capacity[4] || 0,
      5: lab.grade_free_capacity[5] || 0,
      6: lab.grade_free_capacity[6] || 0,
    };
    let totalBudget = lab.total_free_capacity;

    const picked = new Set<string>();
    // Prioritize students that were already selected
    for (const student of candidateStudents) {
      if (!effectiveSelectedIds.has(student.S_ID)) continue;
      if (totalBudget <= 0) break;
      const g = Number(student.Grade) || 4;
      if (remainingBudget[g] > 0) {
        picked.add(student.S_ID);
        remainingBudget[g] -= 1;
        totalBudget -= 1;
      }
    }

    // If none were selected yet, pick up to capacity
    if (picked.size === 0 && effectiveSelectedIds.size > 0) {
      for (const student of candidateStudents) {
        if (totalBudget <= 0) break;
        const g = Number(student.Grade) || 4;
        if (remainingBudget[g] > 0) {
          picked.add(student.S_ID);
          remainingBudget[g] -= 1;
          totalBudget -= 1;
        }
      }
    }

    if (picked.size > 0) {
      setSelectedStudentIds(picked);
    }
  };

  // Student selection helpers
  const handleToggleStudent = (sId: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(sId)) next.delete(sId);
      else next.add(sId);
      return next;
    });
  };

  const handleSelectAllStudents = () => {
    setSelectedStudentIds(new Set(displayedStudents.map((s) => s.S_ID)));
  };

  const handleDeselectAllStudents = () => {
    setSelectedStudentIds(new Set());
  };

  // Fit to Lab Capacity using Grade-Aware Free Capacity and Total Free Capacity Bounds
  const handleSelectUpToCapacity = () => {
    if (!selectedDestLab) return;

    const remainingBudget: Record<number, number> = {
      4: selectedDestLab.grade_free_capacity[4] || 0,
      5: selectedDestLab.grade_free_capacity[5] || 0,
      6: selectedDestLab.grade_free_capacity[6] || 0,
    };
    let totalBudget = selectedDestLab.total_free_capacity;

    const picked = new Set<string>();
    for (const student of displayedStudents) {
      if (totalBudget <= 0) break;
      const g = Number(student.Grade) || 4;
      if (remainingBudget[g] > 0) {
        picked.add(student.S_ID);
        remainingBudget[g] -= 1;
        totalBudget -= 1;
      }
    }

    setSelectedStudentIds(picked);
  };

  // Submit a lab-first Event Team approval request. Students are not moved here.
  const handleSubmitCSRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedDestLab) {
      toast.error("Please select a destination lab with available capacity");
      return;
    }

    const studentsToMove = displayedStudents.filter((s) =>
      selectedStudentIds.has(s.S_ID)
    );

    if (studentsToMove.length === 0) {
      toast.error("Please select at least one student to move");
      return;
    }

    // Capacity Validation: prevent creating overbooked requests
    if (capacityValidation.isOverCapacity) {
      const errorDesc = capacityValidation.errors
        .map((err) => `${formatGradeLevel(err.grade)}: ${err.selected} selected vs ${err.available} available`)
        .join(", ");
      toast.error(
        `Cannot create CS request: Selected students exceed capacity in ${selectedDestLab.name} (${errorDesc}). Please fit selection to capacity before submitting.`
      );
      return;
    }

    // Resolve robust batch & project identifiers
    const effectiveBatchId =
      batchId ||
      (typeof window !== "undefined"
        ? localStorage.getItem("selected_batch_id") ||
          localStorage.getItem("last_active_batch_id")
        : null) ||
      "current_batch";

    const effectiveProjectId =
      projectId ||
      (typeof window !== "undefined"
        ? localStorage.getItem("selected_project_id")
        : null) ||
      null;

    setSubmitting(true);
    try {
      await saveBatchResolutionRequest({
        batch_id: effectiveBatchId,
        project_id: effectiveProjectId,
        type: "nearby_lab",
        target_team: "Event Team",
        status: "pending",
        area: shortfallArea,
        grades: Array.from(new Set(studentsToMove.map((s) => Number(s.Grade) || 4))),
        unassigned_count: studentsToMove.length,
        lab_id: selectedDestLab.id,
        destination_lab_capacity: selectedDestLab.grade_free_capacity,
        destination_lab_total_capacity: selectedDestLab.total_free_capacity,
        suggested_nearest_lab: selectedDestLab.name,
        suggested_nearest_area: selectedDestLab.area,
        reason: `Approve existing lab ${selectedDestLab.name} for ${studentsToMove.length} unassigned student(s) from ${shortfallArea}.`,
        notes: operationsNote.trim() || undefined,
        submitted_by_name: currentUserName,
        submitted_by_role: "Operations Team",
        nearby_lab_metadata: {
          lab_uuid: selectedDestLab.id,
          lab_code: selectedDestLab.lab_code,
          lab_name: selectedDestLab.name,
          source_area: shortfallArea,
          source_governorate: resolvedGov,
          destination_area: selectedDestLab.area,
          destination_governorate: selectedDestLab.gov,
          capacity: selectedDestLab.capacity_per_session,
          free_capacity: selectedDestLab.active_free_capacity,
          distance_km: selectedDestLab.distanceKm,
          quality_rating: selectedDestLab.quality_rating,
          price_per_session: selectedDestLab.price_per_session,
          required_sessions: requiredSessions,
          selected_student_ids: studentsToMove.map((student) => student.S_ID),
        },
      });

      toast.success(
        `Approval requested for ${selectedDestLab.name}. Students will remain unassigned until Operations uses the approved lab.`
      );

      if (onSuccess) onSuccess();

      onOpenChange(false);
    } catch (err: any) {
      console.error("Failed to create nearby lab request:", err);
      toast.error(err.message || "Failed to create nearby lab request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0 overflow-hidden shadow-2xl">
          <form onSubmit={handleSubmitCSRequest} className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <DialogHeader className="p-5 pb-3 border-b bg-muted/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <DialogTitle className="text-base font-bold flex items-center gap-2">
                      Free Labs by Governorate:{" "}
                      <span className="text-primary font-bold">{resolvedGov}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {govLabsList.length} Available Venues
                      </Badge>
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                      Shortfall Area: <strong>{shortfallArea}</strong> • Request approval for an existing lab that is free for the full batch schedule.
                    </DialogDescription>
                  </div>
                </div>

                {/* Interactive Shortfall Filter Chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {shortfallGrades.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant={selectedGradeFilter === "ALL" ? "default" : "outline"}
                      onClick={() => setSelectedGradeFilter("ALL")}
                      className={`h-7 text-xs font-bold px-2.5 transition-all ${
                        selectedGradeFilter === "ALL"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      All Shortfall ({areaUnassignedStudents.length})
                    </Button>
                  )}
                  {shortfallGrades.map((g) => {
                    const count = shortfallCountByGrade.get(g) || 0;
                    const isSelected = selectedGradeFilter === g;
                    return (
                      <Button
                        key={g}
                        type="button"
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        onClick={() =>
                          setSelectedGradeFilter(
                            isSelected && shortfallGrades.length > 1 ? "ALL" : g
                          )
                        }
                        className={`h-7 text-xs font-bold px-2.5 transition-all ${
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        {formatGradeLevel(g)} Shortfall ({count})
                      </Button>
                    );
                  })}
                </div>
              </div>
            </DialogHeader>

            {/* Body Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* STEP 1: Select Destination Lab */}
              <div className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                      <span className="flex h-5 w-5 rounded-full bg-primary text-white items-center justify-center text-[10px] font-bold">1</span>
                      Select Destination Lab in {resolvedGov} Governorate
                    </Label>

                    {/* Active Grade Indicator Badge */}
                    {typeof selectedGradeFilter === "number" ? (
                      <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] font-bold">
                        Filtering {formatGradeLevel(selectedGradeFilter)} Available Labs Only
                      </Badge>
                    ) : shortfallGrades.length > 0 ? (
                      <Badge variant="outline" className="text-[10px] font-medium text-muted-foreground">
                        Showing labs with seats for {shortfallGrades.map((grade) => formatGradeLevel(grade, undefined, true)).join(" / ")}
                      </Badge>
                    ) : null}
                  </div>

                  {/* Search Labs */}
                  <div className="relative w-full sm:w-60">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search lab name or area..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 text-xs bg-background"
                    />
                  </div>
                </div>

                {/* Labs List Cards (Filtered to Shortfall Grades Only) */}
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {loadingLabs || (Boolean(batchId) && !availabilityLoaded) ? (
                    <div className="text-center py-8 text-xs text-muted-foreground border rounded-xl bg-card">
                      <div className="animate-spin inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full mb-2" />
                      <div>Loading available lab venues in {resolvedGov}...</div>
                    </div>
                  ) : filteredGovLabs.length === 0 ? (
                    <div className="text-center py-8 text-xs text-muted-foreground border rounded-xl bg-card space-y-1">
                      <div className="font-semibold text-foreground">
                        No available labs found in {resolvedGov} for{" "}
                        {typeof selectedGradeFilter === "number"
                          ? formatGradeLevel(selectedGradeFilter)
                          : shortfallGrades.length > 0
                          ? shortfallGrades.map((grade) => formatGradeLevel(grade, undefined, true)).join(" / ")
                          : "this area"}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        All other active labs in {resolvedGov} currently have 0 free seats for the selected shortfall grade(s).
                      </p>
                    </div>
                  ) : (
                    paginatedGovLabs.map((lab) => {
                      const isSelected = selectedLabId === lab.id;
                      const targetGradeCap =
                        typeof selectedGradeFilter === "number"
                          ? lab.grade_free_capacity[selectedGradeFilter] || 0
                          : lab.active_free_capacity;
                      const occupancyPct =
                        lab.total_capacity > 0
                          ? Math.min(100, Math.round((lab.assigned_students / lab.total_capacity) * 100))
                          : 0;

                      return (
                        <div
                          key={lab.id}
                          onClick={() => handleSelectLab(lab.id)}
                          className={`group relative rounded-xl border p-3 transition-all ${lab.availability === "free" ? "cursor-pointer" : "cursor-not-allowed opacity-65"} ${
                            isSelected
                              ? "border-primary bg-primary/[0.04] ring-2 ring-primary/20 shadow-xs"
                              : "border-border/70 bg-card hover:border-primary/40 hover:bg-muted/30"
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            {/* Left: Radio + Lab Identity */}
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="pt-0.5 shrink-0">
                                <input
                                  type="radio"
                                  name="destination_lab"
                                  checked={isSelected}
                                  onChange={() => handleSelectLab(lab.id)}
                                  className="h-4 w-4 text-primary accent-primary cursor-pointer"
                                />
                              </div>
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-xs text-foreground flex items-center gap-1.5 truncate">
                                    <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                                    <span>{lab.name}</span>
                                  </span>
                                  {lab.lab_code && (
                                    <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 bg-muted/50">
                                      {lab.lab_code}
                                    </Badge>
                                  )}
                                  <Badge variant="secondary" className="text-[10px] font-medium px-1.5 py-0 flex items-center gap-1">
                                    <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                                    <span>{lab.area}</span>
                                  </Badge>
                                  <Badge className={`text-[10px] ${lab.availability === "free" ? "bg-emerald-600" : lab.availability === "pending" ? "bg-amber-600" : "bg-slate-500"}`}>
                                    {lab.availability === "free" ? "Available all required sessions" : lab.availability === "pending" ? "Pending approval for another project" : "Schedule conflict"}
                                  </Badge>
                                  {typeof lab.distanceKm === "number" && Number.isFinite(lab.distanceKm) && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] font-bold px-1.5 py-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 flex items-center gap-1"
                                      title={lab.distanceMethod ? `Method: ${lab.distanceMethod}` : undefined}
                                    >
                                      <span>📍 {Number(lab.distanceKm.toFixed(2))} km</span>
                                      {lab.distanceRank ? (
                                        <span className="text-[9px] opacity-80 font-normal">#{lab.distanceRank}</span>
                                      ) : null}
                                    </Badge>
                                  )}
                                </div>

                                {/* Capacity & Occupancy metrics */}
                                <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-0.5">
                                  <span className="font-medium text-foreground/80">
                                    Session Cap: <strong className="text-foreground">{lab.capacity_per_session}</strong> seats
                                  </span>
                                  <span>•</span>
                                  <div className="flex items-center gap-1.5">
                                    <span>Occupancy:</span>
                                    <strong className="font-mono text-foreground">
                                      {lab.assigned_students} / {lab.total_capacity}
                                    </strong>
                                    <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden inline-block ml-1">
                                      <div
                                        className={`h-full rounded-full ${
                                          occupancyPct >= 100
                                            ? "bg-rose-500"
                                            : occupancyPct >= 80
                                            ? "bg-amber-500"
                                            : "bg-emerald-500"
                                        }`}
                                        style={{ width: `${occupancyPct}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Right: Availability Metrics */}
                            <div className="flex sm:flex-col items-end justify-between sm:justify-center gap-1.5 shrink-0 pl-7 sm:pl-0">
                              {/* Primary Target Grade Availability Badge */}
                              {typeof selectedGradeFilter === "number" ? (
                                <div className="flex items-center gap-1.5">
                                  <Badge
                                    className={`text-xs font-bold px-2.5 py-1 ${
                                      targetGradeCap > 0
                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                                        : "bg-muted text-muted-foreground border-border"
                                    }`}
                                  >
                                    {targetGradeCap > 0
                                      ? `+${targetGradeCap} seats for ${formatGradeLevel(selectedGradeFilter)}`
                                      : `Full for ${formatGradeLevel(selectedGradeFilter)}`}
                                  </Badge>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 flex-wrap justify-end">
                                  {shortfallGrades.map((g) => {
                                    const cap = lab.grade_free_capacity[g] || 0;
                                    return (
                                      <Badge
                                        key={g}
                                        variant="outline"
                                        className={`text-[10px] font-bold px-2 py-0.5 ${
                                          cap > 0
                                            ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                                            : "bg-muted/40 text-muted-foreground border-border"
                                        }`}
                                      >
                                        {formatGradeLevel(g, undefined, true)}: +{cap}
                                      </Badge>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Total Free Seats summary */}
                              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <span>Total Free:</span>
                                <strong className={lab.total_free_capacity > 0 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-muted-foreground"}>
                                  {lab.total_free_capacity} seats
                                </strong>
                                {lab.empty_slots > 0 && (
                                  <span className="text-muted-foreground">
                                    ({lab.empty_slots} open slot{lab.empty_slots !== 1 ? "s" : ""})
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                {filteredGovLabs.length > CANDIDATES_PER_PAGE && (
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">
                      Showing {(candidatePage - 1) * CANDIDATES_PER_PAGE + 1}–{Math.min(candidatePage * CANDIDATES_PER_PAGE, filteredGovLabs.length)} of {filteredGovLabs.length} labs
                    </span>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={candidatePage === 1} onClick={() => setCandidatePage((page) => Math.max(1, page - 1))}>Previous</Button>
                      <span>{candidatePage} / {candidatePageCount}</span>
                      <Button type="button" size="sm" variant="outline" disabled={candidatePage === candidatePageCount} onClick={() => setCandidatePage((page) => Math.min(candidatePageCount, page + 1))}>Next</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* STEP 2: Select Affected Students */}
              {selectedDestLab && <div className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                      <span className="flex h-5 w-5 rounded-full bg-primary text-white items-center justify-center text-[10px] font-bold">2</span>
                      Select Shortfall Students to Reassign ({selectedStudents.length} / {displayedStudents.length} Selected)
                    </Label>

                    {/* Grade Filter Pill Tabs */}
                    {shortfallGrades.length > 1 && (
                      <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border">
                        <Button
                          type="button"
                          size="sm"
                          variant={selectedGradeFilter === "ALL" ? "default" : "ghost"}
                          onClick={() => setSelectedGradeFilter("ALL")}
                          className="h-6 text-[10px] px-2"
                        >
                          All Grades ({areaUnassignedStudents.length})
                        </Button>
                        {shortfallGrades.map((g) => {
                          const count = shortfallCountByGrade.get(g) || 0;
                          return (
                            <Button
                              key={g}
                              type="button"
                              size="sm"
                              variant={selectedGradeFilter === g ? "default" : "ghost"}
                              onClick={() => setSelectedGradeFilter(g)}
                              className="h-6 text-[10px] px-2"
                            >
                              {formatGradeLevel(g)} ({count})
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleSelectAllStudents}
                      className="h-7 text-xs px-2"
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleDeselectAllStudents}
                      className="h-7 text-xs px-2 text-muted-foreground"
                    >
                      Clear
                    </Button>
                    {selectedDestLab && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSelectUpToCapacity}
                        className="h-7 text-xs px-2 gap-1 text-primary border-primary/30"
                      >
                        <Sparkles className="h-3 w-3" /> Fit to Grade Capacity ({selectedDestLab.active_free_capacity})
                      </Button>
                    )}
                  </div>
                </div>

                {/* Overbooking Alert Banner (if selected students exceed capacity) */}
                {capacityValidation.isOverCapacity && selectedDestLab && (
                  <div className="p-3 rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs animate-in fade-in">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                      <div>
                        <strong>Capacity Overbooking Warning:</strong> Selected {selectedStudents.length} students, but <strong>{selectedDestLab.name}</strong> only has {selectedDestLab.total_free_capacity} seats free
                        {capacityValidation.errors.map((e) => ` (${formatGradeLevel(e.grade)}: ${e.selected} selected vs ${e.available} available)`).join(", ")}.
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleSelectUpToCapacity}
                      className="h-7 text-xs font-bold border-rose-300 text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/50 shrink-0 gap-1"
                    >
                      <Sparkles className="h-3 w-3" /> Auto-Fit to Capacity
                    </Button>
                  </div>
                )}

                {/* Students List Table */}
                <div className="border rounded-xl overflow-hidden max-h-44 overflow-y-auto bg-card">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead className="w-10 text-xs"></TableHead>
                        <TableHead className="text-xs font-bold">Student ID</TableHead>
                        <TableHead className="text-xs font-bold">Grade</TableHead>
                        <TableHead className="text-xs font-bold">Current Area</TableHead>
                        <TableHead className="text-xs font-bold">Shortfall Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedStudents.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-4 text-xs text-muted-foreground">
                            No unassigned students recorded for {shortfallArea} matching grade filter.
                          </TableCell>
                        </TableRow>
                      ) : (
                        paginatedStudents.map((student) => {
                          const isChecked = selectedStudentIds.has(student.S_ID);
                          return (
                            <TableRow
                              key={student.S_ID}
                              onClick={() => handleToggleStudent(student.S_ID)}
                              className={`cursor-pointer transition-colors ${
                                isChecked ? "bg-muted/30" : ""
                              }`}
                            >
                              <TableCell className="py-2">
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => handleToggleStudent(student.S_ID)}
                                />
                              </TableCell>
                              <TableCell className="py-2 font-mono font-bold text-xs text-rose-600 dark:text-rose-400">
                                {student.S_ID}
                              </TableCell>
                              <TableCell className="py-2 text-xs">
                                <Badge variant="outline" className="text-[10px]">
                                  {formatGradeLevel(student.Grade)}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-2 text-xs font-medium">
                                {student["Physical Area"]}
                              </TableCell>
                              <TableCell className="py-2 text-xs text-muted-foreground">
                                {student.Reason || "Capacity bottleneck in area"}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
                {displayedStudents.length > STUDENTS_PER_PAGE && (
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">Showing {(studentPage - 1) * STUDENTS_PER_PAGE + 1}–{Math.min(studentPage * STUDENTS_PER_PAGE, displayedStudents.length)} of {displayedStudents.length} students</span>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={studentPage === 1} onClick={() => setStudentPage((page) => Math.max(1, page - 1))}>Previous</Button>
                      <span>{studentPage} / {studentPageCount}</span>
                      <Button type="button" size="sm" variant="outline" disabled={studentPage === studentPageCount} onClick={() => setStudentPage((page) => Math.min(studentPageCount, page + 1))}>Next</Button>
                    </div>
                  </div>
                )}
              </div>}

              {/* STEP 3: Request Summary & Notes */}
              <div className="space-y-2 p-3.5 rounded-xl border bg-muted/20">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-foreground">Reallocation Plan Summary:</span>
                  {selectedDestLab ? (
                    <Badge className="bg-[#056FEC] text-white text-[11px] font-semibold">
                      {selectedStudents.length} Students ➔ {selectedDestLab.name} ({selectedDestLab.area})
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground italic text-xs">No destination lab chosen yet</span>
                  )}
                </div>

                <div className="space-y-1 pt-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Operational Note / Reassignment Context (Optional):
                  </Label>
                  <Textarea
                    placeholder="e.g. Approved venue move within governorate; bus shuttle provided or parent confirmed nearest area."
                    value={operationsNote}
                    onChange={(e) => setOperationsNote(e.target.value)}
                    className="text-xs h-14 bg-background"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <DialogFooter className="p-4 border-t bg-muted/20 flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span>Created request will be forwarded to <strong>Event Team</strong> for student sign-off.</span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    submitting ||
                    !selectedDestLab ||
                    selectedStudentIds.size === 0 ||
                    capacityValidation.isOverCapacity
                  }
                  className={`text-xs font-bold gap-1.5 shadow-xs ${
                    capacityValidation.isOverCapacity
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-[#056FEC] hover:bg-[#043FAD] text-white"
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Request Event Team Approval ({selectedStudents.length} Students)</span>
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </>
  );
}
