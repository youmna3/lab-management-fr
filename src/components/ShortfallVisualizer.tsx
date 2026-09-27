import React, { useEffect, useState, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
  CartesianGrid,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Copy,
  Check,
  Building2,
  Users,
  Layers,
  MapPin,
  TrendingDown,
  Sparkles,
  ArrowUpDown,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { getGovForArea } from "@/lib/arabic";
import { GovFreeLabsModal } from "@/components/GovFreeLabsModal";
import { formatGradeLabel, cleanGrade, type LabRow } from "@/lib/lab-allocation-runner/parse";
import { extractShortMegaGroupId } from "@/lib/lab-allocation-runner/mega-groups";
import type {
  AllocationSummary,
  ShortfallMathRow,
  UnassignedStudentRow,
  MasterAllocationRow,
  OverflowFragmentNotice,
} from "@/lib/allocation-client";

export interface ParsedGradeShortfall {
  grade: number;
  demand: number;
  bestCaseCap: number;
  minSessionsNeeded: number;
  isShort: boolean;
  studentsShort?: number;
  sessionsAssigned?: number;
  capacityAssigned?: number;
  megaGroup?: string;
}

export interface AreaDiagnosticGroup {
  area: string;
  gov: string;
  unseatedStudents: number;
  seatedStudents: number;
  totalDemand: number;
  grades: ParsedGradeShortfall[];
  labsCount: number;
  activeLabs: string[];
  totalAreaCapacity: number;
  hasStructuralGap: boolean;
  explanation: string;
  rawBlock: string;
}

export interface ParsedAreaShortfall {
  area: string;
  labsCount: number;
  trueCapacities: Record<string, number>;
  totalSessionsAvailable: number;
  grades: ParsedGradeShortfall[];
  totalSessionsNeeded: number;
  sessionsGap: number;
  unseatedStudents: number;
  hasStructuralGap: boolean;
  explanation: string;
  rawBlock: string;
}

export interface ShortfallVisualizerProps {
  summary: AllocationSummary;
  shortfallText: string;
  shortfallMath?: ShortfallMathRow[];
  unassignedStudents?: UnassignedStudentRow[];
  masterAllocation?: MasterAllocationRow[];
  overflowFragmentNotices?: OverflowFragmentNotice[];
  labRows?: LabRow[];
  allLabs?: any[];
  logs?: string[];
  jobId?: string;
  batchId?: string;
  projectId?: string | null;
  batchName?: string;
  onReallocationApplied?: () => void;
  slotCount?: number;
}

export const MEGA_GROUP_THEMES: Record<string, { bar: string; light: string; border: string; badge: string; text: string }> = {
  MGA: { bar: "#056FEC", light: "rgba(5, 111, 236, 0.12)", border: "rgba(5, 111, 236, 0.35)", badge: "bg-blue-600 text-white", text: "text-blue-600 dark:text-blue-400" },
  MGB: { bar: "#8B5CF6", light: "rgba(139, 92, 246, 0.12)", border: "rgba(139, 92, 246, 0.35)", badge: "bg-purple-600 text-white", text: "text-purple-600 dark:text-purple-400" },
  MGC: { bar: "#059669", light: "rgba(5, 150, 105, 0.12)", border: "rgba(5, 150, 105, 0.35)", badge: "bg-emerald-600 text-white", text: "text-emerald-600 dark:text-emerald-400" },
  MGD: { bar: "#D97706", light: "rgba(217, 119, 6, 0.12)", border: "rgba(217, 119, 6, 0.35)", badge: "bg-amber-600 text-white", text: "text-amber-600 dark:text-amber-400" },
  MG1: { bar: "#056FEC", light: "rgba(5, 111, 236, 0.12)", border: "rgba(5, 111, 236, 0.35)", badge: "bg-blue-600 text-white", text: "text-blue-600 dark:text-blue-400" },
  MG2: { bar: "#8B5CF6", light: "rgba(139, 92, 246, 0.12)", border: "rgba(139, 92, 246, 0.35)", badge: "bg-purple-600 text-white", text: "text-purple-600 dark:text-purple-400" },
  MG3: { bar: "#059669", light: "rgba(5, 150, 105, 0.12)", border: "rgba(5, 150, 105, 0.35)", badge: "bg-emerald-600 text-white", text: "text-emerald-600 dark:text-emerald-400" },
  MG4: { bar: "#D97706", light: "rgba(217, 119, 6, 0.12)", border: "rgba(217, 119, 6, 0.35)", badge: "bg-amber-600 text-white", text: "text-amber-600 dark:text-amber-400" },
};

export const FALLBACK_THEMES = [
  { bar: "#056FEC", light: "rgba(5, 111, 236, 0.12)", border: "rgba(5, 111, 236, 0.35)", badge: "bg-blue-600 text-white", text: "text-blue-600 dark:text-blue-400" },
  { bar: "#8B5CF6", light: "rgba(139, 92, 246, 0.12)", border: "rgba(139, 92, 246, 0.35)", badge: "bg-purple-600 text-white", text: "text-purple-600 dark:text-purple-400" },
  { bar: "#059669", light: "rgba(5, 150, 105, 0.12)", border: "rgba(5, 150, 105, 0.35)", badge: "bg-emerald-600 text-white", text: "text-emerald-600 dark:text-emerald-400" },
  { bar: "#D97706", light: "rgba(217, 119, 6, 0.12)", border: "rgba(217, 119, 6, 0.35)", badge: "bg-amber-600 text-white", text: "text-amber-600 dark:text-amber-400" },
];

export function getMegaGroupTheme(shortMg?: string, index = 0) {
  if (shortMg && MEGA_GROUP_THEMES[shortMg]) return MEGA_GROUP_THEMES[shortMg];
  return FALLBACK_THEMES[index % FALLBACK_THEMES.length];
}

/**
 * Parses raw shortfall text and enriches with structured math rows
 */
export function parseShortfallDiagnostics(
  text?: string | null,
  shortfallMath: ShortfallMathRow[] = [],
  unassignedStudents: UnassignedStudentRow[] = [],
  masterAllocation: MasterAllocationRow[] = [],
): ParsedAreaShortfall[] {
  const results: ParsedAreaShortfall[] = [];
  const existingAreas = new Set<string>();
  const safeText = typeof text === "string" ? text : "";

  if (safeText && safeText.trim()) {
    const areaBlocks = safeText
      .split(/-{6,}|={6,}/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && b.includes("AREA:"));

    for (const block of areaBlocks) {
      try {
        const areaMatch = block.match(/AREA:\s*([^\n\r|]+)/);
        const area = areaMatch ? areaMatch[1].trim() : "Unknown Area";
        existingAreas.add(area);

        const labsCountMatch = block.match(/Labs:\s*(\d+)/i);
        const labsCount = labsCountMatch ? parseInt(labsCountMatch[1], 10) : 0;

        const capsMatch = block.match(/True capacities:\s*(\{.*?\})/);
        let trueCapacities: Record<string, number> = {};
        if (capsMatch) {
          try {
            trueCapacities = JSON.parse(capsMatch[1]);
          } catch {
            trueCapacities = {};
          }
        }

        const sessionsAvailMatch =
          block.match(/Total sessions available:\s*(\d+)/i) ||
          block.match(/available:\s*(\d+)/i);
        const totalSessionsAvailable = sessionsAvailMatch
          ? parseInt(sessionsAvailMatch[1], 10)
          : 0;

        const mathRowsForArea = shortfallMath.filter(
          (m) => (m.Area || "").trim().toLowerCase() === area.trim().toLowerCase() || m.Area === area,
        );

        const areaMegaGroups = Array.from(
          new Set([
            ...mathRowsForArea.map((m) => m.Mega_Group).filter(Boolean),
            ...masterAllocation
              .filter((r) => (r["Physical Area"] || "").trim().toLowerCase() === area.trim().toLowerCase())
              .map((r) => r.Mega_Group)
              .filter(Boolean),
            ...unassignedStudents
              .filter((u) => (u["Physical Area"] || "").trim().toLowerCase() === area.trim().toLowerCase())
              .map((u) => (u as any).Mega_Group)
              .filter(Boolean),
          ]),
        ) as string[];

        const gradeRegex =
          /(?:Grade\s+(\d+)|([^\n:]+)):\s*(\d+)\s+students\s*\/\s*best-case\s+(\d+)\s+cap\s*->\s*needs\s*>=\s*(\d+)\s+sessions(?:\s*(<--\s*SHORT))?/gi;
        const grades: ParsedGradeShortfall[] = [];
        let gMatch: RegExpExecArray | null;
        const gradeMatchesByGrade = new Map<number, number>();

        while ((gMatch = gradeRegex.exec(block)) !== null) {
          const rawLabel = (gMatch[1] ? `Grade ${gMatch[1]}` : gMatch[2] || "").trim();
          const cleanRes = cleanGrade(rawLabel);
          const gradeNum = cleanRes ? cleanRes.gradeNum : (parseInt(gMatch[1], 10) || 4);
          const occ = gradeMatchesByGrade.get(gradeNum) ?? 0;
          gradeMatchesByGrade.set(gradeNum, occ + 1);

          const matchingMathRows = mathRowsForArea.filter(
            (m) => m.Grade === gradeNum || formatGradeLabel(m.Grade) === rawLabel,
          );
          const mathRow = matchingMathRows[occ] || matchingMathRows[0];
          const inferredMg = mathRow?.Mega_Group || (areaMegaGroups.length > 0 ? areaMegaGroups[occ % areaMegaGroups.length] : undefined);

          grades.push({
            grade: gradeNum,
            demand: parseInt(gMatch[3], 10),
            bestCaseCap: parseInt(gMatch[4], 10),
            minSessionsNeeded: parseInt(gMatch[5], 10),
            isShort: Boolean(gMatch[6]) || (mathRow ? mathRow.Students_Short > 0 : false),
            studentsShort: mathRow?.Students_Short,
            sessionsAssigned: mathRow?.Sessions_Assigned,
            capacityAssigned: mathRow?.Capacity_Assigned,
            megaGroup: inferredMg,
          });
        }

        // If no grades were matched from text block, but mathRows exist for this area:
        if (grades.length === 0 && mathRowsForArea.length > 0) {
          for (const m of mathRowsForArea) {
            grades.push({
              grade: m.Grade,
              demand: m.Demand,
              bestCaseCap: m.Capacity_Assigned || 25,
              minSessionsNeeded: (m.Sessions_Assigned || 0) + (m.Students_Short > 0 ? Math.ceil(m.Students_Short / (m.Capacity_Assigned || 25)) : 0),
              isShort: m.Students_Short > 0,
              studentsShort: m.Students_Short,
              sessionsAssigned: m.Sessions_Assigned,
              capacityAssigned: m.Capacity_Assigned,
              megaGroup: m.Mega_Group,
            });
          }
        }

        // Group/sort grades by megaGroup then grade for clustered display
        grades.sort((a, b) => (a.megaGroup || "").localeCompare(b.megaGroup || "") || a.grade - b.grade);

        const totalNeededMatch = block.match(
          /TOTAL sessions needed(?:\s*\(best case\))?:\s*(\d+)/i,
        );
        const totalSessionsNeeded = totalNeededMatch
          ? parseInt(totalNeededMatch[1], 10)
          : grades.reduce((acc, g) => acc + g.minSessionsNeeded, 0);

        const gapMatch = block.match(
          /GAP:\s*short by\s*(\d+)\s*session\(s\)\s*area-wide\s*->\s*(\d+)\s*student\(s\)\s*can't be seated/i,
        );
        const hasStructuralGap = Boolean(gapMatch);
        const sessionsGap = gapMatch
          ? parseInt(gapMatch[1], 10)
          : Math.max(0, totalSessionsNeeded - totalSessionsAvailable);

        const unassignedInArea = unassignedStudents.filter(
          (u) => u["Physical Area"] === area,
        ).length;
        const unseatedStudents = gapMatch
          ? parseInt(gapMatch[2], 10)
          : unassignedInArea ||
            grades.reduce((sum, g) => sum + (g.studentsShort || 0), 0);

        const combinatorialReason =
          block.includes("No structural session-count gap") ||
          block.includes("combinatorial reason");

        const explanation = hasStructuralGap
          ? labsCount === 0
            ? `No physical labs exist in ${area} (${unseatedStudents} unassigned students).`
            : `Area lacks ${sessionsGap} session(s) of physical capacity (needs >= ${totalSessionsNeeded} sessions across labs, but only ${totalSessionsAvailable} available).`
          : combinatorialReason
          ? `No overall session count deficit (${totalSessionsAvailable} available vs ${totalSessionsNeeded} needed), but combinatorial grade cohort grouping and lab capacity boundaries prevent seating all students.`
          : `Capacity bottleneck identified in area.`;

        results.push({
          area,
          labsCount: labsCount || Object.keys(trueCapacities).length,
          trueCapacities,
          totalSessionsAvailable,
          grades,
          totalSessionsNeeded,
          sessionsGap,
          unseatedStudents,
          hasStructuralGap,
          explanation,
          rawBlock: block,
        });
      } catch (e) {
        console.warn("Failed to parse area block:", e);
      }
    }
  }

  // Check shortfallMath for any missing areas (e.g. orphan areas without labs)
  if (shortfallMath && shortfallMath.length > 0) {
    const missingMathAreas = new Map<string, ShortfallMathRow[]>();
    for (const row of shortfallMath) {
      if (!existingAreas.has(row.Area)) {
        if (!missingMathAreas.has(row.Area)) missingMathAreas.set(row.Area, []);
        missingMathAreas.get(row.Area)!.push(row);
      }
    }
    for (const [area, rows] of missingMathAreas) {
      const unassignedInArea = unassignedStudents.filter((u) => u["Physical Area"] === area);
      const totalShort = rows.reduce((sum, r) => sum + (r.Students_Short || 0), 0);
      const totalNeeded = rows.reduce((sum, r) => sum + (r.Sessions_Assigned || 0) + (r.Students_Short > 0 ? Math.ceil(r.Students_Short / 25) : 0), 0);
      const totalAvailable = rows.reduce((sum, r) => sum + (r.Sessions_Assigned || 0), 0);
      results.push({
        area,
        labsCount: 0,
        trueCapacities: {},
        totalSessionsAvailable: totalAvailable,
        grades: rows.map((r) => ({
          grade: r.Grade,
          demand: r.Demand,
          bestCaseCap: r.Capacity_Assigned || 25,
          minSessionsNeeded: (r.Sessions_Assigned || 0) + (r.Students_Short > 0 ? Math.ceil(r.Students_Short / 25) : 0),
          isShort: r.Students_Short > 0,
          studentsShort: r.Students_Short,
          sessionsAssigned: r.Sessions_Assigned,
          capacityAssigned: r.Capacity_Assigned,
          megaGroup: r.Mega_Group,
        })),
        totalSessionsNeeded: totalNeeded,
        sessionsGap: Math.max(0, totalNeeded - totalAvailable),
        unseatedStudents: totalShort || unassignedInArea.length,
        hasStructuralGap: true,
        explanation: `No physical labs exist in ${area} (${totalShort || unassignedInArea.length} unassigned students).`,
        rawBlock: "",
      });
      existingAreas.add(area);
    }
  }

  // Check unassignedStudents for any remaining missing orphan areas
  const missingUnassignedAreas = new Map<string, UnassignedStudentRow[]>();
  for (const u of unassignedStudents) {
    const area = u["Physical Area"] || "Unknown";
    if (!existingAreas.has(area)) {
      if (!missingUnassignedAreas.has(area)) missingUnassignedAreas.set(area, []);
      missingUnassignedAreas.get(area)!.push(u);
    }
  }
  for (const [area, uRows] of missingUnassignedAreas) {
    const byGrade = new Map<number, number>();
    for (const u of uRows) byGrade.set(u.Grade, (byGrade.get(u.Grade) ?? 0) + 1);
    const grades = Array.from(byGrade.entries()).map(([g, count]) => ({
      grade: g,
      demand: count,
      bestCaseCap: 25,
      minSessionsNeeded: Math.ceil(count / 25),
      isShort: true,
      studentsShort: count,
      sessionsAssigned: 0,
      capacityAssigned: 0,
    }));
    const totalNeeded = grades.reduce((acc, g) => acc + g.minSessionsNeeded, 0);
    results.push({
      area,
      labsCount: 0,
      trueCapacities: {},
      totalSessionsAvailable: 0,
      grades,
      totalSessionsNeeded: totalNeeded,
      sessionsGap: totalNeeded,
      unseatedStudents: uRows.length,
      hasStructuralGap: true,
      explanation: `No physical labs exist in ${area} (${uRows.length} unassigned students).`,
      rawBlock: "",
    });
    existingAreas.add(area);
  }

  return results;
}

export function ShortfallVisualizer({
  summary,
  shortfallText,
  shortfallMath = [],
  unassignedStudents = [],
  masterAllocation = [],
  overflowFragmentNotices = [],
  labRows,
  allLabs,
  logs = [],
  jobId,
  batchId,
  projectId,
  batchName,
  onReallocationApplied,
  slotCount: propSlotCount,
}: ShortfallVisualizerProps) {
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("[Shortfall] mounted", {
        unassigned: unassignedStudents.length,
        masterRows: masterAllocation.length,
      });
    }
    // This trace intentionally records the initial persisted result only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [logFilterLevel, setLogFilterLevel] = useState<"ALL" | "INFO" | "WARN" | "ERROR">("ALL");
  const [sortBy, setSortBy] = useState<"unseated" | "gap" | "name" | "labs">("unseated");
  const [filterType, setFilterType] = useState<"all" | "structural" | "combinatorial">("all");
  const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>({});
  const [showAllLogs, setShowAllLogs] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);

  // Governorate Free Labs Modal State
  const [govModalOpen, setGovModalOpen] = useState(false);
  const [targetShortfallArea, setTargetShortfallArea] = useState<string>("");

  const handleOpenGovLabs = (areaName: string) => {
    setTargetShortfallArea(areaName);
    setGovModalOpen(true);
  };

  // Derive authoritative slot count from props, summary, or master allocation
  const batchSlotCount = useMemo(() => {
    if (typeof propSlotCount === "number" && propSlotCount > 0) return propSlotCount;
    if (summary?.total_labs > 0 && summary?.total_sessions_available > 0) {
      return Math.round(summary.total_sessions_available / summary.total_labs);
    }
    if (masterAllocation && masterAllocation.length > 0) {
      const maxSlot = Math.max(...masterAllocation.map((r) => r.Slot_Num || 0), 0);
      if (maxSlot > 0) return maxSlot;
    }
    return 7;
  }, [propSlotCount, summary, masterAllocation]);

  // Parse structured areas
  const parsedAreas = useMemo(() => {
    return parseShortfallDiagnostics(shortfallText, shortfallMath, unassignedStudents, masterAllocation);
  }, [shortfallText, shortfallMath, unassignedStudents, masterAllocation]);

  const unassignedCount = summary?.unassigned_count ?? unassignedStudents?.length ?? 0;
  const totalStudents = summary?.total_students ?? 0;
  const totalSessionsAssigned = summary?.total_sessions_assigned ?? 0;
  const hasShortfall = unassignedCount > 0 || parsedAreas.length > 0;

  // Expand all / Collapse all helpers
  const handleToggleExpand = (area: string) => {
    setExpandedAreas((prev) => ({
      ...prev,
      [area]: !(prev[area] ?? true), // default is open
    }));
  };

  const handleExpandAll = () => {
    const next: Record<string, boolean> = {};
    parsedAreas.forEach((a) => {
      next[a.area] = true;
    });
    setExpandedAreas(next);
  };

  const handleCollapseAll = () => {
    const next: Record<string, boolean> = {};
    parsedAreas.forEach((a) => {
      next[a.area] = false;
    });
    setExpandedAreas(next);
  };

  // Filter & Sort
  const filteredAndSortedAreas = useMemo(() => {
    return parsedAreas
      .filter((a) => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          if (!a.area.toLowerCase().includes(q)) return false;
        }
        if (filterType === "structural") return a.hasStructuralGap && a.sessionsGap > 0;
        if (filterType === "combinatorial") return !a.hasStructuralGap || a.sessionsGap === 0;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "unseated") return b.unseatedStudents - a.unseatedStudents;
        if (sortBy === "gap") return b.sessionsGap - a.sessionsGap;
        if (sortBy === "labs") return b.labsCount - a.labsCount;
        return a.area.localeCompare(b.area, "ar");
      });
  }, [parsedAreas, searchQuery, filterType, sortBy]);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    const rawLogs = logs && logs.length > 0 ? logs : shortfallText ? shortfallText.split("\n") : [];
    return rawLogs.filter((line) => {
      const lower = line.toLowerCase();
      if (logSearchQuery.trim()) {
        if (!lower.includes(logSearchQuery.toLowerCase().trim())) return false;
      }
      if (logFilterLevel === "WARN") return lower.includes("warning") || lower.includes("warn") || lower.includes("shortfall");
      if (logFilterLevel === "ERROR") return lower.includes("error") || lower.includes("fail") || lower.includes("invariant");
      if (logFilterLevel === "INFO") return !lower.includes("warning") && !lower.includes("error");
      return true;
    });
  }, [logs, shortfallText, logSearchQuery, logFilterLevel]);

  // Aggregate totals
  const totalSessionGap = useMemo(() => {
    return parsedAreas.reduce((sum, a) => sum + a.sessionsGap, 0);
  }, [parsedAreas]);

  const totalAffectedLabs = useMemo(() => {
    return parsedAreas.reduce((sum, a) => sum + a.labsCount, 0);
  }, [parsedAreas]);

  const handleCopyLogs = async () => {
    try {
      const fullText = logs.length > 0 ? logs.join("\n") : shortfallText;
      await navigator.clipboard.writeText(fullText);
      setCopiedLogs(true);
      toast.success("Logs copied to clipboard!");
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch {
      toast.error("Failed to copy logs");
    }
  };

  const handleDownloadLogs = () => {
    const fullText = logs.length > 0 ? logs.join("\n") : shortfallText;
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `engine_logs_${jobId || "run"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded engine execution logs!");
  };

  const renderLogsConsole = () => (
    <Card className="border-border bg-card shadow-xs overflow-hidden">
      <CardHeader className="p-4 bg-muted/30 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary font-mono font-bold text-xs">
            &gt;_
          </div>
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              Engine Execution Logs &amp; Audit Trail
              <Badge variant="outline" className="text-[10px] font-mono font-normal">
                {filteredLogs.length} Lines
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Real-time diagnostic stream from the mathematical optimization solver.
            </CardDescription>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Log Level Filters */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={logFilterLevel === "ALL" ? "default" : "outline"}
              onClick={() => setLogFilterLevel("ALL")}
              className="h-7 text-[11px] px-2"
            >
              All
            </Button>
            <Button
              size="sm"
              variant={logFilterLevel === "INFO" ? "default" : "outline"}
              onClick={() => setLogFilterLevel("INFO")}
              className="h-7 text-[11px] px-2"
            >
              Info
            </Button>
            <Button
              size="sm"
              variant={logFilterLevel === "WARN" ? "default" : "outline"}
              onClick={() => setLogFilterLevel("WARN")}
              className="h-7 text-[11px] px-2"
            >
              Warnings
            </Button>
            <Button
              size="sm"
              variant={logFilterLevel === "ERROR" ? "default" : "outline"}
              onClick={() => setLogFilterLevel("ERROR")}
              className="h-7 text-[11px] px-2"
            >
              Errors
            </Button>
          </div>

          {/* Search Logs */}
          <div className="relative w-36 sm:w-44">
            <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={logSearchQuery}
              onChange={(e) => setLogSearchQuery(e.target.value)}
              className="h-7 pl-7 text-xs bg-background"
            />
          </div>

          {/* Action Buttons */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyLogs}
            className="h-7 text-xs gap-1.5 px-2.5"
          >
            {copiedLogs ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copiedLogs ? "Copied" : "Copy"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadLogs}
            className="h-7 text-xs gap-1.5 px-2.5"
          >
            <Download className="h-3 w-3" />
            Download
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowAllLogs(!showAllLogs)}
            className="h-7 w-7 p-0 text-muted-foreground"
          >
            {showAllLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      {showAllLogs && (
        <CardContent className="p-0">
          <div className="p-4 font-mono text-[11px] leading-relaxed bg-[#0F172A] text-[#E2E8F0] dark:bg-[#090D16] dark:text-[#CBD5E1] max-h-96 overflow-y-auto overflow-x-auto space-y-1 select-text">
            {filteredLogs.length === 0 ? (
              <div className="text-muted-foreground py-6 text-center text-xs">
                No log lines matching the selected filter.
              </div>
            ) : (
              filteredLogs.map((line, idx) => {
                const lower = line.toLowerCase();
                let colorClass = "text-[#94A3B8]";
                if (lower.includes("start") || lower.includes("verified") || lower.includes("passed") || lower.includes("100%")) {
                  colorClass = "text-emerald-400 font-semibold";
                } else if (lower.includes("warning") || lower.includes("warn") || lower.includes("shortfall") || lower.includes("unassigned")) {
                  colorClass = "text-amber-400 font-semibold";
                } else if (lower.includes("error") || lower.includes("fail") || lower.includes("critical") || lower.includes("invariant")) {
                  colorClass = "text-rose-400 font-bold bg-rose-950/40 px-1 py-0.5 rounded";
                } else if (lower.includes("===") || lower.includes("---")) {
                  colorClass = "text-blue-400/60";
                } else if (line.startsWith("•") || line.startsWith("  -")) {
                  colorClass = "text-[#E2E8F0]";
                }

                return (
                  <div key={idx} className={`whitespace-pre-wrap hover:bg-white/5 px-1 rounded transition-colors ${colorClass}`}>
                    {line}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );

  if (!hasShortfall) {
    return (
      <div className="space-y-6">
        <Card className="border-[#056FEC]/30 bg-[#056FEC]/5 dark:bg-[#056FEC]/10 shadow-xs rounded-2xl">
          <CardContent className="p-8 text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF]">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
              Zero Shortfall — 100% Demand Fulfilled
            </h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
              Every single student across all physical areas and grade cohorts was successfully allocated a seat. No lab capacity overfills or slot constraint violations occurred.
            </p>
            <div className="pt-2 flex items-center justify-center gap-3">
              <Badge className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold text-xs px-3 py-1 shadow-2xs">
                {totalStudents.toLocaleString()} Students Seated
              </Badge>
              <Badge variant="secondary" className="bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white font-semibold text-xs px-3 py-1 shadow-2xs">
                {totalSessionsAssigned} Sessions Utilized
              </Badge>
            </div>
          </CardContent>
        </Card>

        {renderLogsConsole()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. TOP SUMMARY STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Stat 1: Unassigned Students */}
        <Card className="border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-background to-rose-500/5 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                Unassigned Demand
              </span>
              <div className="text-2xl font-black text-rose-700 dark:text-rose-300 tracking-tight">
                {unassignedCount.toLocaleString()}{" "}
                <span className="text-xs font-normal text-muted-foreground">students</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {(((unassignedCount) / (totalStudents || 1)) * 100).toFixed(2)}% of total cohort unseated
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/20 text-rose-600 shrink-0">
              <TrendingDown className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Stat 2: Bottleneck Areas */}
        <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-background to-amber-500/5 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Bottleneck Areas
              </span>
              <div className="text-2xl font-black text-amber-700 dark:text-amber-300 tracking-tight">
                {parsedAreas.length}{" "}
                <span className="text-xs font-normal text-muted-foreground">areas</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Across {totalAffectedLabs} physical lab venues
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 shrink-0">
              <MapPin className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Stat 3: Total Session Deficit */}
        <Card className="border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-background to-blue-500/5 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Session Deficit Gap
              </span>
              <div className="text-2xl font-black text-blue-700 dark:text-blue-300 tracking-tight">
                {totalSessionGap > 0 ? `-${totalSessionGap}` : "0"}{" "}
                <span className="text-xs font-normal text-muted-foreground">sessions</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {totalSessionGap > 0 ? "Physical seat deficit area-wide" : "Combinatorial packing bottleneck"}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/20 text-blue-600 shrink-0">
              <Layers className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Stat 4: Recommended Resolution Action */}
        <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-background to-purple-500/5 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                Resolution Workflow
              </span>
              <div className="text-sm font-bold text-purple-700 dark:text-purple-300">
                Operations Requests
              </div>
              <p className="text-[11px] text-muted-foreground">
                Request Overfill / Add New Lab / CS Reassignment
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/20 text-purple-600 shrink-0">
              <Sparkles className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 2. FILTER & SORT TOOLBAR */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-muted/40 rounded-xl border">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search area name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-background"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={filterType === "all" ? "default" : "outline"}
              onClick={() => setFilterType("all")}
              className="h-8 text-xs px-2.5"
            >
              All ({parsedAreas.length})
            </Button>
            <Button
              size="sm"
              variant={filterType === "structural" ? "default" : "outline"}
              onClick={() => setFilterType("structural")}
              className="h-8 text-xs px-2.5"
            >
              Structural Gap ({parsedAreas.filter((a) => a.sessionsGap > 0).length})
            </Button>
            <Button
              size="sm"
              variant={filterType === "combinatorial" ? "default" : "outline"}
              onClick={() => setFilterType("combinatorial")}
              className="h-8 text-xs px-2.5"
            >
              Combinatorial ({parsedAreas.filter((a) => a.sessionsGap === 0).length})
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={sortBy} onValueChange={(val: any) => setSortBy(val)}>
              <SelectTrigger className="h-8 text-xs w-[170px] bg-background">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unseated">Most Unseated</SelectItem>
                <SelectItem value="gap">Largest Session Gap</SelectItem>
                <SelectItem value="name">Area Name (A-Z)</SelectItem>
                <SelectItem value="labs">Most Labs</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Expand / Collapse All */}
          <div className="flex items-center gap-1 border-l pl-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExpandAll}
              className="h-8 text-xs px-2"
            >
              Expand All
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCollapseAll}
              className="h-8 text-xs px-2"
            >
              Collapse All
            </Button>
          </div>
        </div>
      </div>

      {/* 3. PER-AREA SHORTFALL CARDS */}
      <div className="space-y-4">
        {filteredAndSortedAreas.length === 0 ? (
          <div className="p-8 text-center border rounded-xl bg-muted/20 text-xs text-muted-foreground">
            No bottleneck areas matching your search criteria.
          </div>
        ) : (
          filteredAndSortedAreas.map((areaData) => {
            const isExpanded = expandedAreas[areaData.area] ?? true;
            const maxLabCap = Math.max(
              ...Object.values(areaData.trueCapacities),
              0,
            );

            const distinctMgList = Array.from(
              new Set(
                areaData.grades
                  .map((g) => (g.megaGroup ? extractShortMegaGroupId(g.megaGroup) : undefined))
                  .filter((mg): mg is string => Boolean(mg)),
              ),
            );

            // Chart data for grade sessions needed vs available, tagged with Mega Group and theme
            const chartData = areaData.grades.map((g, idx) => {
              const shortMg = g.megaGroup ? extractShortMegaGroupId(g.megaGroup) : undefined;
              const mgIndex = shortMg ? distinctMgList.indexOf(shortMg) : idx;
              const theme = getMegaGroupTheme(shortMg, mgIndex >= 0 ? mgIndex : 0);
              const gradeLabel = shortMg
                ? `${shortMg} · ${formatGradeLabel(g.grade)}`
                : formatGradeLabel(g.grade);

              return {
                gradeLabel,
                rawGradeLabel: formatGradeLabel(g.grade),
                megaGroup: g.megaGroup,
                shortMg,
                theme,
                barColor: g.isShort ? "#EF4444" : theme.bar,
                sessionsNeeded: g.minSessionsNeeded,
                demandStudents: g.demand,
                isShort: g.isShort,
                studentsShort: g.studentsShort || 0,
                bestCaseCap: g.bestCaseCap,
              };
            });

            const areaUnassigned = unassignedStudents.filter(
              (u) =>
                (u["Physical Area"] || "").trim().toLowerCase() === areaData.area.trim().toLowerCase() ||
                (u["Physical Area"] || "").trim() === areaData.area.trim()
            );

            const areaNotices = (overflowFragmentNotices || []).filter(
              (n) =>
                (n.area || "").trim().toLowerCase() === areaData.area.trim().toLowerCase() ||
                (n.area || "").trim() === areaData.area.trim()
            );

            return (
              <Card
                key={areaData.area}
                className={`transition-all border ${
                  areaData.unseatedStudents > 0
                    ? "border-rose-500/30 hover:border-rose-500/50"
                    : "border-border hover:border-primary/40"
                } shadow-xs`}
              >
                {/* CARD HEADER */}
                <div
                  onClick={() => handleToggleExpand(areaData.area)}
                  className="p-4 flex items-center justify-between cursor-pointer select-none bg-muted/20 hover:bg-muted/40 rounded-t-xl transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg font-bold text-sm ${
                        areaData.unseatedStudents > 0
                          ? "bg-rose-500/20 text-rose-600 dark:text-rose-400"
                          : "bg-primary/20 text-primary"
                      }`}
                    >
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-bold text-foreground">
                          {areaData.area}
                        </h4>
                        <Badge variant="outline" className="text-[11px] gap-1 font-normal">
                          <Building2 className="h-3 w-3" />
                          {areaData.labsCount} Lab{areaData.labsCount !== 1 ? "s" : ""}
                        </Badge>
                        <Badge variant="secondary" className="text-[11px] font-normal">
                          {areaData.totalSessionsAvailable} Sessions Available
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {areaData.explanation}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* View Free Labs in Gov Button */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenGovLabs(areaData.area);
                      }}
                      className="h-8 text-xs font-semibold gap-1.5 text-primary border-primary/30 hover:bg-primary/10 bg-background shadow-2xs"
                      title={`View available lab venues in ${getGovForArea(areaData.area) || areaData.area} governorate`}
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      <span>Free Labs in {getGovForArea(areaData.area) || "Gov"}</span>
                    </Button>

                    {/* Status Badges */}
                    {areaData.unseatedStudents > 0 ? (
                      <Badge
                        variant="destructive"
                        className="text-xs font-bold px-2.5 py-1 flex items-center gap-1 shadow-xs"
                      >
                        <TrendingDown className="h-3.5 w-3.5" />
                        {areaData.unseatedStudents} Unseated
                      </Badge>
                    ) : (
                      <Badge className="bg-[#056FEC] text-white text-xs font-semibold px-2.5 py-1">
                        Seated
                      </Badge>
                    )}

                    {areaData.sessionsGap > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs font-semibold text-rose-600 border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50"
                      >
                        Gap: -{areaData.sessionsGap} Session{areaData.sessionsGap > 1 ? "s" : ""}
                      </Badge>
                    )}

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* CARD BODY */}
                {isExpanded && (
                  <CardContent className="p-5 space-y-6 border-t">
                    {/* Overflow Fragment & Overfill Notices */}
                    {areaNotices.length > 0 && (
                      <div className="space-y-2">
                        {areaNotices.map((notice, nIdx) => (
                          <div
                            key={nIdx}
                            className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/20 text-xs space-y-1.5 shadow-2xs"
                          >
                            <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                              <span>
                                Partial Overflow Routing: Grade {notice.grade}{notice.mega_group ? ` (${notice.mega_group})` : ""}
                              </span>
                            </div>
                            <p className="text-muted-foreground pl-6 leading-relaxed">
                              Primary lab <strong className="font-mono text-foreground">{notice.primary_lab_id}</strong> is filled to full capacity ({notice.primary_students}/{notice.primary_capacity} seats).
                              The remaining <strong className="text-foreground">{notice.overflow_students} student{notice.overflow_students !== 1 ? "s" : ""}</strong> were routed to overflow lab <strong className="font-mono text-foreground">{notice.overflow_lab_id}</strong> for ops review.
                            </p>
                            {notice.has_overfill_option && (
                              <div className="pl-6 text-[11px] text-amber-900 dark:text-amber-200 font-medium flex items-center gap-1.5 pt-0.5">
                                <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span>
                                  💡 <strong>Overfill Option Available:</strong> You can reduce or eliminate this overflow (down to {Math.max(0, notice.overflow_students - notice.overfill_budget)} students) by enabling the overfill option (+{notice.overfill_budget} seats) on the primary lab.
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Visual Sections Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Left: Grade Sessions Needed Bar Chart (7 cols) */}
                      <div className="lg:col-span-7 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-primary" />
                            Grade Cohort Demand &amp; Sessions Needed
                          </div>
                          <div className="flex items-center gap-2">
                            {distinctMgList.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {distinctMgList.map((mg, i) => {
                                  const theme = getMegaGroupTheme(mg, i);
                                  return (
                                    <span
                                      key={mg}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border"
                                      style={{
                                        backgroundColor: theme.light,
                                        borderColor: theme.border,
                                        color: theme.bar,
                                      }}
                                    >
                                      <span
                                        className="h-1.5 w-1.5 rounded-full"
                                        style={{ backgroundColor: theme.bar }}
                                      />
                                      {mg}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                              Best-case cap: {maxLabCap} seats/lab
                            </span>
                          </div>
                        </div>

                        {/* Chart */}
                        <div className="h-48 w-full border rounded-xl p-2 bg-background/50">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={chartData}
                              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                              <XAxis
                                dataKey="gradeLabel"
                                tick={{ fontSize: 10, fontWeight: 600 }}
                                tickLine={false}
                                interval={0}
                              />
                              <YAxis tick={{ fontSize: 10 }} tickLine={false} />
                              <Tooltip
                                content={({ active, payload }) => {
                                  if (!active || !payload || !payload.length) return null;
                                  const data = payload[0].payload;
                                  return (
                                    <div className="p-2.5 rounded-lg bg-popover text-popover-foreground text-xs shadow-md border space-y-1.5">
                                      <div className="flex items-center justify-between gap-2 border-b pb-1">
                                        <span className="font-bold">{data.gradeLabel}</span>
                                        {data.shortMg && (
                                          <Badge
                                            variant="outline"
                                            className="text-[10px] px-1.5 py-0 font-bold"
                                            style={{
                                              backgroundColor: data.theme.light,
                                              borderColor: data.theme.border,
                                              color: data.theme.bar,
                                            }}
                                          >
                                            {data.megaGroup || data.shortMg}
                                          </Badge>
                                        )}
                                      </div>
                                      <div>Student Demand: <span className="font-semibold">{data.demandStudents}</span></div>
                                      <div>Sessions Needed: <span className="font-semibold">{data.sessionsNeeded}</span></div>
                                      {data.isShort && (
                                        <div className="text-rose-500 font-bold flex items-center gap-1 pt-1 border-t">
                                          <AlertTriangle className="h-3 w-3" />
                                          SHORT: Capacity Bottleneck
                                        </div>
                                      )}
                                    </div>
                                  );
                                }}
                              />
                              <Bar
                                dataKey="sessionsNeeded"
                                name="Sessions Needed"
                                radius={[4, 4, 0, 0]}
                              >
                                {chartData.map((entry, idx) => (
                                  <Cell
                                    key={`cell-${idx}`}
                                    fill={entry.barColor}
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Grade Breakdown Pills */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {areaData.grades.map((g, idx) => {
                            const shortMg = g.megaGroup ? extractShortMegaGroupId(g.megaGroup) : undefined;
                            const mgIndex = shortMg ? distinctMgList.indexOf(shortMg) : idx;
                            const theme = getMegaGroupTheme(shortMg, mgIndex >= 0 ? mgIndex : 0);
                            const cardTitle = shortMg
                              ? `${shortMg} · ${formatGradeLabel(g.grade)}`
                              : formatGradeLabel(g.grade);

                            return (
                              <div
                                key={`${g.megaGroup || "all"}-${g.grade}-${idx}`}
                                className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                                  g.isShort
                                    ? "bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200"
                                    : "bg-muted/30 border-border"
                                }`}
                                style={
                                  !g.isShort && shortMg
                                    ? {
                                        backgroundColor: theme.light,
                                        borderColor: theme.border,
                                      }
                                    : undefined
                                }
                              >
                                <div className="flex items-center justify-between font-bold">
                                  <div className="flex items-center gap-1.5">
                                    {shortMg && (
                                      <span
                                        className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                                        style={{
                                          backgroundColor: theme.bar,
                                          color: "#FFFFFF",
                                        }}
                                      >
                                        {shortMg}
                                      </span>
                                    )}
                                    <span>{cardTitle}</span>
                                  </div>
                                  {g.isShort ? (
                                    <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                                      SHORT
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-background/80">
                                      OK
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {g.demand} students / best-case {g.bestCaseCap} cap
                                </div>
                                <div className="text-[11px] font-semibold flex items-center justify-between pt-0.5">
                                  <span>Needs &gt;= {g.minSessionsNeeded} sessions</span>
                                  {g.studentsShort ? (
                                    <span className="text-rose-600 font-bold">
                                      -{g.studentsShort} unseated
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right: Lab Venue True Capacity Matrix (5 cols) */}
                      <div className="lg:col-span-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-primary" />
                            Lab Capacities in {areaData.area}
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {Object.keys(areaData.trueCapacities).length} Venues
                          </span>
                        </div>

                        <div className="border rounded-xl p-3 bg-background/50 space-y-2.5 max-h-[260px] overflow-y-auto">
                          {Object.keys(areaData.trueCapacities).length === 0 ? (
                            <div className="text-xs text-muted-foreground py-4 text-center">
                              No individual lab capacity details recorded.
                            </div>
                          ) : (
                            Object.entries(areaData.trueCapacities).map(
                              ([labId, cap]) => {
                                const capPercent = maxLabCap > 0 ? (cap / maxLabCap) * 100 : 100;
                                const areaSlots =
                                  areaData.labsCount > 0 && areaData.totalSessionsAvailable > 0
                                    ? Math.round(areaData.totalSessionsAvailable / areaData.labsCount)
                                    : batchSlotCount;
                                return (
                                  <div key={labId} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="font-semibold text-foreground font-mono">
                                        {labId}
                                      </span>
                                      <span className="font-bold text-primary">
                                        {cap} Seats / Session
                                      </span>
                                    </div>
                                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${
                                          cap === maxLabCap
                                            ? "bg-primary"
                                            : "bg-blue-400 dark:bg-blue-600"
                                        }`}
                                        style={{ width: `${capPercent}%` }}
                                      />
                                    </div>
                                    <div className="text-[10px] text-muted-foreground flex justify-between">
                                      <span>Max potential: {cap * areaSlots} students ({areaSlots} slots)</span>
                                      {cap === maxLabCap && (
                                        <span className="text-primary font-medium">Largest Venue</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              },
                            )
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Unassigned / Unseated Students in this Area */}
                    {areaUnassigned.length > 0 && (
                      <div className="space-y-2.5 pt-1">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                            Unassigned Students in {areaData.area} ({areaUnassigned.length})
                          </div>
                          <Badge variant="destructive" className="text-[10px] font-bold px-2 py-0.5">
                            {areaUnassigned.length} Unseated
                          </Badge>
                        </div>

                        <div className="border border-rose-500/30 rounded-xl overflow-hidden bg-rose-500/5 dark:bg-rose-950/20 max-h-60 overflow-y-auto">
                          <Table>
                            <TableHeader className="bg-rose-500/10 dark:bg-rose-950/40 sticky top-0">
                              <TableRow className="border-rose-500/20 hover:bg-transparent">
                                <TableHead className="text-xs font-bold text-rose-700 dark:text-rose-300 py-2">Student ID</TableHead>
                                <TableHead className="text-xs font-bold text-rose-700 dark:text-rose-300 py-2">Grade</TableHead>
                                <TableHead className="text-xs font-bold text-rose-700 dark:text-rose-300 py-2">Bottleneck / Shortfall Reason</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {areaUnassigned.map((u, uIdx) => (
                                <TableRow key={u.S_ID || uIdx} className="border-rose-500/10 hover:bg-rose-500/10">
                                  <TableCell className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400 py-2">
                                    {u.S_ID}
                                  </TableCell>
                                  <TableCell className="text-xs font-semibold py-2">
                                    {formatGradeLabel(u.Grade)}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground py-2">
                                    {u.Reason || "Capacity bottleneck: no seat available"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {/* AREA FOOTER STAT BAR */}
                    <div className="p-3.5 rounded-xl bg-muted/40 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full sm:w-auto">
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase font-semibold">
                            Needed (Best-case)
                          </div>
                          <div className="text-sm font-bold text-foreground">
                            {areaData.totalSessionsNeeded} Sessions
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase font-semibold">
                            Available Capacity
                          </div>
                          <div className="text-sm font-bold text-foreground">
                            {areaData.totalSessionsAvailable} Sessions
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase font-semibold">
                            Capacity Gap
                          </div>
                          <div
                            className={`text-sm font-bold ${
                              areaData.sessionsGap > 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-[#056FEC] dark:text-[#05ACFF]"
                            }`}
                          >
                            {areaData.sessionsGap > 0
                              ? `Short by ${areaData.sessionsGap} session(s)`
                              : "0 Gap"}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase font-semibold">
                            Unseated Students
                          </div>
                          <div
                            className={`text-sm font-black ${
                              areaData.unseatedStudents > 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-[#056FEC] dark:text-[#05ACFF]"
                            }`}
                          >
                            {areaData.unseatedStudents} Students
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {areaData.unseatedStudents > 0 && (
                          <>
                            <div className="text-[11px] text-rose-700 dark:text-rose-300 font-medium bg-rose-50 dark:bg-rose-950/40 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900">
                              {areaData.hasStructuralGap
                                ? `Requires ${areaData.sessionsGap} additional session slot(s) or venue expansion.`
                                : "Combinatorial bottleneck: requires adjusting grade limits or reassigning."}
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleOpenGovLabs(areaData.area)}
                              className="h-8 text-xs font-bold gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs"
                            >
                              <Building2 className="h-3.5 w-3.5" />
                              <span>Reallocate to Free Labs in {getGovForArea(areaData.area) || "Gov"}</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* 4. UNASSIGNED STUDENTS TABLE (IF ANY) */}
      {unassignedStudents.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-rose-500" />
                  Unassigned Students Registry ({unassignedStudents.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Full list of students who could not be seated due to capacity limits.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {jobId && (
                  <Button size="sm" variant="outline" asChild className="h-8 text-xs gap-1.5 text-rose-600">
                    <a href={`/api/download/${jobId}/unassigned_students`} download>
                      <Download className="h-3.5 w-3.5" /> Download Unassigned List
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-y-auto border rounded-xl">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0">
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Student ID</TableHead>
                    <TableHead className="text-xs font-semibold">Grade</TableHead>
                    <TableHead className="text-xs font-semibold">Physical Area</TableHead>
                    <TableHead className="text-xs font-semibold">Bottleneck Reason</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Quick Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unassignedStudents.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono font-bold text-rose-600">
                        {u.S_ID}
                      </TableCell>
                      <TableCell className="text-xs">{formatGradeLabel(u.Grade)}</TableCell>
                      <TableCell className="text-xs font-medium">{u["Physical Area"]}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.Reason}</TableCell>
                      <TableCell className="text-xs text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenGovLabs(u["Physical Area"])}
                          className="h-6 text-[11px] text-primary hover:bg-primary/10 gap-1 px-2"
                        >
                          <Building2 className="h-3 w-3" /> Find Free Labs
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 5. ENGINE EXECUTION LOGS & AUDIT TRAIL */}
      {renderLogsConsole()}

      {/* 6. GOVERNORATE FREE LABS & CS REQUEST CREATION MODAL */}
      {govModalOpen && (
        <GovFreeLabsModal
          open={true}
          onOpenChange={setGovModalOpen}
          shortfallArea={targetShortfallArea}
          unassignedStudents={unassignedStudents}
          masterAllocation={masterAllocation}
          labRows={labRows}
          allLabs={allLabs}
          batchId={batchId}
          projectId={projectId}
          batchName={batchName}
          slotCount={batchSlotCount}
          onSuccess={() => {
            if (onReallocationApplied) onReallocationApplied();
          }}
        />
      )}
    </div>
  );
}
