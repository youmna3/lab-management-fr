import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { isProjectSoftDeleted } from "@/lib/audit-logging";
import { BrandIcon } from "@/components/BrandIcon";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  Filter,
  FolderPlus,
  Grid,
  Layers,
  List,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { formatEGP } from "@/lib/format";
import { formatTimeSlot, normalizeTimeSlots } from "@/lib/time-slots";
import { ProjectTimelineCreationDialog } from "@/components/ProjectTimelineCreationDialog";

export const Route = createFileRoute("/_authenticated/timeline")({
  head: () => ({ meta: [{ title: "Timeline & Master Ops Roadmap – iSchool" }] }),
  component: TimelinePage,
});

type Project = Tables<"projects">;
type Batch = Tables<"batches">;
type Assignment = Tables<"assignments">;
type Lab = Tables<"labs">;
type Override = Tables<"timeline_overrides">;

type ViewMode = "gantt" | "calendar" | "list";
type GanttScale = "monthly" | "weekly";

interface TimelineColumn {
  id: string;
  label: string;
  sublabel?: string;
  monthName?: string;
  leftPct: number;
  widthPct: number;
}

interface MonthSpan {
  id: string;
  label: string;
  leftPct: number;
  widthPct: number;
}

function parseLocalDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[-/]/);
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day) && year >= 2020 && year <= 2035) {
      return new Date(year, month, day, 0, 0, 0, 0);
    }
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 2020 || y > 2035) return null;
  return new Date(y, d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function formatSessionDay(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const ALL_PROGRAMS = "__all__";
const ALL_STATUSES = "__all__";

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    bg: string;
    text: string;
    border: string;
    dot: string;
    barGradient: string;
    barBorder: string;
    barText: string;
  }
> = {
  draft: {
    label: "Draft",
    bg: "bg-[#056FEC]/10 dark:bg-[#05ACFF]/20",
    text: "text-[#056FEC] dark:text-[#05ACFF]",
    border: "border-[#056FEC]/30",
    dot: "bg-white",
    barGradient: "bg-gradient-to-r from-[#056FEC] via-[#043FAD] to-[#056FEC]",
    barBorder: "border-[#05ACFF]/50 shadow-[0_2px_8px_rgba(5,111,236,0.25)]",
    barText: "text-white",
  },
  assigning: {
    label: "Assigning Labs",
    bg: "bg-[#FF7F1C]/10 dark:bg-[#FF7F1C]/20",
    text: "text-[#FF7F1C]",
    border: "border-[#FF7F1C]/30",
    dot: "bg-[#FF7F1C]",
    barGradient: "bg-gradient-to-r from-[#056FEC] to-[#05ACFF]",
    barBorder: "border-[#05ACFF]/60 shadow-[0_2px_8px_rgba(5,111,236,0.25)]",
    barText: "text-white",
  },
  confirming: {
    label: "Confirming",
    bg: "bg-[#05ACFF]/15 dark:bg-[#05ACFF]/25",
    text: "text-[#05ACFF]",
    border: "border-[#05ACFF]/30",
    dot: "bg-[#05ACFF]",
    barGradient: "bg-gradient-to-r from-[#05ACFF] to-[#056FEC]",
    barBorder: "border-[#05ACFF]/60 shadow-[0_2px_8px_rgba(5,172,255,0.25)]",
    barText: "text-white",
  },
  ready: {
    label: "Ready / Confirmed",
    bg: "bg-[#056FEC]/10 dark:bg-[#05ACFF]/20",
    text: "text-[#056FEC] dark:text-[#05ACFF]",
    border: "border-[#056FEC]/30",
    dot: "bg-white",
    barGradient: "bg-gradient-to-r from-[#056FEC] to-[#043FAD]",
    barBorder: "border-[#05ACFF]/60 shadow-[0_2px_8px_rgba(5,111,236,0.3)]",
    barText: "text-white",
  },
  exported: {
    label: "Ops Exported",
    bg: "bg-[#043FAD]/15 dark:bg-[#056FEC]/25",
    text: "text-[#056FEC] dark:text-[#05ACFF]",
    border: "border-[#056FEC]/30",
    dot: "bg-[#05ACFF]",
    barGradient: "bg-gradient-to-r from-[#043FAD] to-[#056FEC]",
    barBorder: "border-[#05ACFF]/50 shadow-[0_2px_8px_rgba(4,63,173,0.3)]",
    barText: "text-white",
  },
};

function TimelinePage() {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("gantt");
  const [search, setSearch] = useState("");
  const [selectedProgram, setSelectedProgram] = useState<string>(ALL_PROGRAMS);
  const [selectedStatus, setSelectedStatus] = useState<string>(ALL_STATUSES);

  // Selected Detail Modal
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [inspectLabSearch, setInspectLabSearch] = useState("");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  // Gantt scale and expanded batch rows
  const [ganttScale, setGanttScale] = useState<GanttScale>("monthly");
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  function toggleBatchExpand(batchId: string) {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [projRes, batchRes, asgRes, labRes, ovRes] = await Promise.all([
        supabase.from("projects").select("*").order("code"),
        supabase.from("batches").select("*").order("created_at", { ascending: false }),
        supabase.from("assignments").select("*"),
        supabase.from("labs").select("*"),
        supabase.from("timeline_overrides").select("*"),
      ]);

      if (projRes.error) throw projRes.error;
      const allProjects = (projRes.data || []) as Project[];
      const activeProjects = allProjects.filter((p) => !isProjectSoftDeleted(p));
      const activeProjectIds = new Set(activeProjects.map((p) => p.id));
      const activeBatches = ((batchRes.data || []) as Batch[]).filter((b) => activeProjectIds.has(b.project_id));
      setProjects(activeProjects);
      setBatches(activeBatches);
      setAssignments(asgRes.data || []);
      setLabs(labRes.data || []);
      setOverrides(ovRes.data || []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load timeline data");
    } finally {
      setLoading(false);
    }
  }

  // Maps
  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    projects.forEach((p) => map.set(p.id, p));
    return map;
  }, [projects]);

  const labMap = useMemo(() => {
    const map = new Map<string, Lab>();
    labs.forEach((l) => map.set(l.id, l));
    return map;
  }, [labs]);

  const assignmentsByBatch = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    assignments.forEach((asg) => {
      const list = map.get(asg.batch_id) || [];
      list.push(asg);
      map.set(asg.batch_id, list);
    });
    return map;
  }, [assignments]);

  // Derived timeline items
  const timelineBatches = useMemo(() => {
    return batches.filter((b) => {
      const proj = projectMap.get(b.project_id);
      const query = search.toLowerCase().trim();

      if (query) {
        const matchBatch = b.name.toLowerCase().includes(query);
        const matchProj = proj?.name.toLowerCase().includes(query) || proj?.code?.toLowerCase().includes(query);
        if (!matchBatch && !matchProj) return false;
      }

      if (selectedProgram !== ALL_PROGRAMS && proj?.program !== selectedProgram) {
        return false;
      }

      if (selectedStatus !== ALL_STATUSES && b.status !== selectedStatus) {
        return false;
      }

      return true;
    });
  }, [batches, projectMap, search, selectedProgram, selectedStatus]);

  // Timeline Date Boundaries, Scales & Columns
  const { startTimestamp, endTimestamp, totalTimeSpan, columns, monthSpans, trackWidth } = useMemo(() => {
    let allTimestamps: number[] = [];

    batches.forEach((b) => {
      (b.dates || []).forEach((dStr) => {
        const d = parseLocalDate(dStr);
        if (d) allTimestamps.push(d.getTime());
      });
    });

    overrides.forEach((o) => {
      const d = parseLocalDate(o.event_date);
      if (d) allTimestamps.push(d.getTime());
    });

    if (!allTimestamps.length) {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
      const e = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999).getTime();
      allTimestamps = [s, e];
    }

    const minT = Math.min(...allTimestamps);
    const maxT = Math.max(...allTimestamps);

    const minD = new Date(minT);
    const maxD = new Date(maxT);

    const cols: TimelineColumn[] = [];
    let startT = 0;
    let endT = 0;

    if (ganttScale === "monthly") {
      // Start at 1st of min month
      const start = new Date(minD.getFullYear(), minD.getMonth(), 1, 0, 0, 0, 0);
      // End at end of max month
      const end = new Date(maxD.getFullYear(), maxD.getMonth() + 1, 0, 23, 59, 59, 999);

      // If span is less than 2 months, expand by 1 month forward
      if (end.getTime() - start.getTime() < 45 * 86400000) {
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
      }

      startT = start.getTime();
      endT = end.getTime();
      const span = Math.max(86400000, endT - startT);

      const cur = new Date(start);
      let monthIndex = 0;
      while (cur.getTime() < endT && monthIndex < 36) {
        const mStart = new Date(cur.getFullYear(), cur.getMonth(), 1, 0, 0, 0, 0);
        const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999);

        const leftPct = Math.max(0, ((mStart.getTime() - startT) / span) * 100);
        const widthPct = Math.max(0.5, ((mEnd.getTime() - mStart.getTime() + 1) / span) * 100);

        cols.push({
          id: `m-${cur.getFullYear()}-${cur.getMonth()}`,
          label: cur.toLocaleString("en-US", { month: "short", year: "numeric" }),
          sublabel: cur.toLocaleString("en-US", { month: "long" }),
          monthName: cur.toLocaleString("en-US", { month: "long", year: "numeric" }),
          leftPct,
          widthPct,
        });

        cur.setMonth(cur.getMonth() + 1);
        monthIndex++;
      }
    } else {
      // Weekly scale: rewind to Monday 00:00:00
      const start = new Date(minD);
      const dayOffset = (start.getDay() + 6) % 7; // Monday = 0
      start.setDate(start.getDate() - dayOffset);
      start.setHours(0, 0, 0, 0);

      // Forward to Sunday of max week 23:59:59
      const end = new Date(maxD);
      const endDayOffset = (end.getDay() + 6) % 7;
      end.setDate(end.getDate() + (6 - endDayOffset));
      end.setHours(23, 59, 59, 999);

      // Ensure minimum 2 weeks
      if (end.getTime() - start.getTime() < 13 * 86400000) {
        end.setDate(end.getDate() + 7);
      }

      startT = start.getTime();
      endT = end.getTime();
      const span = Math.max(86400000, endT - startT);

      const cur = new Date(start);
      let weekIndex = 1;
      while (cur.getTime() < endT && weekIndex <= 52) {
        const wStart = new Date(cur);
        const wEnd = new Date(cur);
        wEnd.setDate(wEnd.getDate() + 6);
        wEnd.setHours(23, 59, 59, 999);

        const leftPct = Math.max(0, ((wStart.getTime() - startT) / span) * 100);
        const widthPct = Math.max(0.5, ((wEnd.getTime() - wStart.getTime() + 1) / span) * 100);

        const sStr = wStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const eStr = wEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const mName = wStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

        cols.push({
          id: `w-${wStart.toISOString()}`,
          label: `${sStr} – ${eStr}`,
          sublabel: `W${weekIndex}`,
          monthName: mName,
          leftPct,
          widthPct,
        });

        cur.setDate(cur.getDate() + 7);
        weekIndex++;
      }
    }

    // In Weekly mode, group weeks by month for the top-tier header
    const mSpans: MonthSpan[] = [];
    if (ganttScale === "weekly") {
      let curM = "";
      let sPct = 0;
      let wPct = 0;

      cols.forEach((col, idx) => {
        const m = col.monthName || "";
        if (m !== curM) {
          if (curM) {
            mSpans.push({
              id: `ms-${idx}`,
              label: curM,
              leftPct: sPct,
              widthPct: wPct,
            });
          }
          curM = m;
          sPct = col.leftPct;
          wPct = col.widthPct;
        } else {
          wPct += col.widthPct;
        }
      });
      if (curM) {
        mSpans.push({
          id: "ms-last",
          label: curM,
          leftPct: sPct,
          widthPct: wPct,
        });
      }
    }

    const colPixelWidth = ganttScale === "weekly" ? 140 : 160;
    const computedTrackWidth = Math.max(900, cols.length * colPixelWidth);

    return {
      startTimestamp: startT,
      endTimestamp: endT,
      totalTimeSpan: Math.max(86400000, endT - startT),
      columns: cols,
      monthSpans: mSpans,
      trackWidth: computedTrackWidth,
    };
  }, [batches, overrides, ganttScale]);

  // Group Batches by Program & Project for Gantt Roadmap
  const ganttGrouped = useMemo(() => {
    const groups: {
      program: string;
      projects: {
        project: Project;
        batches: Batch[];
      }[];
    }[] = [];

    const progList = Array.from(new Set(projects.map((p) => p.program || "General")));
    progList.forEach((prog) => {
      const progProjects = projects.filter((p) => (p.program || "General") === prog);
      const projectItems = progProjects.map((p) => {
        const pBatches = timelineBatches.filter((b) => b.project_id === p.id);
        return { project: p, batches: pBatches };
      });

      if (projectItems.some((p) => p.batches.length > 0)) {
        groups.push({ program: prog, projects: projectItems });
      }
    });

    return groups;
  }, [projects, timelineBatches]);

  // Overall Statistics
  const stats = useMemo(() => {
    const totalSessions = batches.reduce((acc, b) => acc + (b.dates?.length || 0), 0);
    const totalBatches = batches.length;
    const confirmedBatches = batches.filter((b) => b.status === "ready" || b.status === "exported").length;
    const totalAssignedLabs = assignments.filter((a) => a.status === "confirmed").length;

    return { totalSessions, totalBatches, confirmedBatches, totalAssignedLabs };
  }, [batches, assignments]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <BrandIcon name="meeting" size={26} />
            Master Ops Timeline &amp; Session Roadmap
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Visual execution schedule across DECI &amp; DEMI programs, batch milestones, and physical lab sessions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setCreateProjectOpen(true)}
            className="gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-xs"
          >
            <FolderPlus className="h-4 w-4" /> Add Project / Timeline
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <div className="flex items-center rounded-lg border bg-muted p-0.5">
            <Button
              variant={viewMode === "gantt" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2.5 text-xs gap-1"
              onClick={() => setViewMode("gantt")}
            >
              <Activity className="h-3.5 w-3.5" /> Gantt Roadmap
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2.5 text-xs gap-1"
              onClick={() => setViewMode("list")}
            >
              <List className="h-3.5 w-3.5" /> Detailed Agenda
            </Button>
          </div>
        </div>
      </div>

      {/* High-level KPI Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Scheduled Sessions</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{stats.totalSessions} Days</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Across all active intakes</p>
            </div>
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <CalendarIcon className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Batches in Flight</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{stats.totalBatches}</span>
                <Badge variant="outline" className="text-xs bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/20">
                  {stats.confirmedBatches} Confirmed
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Scheduled for lab execution</p>
            </div>
            <div className="rounded-xl bg-[#056FEC]/10 p-3 text-[#056FEC]">
              <Layers className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Confirmed Lab Seats</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{stats.totalAssignedLabs} Labs</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Assignments locked in Ops</p>
            </div>
            <div className="rounded-xl bg-blue-500/10 p-3 text-blue-600">
              <Building2 className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Status Legend</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-slate-400"></span> Draft
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500"></span> Assigning
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500"></span> Confirming
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#056FEC]"></span> Ready
                </span>
              </div>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-3 text-amber-600">
              <Sparkles className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card className="border-border/60 shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by Project Code or Batch Name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedProgram} onValueChange={setSelectedProgram}>
                <SelectTrigger className="w-[150px] text-xs">
                  <SelectValue placeholder="Program" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROGRAMS}>All Programs</SelectItem>
                  <SelectItem value="DECI">DECI Program</SelectItem>
                  <SelectItem value="DEMI">DEMI Program</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-[160px] text-xs">
                  <SelectValue placeholder="Batch Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="assigning">Assigning Labs</SelectItem>
                  <SelectItem value="confirming">Confirming</SelectItem>
                  <SelectItem value="ready">Ready / Confirmed</SelectItem>
                  <SelectItem value="exported">Exported to Ops</SelectItem>
                </SelectContent>
              </Select>

              {(search || selectedProgram !== ALL_PROGRAMS || selectedStatus !== ALL_STATUSES) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setSelectedProgram(ALL_PROGRAMS);
                    setSelectedStatus(ALL_STATUSES);
                  }}
                  className="text-xs"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MAIN VIEW: GANTT ROADMAP */}
      {viewMode === "gantt" && (
        <Card className="border border-border/80 shadow-sm overflow-hidden rounded-2xl bg-card">
          <CardHeader className="p-4 pb-3 border-b bg-muted/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                  <Activity className="h-4.5 w-4.5 text-[#056FEC]" /> Master Gantt Execution Schedule
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Timeline of execution milestones across batches. Toggle scale or expand batches to inspect sessions.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Granularity Switcher */}
                <div className="flex items-center p-0.5 rounded-xl border border-border/80 bg-background shadow-xs">
                  <Button
                    variant={ganttScale === "monthly" ? "default" : "ghost"}
                    size="sm"
                    className={`h-7 px-3 text-xs font-bold gap-1.5 rounded-lg transition-all ${
                      ganttScale === "monthly"
                        ? "bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setGanttScale("monthly")}
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    <span>Monthly</span>
                  </Button>
                  <Button
                    variant={ganttScale === "weekly" ? "default" : "ghost"}
                    size="sm"
                    className={`h-7 px-3 text-xs font-bold gap-1.5 rounded-lg transition-all ${
                      ganttScale === "weekly"
                        ? "bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setGanttScale("weekly")}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    <span>Weekly</span>
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <div style={{ width: `${320 + trackWidth}px`, minWidth: "100%" }}>
              {/* Sticky Calendar Header Axis */}
              <div className="sticky top-0 z-20 flex border-b border-border/80 bg-card/95 backdrop-blur shadow-2xs">
                {/* Frozen Left Table Header */}
                <div className="w-80 shrink-0 sticky left-0 z-40 border-r border-border/80 px-4 h-14 flex items-center justify-between font-bold text-xs text-muted-foreground uppercase tracking-wider bg-muted/80 backdrop-blur shadow-[2px_0_6px_rgba(0,0,0,0.06)]">
                  <span>Batch / Project</span>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span>Status</span>
                    <span>Labs</span>
                  </div>
                </div>

                {/* Right Timeline Header Cells */}
                <div style={{ width: `${trackWidth}px` }} className="relative shrink-0 h-14 bg-muted/30 overflow-hidden">
                  {ganttScale === "weekly" ? (
                    <>
                      {/* Tier 1: Months */}
                      <div className="absolute top-0 inset-x-0 h-[26px] border-b border-border/50">
                        {monthSpans.map((m) => (
                          <div
                            key={m.id}
                            className="absolute inset-y-0 border-r border-border/60 flex items-center justify-center font-bold text-xs text-[#056FEC] dark:text-[#05ACFF] bg-muted/40 px-2 truncate"
                            style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}
                          >
                            <span className="truncate">{m.label}</span>
                          </div>
                        ))}
                      </div>

                      {/* Tier 2: Weeks */}
                      <div className="absolute bottom-0 inset-x-0 h-[28px]">
                        {columns.map((col) => (
                          <div
                            key={col.id}
                            className="absolute inset-y-0 border-r border-border/40 flex items-center justify-center gap-1.5 px-1"
                            style={{ left: `${col.leftPct}%`, width: `${col.widthPct}%` }}
                          >
                            <span className="text-[10px] font-bold text-[#056FEC] dark:text-[#05ACFF] font-mono bg-[#056FEC]/10 px-1 py-0.5 rounded shrink-0">
                              {col.sublabel}
                            </span>
                            <span className="text-[11px] font-medium text-foreground truncate">
                              {col.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    /* Monthly View Header */
                    columns.map((col) => (
                      <div
                        key={col.id}
                        className="absolute inset-y-0 border-r border-border/40 flex flex-col items-center justify-center text-center px-1"
                        style={{ left: `${col.leftPct}%`, width: `${col.widthPct}%` }}
                      >
                        <span className="text-[10px] font-bold text-[#056FEC] dark:text-[#05ACFF] uppercase tracking-wider">
                          {col.sublabel}
                        </span>
                        <span className="text-xs font-semibold text-foreground truncate mt-0.5">
                          {col.label}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Gantt Body */}
              {loading ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  Loading timeline roadmap data...
                </div>
              ) : ganttGrouped.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  No batches match your filter criteria.
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {ganttGrouped.map((group) => (
                    <div key={group.program} className="divide-y divide-border/40">
                      {/* Program Header Row */}
                      <div className="flex bg-[#056FEC]/5 border-y border-[#056FEC]/20">
                        <div className="w-80 shrink-0 sticky left-0 z-30 bg-[#056FEC]/10 border-r border-border/70 px-4 py-2 flex items-center gap-2 shadow-[2px_0_6px_rgba(0,0,0,0.04)]">
                          <Badge className="bg-[#056FEC] text-white font-bold text-xs px-2.5 py-0.5 rounded-md">
                            {group.program}
                          </Badge>
                          <span className="text-xs font-bold text-foreground">Program Roadmaps</span>
                        </div>
                        <div style={{ width: `${trackWidth}px` }} className="relative shrink-0 h-9 bg-[#056FEC]/5">
                          {columns.map((col) => (
                            <div
                              key={col.id}
                              className="absolute inset-y-0 border-r border-[#056FEC]/10 pointer-events-none"
                              style={{ left: `${col.leftPct}%`, width: `${col.widthPct}%` }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Projects */}
                      {group.projects.map(({ project, batches: projBatches }) => (
                        <div key={project.id} className="divide-y divide-border/30">
                          {/* Project Header Row */}
                          <div className="flex bg-muted/20 hover:bg-muted/30 transition-colors">
                            <div className="w-80 shrink-0 sticky left-0 z-30 bg-card border-r border-border/70 px-4 py-1.5 flex items-center justify-between shadow-[2px_0_6px_rgba(0,0,0,0.04)]">
                              <Link
                                to="/projects/$id"
                                params={{ id: project.id }}
                                className="text-xs font-bold text-foreground hover:text-[#056FEC] transition-colors flex items-center gap-1.5 truncate"
                              >
                                <span className="truncate">{project.name}</span>
                                <Badge variant="outline" className="text-[10px] font-mono px-1 py-0 border-border/60 shrink-0">
                                  {project.code}
                                </Badge>
                              </Link>
                              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                                {projBatches.length} {projBatches.length === 1 ? "batch" : "batches"}
                              </span>
                            </div>
                            <div style={{ width: `${trackWidth}px` }} className="relative shrink-0 h-8">
                              {columns.map((col) => (
                                <div
                                  key={col.id}
                                  className="absolute inset-y-0 border-r border-border/20 pointer-events-none"
                                  style={{ left: `${col.leftPct}%`, width: `${col.widthPct}%` }}
                                />
                              ))}
                            </div>
                          </div>

                          {/* Batches Rows */}
                          {projBatches.length === 0 ? (
                            <div className="flex py-2">
                              <div className="w-80 shrink-0 sticky left-0 z-30 bg-card border-r border-border/70 px-8 text-xs text-muted-foreground italic shadow-[2px_0_6px_rgba(0,0,0,0.04)]">
                                No scheduled batches
                              </div>
                              <div style={{ width: `${trackWidth}px` }} className="shrink-0" />
                            </div>
                          ) : (
                            projBatches.map((b) => {
                              const validDates = (b.dates || [])
                                .map(parseLocalDate)
                                .filter((d): d is Date => d !== null)
                                .sort((a, b) => a.getTime() - b.getTime());

                              const hasDates = validDates.length > 0;
                              const startDate = hasDates ? validDates[0] : null;
                              const endDate = hasDates ? validDates[validDates.length - 1] : null;

                              const startDateStr = startDate ? startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
                              const endDateStr = endDate ? endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

                              const startT = startDate ? startDate.getTime() : startTimestamp;
                              const endT = endDate ? endDate.getTime() : startT;

                              const leftPos = Math.max(0, Math.min(100, ((startT - startTimestamp) / totalTimeSpan) * 100));
                              const rightPos = Math.max(0, Math.min(100, ((endT - startTimestamp) / totalTimeSpan) * 100));
                              const widthPct = Math.max((56 / trackWidth) * 100, rightPos - leftPos);

                              const statusInfo = STATUS_CONFIG[b.status] || STATUS_CONFIG.draft;
                              const bAssignments = assignmentsByBatch.get(b.id) || [];
                              const confirmedCount = bAssignments.filter((a) => a.status === "confirmed").length;
                              const isExpanded = expandedBatches.has(b.id);

                              return (
                                <div key={b.id}>
                                  {/* Main Batch Row */}
                                  <div className={`flex items-stretch hover:bg-[#056FEC]/5 transition-colors ${isExpanded ? "bg-muted/20" : ""}`}>
                                    {/* Frozen Left Table Cell */}
                                    <div className="w-80 shrink-0 sticky left-0 z-30 bg-card border-r border-border/70 px-3 py-2 flex items-center justify-between gap-2 shadow-[2px_0_6px_rgba(0,0,0,0.04)]">
                                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <button
                                          onClick={() => toggleBatchExpand(b.id)}
                                          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-transform cursor-pointer shrink-0"
                                          title={isExpanded ? "Collapse sessions" : "Expand sessions"}
                                        >
                                          {isExpanded ? (
                                            <ChevronDown className="h-3.5 w-3.5 text-[#056FEC]" />
                                          ) : (
                                            <ChevronRight className="h-3.5 w-3.5" />
                                          )}
                                        </button>
                                        <div
                                          className="min-w-0 cursor-pointer"
                                          onClick={() => setSelectedBatch(b)}
                                        >
                                          <div className="text-xs font-bold text-foreground truncate hover:text-[#056FEC] transition-colors" title={b.name}>
                                            {b.name}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                                            <span>{hasDates ? `${startDateStr} → ${endDateStr}` : "No scheduled dates"}</span>
                                            {hasDates && (
                                              <span className="text-[#FF7F1C] font-semibold font-mono">• {validDates.length} days</span>
                                            )}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        <Badge
                                          variant="outline"
                                          className={`text-[10px] px-1.5 py-0 font-semibold ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}
                                        >
                                          {statusInfo.label}
                                        </Badge>
                                        <span className="text-[11px] font-mono font-bold text-foreground w-6 text-right">
                                          {confirmedCount}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Right Timeline Canvas Cell */}
                                    <div style={{ width: `${trackWidth}px` }} className="relative shrink-0 h-12 flex items-center">
                                      {/* Background vertical column lines */}
                                      {columns.map((col) => (
                                        <div
                                          key={col.id}
                                          className="absolute inset-y-0 border-r border-border/25 pointer-events-none"
                                          style={{ left: `${col.leftPct}%`, width: `${col.widthPct}%` }}
                                        />
                                      ))}

                                      {hasDates ? (
                                        /* Solid Gantt Bar */
                                        <div
                                          onClick={() => setSelectedBatch(b)}
                                          style={{ left: `${leftPos}%`, width: `${widthPct}%` }}
                                          className={`absolute h-7 rounded-lg cursor-pointer transition-all hover:scale-[1.005] hover:brightness-110 shadow-xs border ${statusInfo.barBorder} ${statusInfo.barGradient} ${statusInfo.barText} flex items-center px-2.5 justify-between z-10 overflow-hidden group`}
                                          title={`${b.name} (${startDateStr} → ${endDateStr}) • ${validDates.length} session days • ${confirmedCount} labs assigned — Click to inspect`}
                                        >
                                          <div className="flex items-center gap-1.5 min-w-0 pr-2">
                                            <span className={`h-2 w-2 rounded-full ${statusInfo.dot} shrink-0 ring-2 ring-white/30`}></span>
                                            <span className="font-bold text-[11px] truncate drop-shadow-xs">{b.name}</span>
                                          </div>
                                          <div className="flex items-center gap-1 text-[10px] font-mono shrink-0 bg-black/25 px-1.5 py-0.5 rounded-md backdrop-blur-xs text-white">
                                            <span className="font-bold text-[#FFD700]">{validDates.length}d</span>
                                            {confirmedCount > 0 && (
                                              <>
                                                <span>•</span>
                                                <span>{confirmedCount} labs</span>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        /* No Dates Placeholder */
                                        <div className="flex items-center px-4 text-xs text-muted-foreground/60 italic gap-2">
                                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500/60"></span>
                                          <span>No scheduled dates</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Expanded Sub-rows for each session day in iSchool Orange */}
                                  {isExpanded && (
                                    <div className="divide-y divide-border/20 bg-[#FF7F1C]/[0.02]">
                                      {hasDates ? (
                                        validDates.map((dateObj, dIdx) => {
                                          const dt = dateObj.getTime();
                                          const dPos = Math.max(0, Math.min(100, ((dt - startTimestamp) / totalTimeSpan) * 100));
                                          const dFormatted = dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                                          const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });

                                          return (
                                            <div key={dIdx} className="flex items-stretch hover:bg-[#FF7F1C]/5 transition-colors">
                                              {/* Sub-row left label */}
                                              <div className="w-80 shrink-0 sticky left-0 z-30 bg-card border-r border-border/70 pl-8 pr-4 py-2 flex items-center justify-between text-xs text-muted-foreground shadow-[2px_0_6px_rgba(0,0,0,0.04)]">
                                                <div className="flex items-center gap-2 min-w-0">
                                                  <Clock className="h-3.5 w-3.5 text-[#FF7F1C] shrink-0" />
                                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold font-mono bg-[#FF7F1C]/15 text-[#FF7F1C] dark:text-[#FFA04D] border border-[#FF7F1C]/30 shrink-0">
                                                    Day {dIdx + 1}
                                                  </span>
                                                  <span className="text-xs font-semibold text-foreground truncate">
                                                    {dFormatted}
                                                  </span>
                                                </div>
                                                <span className="text-[10px] font-mono font-bold text-[#FF7F1C] uppercase shrink-0">
                                                  {weekday}
                                                </span>
                                              </div>

                                              {/* Sub-row timeline track with single session marker pill in Orange */}
                                              <div style={{ width: `${trackWidth}px` }} className="relative shrink-0 h-9 flex items-center">
                                                {columns.map((col) => (
                                                  <div
                                                    key={col.id}
                                                    className="absolute inset-y-0 border-r border-border/20 pointer-events-none"
                                                    style={{ left: `${col.leftPct}%`, width: `${col.widthPct}%` }}
                                                  />
                                                ))}

                                                <div
                                                  onClick={() => setSelectedBatch(b)}
                                                  className="absolute -translate-x-1/2 px-2.5 py-1 rounded-lg bg-gradient-to-r from-[#FF7F1C] to-[#E06A10] text-white font-bold text-[11px] flex items-center gap-1.5 shadow-sm border border-[#FF7F1C]/60 cursor-pointer hover:brightness-110 z-10 transition-all hover:scale-105 active:scale-95 group"
                                                  style={{ left: `${dPos}%` }}
                                                  title={`Day ${dIdx + 1}: ${dFormatted} (${b.name}) • Click to inspect details`}
                                                >
                                                  <span className="h-1.5 w-1.5 rounded-full bg-white ring-1 ring-white/60 shrink-0"></span>
                                                  <span>Day {dIdx + 1}</span>
                                                  <span className="text-[10px] opacity-90 font-mono font-normal">({weekday})</span>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })
                                      ) : (
                                        <div className="py-2.5 pl-12 text-xs text-muted-foreground italic">
                                          No session dates scheduled.
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* DETAILED AGENDA TABLE VIEW */}
      {viewMode === "list" && (
        <Card className="border-border/60 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Project Code</TableHead>
                  <TableHead>Batch Name</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Dates &amp; Duration</TableHead>
                  <TableHead className="text-center">Time Slots</TableHead>
                  <TableHead className="text-center">Labs Confirmed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                      Loading schedule agenda...
                    </TableCell>
                  </TableRow>
                ) : timelineBatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                      No batches match your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  timelineBatches.map((b) => {
                    const proj = projectMap.get(b.project_id);
                    const statusInfo = STATUS_CONFIG[b.status] || STATUS_CONFIG.draft;
                    const bAssignments = assignmentsByBatch.get(b.id) || [];
                    const confirmedCount = bAssignments.filter((a) => a.status === "confirmed").length;
                    const sortedDates = [...(b.dates || [])].sort();

                    return (
                      <TableRow key={b.id} className="hover:bg-muted/20 transition-colors">
                        <TableCell>
                          <Link
                            to="/projects/$id"
                            params={{ id: b.project_id }}
                            className="font-bold text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            <span>{proj?.name || "Unknown Project"}</span>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {proj?.code}
                            </Badge>
                          </Link>
                        </TableCell>
                        <TableCell className="font-medium text-sm text-foreground">{b.name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`${statusInfo.bg} ${statusInfo.text} ${statusInfo.border} text-xs`}>
                            {statusInfo.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex flex-col items-center text-xs">
                            <span className="font-mono font-medium">
                              {sortedDates[0] || "—"} &rarr; {sortedDates[sortedDates.length - 1] || "—"}
                            </span>
                            <span className="text-[#FF7F1C] font-semibold text-[10px] font-mono">
                              {sortedDates.length} Session Day{sortedDates.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            {normalizeTimeSlots(b.time_slots, { preserveInvalid: true }).map((slot) => (
                              <Badge
                                key={slot}
                                variant="outline"
                                className="bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/30 text-[10px] font-mono py-0.5 px-1.5 font-semibold rounded-md"
                              >
                                {formatTimeSlot(slot)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="gap-1 font-mono text-xs">
                            <Building2 className="h-3 w-3 text-primary" />
                            {confirmedCount} Labs
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-xs"
                            onClick={() => setSelectedBatch(b)}
                          >
                            <Eye className="h-3.5 w-3.5 text-primary" /> Inspect Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* BATCH DETAIL INSPECT DIALOG */}
      {selectedBatch && (
        <Dialog
          open={Boolean(selectedBatch)}
          onOpenChange={(o) => {
            if (!o) {
              setSelectedBatch(null);
              setInspectLabSearch("");
            }
          }}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden shadow-2xl rounded-2xl border border-border/80">
            <DialogHeader className="p-5 sm:p-6 pb-4 border-b shrink-0 bg-background/95 backdrop-blur">
              <div className="flex items-start sm:items-center justify-between gap-4">
                <div>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
                    <Layers className="h-5 w-5 text-[#056FEC]" />
                    <span>{selectedBatch.name}</span>
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-xs text-muted-foreground">
                    {projectMap.get(selectedBatch.project_id)?.name} (Code:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {projectMap.get(selectedBatch.project_id)?.code}
                    </span>)
                  </DialogDescription>
                </div>
                <Badge
                  variant="outline"
                  className={`font-semibold shrink-0 ${(STATUS_CONFIG[selectedBatch.status] || STATUS_CONFIG.draft).bg} ${(STATUS_CONFIG[selectedBatch.status] || STATUS_CONFIG.draft).text} ${(STATUS_CONFIG[selectedBatch.status] || STATUS_CONFIG.draft).border}`}
                >
                  {(STATUS_CONFIG[selectedBatch.status] || STATUS_CONFIG.draft).label}
                </Badge>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {/* Batch Time & Dates Overview */}
              <div className="rounded-xl bg-muted/40 p-4 space-y-2 border border-border/60">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-[#FF7F1C]" /> Scheduled Session Dates{" "}
                    <span className="text-[#FF7F1C] font-mono">({selectedBatch.dates?.length || 0} Days)</span>
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {(selectedBatch.dates || []).length} scheduled session days
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1 max-h-36 overflow-y-auto pr-1">
                  {(selectedBatch.dates || []).sort().map((dStr, idx) => (
                    <Badge key={dStr} variant="outline" className="font-mono text-xs bg-card py-1 px-2.5 gap-1.5 rounded-lg border-border/70 hover:border-[#FF7F1C]/40 transition-colors">
                      <span className="font-bold text-[10px] text-[#FF7F1C] bg-[#FF7F1C]/10 border border-[#FF7F1C]/25 px-1 py-0.2 rounded">
                        Day {idx + 1}
                      </span>
                      <span>{dStr}</span>
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Time Slots */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[#056FEC]" /> Session Time Slots
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {normalizeTimeSlots(selectedBatch.time_slots, { preserveInvalid: true }).map((slot) => (
                    <Badge
                      key={slot}
                      variant="outline"
                      className="bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/30 font-mono text-xs py-1 px-2.5 rounded-lg font-semibold shadow-2xs"
                    >
                      {formatTimeSlot(slot)}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Assigned Labs List */}
              {(() => {
                const bAsgs = assignmentsByBatch.get(selectedBatch.id) || [];
                const searchNorm = inspectLabSearch.trim().toLowerCase();
                const filteredAsgs = searchNorm
                  ? bAsgs.filter((asg) => {
                      const lab = labMap.get(asg.lab_id);
                      const name = (lab?.name || "").toLowerCase();
                      const code = (lab?.lab_code || "").toLowerCase();
                      const gov = (lab?.gov || "").toLowerCase();
                      const area = (lab?.area || "").toLowerCase();
                      return (
                        name.includes(searchNorm) ||
                        code.includes(searchNorm) ||
                        gov.includes(searchNorm) ||
                        area.includes(searchNorm)
                      );
                    })
                  : bAsgs;

                return (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Building2 className="h-4 w-4 text-[#056FEC]" /> Assigned Labs ({bAsgs.length})
                      </div>
                      {bAsgs.length > 4 && (
                        <div className="relative w-full sm:w-64">
                          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Filter assigned labs..."
                            value={inspectLabSearch}
                            onChange={(e) => setInspectLabSearch(e.target.value)}
                            className="h-8 pl-8 pr-7 text-xs rounded-xl bg-background"
                          />
                          {inspectLabSearch && (
                            <button
                              onClick={() => setInspectLabSearch("")}
                              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {!bAsgs.length ? (
                      <p className="text-xs text-muted-foreground italic bg-muted/20 p-4 rounded-xl text-center border border-dashed">
                        No labs assigned to this batch yet.
                      </p>
                    ) : !filteredAsgs.length ? (
                      <p className="text-xs text-muted-foreground italic bg-muted/20 p-4 rounded-xl text-center border border-dashed">
                        No assigned labs match "{inspectLabSearch}".
                      </p>
                    ) : (
                      <div className="rounded-xl border border-border/80 overflow-hidden shadow-xs">
                        <div className="max-h-72 overflow-y-auto">
                          <Table>
                            <TableHeader className="bg-muted/70 sticky top-0 z-10 backdrop-blur">
                              <TableRow className="text-xs">
                                <TableHead>Lab Code &amp; Name</TableHead>
                                <TableHead>Location</TableHead>
                                <TableHead className="text-center">Status</TableHead>
                                <TableHead className="text-right">Price / Session</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredAsgs.map((asg) => {
                                const lab = labMap.get(asg.lab_id);
                                return (
                                  <TableRow key={asg.id} className="text-xs hover:bg-muted/30 transition-colors">
                                    <TableCell className="font-medium">
                                      <div className="font-semibold text-foreground">{lab?.name || "Unknown Lab"}</div>
                                      <div className="font-mono text-[10px] text-[#056FEC] font-bold">{lab?.lab_code || "—"}</div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {lab?.gov || "—"} — {lab?.area || "Area unspecified"}
                                    </TableCell>
                                    <TableCell className="text-center">
                                      <Badge variant="outline" className="capitalize text-[10px] py-0 font-semibold">
                                        {asg.status}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-semibold text-[#056FEC]">
                                      {formatEGP(asg.confirmed_price ?? lab?.session_price ?? 0)}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center justify-between border-t p-4 px-6 bg-muted/20 shrink-0">
              <Link to="/projects/$id" params={{ id: selectedBatch.project_id }}>
                <Button variant="default" size="sm" className="gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold rounded-xl text-xs shadow-xs">
                  Open Project Workspace <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedBatch(null);
                  setInspectLabSearch("");
                }}
                className="rounded-xl text-xs font-semibold"
              >
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <ProjectTimelineCreationDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onProjectCreated={() => {
          loadData();
        }}
      />
    </div>
  );
}
