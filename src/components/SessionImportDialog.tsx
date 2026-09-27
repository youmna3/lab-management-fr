import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  formatScheduleDate,
  getAssignmentScheduleSummary,
  type AssignmentSession,
} from "@/lib/assignment-schedule";
import { formatEGP } from "@/lib/format";
import { normalizeTimeSlot } from "@/lib/time-slots";
import {
  buildSessionImportPreview,
  normalizeLabCode,
  type SessionImportResult,
} from "@/lib/session-import";
import { downloadCsv, parseSheetMatrix } from "@/lib/sheet";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

type ProjectContext = Pick<Tables<"projects">, "id" | "name" | "code">;
type BatchContext = Pick<
  Tables<"batches">,
  "id" | "name" | "project_id" | "dates" | "time_slots" | "expected_sessions_per_group"
>;
type Assignment = Tables<"assignments">;
type Lab = Tables<"labs">;

type SessionImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectContext;
  batch: BatchContext;
  onImported: () => void | Promise<void>;
};

export function SessionImportDialog({
  open,
  onOpenChange,
  project,
  batch,
  onImported,
}: SessionImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [preview, setPreview] = useState<SessionImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);

  const previewRows = useMemo(() => preview?.previewRows ?? [], [preview]);
  const previewCounts = useMemo(
    () => ({
      valid: previewRows.filter((row) => row.status === "Valid").length,
      warnings: previewRows.filter((row) => row.status === "Warning").length,
      errors: previewRows.filter((row) => row.status === "Error").length,
    }),
    [previewRows],
  );

  function reset() {
    setPreview(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  useEffect(() => {
    reset();
  }, [batch.id, importMode]);

  function setOpen(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  async function buildPreview(file: File) {
    setPreviewing(true);
    try {
      const matrix = await parseSheetMatrix(file);
      if (!matrix.length) throw new Error("The file has no rows.");

      const [assignmentResult, sessionResult, labResult] = await Promise.all([
        supabase.from("assignments").select("*").eq("batch_id", batch.id).neq("status", "denied"),
        supabase.from("assignment_sessions").select("*").eq("batch_id", batch.id),
        supabase.from("labs").select("*"),
      ]);

      if (assignmentResult.error) throw assignmentResult.error;
      if (sessionResult.error) throw sessionResult.error;
      if (labResult.error) throw labResult.error;

      const assignments = (assignmentResult.data ?? []) as Assignment[];
      const sessions = (sessionResult.data ?? []) as AssignmentSession[];
      const labs = (labResult.data ?? []) as Lab[];
      const sessionsByAssignment = new Map<string, AssignmentSession[]>();

      sessions.forEach((session) => {
        const rows = sessionsByAssignment.get(session.assignment_id) ?? [];
        rows.push(session);
        sessionsByAssignment.set(session.assignment_id, rows);
      });

      const labsById = new Map(labs.map((lab) => [lab.id, lab]));
      const labsByLabCode = new Map<
        string,
        { labId: string; labName: string; unitPrice: number }
      >();

      labs.forEach((lab) => {
        if (!lab.lab_code) return;
        labsByLabCode.set(normalizeLabCode(lab.lab_code), {
          labId: lab.id,
          labName: lab.name ?? lab.lab_code,
          unitPrice: Number(lab.session_price ?? 0),
        });
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
            currentSessions.map((session) => {
              const sessionTime = normalizeTimeSlot(session.session_time) ?? session.session_time;
              return `${session.session_date}|${sessionTime}`;
            }),
          ),
          labId: assignment.lab_id,
          labName: lab.name ?? lab.lab_code,
          unitPrice: Number(assignment.confirmed_price ?? lab.session_price ?? 0),
          currentSummary: getAssignmentScheduleSummary(assignment, batch, currentSessions),
        });
      });

      const nextPreview = buildSessionImportPreview(matrix, {
        batchId: batch.id,
        batchDates: Array.isArray(batch.dates) ? batch.dates : [],
        batchTimeSlots: Array.isArray(batch.time_slots) ? batch.time_slots : [],
        importMode,
        expectedSessionsPerGroup: batch.expected_sessions_per_group ?? null,
        assignmentsByLabCode,
        labsByLabCode,
      });

      setPreview(nextPreview);
      setFileName(file.name);
      toast.success(`Preview ready for ${file.name}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to build session import preview",
      );
    } finally {
      setPreviewing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function exportIssues() {
    if (!preview) return;
    const rows = preview.previewRows
      .filter((row) => row.issues.length > 0)
      .map((row) => ({
        "File Row": row.rowNumber,
        "Lab ID": row.labCode,
        "Matched Lab": row.matchedLabName,
        Status: row.status,
        "Scheduled Days": row.scheduledDays,
        "Sessions By Date": row.sessionsByDate
          .map((item) => `${formatScheduleDate(item.date)}: ${item.sessions}`)
          .join(" | "),
        "Total Sessions": row.totalSessions,
        "Current Price": row.currentCalculatedPrice,
        "New Price": row.newCalculatedPrice,
        Issues: row.issues
          .map((issue) => `${issue.level.toUpperCase()}: ${issue.message}`)
          .join(" | "),
      }));

    if (!rows.length) {
      toast.info("There are no warnings or errors to export.");
      return;
    }

    downloadCsv(`session-import-issues-${batch.name}.csv`, rows);
  }

  async function importValidRows() {
    if (!preview?.validRows.length) {
      toast.error("There are no valid rows to import.");
      return;
    }

    setImporting(true);
    try {
      const { error } = await supabase.rpc("import_assignment_sessions", {
        _batch_id: batch.id,
        _file_name: fileName || "session-import",
        _import_mode: importMode,
        _target_assignment_ids: preview.targetAssignmentIds,
        _sessions: preview.validSessions,
      });
      if (error) throw error;

      await onImported();
      toast.success(
        `Imported ${preview.validSessions.length} session(s) across ${preview.validRows.length} lab row(s).`,
      );
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import sessions");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Import Sessions
          </DialogTitle>
          <DialogDescription>
            Preview CSV or Excel sessions for the active project and batch, then import only valid
            rows.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(event) => event.target.files?.[0] && void buildPreview(event.target.files[0])}
        />

        <div className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_220px]">
          <div>
            <div className="text-xs font-semibold text-muted-foreground">Project</div>
            <div className="mt-1 font-semibold">{project.name}</div>
            <div className="text-xs text-muted-foreground">{project.code}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground">Selected batch</div>
            <div className="mt-1 font-semibold">{batch.name}</div>
            <div className="text-xs text-muted-foreground">
              {(batch.dates ?? []).map(formatScheduleDate).join(", ") || "No batch dates"}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Import mode</Label>
            <Select
              value={importMode}
              onValueChange={(value) => setImportMode(value as "merge" | "replace")}
            >
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">Merge only new sessions</SelectItem>
                <SelectItem value="replace">Replace schedules for labs in file</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div className="text-sm text-muted-foreground">
            Expected sessions/group: {batch.expected_sessions_per_group ?? "Validation disabled"}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={previewing}
            >
              <Upload className="mr-1 h-4 w-4" />
              {previewing
                ? "Building preview..."
                : fileName
                  ? "Choose another file"
                  : "Choose file"}
            </Button>
            {preview && (
              <Button type="button" variant="outline" size="sm" onClick={exportIssues}>
                <Download className="mr-1 h-4 w-4" /> Export issues
              </Button>
            )}
          </div>
        </div>

        {preview ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Preview rows", previewRows.length, "text-foreground"],
                ["Valid", previewCounts.valid, "text-emerald-600"],
                ["Warnings", previewCounts.warnings, "text-amber-600"],
                ["Errors", previewCounts.errors, "text-rose-600"],
              ].map(([label, value, color]) => (
                <Card key={String(label)}>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Lab ID</TableHead>
                    <TableHead>Matched lab / issues</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead>Sessions by date</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Current price</TableHead>
                    <TableHead className="text-right">New price</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row) => (
                    <TableRow key={`${row.rowNumber}-${row.normalizedLabCode || "blank"}`}>
                      <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                      <TableCell className="font-mono text-xs">{row.labCode || "—"}</TableCell>
                      <TableCell className="min-w-56">
                        <div className="font-medium" dir="auto">
                          {row.matchedLabName || "—"}
                        </div>
                        {row.issues.length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.issues
                              .map((issue) => `${issue.level.toUpperCase()}: ${issue.message}`)
                              .join(" | ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.scheduledDays}</TableCell>
                      <TableCell className="min-w-52 text-sm text-muted-foreground">
                        {row.sessionsByDate.length
                          ? row.sessionsByDate
                              .map((item) => `${formatScheduleDate(item.date)}: ${item.sessions}`)
                              .join(" | ")
                          : "No sessions"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.totalSessions}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatEGP(row.currentCalculatedPrice)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatEGP(row.newCalculatedPrice)}
                      </TableCell>
                      <TableCell>
                        {row.status === "Valid" && (
                          <Badge className="bg-emerald-600 text-white">Valid</Badge>
                        )}
                        {row.status === "Warning" && (
                          <Badge variant="outline" className="border-amber-400 text-amber-700">
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
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            Choose a file to build the preview. No database writes happen until you import valid
            rows.
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void importValidRows()}
            disabled={!preview?.validRows.length || importing}
          >
            {importing ? "Importing..." : "Import valid rows only"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
