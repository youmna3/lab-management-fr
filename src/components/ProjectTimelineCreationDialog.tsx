import React, { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit2,
  FileSpreadsheet,
  FolderPlus,
  HelpCircle,
  Layers,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Sparkles,
  Table as TableIcon,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  generateTimelineTemplateFiles,
  parseTimelineSpreadsheetRows,
  buildProjectTimelineFromRows,
  getDayNameFromDate,
  formatLocalDateToIso,
  getCanonicalVisitCount,
  type TimelineRow,
  type ParsedProjectTimeline,
} from "@/lib/project-timeline-template";
import {
  BATCH_TIME_SLOT_PRESETS,
  DEFAULT_BATCH_TIME_SLOTS,
  flattenDayTimeSlots,
  formatTimeSlot,
  getDayTimeSlots,
  normalizeTimeSlot,
  normalizeTimeSlots,
  sortTimeSlots,
} from "@/lib/time-slots";

interface TimelineTimeSlotEditorProps {
  value: string[];
  onChange: (newSlots: string[]) => void;
  showPresetsSelect?: boolean;
  label?: string;
  compact?: boolean;
}

export function TimelineTimeSlotEditor({
  value,
  onChange,
  showPresetsSelect = true,
  label,
  compact = false,
}: TimelineTimeSlotEditorProps) {
  const [customTimeInput, setCustomTimeInput] = useState("10:00");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const currentSlots = useMemo(
    () => normalizeTimeSlots(value && value.length > 0 ? value : DEFAULT_BATCH_TIME_SLOTS),
    [value]
  );

  // Match against known presets
  const matchedPreset = useMemo(() => {
    const sortedCurrent = sortTimeSlots([...currentSlots]);
    for (const preset of BATCH_TIME_SLOT_PRESETS) {
      const sortedPreset = sortTimeSlots([...preset.values]);
      if (
        sortedCurrent.length === sortedPreset.length &&
        sortedCurrent.every((s, i) => s === sortedPreset[i])
      ) {
        return preset.label;
      }
    }
    return "custom";
  }, [currentSlots]);

  const handleAddSlot = (slotToAdd: string) => {
    const norm = normalizeTimeSlot(slotToAdd);
    if (!norm) {
      toast.error("Invalid time format (e.g. 10:00, 14:30)");
      return;
    }
    if (currentSlots.includes(norm)) {
      toast.info(`Time slot ${norm} is already added`);
      return;
    }
    onChange(sortTimeSlots([...currentSlots, norm]));
    setIsPickerOpen(false);
  };

  const handleRemoveSlot = (slotToRemove: string) => {
    if (currentSlots.length <= 1) {
      toast.error("At least one time slot is required.");
      return;
    }
    onChange(currentSlots.filter((s) => s !== slotToRemove));
  };

  const handlePresetSelect = (presetVal: string) => {
    if (presetVal === "custom") return;
    const found = BATCH_TIME_SLOT_PRESETS.find((p) => p.label === presetVal);
    if (found) {
      onChange([...found.values]);
    }
  };

  return (
    <div className={`space-y-1.5 ${compact ? "text-xs" : ""}`}>
      {label && <Label className="text-[11px] text-muted-foreground font-medium">{label}</Label>}

      {showPresetsSelect && (
        <Select value={matchedPreset} onValueChange={handlePresetSelect}>
          <SelectTrigger className="h-8 text-xs bg-background">
            <SelectValue placeholder="Select preset or custom..." />
          </SelectTrigger>
          <SelectContent>
            {BATCH_TIME_SLOT_PRESETS.map((p) => (
              <SelectItem key={p.label} value={p.label} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value="custom" className="text-xs font-semibold text-primary">
              ⚡ Custom Times ({currentSlots.length} slots configured)
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      {/* Interactive Time Chips & Add Control */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-md border bg-muted/20">
        {currentSlots.map((slot) => (
          <Badge
            key={slot}
            variant="secondary"
            className="text-[11px] font-mono gap-1 py-0.5 px-2 bg-background border shadow-2xs shrink-0"
          >
            <span>{formatTimeSlot(slot)}</span>
            <span className="text-[9px] text-muted-foreground font-sans font-normal">({slot})</span>
            <button
              type="button"
              onClick={() => handleRemoveSlot(slot)}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded p-0.5 ml-0.5"
              title="Remove slot"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}

        {/* Quick Add Popover & Custom Input */}
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 gap-1 bg-background shrink-0"
            >
              <Plus className="h-3 w-3" /> Add Time
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3 space-y-3" align="start">
            <div className="space-y-1">
              <span className="text-xs font-semibold">Add Time Slot</span>
              <p className="text-[10px] text-muted-foreground">Pick a common time or enter any custom value.</p>
            </div>

            {/* Custom Input */}
            <div className="flex gap-1.5">
              <Input
                type="time"
                value={customTimeInput}
                onChange={(e) => setCustomTimeInput(e.target.value)}
                className="h-7 text-xs font-mono"
              />
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => {
                  handleAddSlot(customTimeInput);
                }}
              >
                Add
              </Button>
            </div>

            {/* Quick suggestions */}
            <div className="space-y-1 pt-1 border-t">
              <span className="text-[10px] font-medium text-muted-foreground">Quick Suggestions:</span>
              <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto pr-1">
                {["08:30", "09:00", "10:00", "11:00", "12:30", "13:00", "14:00", "15:30", "16:00", "17:00", "18:30", "19:30", "20:00"].map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={currentSlots.includes(s) ? "secondary" : "outline"}
                    size="sm"
                    disabled={currentSlots.includes(s)}
                    className="h-5 text-[10px] px-1.5 font-mono"
                    onClick={() => handleAddSlot(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

interface ProjectTimelineCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreated?: (projectId: string) => void;
}

export function ProjectTimelineCreationDialog({
  open,
  onOpenChange,
  onProjectCreated,
}: ProjectTimelineCreationDialogProps) {
  const [activeTab, setActiveTab] = useState<"scratch" | "upload">("scratch");
  const [scheduleViewMode, setScheduleViewMode] = useState<"calendar" | "table">("calendar");
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);

  // --- Mode A: Scratch Form State ---
  const [scratchProjectName, setScratchProjectName] = useState("DEMI Summer 2026");
  const [scratchProgram, setScratchProgram] = useState<Database["public"]["Enums"]["program"]>("DEMI");
  const [scratchCode, setScratchCode] = useState("DEMI-S26");
  const [scratchStartDate, setScratchStartDate] = useState("2026-09-13");
  const [scratchEndDate, setScratchEndDate] = useState("2026-09-24");
  const [scratchBlockFridays, setScratchBlockFridays] = useState(true);

  // Scratch Batches List
  interface ScratchBatchConfig {
    id: string;
    name: string;
    mode: "single_session" | "multi_session";
    startDate?: string;
    endDate?: string;
    repeatCount: number;
    megaGroups: Array<{ name: string; startDate: string; endDate: string }>;
    timeSlots: string[];
  }

  const [scratchBatches, setScratchBatches] = useState<ScratchBatchConfig[]>([
    {
      id: "b1",
      name: "Cohort 1",
      mode: "single_session",
      startDate: "2026-09-13",
      endDate: "2026-09-24",
      repeatCount: 1,
      megaGroups: [
        { name: "Group A", startDate: "2026-09-13", endDate: "2026-09-17" },
        { name: "Group B", startDate: "2026-09-20", endDate: "2026-09-24" },
      ],
      timeSlots: ["10:00", "12:30", "16:00", "19:30"],
    },
  ]);

  // --- Active Timeline Rows (Editable Grid & Calendar for both flows) ---
  const [timelineRows, setTimelineRows] = useState<TimelineRow[]>([]);
  const [importedFilename, setImportedFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calendar view active month state (YYYY-MM)
  const [calendarMonth, setCalendarMonth] = useState<string>(() => {
    return scratchStartDate ? scratchStartDate.slice(0, 7) : "2026-09";
  });

  // Selected date dialog state for editing
  const [editingDate, setEditingDate] = useState<string | null>(null);

  // Helper to resolve standard default time slots for a batch by name
  function getBatchDefaultSlots(batchName: string): string[] {
    const matched = scratchBatches.find((sb) => sb.name === batchName);
    if (matched?.timeSlots && matched.timeSlots.length > 0) {
      return [...matched.timeSlots];
    }
    return [...DEFAULT_BATCH_TIME_SLOTS];
  }

  // Auto-generate rows from scratch state when switching or requesting preview
  function generateScratchTimelineRows(): TimelineRow[] {
    const rows: TimelineRow[] = [];
    if (!scratchStartDate || !scratchEndDate) return [];

    let rowIdx = 1;
    for (const b of scratchBatches) {
      const defaultSlots = getBatchDefaultSlots(b.name);

      if (b.mode === "single_session") {
        const batchStart = b.startDate || scratchStartDate;
        const batchEnd = b.endDate || scratchEndDate;
        const [sy, sm, sd] = batchStart.split("-").map(Number);
        const [ey, em, ed] = batchEnd.split("-").map(Number);
        const start = new Date(sy, sm - 1, sd);
        const end = new Date(ey, em - 1, ed);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) continue;

        let curr = new Date(start);
        while (curr <= end) {
          const iso = formatLocalDateToIso(curr);
          const dayName = getDayNameFromDate(iso);
          const isFri = dayName === "Friday";
          const isBlocked = scratchBlockFridays && isFri;

          rows.push({
            id: `row-${rowIdx++}`,
            projectName: scratchProjectName,
            date: iso,
            dayName,
            batchName: b.name,
            sessionType: "SG",
            subGroup: "",
            isBlocked,
            isOffline: isBlocked,
            timeSlots: defaultSlots,
          });
          curr.setDate(curr.getDate() + 1);
        }
      } else {
        // Multi-session with mega groups
        for (const mg of b.megaGroups) {
          const [msy, msm, msd] = (mg.startDate || scratchStartDate).split("-").map(Number);
          const [mey, mem, med] = (mg.endDate || scratchEndDate).split("-").map(Number);
          const mgStart = new Date(msy, msm - 1, msd);
          const mgEnd = new Date(mey, mem - 1, med);
          if (isNaN(mgStart.getTime()) || isNaN(mgEnd.getTime()) || mgStart > mgEnd) continue;

          let curr = new Date(mgStart);
          while (curr <= mgEnd) {
            const iso = formatLocalDateToIso(curr);
            const dayName = getDayNameFromDate(iso);
            const isFri = dayName === "Friday";
            const isBlocked = scratchBlockFridays && isFri;

            rows.push({
              id: `row-${rowIdx++}`,
              projectName: scratchProjectName,
              date: iso,
              dayName,
              batchName: b.name,
              sessionType: "Multi",
              subGroup: mg.name || "Group A",
              isBlocked,
              isOffline: isBlocked,
              timeSlots: defaultSlots,
            });
            curr.setDate(curr.getDate() + 1);
          }
        }
      }
    }

    return rows;
  }

  // Derive canonical parsed project model from active timeline rows
  const parsedTimeline: ParsedProjectTimeline = useMemo(() => {
    const sourceRows = timelineRows.length > 0 ? timelineRows : generateScratchTimelineRows();
    return buildProjectTimelineFromRows(sourceRows, [], [], scratchProjectName);
  }, [timelineRows, scratchProjectName, scratchBatches, scratchStartDate, scratchEndDate, scratchBlockFridays]);

  // Synchronize scratch rows into editable grid
  function handleGenerateScratchGrid() {
    const generated = generateScratchTimelineRows();
    setTimelineRows(generated);
    toast.success(`Generated ${generated.length} calendar day entries.`);
  }

  // --- Mode B: File Upload Handling ---
  async function handleFileUpload(file: File) {
    setParsing(true);
    setImportedFilename(file.name);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      let rawRows: Array<Record<string, unknown>> = [];

      if (isCsv) {
        const text = await file.text();
        const wb = XLSX.read(text, { type: "string", raw: false });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json(sheet);
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json(sheet);
      }

      const parsed = parseTimelineSpreadsheetRows(rawRows, scratchProjectName);
      if (parsed.validationErrors.length > 0) {
        toast.error(parsed.validationErrors[0]);
      } else {
        setTimelineRows(parsed.rows);
        if (parsed.projectName && parsed.projectName !== "New Project") {
          setScratchProjectName(parsed.projectName);
        }
        setScratchProgram(parsed.program);
        if (parsed.startDate) {
          setScratchStartDate(parsed.startDate);
          setCalendarMonth(parsed.startDate.slice(0, 7));
        }
        if (parsed.endDate) setScratchEndDate(parsed.endDate);
        toast.success(`Successfully parsed ${parsed.rows.length} schedule rows across ${parsed.batches.length} batch(es)!`);
      }
    } catch (e: any) {
      console.error("Parse error:", e);
      toast.error(e.message || "Failed to parse timeline file");
    } finally {
      setParsing(false);
    }
  }

  // --- Sample Template Downloads ---
  function handleDownloadTemplate(format: "xlsx" | "csv") {
    const { xlsxBuffer, csvContent } = generateTimelineTemplateFiles();
    if (format === "xlsx") {
      const blob = new Blob([xlsxBuffer as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ischool_timeline_standard_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded Excel timeline template.");
    } else {
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ischool_timeline_standard_template.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded CSV timeline template.");
    }
  }

  // --- Row Editing Helpers ---
  function handleUpdateRow(id: string, updates: Partial<TimelineRow>) {
    setTimelineRows((prev) => {
      const base = prev.length > 0 ? prev : generateScratchTimelineRows();
      return base.map((r) => (r.id === id ? { ...r, ...updates } : r));
    });
  }

  function handleDeleteRow(id: string) {
    setTimelineRows((prev) => {
      const base = prev.length > 0 ? prev : generateScratchTimelineRows();
      return base.filter((r) => r.id !== id);
    });
  }

  function handleAddRow() {
    const base = timelineRows.length > 0 ? timelineRows : generateScratchTimelineRows();
    const lastRow = base[base.length - 1];
    let newDate = new Date();
    if (lastRow) {
      const [ly, lm, ld] = lastRow.date.split("-").map(Number);
      newDate = new Date(ly, lm - 1, ld + 1);
    }
    const isoDate = formatLocalDateToIso(newDate);
    const targetBatch = lastRow?.batchName || scratchBatches[0]?.name || "Cohort 1";

    const newRow: TimelineRow = {
      id: `row-${Date.now()}`,
      projectName: scratchProjectName,
      date: isoDate,
      dayName: getDayNameFromDate(isoDate),
      batchName: targetBatch,
      sessionType: lastRow?.sessionType || "SG",
      subGroup: lastRow?.sessionType === "Multi" ? lastRow?.subGroup || "Group A" : "",
      isBlocked: false,
      timeSlots: getBatchDefaultSlots(targetBatch),
    };

    setTimelineRows([...base, newRow]);
  }

  // Add session for a specific date from calendar click
  function handleAddSessionForDate(isoDate: string) {
    const base = timelineRows.length > 0 ? timelineRows : generateScratchTimelineRows();
    const targetBatch = scratchBatches[0]?.name || "Cohort 1";
    const newRow: TimelineRow = {
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      projectName: scratchProjectName,
      date: isoDate,
      dayName: getDayNameFromDate(isoDate),
      batchName: targetBatch,
      sessionType: scratchBatches[0]?.mode === "multi_session" ? "Multi" : "SG",
      subGroup: scratchBatches[0]?.mode === "multi_session" ? "Group A" : "",
      isBlocked: false,
      timeSlots: getBatchDefaultSlots(targetBatch),
    };
    setTimelineRows([...base, newRow]);
  }

  // Toggle blocked status for all sessions on a given date
  function handleToggleDateBlocked(isoDate: string, currentlyBlocked: boolean) {
    const base = timelineRows.length > 0 ? timelineRows : generateScratchTimelineRows();
    const dateRows = base.filter((r) => r.date === isoDate);

    if (dateRows.length === 0) {
      const targetBatch = scratchBatches[0]?.name || "Cohort 1";
      const newRow: TimelineRow = {
        id: `row-${Date.now()}`,
        projectName: scratchProjectName,
        date: isoDate,
        dayName: getDayNameFromDate(isoDate),
        batchName: targetBatch,
        sessionType: "SG",
        subGroup: "",
        isBlocked: !currentlyBlocked,
        timeSlots: getBatchDefaultSlots(targetBatch),
      };
      setTimelineRows([...base, newRow]);
    } else {
      setTimelineRows(
        base.map((r) => (r.date === isoDate ? { ...r, isBlocked: !currentlyBlocked } : r))
      );
    }
  }

  // --- Save Project & Batches to Supabase ---
  async function handleSaveProject() {
    if (!scratchProjectName.trim()) {
      return toast.error("Please enter a project name.");
    }

    const currentRows = timelineRows.length > 0 ? timelineRows : generateScratchTimelineRows();
    if (currentRows.length === 0) {
      return toast.error("No timeline rows found. Please configure dates and batches.");
    }

    const payload = buildProjectTimelineFromRows(currentRows, [], [], scratchProjectName);
    if (payload.batches.length === 0) {
      return toast.error("No batches configured. Please add at least one batch.");
    }

    setSaving(true);
    try {
      // 1. Insert Project record (using valid 'draft' enum)
      const codeToUse = scratchCode.trim() || `${scratchProgram}-${new Date().getFullYear()}`;
      const { data: projectRecord, error: projErr } = await supabase
        .from("projects")
        .insert({
          name: scratchProjectName.trim(),
          program: scratchProgram,
          code: codeToUse,
          start_date: payload.startDate || scratchStartDate,
          end_date: payload.endDate || scratchEndDate,
          status: "draft",
          sessions_count: currentRows.filter((r) => !r.isBlocked && !r.isOffline).length,
          participants_per_session: 25,
        })
        .select("id")
        .single();

      if (projErr) throw projErr;
      const newProjectId = projectRecord.id;

      // 2. Insert Batch records (with per-day time slots & valid 'draft' enum)
      for (const b of payload.batches) {
        // Resolve default time slots
        const matchedScratch = scratchBatches.find((sb) => sb.name === b.name);
        const defaultBatchSlots = matchedScratch?.timeSlots && matchedScratch.timeSlots.length > 0
          ? [...matchedScratch.timeSlots]
          : [...DEFAULT_BATCH_TIME_SLOTS];

        // Compile per-day time slots map
        const daySlotsMap: Record<string, string[]> = {};
        let hasCustomDailyOverride = false;

        b.dates.forEach((dateStr) => {
          const matchingRow = currentRows.find((r) => r.batchName === b.name && r.date === dateStr);
          if (matchingRow && matchingRow.timeSlots && matchingRow.timeSlots.length > 0) {
            daySlotsMap[dateStr] = matchingRow.timeSlots;
            if (JSON.stringify(matchingRow.timeSlots) !== JSON.stringify(defaultBatchSlots)) {
              hasCustomDailyOverride = true;
            }
          } else {
            daySlotsMap[dateStr] = defaultBatchSlots;
          }
        });

        // If specific days have overrides, store date-tagged slots (YYYY-MM-DD@HH:MM)
        const finalTimeSlotsToStore = hasCustomDailyOverride
          ? flattenDayTimeSlots(daySlotsMap)
          : defaultBatchSlots;

        const resolvedExpectedVisits = b.groupDistributionMode === "single_session"
          ? 1
          : getCanonicalVisitCount({
              mode: b.groupDistributionMode,
              repeatCount: matchedScratch?.repeatCount,
              expectedSessionsPerGroup: matchedScratch?.repeatCount ?? b.expectedSessionsPerGroup,
            });

        const { error: batchErr } = await supabase.from("batches").insert({
          project_id: newProjectId,
          name: b.name,
          date_mode: "custom",
          dates: b.dates,
          time_slots: finalTimeSlotsToStore,
          group_distribution_mode: b.groupDistributionMode,
          expected_sessions_per_group: resolvedExpectedVisits,
          blocked_days: b.blockedDays,
          mega_groups: (b.megaGroups || []) as any,
          status: "draft",
        });

        if (batchErr) throw batchErr;
      }

      toast.success(`Project "${scratchProjectName}" & ${payload.batches.length} batch(es) successfully created!`);
      onOpenChange(false);
      onProjectCreated?.(newProjectId);
    } catch (e: any) {
      console.error("Save project error:", e);
      toast.error(e.message || "Failed to save project & batches");
    } finally {
      setSaving(false);
    }
  }

  const activeGridRows = timelineRows.length > 0 ? timelineRows : generateScratchTimelineRows();

  // Group active rows by ISO date for calendar visualization
  const rowsByDate = useMemo(() => {
    const map = new Map<string, TimelineRow[]>();
    activeGridRows.forEach((r) => {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date)!.push(r);
    });
    return map;
  }, [activeGridRows]);

  // Calendar Month Grid Generation
  const calendarData = useMemo(() => {
    const [yearStr, monthStr] = calendarMonth.split("-");
    const year = parseInt(yearStr, 10) || 2026;
    const month = parseInt(monthStr, 10) || 9; // 1-indexed

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday

    const monthLabel = firstDay.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const days: Array<{
      dayNumber: number;
      isoDate: string;
      dayOfWeek: number;
      isCurrentMonth: boolean;
      isInProjectRange: boolean;
    }> = [];

    // Previous month padding
    const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dNum = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 2, dNum);
      const iso = formatLocalDateToIso(prevDate);
      days.push({
        dayNumber: dNum,
        isoDate: iso,
        dayOfWeek: prevDate.getDay(),
        isCurrentMonth: false,
        isInProjectRange: iso >= scratchStartDate && iso <= scratchEndDate,
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const currDate = new Date(year, month - 1, d);
      const iso = formatLocalDateToIso(currDate);
      days.push({
        dayNumber: d,
        isoDate: iso,
        dayOfWeek: currDate.getDay(),
        isCurrentMonth: true,
        isInProjectRange: iso >= scratchStartDate && iso <= scratchEndDate,
      });
    }

    // Next month padding to complete 35 or 42 grid cells
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(year, month, i);
      const iso = formatLocalDateToIso(nextDate);
      days.push({
        dayNumber: i,
        isoDate: iso,
        dayOfWeek: nextDate.getDay(),
        isCurrentMonth: false,
        isInProjectRange: iso >= scratchStartDate && iso <= scratchEndDate,
      });
    }

    return {
      monthLabel,
      year,
      month,
      days,
    };
  }, [calendarMonth, scratchStartDate, scratchEndDate]);

  function navigateMonth(direction: -1 | 1) {
    const [yearStr, monthStr] = calendarMonth.split("-");
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10) + direction;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    const newMonthStr = `${year}-${String(month).padStart(2, "0")}`;
    setCalendarMonth(newMonthStr);
  }

  // Active date row for editing modal
  const editingDateRows = editingDate ? rowsByDate.get(editingDate) || [] : [];
  const isEditingDateBlocked = editingDateRows.length > 0 && editingDateRows.every((r) => r.isBlocked);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b bg-card">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <DialogTitle className="text-xl flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-primary" />
                Create New Project & Timeline
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Build a standardized timeline from scratch or upload a 6-column Excel/CSV template. Fully connected to Lab Allocation.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 gap-1.5"
                onClick={() => handleDownloadTemplate("xlsx")}
              >
                <Download className="h-3.5 w-3.5 text-primary" />
                Template (XLSX)
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8 gap-1.5"
                onClick={() => handleDownloadTemplate("csv")}
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                Template (CSV)
              </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full mt-3">
            <TabsList className="grid grid-cols-2 w-full max-w-xs h-8">
              <TabsTrigger value="scratch" className="text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Build from Scratch
              </TabsTrigger>
              <TabsTrigger value="upload" className="text-xs gap-1.5">
                <UploadCloud className="h-3.5 w-3.5" />
                Upload Spreadsheet
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === "scratch" ? (
            <div className="space-y-6">
              {/* Project Details */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-muted/30 p-4 rounded-lg border">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-semibold">Project Name</Label>
                  <Input
                    placeholder="e.g. DEMI Summer 2026"
                    value={scratchProjectName}
                    onChange={(e) => setScratchProjectName(e.target.value)}
                    className="h-8 text-xs bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Program</Label>
                  <Select value={scratchProgram} onValueChange={(v) => setScratchProgram(v as any)}>
                    <SelectTrigger className="h-8 text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEMI">DEMI</SelectItem>
                      <SelectItem value="DECI">DECI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Project Code</Label>
                  <Input
                    placeholder="e.g. DEMI-S26"
                    value={scratchCode}
                    onChange={(e) => setScratchCode(e.target.value)}
                    className="h-8 text-xs bg-background"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Start Date</Label>
                  <Input
                    type="date"
                    value={scratchStartDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setScratchStartDate(v);
                      if (v) setCalendarMonth(v.slice(0, 7));
                    }}
                    className="h-8 text-xs bg-background font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">End Date</Label>
                  <Input
                    type="date"
                    value={scratchEndDate}
                    onChange={(e) => setScratchEndDate(e.target.value)}
                    className="h-8 text-xs bg-background font-mono"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2 flex items-center justify-between pt-4 pr-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold">Block Fridays Automatically</Label>
                    <p className="text-[11px] text-muted-foreground">Mark all Fridays as blocked / no sessions</p>
                  </div>
                  <Switch
                    checked={scratchBlockFridays}
                    onCheckedChange={setScratchBlockFridays}
                  />
                </div>
              </div>

              {/* Batches Builder */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-primary" />
                    Configured Batches & Cohorts ({scratchBatches.length})
                  </h4>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 bg-background shadow-2xs"
                    onClick={() => {
                      const nextNum = scratchBatches.length + 1;
                      setScratchBatches([
                        ...scratchBatches,
                        {
                          id: `b-${Date.now()}`,
                          name: `Cohort ${nextNum}`,
                          mode: "single_session",
                          startDate: scratchStartDate,
                          endDate: scratchEndDate,
                          repeatCount: 1,
                          megaGroups: [
                            { name: "Group A", startDate: scratchStartDate, endDate: scratchEndDate },
                            { name: "Group B", startDate: scratchStartDate, endDate: scratchEndDate },
                          ],
                          timeSlots: ["10:00", "12:30", "16:00", "19:30"],
                        },
                      ]);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Batch
                  </Button>
                </div>

                {scratchBatches.map((b, idx) => (
                  <Card key={b.id} className="border shadow-2xs overflow-hidden">
                    <CardHeader className="p-3.5 pb-2.5 bg-muted/20 border-b flex flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 flex-1 max-w-lg">
                        <Badge variant="secondary" className="text-[10px] font-mono px-2 py-0.5 shrink-0">
                          #{idx + 1}
                        </Badge>
                        <div className="flex-1 max-w-xs">
                          <Input
                            value={b.name}
                            placeholder="Batch / Cohort Name"
                            onChange={(e) => {
                              const val = e.target.value;
                              setScratchBatches(scratchBatches.map((x) => (x.id === b.id ? { ...x, name: val } : x)));
                            }}
                            className="h-8 text-xs font-semibold bg-background"
                          />
                        </div>
                        {b.mode === "single_session" ? (
                          <Badge
                            variant="outline"
                            className="bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800 text-[10px] gap-1 font-medium shrink-0"
                          >
                            <Sparkles className="h-3 w-3 text-sky-500" />
                            Single Group (SG)
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 text-[10px] gap-1 font-medium shrink-0"
                          >
                            <Layers className="h-3 w-3 text-purple-500" />
                            Multi-Session ({b.megaGroups.length} Sub-Cohorts)
                          </Badge>
                        )}
                      </div>
                      {scratchBatches.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setScratchBatches(scratchBatches.filter((x) => x.id !== b.id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="p-3.5 space-y-3.5">
                      {/* Mode and Visits Grid */}
                      <div className={`grid gap-3 ${b.mode === "multi_session" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground font-medium">Session Distribution Mode</Label>
                          <Select
                            value={b.mode}
                            onValueChange={(val: any) => {
                              setScratchBatches(
                                scratchBatches.map((x) => {
                                  if (x.id !== b.id) return x;
                                  const isMulti = val === "multi_session";
                                  return {
                                    ...x,
                                    mode: val,
                                    repeatCount: getCanonicalVisitCount({
                                      mode: val,
                                      repeatCount: isMulti ? Math.max(2, x.repeatCount) : 1,
                                    }),
                                    startDate: x.startDate || scratchStartDate,
                                    endDate: x.endDate || scratchEndDate,
                                    megaGroups:
                                      val === "multi_session" && (!x.megaGroups || x.megaGroups.length === 0)
                                        ? [
                                            { name: "Group A", startDate: scratchStartDate, endDate: scratchEndDate },
                                            { name: "Group B", startDate: scratchStartDate, endDate: scratchEndDate },
                                          ]
                                        : x.megaGroups,
                                  };
                                })
                              );
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="single_session">Single Group (SG / 1 Visit)</SelectItem>
                              <SelectItem value="multi_session">Multi-Session (Mega Groups A/B)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {b.mode === "multi_session" && (
                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground font-medium">Expected Repeat Visits</Label>
                            <Input
                              type="number"
                              min={2}
                              max={10}
                              value={b.repeatCount}
                              onChange={(e) => {
                                const count = Number(e.target.value) || 2;
                                setScratchBatches(
                                  scratchBatches.map((x) => (x.id === b.id ? { ...x, repeatCount: count } : x))
                                );
                              }}
                              className="h-8 text-xs bg-background"
                            />
                          </div>
                        )}
                      </div>

                      {/* Default Daily Time Slots for this batch */}
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                          Default Daily Time Slots for Batch
                        </Label>
                        <TimelineTimeSlotEditor
                          value={b.timeSlots || ["10:00", "12:30", "16:00", "19:30"]}
                          onChange={(newSlots) => {
                            setScratchBatches(
                              scratchBatches.map((x) => (x.id === b.id ? { ...x, timeSlots: newSlots } : x))
                            );
                          }}
                        />
                      </div>

                      {/* Mode-Specific Body */}
                      {b.mode === "single_session" ? (
                        <div className="space-y-2.5 p-3 rounded-lg border bg-sky-500/5 border-sky-500/15">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold flex items-center gap-1.5 text-sky-900 dark:text-sky-200">
                              <CalendarIcon className="h-3.5 w-3.5 text-sky-600" />
                              Single Group (SG) Batch Date Window
                            </span>
                            <Badge variant="outline" className="text-[10px] bg-background">1 Session / Student</Badge>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground font-medium">Batch Start Date</Label>
                              <Input
                                type="date"
                                value={b.startDate || scratchStartDate}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setScratchBatches(
                                    scratchBatches.map((x) => (x.id === b.id ? { ...x, startDate: val } : x))
                                  );
                                }}
                                className="h-8 text-xs font-mono bg-background"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground font-medium">Batch End Date</Label>
                              <Input
                                type="date"
                                value={b.endDate || scratchEndDate}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setScratchBatches(
                                    scratchBatches.map((x) => (x.id === b.id ? { ...x, endDate: val } : x))
                                  );
                                }}
                                className="h-8 text-xs font-mono bg-background"
                              />
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            All enrolled students attend 1 visit session on their scheduled day within this date range.
                          </p>
                        </div>
                      ) : (
                        <div className="bg-muted/30 p-3 rounded-lg border space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold flex items-center gap-1.5 text-foreground">
                              <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                              Mega Group Sub-Cohorts ({b.megaGroups.length})
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[11px] px-2 gap-1 bg-background"
                              onClick={() => {
                                const nextLetter = String.fromCharCode(65 + b.megaGroups.length);
                                setScratchBatches(
                                  scratchBatches.map((x) =>
                                    x.id === b.id
                                      ? {
                                          ...x,
                                          megaGroups: [
                                            ...x.megaGroups,
                                            { name: `Group ${nextLetter}`, startDate: scratchStartDate, endDate: scratchEndDate },
                                          ],
                                        }
                                      : x
                                  )
                                );
                              }}
                            >
                              <Plus className="h-3 w-3" />
                              Add Sub-Group
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {b.megaGroups.map((mg, mgIdx) => (
                              <div key={mgIdx} className="bg-card p-2.5 rounded-md border text-xs space-y-2 shadow-2xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-primary flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-primary inline-block" />
                                    {mg.name}
                                  </span>
                                  {b.megaGroups.length > 1 && (
                                    <button
                                      type="button"
                                      className="text-muted-foreground hover:text-destructive text-xs p-0.5 rounded hover:bg-destructive/10"
                                      onClick={() => {
                                        setScratchBatches(
                                          scratchBatches.map((x) =>
                                            x.id === b.id
                                              ? { ...x, megaGroups: x.megaGroups.filter((_, i) => i !== mgIdx) }
                                              : x
                                          )
                                        );
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-0.5">
                                    <span className="text-[10px] text-muted-foreground font-medium">Start Date</span>
                                    <Input
                                      type="date"
                                      value={mg.startDate}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setScratchBatches(
                                          scratchBatches.map((x) => {
                                            if (x.id !== b.id) return x;
                                            const nextMgs = [...x.megaGroups];
                                            nextMgs[mgIdx] = { ...nextMgs[mgIdx], startDate: val };
                                            return { ...x, megaGroups: nextMgs };
                                          })
                                        );
                                      }}
                                      className="h-7 text-[11px] font-mono bg-background"
                                    />
                                  </div>
                                  <div className="space-y-0.5">
                                    <span className="text-[10px] text-muted-foreground font-medium">End Date</span>
                                    <Input
                                      type="date"
                                      value={mg.endDate}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setScratchBatches(
                                          scratchBatches.map((x) => {
                                            if (x.id !== b.id) return x;
                                            const nextMgs = [...x.megaGroups];
                                            nextMgs[mgIdx] = { ...nextMgs[mgIdx], endDate: val };
                                            return { ...x, megaGroups: nextMgs };
                                          })
                                        );
                                      }}
                                      className="h-7 text-[11px] font-mono bg-background"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary transition-colors bg-muted/15 flex flex-col items-center justify-center gap-3"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                  }}
                />
                <div className="p-3 bg-primary/10 text-primary rounded-full">
                  <UploadCloud className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Click or drag & drop timeline spreadsheet</p>
                  <p className="text-xs text-muted-foreground">Supported formats: Excel (.xlsx, .xls) and CSV (.csv)</p>
                </div>
                {importedFilename && (
                  <Badge variant="secondary" className="text-xs mt-1 gap-1">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                    {importedFilename}
                  </Badge>
                )}
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3.5 flex items-start gap-3">
                <HelpCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-semibold text-foreground">Standardized 6-Column Template:</p>
                  <p className="text-muted-foreground">
                    <code>Date</code>, <code>Day</code>, <code>Batch Name</code>, <code>Session Type</code> (SG or Multi), <code>Sub-Group</code> (Group A/B), <code>Blocked Day</code> (Yes/No).
                  </p>
                  <p className="text-[11px] text-muted-foreground pt-0.5">
                    * Project Name is defined in the project settings above and applied automatically to all batches.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Editable Day-by-Day Timeline: Calendar & Table Views */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between border-t pt-4">
              <div className="space-y-0.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <CalendarIcon className="h-4 w-4 text-primary" />
                  Timeline Schedule ({activeGridRows.length} Days Scheduled)
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Click any calendar date to edit sessions, sub-groups, daily time slots, or toggle blocked status.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border">
                  <Button
                    variant={scheduleViewMode === "calendar" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 text-xs gap-1.5 px-2.5"
                    onClick={() => setScheduleViewMode("calendar")}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Calendar View
                  </Button>
                  <Button
                    variant={scheduleViewMode === "table" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 text-xs gap-1.5 px-2.5"
                    onClick={() => setScheduleViewMode("table")}
                  >
                    <TableIcon className="h-3.5 w-3.5" />
                    Table View
                  </Button>
                </div>

                {activeTab === "scratch" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 bg-background"
                    onClick={handleGenerateScratchGrid}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5 bg-background"
                  onClick={handleAddRow}
                >
                  <Plus className="h-3 w-3" />
                  Add Row
                </Button>
              </div>
            </div>

            {/* Validation Alerts */}
            {parsedTimeline.validationWarnings.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 p-2.5 rounded text-xs space-y-1">
                {parsedTimeline.validationWarnings.map((w, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {/* VIEW A: INTERACTIVE MONTH CALENDAR VIEW */}
            {scheduleViewMode === "calendar" ? (
              <div className="space-y-3 bg-card border rounded-lg p-4 shadow-2xs">
                {/* Month Navigator Header */}
                <div className="flex items-center justify-between pb-2 border-b">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4 text-primary" />
                      {calendarData.monthLabel}
                    </h3>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {scratchStartDate} $\rightarrow$ {scratchEndDate}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 bg-background"
                      onClick={() => navigateMonth(-1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 bg-background"
                      onClick={() => navigateMonth(1)}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1.5">
                  {/* Weekday Headers */}
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((wd, i) => (
                    <div
                      key={wd}
                      className={`text-center py-1 text-[11px] font-semibold ${
                        i === 5 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
                      }`}
                    >
                      {wd}
                    </div>
                  ))}

                  {/* Calendar Days */}
                  {calendarData.days.map((day) => {
                    const dayRows = rowsByDate.get(day.isoDate) || [];
                    const hasRows = dayRows.length > 0;
                    const isAllBlocked = hasRows && dayRows.every((r) => r.isBlocked || r.isOffline);
                    const isFri = day.dayOfWeek === 5;

                    return (
                      <div
                        key={day.isoDate}
                        onClick={() => setEditingDate(day.isoDate)}
                        className={`min-h-[92px] p-1.5 rounded-md border flex flex-col justify-between transition-all cursor-pointer group ${
                          !day.isCurrentMonth
                            ? "bg-muted/10 opacity-30 border-dashed"
                            : isAllBlocked
                            ? "bg-rose-50/60 dark:bg-rose-950/25 border-rose-200 dark:border-rose-900/60 hover:border-rose-400"
                            : day.isInProjectRange
                            ? "bg-card border-border/80 hover:border-primary/60 hover:shadow-2xs"
                            : "bg-muted/5 border-border/40 opacity-60"
                        }`}
                      >
                        {/* Day Header */}
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-[11px] font-bold ${
                              !day.isCurrentMonth
                                ? "text-muted-foreground/60"
                                : isFri
                                ? "text-rose-600 dark:text-rose-400"
                                : day.isInProjectRange
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            {day.dayNumber}
                          </span>

                          <div className="flex items-center gap-1">
                            {isFri && (
                              <span className="text-[9px] font-bold text-rose-500 uppercase px-1 rounded bg-rose-500/10">
                                Fri
                              </span>
                            )}
                            <Edit2 className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>

                        {/* Session Markers */}
                        <div className="space-y-1 my-1">
                          {isAllBlocked ? (
                            <div className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300 text-center border border-rose-200 dark:border-rose-800">
                              ⛔ Blocked
                            </div>
                          ) : (
                            dayRows.map((r, rIdx) => {
                              const isMulti = r.sessionType === "Multi";
                              const isGroupA = (r.subGroup || "").toLowerCase().includes("a");
                              const isGroupB = (r.subGroup || "").toLowerCase().includes("b");
                              const currentSlots = (r.timeSlots && r.timeSlots.length > 0) ? r.timeSlots : getBatchDefaultSlots(r.batchName);
                              const slotsCount = currentSlots.length;

                              return (
                                <div
                                  key={rIdx}
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center justify-between gap-1 truncate border ${
                                    r.isBlocked
                                      ? "bg-rose-100 text-rose-800 border-rose-200"
                                      : !isMulti
                                      ? "bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800"
                                      : isGroupA
                                      ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                                      : isGroupB
                                      ? "bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                                      : "bg-amber-50 text-amber-800 border-amber-200"
                                  }`}
                                >
                                  <div className="flex items-center gap-1 truncate">
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                        r.isBlocked
                                          ? "bg-rose-500"
                                          : !isMulti
                                          ? "bg-sky-500"
                                          : isGroupA
                                          ? "bg-emerald-500"
                                          : isGroupB
                                          ? "bg-purple-500"
                                          : "bg-amber-500"
                                      }`}
                                    />
                                    <span className="truncate">{r.batchName}</span>
                                    {isMulti && r.subGroup && (
                                      <span className="font-semibold text-[8.5px] opacity-85">
                                        ({r.subGroup.replace(/^group\s+/i, "")})
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[8px] font-mono text-muted-foreground shrink-0 font-normal">
                                    {slotsCount}s
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Schedule View Mode B: Interactive Flat Table Grid */
              <div className="rounded-lg border bg-card overflow-hidden shadow-2xs">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-[140px] text-xs font-bold">Date</TableHead>
                      <TableHead className="w-[100px] text-xs font-bold">Day</TableHead>
                      <TableHead className="w-[160px] text-xs font-bold">Batch Name</TableHead>
                      <TableHead className="w-[150px] text-xs font-bold">Session Type</TableHead>
                      <TableHead className="w-[130px] text-xs font-bold">Sub-Group</TableHead>
                      <TableHead className="w-[190px] text-xs font-bold">Time Slots</TableHead>
                      <TableHead className="w-[90px] text-xs font-bold text-center">Blocked?</TableHead>
                      <TableHead className="w-[50px] text-xs font-bold text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeGridRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center text-xs text-muted-foreground">
                          No timeline rows defined yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      activeGridRows.slice(0, 100).map((row) => {
                        const currentSlots = row.timeSlots || getBatchDefaultSlots(row.batchName);

                        return (
                          <TableRow key={row.id} className={`text-xs ${row.isBlocked ? "bg-rose-500/5" : ""}`}>
                            <TableCell className="p-2">
                              <Input
                                type="date"
                                value={row.date}
                                onChange={(e) => {
                                  const d = e.target.value;
                                  handleUpdateRow(row.id, { date: d, dayName: getDayNameFromDate(d) });
                                }}
                                className="h-7 text-xs font-mono bg-background"
                              />
                            </TableCell>
                            <TableCell className="p-2 text-muted-foreground font-medium">
                              {row.dayName || getDayNameFromDate(row.date)}
                            </TableCell>
                            <TableCell className="p-2">
                              <Input
                                value={row.batchName}
                                onChange={(e) => handleUpdateRow(row.id, { batchName: e.target.value })}
                                className="h-7 text-xs bg-background"
                              />
                            </TableCell>
                            <TableCell className="p-2">
                              <Select
                                value={row.sessionType}
                                onValueChange={(v: "SG" | "Multi") =>
                                  handleUpdateRow(row.id, {
                                    sessionType: v,
                                    subGroup: v === "SG" ? "" : row.subGroup || "Group A",
                                  })
                                }
                              >
                                <SelectTrigger className="h-7 text-xs bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="SG">SG (Single)</SelectItem>
                                  <SelectItem value="Multi">Multi-Session</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="p-2">
                              {row.sessionType === "Multi" ? (
                                <Input
                                  value={row.subGroup}
                                  placeholder="e.g. Group A"
                                  onChange={(e) => handleUpdateRow(row.id, { subGroup: e.target.value })}
                                  className="h-7 text-xs bg-background"
                                />
                              ) : (
                                <span className="text-muted-foreground italic text-[11px]">—</span>
                              )}
                            </TableCell>
                            <TableCell className="p-2">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-[11px] px-2 gap-1.5 justify-start font-mono max-w-[190px] truncate bg-background"
                                  >
                                    <Clock className="h-3 w-3 text-primary shrink-0" />
                                    <span className="truncate">
                                      {currentSlots.join(", ")}
                                    </span>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-3 space-y-2" align="start">
                                  <div className="flex items-center justify-between pb-1 border-b">
                                    <span className="text-xs font-semibold">Time Slots ({row.batchName})</span>
                                    <span className="text-[10px] text-muted-foreground font-mono">{row.date}</span>
                                  </div>
                                  <TimelineTimeSlotEditor
                                    value={currentSlots}
                                    onChange={(newSlots) => {
                                      handleUpdateRow(row.id, { timeSlots: newSlots });
                                    }}
                                  />
                                </PopoverContent>
                              </Popover>
                            </TableCell>
                            <TableCell className="p-2 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <Switch
                                  checked={row.isBlocked}
                                  onCheckedChange={(val) => handleUpdateRow(row.id, { isBlocked: val, isOffline: val })}
                                />
                                {row.isBlocked && (
                                  <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 bg-rose-600">
                                    Blocked
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="p-2 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDeleteRow(row.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {activeGridRows.length > 100 && scheduleViewMode === "table" && (
              <p className="text-[11px] text-muted-foreground text-center">
                Showing first 100 rows ({activeGridRows.length} total rows will be saved).
              </p>
            )}
          </div>
        </ScrollArea>

        {/* Selected Date Session Edit Dialog */}
        {editingDate && (
          <Dialog open={Boolean(editingDate)} onOpenChange={(o) => !o && setEditingDate(null)}>
            <DialogContent className="max-w-xl p-0 overflow-hidden">
              <DialogHeader className="p-4 pb-3 border-b bg-card">
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle className="text-sm font-bold flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4 text-primary" />
                      {new Date(`${editingDate}T00:00:00`).toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground font-mono mt-0.5">
                      {editingDate} ({getDayNameFromDate(editingDate)})
                    </DialogDescription>
                  </div>
                  <Badge variant={isEditingDateBlocked ? "destructive" : "secondary"} className="text-xs">
                    {isEditingDateBlocked ? "⛔ Blocked Day" : `${editingDateRows.length} Session(s)`}
                  </Badge>
                </div>
              </DialogHeader>

              <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                {/* Blocked Day Toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold">Blocked Day (No Sessions)</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Toggle if this date is a holiday or blocked off for all batches
                    </p>
                  </div>
                  <Switch
                    checked={isEditingDateBlocked}
                    onCheckedChange={() => handleToggleDateBlocked(editingDate, isEditingDateBlocked)}
                  />
                </div>

                {/* Session List on this Day */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Scheduled Batch Sessions ({editingDateRows.length})
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => handleAddSessionForDate(editingDate)}
                    >
                      <Plus className="h-3 w-3" /> Add Session
                    </Button>
                  </div>

                  {editingDateRows.length === 0 ? (
                    <div className="p-6 text-center border rounded-lg bg-muted/10 space-y-2">
                      <p className="text-xs text-muted-foreground">No sessions scheduled for this date.</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => handleAddSessionForDate(editingDate)}
                      >
                        <Plus className="h-3 w-3" /> Schedule Session on {editingDate}
                      </Button>
                    </div>
                  ) : (
                    editingDateRows.map((r, idx) => {
                      const currentSlots = r.timeSlots || getBatchDefaultSlots(r.batchName);

                      return (
                        <div key={r.id} className="p-3.5 border rounded-lg bg-card space-y-3 shadow-2xs">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                              <Badge variant="outline" className="text-[10px] font-mono">#{idx + 1}</Badge>
                              {r.batchName} {r.sessionType === "Multi" && r.subGroup ? `(${r.subGroup})` : ""}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteRow(r.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground font-medium">Batch Name</Label>
                              <Input
                                value={r.batchName}
                                onChange={(e) => handleUpdateRow(r.id, { batchName: e.target.value })}
                                className="h-7 text-xs bg-background"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground font-medium">Session Type</Label>
                              <Select
                                value={r.sessionType}
                                onValueChange={(v: "SG" | "Multi") =>
                                  handleUpdateRow(r.id, {
                                    sessionType: v,
                                    subGroup: v === "SG" ? "" : r.subGroup || "Group A",
                                  })
                                }
                              >
                                <SelectTrigger className="h-7 text-xs bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="SG">Single Group (SG)</SelectItem>
                                  <SelectItem value="Multi">Multi-Session (Mega Group)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {r.sessionType === "Multi" && (
                              <div className="space-y-1 sm:col-span-2">
                                <Label className="text-[10px] text-muted-foreground font-medium">Sub-Group / Mega Cohort</Label>
                                <Input
                                  value={r.subGroup}
                                  placeholder="e.g. Group A"
                                  onChange={(e) => handleUpdateRow(r.id, { subGroup: e.target.value })}
                                  className="h-7 text-xs bg-background"
                                />
                              </div>
                            )}

                            {/* Per-Day Time Slot Override */}
                            <div className="space-y-1 sm:col-span-2 pt-1 border-t">
                              <Label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                                <Clock className="h-3 w-3 text-primary" />
                                Time Slots for this Session ({currentSlots.length} slots)
                              </Label>
                              <TimelineTimeSlotEditor
                                value={currentSlots}
                                onChange={(newSlots) => {
                                  handleUpdateRow(r.id, { timeSlots: newSlots });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="p-3 border-t bg-card flex justify-end">
                <Button size="sm" onClick={() => setEditingDate(null)} className="h-8 text-xs">
                  Done
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        <DialogFooter className="p-4 border-t bg-card flex items-center justify-between sm:justify-between">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {parsedTimeline.batches.length} Batch(es)
            </Badge>
            <span>•</span>
            <span className="font-mono">
              {parsedTimeline.startDate || "—"} $\rightarrow$ {parsedTimeline.endDate || "—"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || parsing || activeGridRows.length === 0}
              onClick={handleSaveProject}
              className="gap-1.5"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Saving Project...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Create Project & Batches
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
