import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  fetchBatchAllocationOutput,
  fetchProjectStudentRoster,
  convertStudentsToCsv,
  formatRevocationDateTime,
  type AllocationResultPayload,
  type BatchAllocationOutputRecord,
  type BatchStudentUploadRecord,
} from "@/lib/batch-allocation-storage";
import {
  generateMigrationWorkbook,
  generateSlotId,
} from "@/lib/exports/migration-workbook-generator";
import { isProjectSoftDeleted } from "@/lib/audit-logging";
import { formatGradeLevel } from "@/lib/project-grade-levels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { BrandIcon } from "@/components/BrandIcon";
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileSpreadsheet,
  FolderKanban,
  Layers,
  MapPin,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/exports")({
  component: MasterExportsPage,
});

type Project = Tables<"projects">;
type Batch = Tables<"batches">;
type Lab = Tables<"labs">;

import type { SlotIdTemplate } from "@/lib/allocation-client";

function MasterExportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter selections
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [slotTemplate, setSlotTemplate] = useState<SlotIdTemplate>("original");
  const [slotStartInteger, setSlotStartInteger] = useState<number>(14000);

  // Loaded allocation data for selected batch
  const [allocationOutput, setAllocationOutput] = useState<AllocationResultPayload | null>(null);
  const [studentUpload, setStudentUpload] = useState<BatchStudentUploadRecord | null>(null);
  const [loadingBatchData, setLoadingBatchData] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Active preview tab
  const [activeTab, setActiveTab] = useState("sessions");

  // Load all initial projects and labs
  useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    setLoading(true);
    try {
      const [projRes, labsRes] = await Promise.all([
        supabase.from("projects").select("*").order("created_at", { ascending: false }),
        supabase.from("labs").select("*").eq("is_active", true),
      ]);

      if (projRes.error) toast.error(projRes.error.message);
      const rawProjList = (projRes.data ?? []) as Project[];
      const projList = rawProjList.filter((p) => !isProjectSoftDeleted(p));
      setProjects(projList);

      const labList = (labsRes.data ?? []) as Lab[];
      setLabs(labList);

      if (projList.length > 0) {
        setSelectedProjectId(projList[0].id);
      }
    } catch (err: any) {
      toast.error("Failed to load export data: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  }

  // When project changes, fetch batches
  useEffect(() => {
    if (!selectedProjectId) {
      setBatches([]);
      setSelectedBatchId("");
      return;
    }

    async function loadBatches() {
      const { data, error } = await supabase
        .from("batches")
        .select("*")
        .eq("project_id", selectedProjectId)
        .order("created_at", { ascending: true });

      if (error) {
        toast.error("Failed to load batches: " + error.message);
        setBatches([]);
        setSelectedBatchId("");
        return;
      }

      const batchList = (data ?? []) as Batch[];
      setBatches(batchList);
      if (batchList.length > 0) {
        setSelectedBatchId(batchList[0].id);
      } else {
        setSelectedBatchId("");
      }
    }

    void loadBatches();
  }, [selectedProjectId]);

  // When batch changes, fetch allocation output and student upload records
  useEffect(() => {
    if (!selectedBatchId) {
      setAllocationOutput(null);
      setStudentUpload(null);
      return;
    }

    async function loadBatchData() {
      setLoadingBatchData(true);
      try {
        const [allocRecord, studentRecord] = await Promise.all([
          fetchBatchAllocationOutput(selectedBatchId),
          fetchProjectStudentRoster(selectedProjectId),
        ]);

        setAllocationOutput(allocRecord || null);
        setStudentUpload(studentRecord);
      } catch (err: any) {
        toast.error("Failed to load batch data: " + (err.message || "Unknown error"));
        setAllocationOutput(null);
        setStudentUpload(null);
      } finally {
        setLoadingBatchData(false);
      }
    }

    void loadBatchData();
  }, [selectedBatchId, selectedProjectId]);

  // Selected entities
  const activeProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );
  const activeBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId),
    [batches, selectedBatchId]
  );

  // Generate 7-Sheet Migration Workbook in memory
  const workbook = useMemo(() => {
    if (!activeProject || !activeBatch) return null;

    try {
      const wb = generateMigrationWorkbook({
        project: activeProject,
        batch: activeBatch,
        allocationData: allocationOutput,
        students: studentUpload?.students ?? [],
        labs,
        slotIdTemplate: slotTemplate,
        slotIdStartInteger: slotStartInteger,
      });
      return wb;
    } catch (err) {
      console.error("Failed to generate migration workbook:", err);
      return null;
    }
  }, [activeProject, activeBatch, allocationOutput, studentUpload, labs, slotTemplate, slotStartInteger]);

  // Sheet previews parsed for UI inspection
  const sheetPreviews = useMemo(() => {
    if (!workbook) return null;

    const getSheetData = (sheetName: string) => {
      const ws = workbook.Sheets[sheetName] || workbook.Sheets[sheetName.slice(0, 31)];
      if (!ws) return { headers: [], rows: [] };
      const rawJson = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
      const headers = rawJson.length > 0 ? Object.keys(rawJson[0]) : [];
      const rows = rawJson.map((r) => headers.map((h) => r[h]));
      return { headers, rows };
    };

    return {
      sessions: getSheetData("Sessions"),
      demoDay: getSheetData("Demo Day Sessions"),
      onlineGroups: getSheetData("Online Groups Migration Sheet"),
      offlineStudents: getSheetData("Offline Students Migration Sheet"),
      onlineStudents: getSheetData("VP Session Students") || getSheetData("Student Online Migration") || getSheetData("Online Students Migration Sheet"),
      slotId: getSheetData("Slot ID"),
      location: getSheetData("Location"),
      govSummary: getSheetData("Governorate VP Summary"),
    };
  }, [workbook]);

  // Summary counts
  const stats = useMemo(() => {
    const assigned = allocationOutput?.summary?.assigned_count || 0;
    const unassigned = allocationOutput?.summary?.unassigned_count || 0;
    const total = allocationOutput?.summary?.total_students || assigned + unassigned;
    const matchRate = total > 0 ? `${((assigned / total) * 100).toFixed(1)}%` : "0.0%";
    const sessionCount = sheetPreviews?.sessions?.rows?.length || 0;
    const slotCount = sheetPreviews?.slotId?.rows?.length || 0;
    const locCount = sheetPreviews?.location?.rows?.length || labs.length;

    return { assigned, unassigned, matchRate, sessionCount, slotCount, locCount };
  }, [allocationOutput, sheetPreviews, labs]);

  // Download Handler
  const handleDownloadWorkbook = () => {
    if (!workbook || !activeProject || !activeBatch) {
      toast.error("No workbook available for download.");
      return;
    }

    setExporting(true);
    try {
      const projectCode = activeProject.code || "PROJECT";
      const sanitizedProject = projectCode.replace(/[^a-zA-Z0-9_-]/g, "_");
      const sanitizedBatch = activeBatch.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = `${sanitizedProject}_${sanitizedBatch}_Migration_Workbook.xlsx`;

      XLSX.writeFile(workbook, fileName);
      toast.success(`Exported master migration workbook "${fileName}" with all 8 sheets!`);
    } catch (err: any) {
      toast.error("Failed to export workbook: " + (err.message || "Unknown error"));
    } finally {
      setExporting(false);
    }
  };

  // Download Student Roster with Revocation Timestamps
  const handleDownloadStudentRoster = (format: "csv" | "xlsx" = "csv") => {
    if (!studentUpload?.students || studentUpload.students.length === 0) {
      toast.error("No student records found for the selected batch.");
      return;
    }

    const projectCode = activeProject?.code || "PROJECT";
    const batchName = activeBatch?.name || "BATCH";
    const sanitizedProject = projectCode.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sanitizedBatch = batchName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const baseName = `${sanitizedProject}_${sanitizedBatch}_Student_Roster`;

    if (format === "csv") {
      const csvContent = "\uFEFF" + convertStudentsToCsv(studentUpload.students, false, activeProject?.program);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${studentUpload.students.length} student records with revocation timestamps to CSV!`);
    } else {
      const rows = studentUpload.students.map((s) => {
        const isRevoked = s.Status === "Dropped Out" || (s as any).status === "Dropped Out";
        const rawRevoked = s.revoked_at || (s as any)["Revoked At"];
        const timeInfo = rawRevoked ? formatRevocationDateTime(String(rawRevoked)) : null;
        return {
          "Student ID": s.S_ID,
          "Grade / Level": formatGradeLevel(s.Grade, activeProject?.program),
          "Physical Area": s["Physical Area"],
          "Status": isRevoked ? "Revoked" : "Active",
          "Revoked At": timeInfo ? timeInfo.full : "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Student Roster");
      XLSX.writeFile(wb, `${baseName}.xlsx`);
      toast.success(`Exported ${studentUpload.students.length} student records with revocation timestamps to Excel (.xlsx)!`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br from-[#056FEC]/15 to-[#05ACFF]/15 text-[#056FEC] dark:text-[#05ACFF] shadow-xs shrink-0">
            <BrandIcon name="upload" size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-[#1F2A55] dark:text-[#F7FAFF]">
                Master Migration &amp; Operations Exports
              </h1>
              <Badge className="bg-[#056FEC] text-white font-semibold text-xs shadow-xs">
                8-Sheet Spec v2.0
              </Badge>
            </div>
            <p className="text-xs text-[#597587] dark:text-[#85A5B9] mt-0.5">
              Generate standardized migration workbooks for offline and online LMS synchronization with exact headers, deterministic Slot IDs, full location details, and complete VP cohort rosters.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadInitial()}
            className="h-8.5 text-xs gap-1.5 rounded-xl font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownloadStudentRoster("csv")}
            className="h-8.5 text-xs gap-1.5 rounded-xl font-semibold border-border/80"
          >
            <Download className="h-3.5 w-3.5 text-[#597587]" /> Download Student Roster (.csv)
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleDownloadWorkbook}
            disabled={exporting || !workbook}
            className="h-8.5 text-xs gap-1.5 rounded-xl font-bold bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {exporting ? "Generating..." : "Download Migration Workbook (.xlsx)"}
          </Button>
        </div>
      </div>

      {/* Control Panel / Filter Card */}
      <Card className="shadow-xs border-border/70">
        <CardHeader className="pb-3 pt-4 px-4 border-b border-border/60 bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-[#056FEC]" />
              <CardTitle className="text-sm font-bold text-foreground">Select Project &amp; Batch Dataset</CardTitle>
            </div>
            {loading && <Badge variant="outline" className="text-xs animate-pulse">Loading data...</Badge>}
          </div>
        </CardHeader>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 flex-1">
            <div className="space-y-1 min-w-[240px]">
              <Label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Building2 className="h-3.5 w-3.5 text-[#056FEC]" /> Target Project
              </Label>
              <Select
                value={selectedProjectId}
                onValueChange={setSelectedProjectId}
                disabled={projects.length === 0}
              >
                <SelectTrigger className="h-8.5 text-xs bg-background rounded-xl">
                  <SelectValue placeholder="Choose Project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 min-w-[240px]">
              <Label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Layers className="h-3.5 w-3.5 text-[#FF7F1C]" /> Target Batch
              </Label>
              <Select
                value={selectedBatchId}
                onValueChange={setSelectedBatchId}
                disabled={batches.length === 0}
              >
                <SelectTrigger className="h-8.5 text-xs bg-background rounded-xl">
                  <SelectValue placeholder={batches.length === 0 ? "No batches available" : "Choose Batch..."} />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[200px]">
              <Label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Clock className="h-3.5 w-3.5 text-[#043FAD] dark:text-[#05ACFF]" /> Slot ID Format (Max 6 Chars)
              </Label>
              <Select
                value={slotTemplate}
                onValueChange={(val) => setSlotTemplate(val as SlotIdTemplate)}
              >
                <SelectTrigger className="h-8.5 text-xs bg-background rounded-xl">
                  <SelectValue placeholder="Slot ID Template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="original">Keep Original (SLOT-LAB-DAY-TIME)</SelectItem>
                  <SelectItem value="template_a">Template A — Pure Integer (14000, 14001)</SelectItem>
                  <SelectItem value="template_b">Template B — Mixed (L556G4, L123G4)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {activeBatch && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground border-l pl-4 shrink-0">
              <Clock className="h-4 w-4 text-[#056FEC]" />
              <span>
                {activeBatch.dates?.length || 0} session dates · {activeBatch.time_slots?.length || 0} time slots
              </span>
              <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded border">
                batch_id: {activeBatch.id}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3 shadow-xs border-[#056FEC]/20 bg-[#056FEC]/5">
          <span className="text-[11px] font-semibold text-[#056FEC] flex items-center gap-1">
            <Users className="h-3.5 w-3.5 text-[#056FEC]" /> Assigned Students
          </span>
          <div className="text-lg font-bold text-foreground mt-1">
            {stats.assigned.toLocaleString()}
          </div>
        </Card>

        <Card className="p-3 shadow-xs border-[#FF7F1C]/20 bg-[#FF7F1C]/5">
          <span className="text-[11px] font-semibold text-[#FF7F1C] flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-[#FF7F1C]" /> Match Rate
          </span>
          <div className="text-lg font-bold text-[#FF7F1C] mt-1">
            {stats.matchRate}
          </div>
        </Card>

        <Card className="p-3 shadow-xs">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Users className="h-3.5 w-3.5 text-rose-500" /> Unassigned Shortfall
          </span>
          <div className="text-lg font-bold text-foreground mt-1">
            {stats.unassigned.toLocaleString()}
          </div>
        </Card>

        <Card className="p-3 shadow-xs">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 text-[#056FEC]" /> Unique Sessions
          </span>
          <div className="text-lg font-bold text-foreground mt-1">
            {stats.sessionCount.toLocaleString()}
          </div>
        </Card>

        <Card className="p-3 shadow-xs">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-[#043FAD] dark:text-[#05ACFF]" /> Unique Slot IDs
          </span>
          <div className="text-lg font-bold text-[#043FAD] dark:text-[#05ACFF] mt-1">
            {stats.slotCount.toLocaleString()}
          </div>
        </Card>

        <Card className="p-3 shadow-xs">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-[#0EAA3A]" /> Physical Locations
          </span>
          <div className="text-lg font-bold text-foreground mt-1">
            {stats.locCount.toLocaleString()}
          </div>
        </Card>
      </div>

      {/* 8-Sheet Tab Previewer */}
      <Card className="shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold">Workbook Structure &amp; Sheet Previews</CardTitle>
              <CardDescription className="text-xs">
                Inspect the 8 standardized migration sheets generated from your batch allocation dataset.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="font-mono text-xs font-semibold">
              8 Sheets Ready
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex flex-wrap items-center gap-1.5 h-auto p-1.5 bg-muted/40 rounded-xl">
              <TabsTrigger value="sessions" className="text-xs py-1.5 px-3 flex-1 min-w-[120px] rounded-lg font-semibold">
                1. Sessions ({sheetPreviews?.sessions?.rows?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="demoDay" className="text-xs py-1.5 px-3 flex-1 min-w-[120px] rounded-lg font-semibold">
                2. Demo Day ({sheetPreviews?.demoDay?.rows?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="onlineGroups" className="text-xs py-1.5 px-3 flex-1 min-w-[120px] rounded-lg font-semibold">
                3. Online Groups ({sheetPreviews?.onlineGroups?.rows?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="offlineStudents" className="text-xs py-1.5 px-3 flex-1 min-w-[130px] rounded-lg font-semibold">
                4. Offline Students ({sheetPreviews?.offlineStudents?.rows?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="onlineStudents" className="text-xs py-1.5 px-3 flex-1 min-w-[140px] rounded-lg font-semibold">
                5. VP Students ({sheetPreviews?.onlineStudents?.rows?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="slotId" className="text-xs py-1.5 px-3 flex-1 min-w-[100px] rounded-lg font-semibold">
                6. Slot ID ({sheetPreviews?.slotId?.rows?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="location" className="text-xs py-1.5 px-3 flex-1 min-w-[100px] rounded-lg font-semibold">
                7. Location ({sheetPreviews?.location?.rows?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="govSummary" className="text-xs py-1.5 px-3 flex-1 min-w-[140px] rounded-lg font-semibold">
                8. Gov VP Summary ({sheetPreviews?.govSummary?.rows?.length || 0})
              </TabsTrigger>
            </TabsList>

            {/* Sheet 1: Sessions */}
            <TabsContent value="sessions" className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  <strong>Sessions Sheet:</strong> Maps each distinct lab shift with generated Slot ID, capacity, and date.
                </span>
                <span className="font-mono text-[11px] text-[#056FEC] font-semibold">Tutor ID &amp; TA ID intentionally blank</span>
              </div>
              {renderPreviewTable(sheetPreviews?.sessions)}
            </TabsContent>

            {/* Sheet 2: Demo Day Sessions */}
            <TabsContent value="demoDay" className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  <strong>Demo Day Sessions:</strong> Culmination and presentation sessions scheduled on the batch final date.
                </span>
              </div>
              {renderPreviewTable(sheetPreviews?.demoDay)}
            </TabsContent>

            {/* Sheet 3: Online Groups Migration Sheet */}
            <TabsContent value="onlineGroups" className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  <strong>Online Groups Migration Sheet:</strong> Online group cohorts with tracks, governorates covered, student counts, occupancy %, and Slot IDs.
                </span>
              </div>
              {renderPreviewTable(sheetPreviews?.onlineGroups)}
            </TabsContent>

            {/* Sheet 4: Offline Students Migration Sheet */}
            <TabsContent value="offlineStudents" className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  <strong>Offline Students Migration Sheet:</strong> In-person student slot assignment descriptors and venue addresses.
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">Format: YYYY-MM-DD D Mon HH:MM (SLOT_ID)</span>
              </div>
              {renderPreviewTable(sheetPreviews?.offlineStudents)}
            </TabsContent>

            {/* Sheet 5: VP Session Students */}
            <TabsContent value="onlineStudents" className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  <strong>VP Session Students:</strong> Comprehensive online student roster with names, phone, email, governorates, tracks, and qualification audit details.
                </span>
              </div>
              {renderPreviewTable(sheetPreviews?.onlineStudents)}
            </TabsContent>

            {/* Sheet 6: Slot ID */}
            <TabsContent value="slotId" className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  <strong>Slot ID Dictionary:</strong> Canonical dictionary of all deterministic Slot IDs and durations.
                </span>
              </div>
              {renderPreviewTable(sheetPreviews?.slotId)}
            </TabsContent>

            {/* Sheet 7: Location */}
            <TabsContent value="location" className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  <strong>Location Sheet:</strong> Lab addresses, governorates, and Google Maps links.
                </span>
              </div>
              {renderPreviewTable(sheetPreviews?.location)}
            </TabsContent>

            {/* Sheet 8: Governorate VP Summary */}
            <TabsContent value="govSummary" className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  <strong>Governorate VP Summary:</strong> Governorate-level breakdown of total student demand, eligible VP headcount, accepted online migrations, and physical remaining seats.
                </span>
              </div>
              {renderPreviewTable(sheetPreviews?.govSummary)}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function renderPreviewTable(previewData?: { headers: any[]; rows: any[][] } | null) {
  if (!previewData || previewData.headers.length === 0) {
    return (
      <div className="p-8 text-center border rounded-lg bg-muted/10 text-xs text-muted-foreground">
        No records available to display for this sheet. Please select a batch with allocation data.
      </div>
    );
  }

  const { headers, rows } = previewData;
  if (rows.length === 0) {
    return (
      <div className="p-8 text-center border rounded-lg bg-muted/10 space-y-1">
        <div className="text-xs font-medium text-foreground">0 records found for this sheet</div>
        <div className="text-[11px] text-muted-foreground">
          This batch allocation does not contain any records for this specific sheet category.
        </div>
      </div>
    );
  }

  const previewRows = rows.slice(0, 15);

  return (
    <div className="border rounded-lg overflow-x-auto bg-card">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            {headers.map((h, i) => (
              <TableHead key={i} className="text-xs font-semibold whitespace-nowrap">
                {String(h)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {previewRows.map((row, rIdx) => (
            <TableRow key={rIdx} className="hover:bg-muted/30">
              {row.map((cell, cIdx) => (
                <TableCell key={cIdx} className="text-xs font-mono whitespace-nowrap">
                  {cell !== "" && cell !== undefined && cell !== null ? (
                    String(cell)
                  ) : (
                    <span className="text-muted-foreground/30 italic">—</span>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 15 && (
        <div className="p-2 text-center text-xs text-muted-foreground bg-muted/20 border-t">
          Showing first 15 of {rows.length.toLocaleString()} rows in preview. Full dataset included in download.
        </div>
      )}
    </div>
  );
}
