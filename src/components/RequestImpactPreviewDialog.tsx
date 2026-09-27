import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  FlaskConical,
  RefreshCw,
  X,
  Check,
  Building2,
  Users,
  AlertCircle,
  Info,
  Sparkles,
  MapPin,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchProjectStudentRoster,
  fetchBatchAllocationOutput,
  createStudentFileFromRecords,
  isStudentActive,
  type ResolutionRequest,
} from "@/lib/batch-allocation-storage";
import {
  fetchBatchGroupClassifications,
  fetchBatchGroupSettings,
} from "@/lib/batch-group-classification-storage";
import {
  runLabAllocationApi,
  type AllocationPreferences,
  type AllocationResultPayload,
} from "@/lib/allocation-client";
import { formatGradeLevel, sortGradeLevels } from "@/lib/project-grade-levels";

export interface RequestImpactPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ResolutionRequest | null;
  batchName?: string;
  projectName?: string;
  onRequestApprove?: (req: ResolutionRequest) => void;
  onRequestReject?: (req: ResolutionRequest) => void;
  canApprove?: boolean;
}

async function fetchActiveDatabaseLabs(): Promise<Array<{ "Lab ID": string; Area: string; "Lab Capacity": number }>> {
  try {
    const { data, error } = await supabase
      .from("labs")
      .select("lab_code, area, capacity, is_active")
      .eq("is_active", true);

    if (!error && data && data.length > 0) {
      return data
        .filter((l) => l.lab_code && l.area && l.capacity)
        .map((l) => ({
          "Lab ID": l.lab_code!,
          Area: l.area!,
          "Lab Capacity": Number(l.capacity),
        }));
    }
  } catch (err) {
    console.warn("Failed to fetch database labs for preview:", err);
  }
  return [];
}

async function fetchBatchTimeSlots(batchId: string): Promise<string[] | undefined> {
  try {
    const { data } = await supabase
      .from("batches")
      .select("time_slots")
      .eq("id", batchId)
      .maybeSingle();

    if (data?.time_slots && Array.isArray(data.time_slots) && data.time_slots.length > 0) {
      return data.time_slots;
    }
  } catch (err) {
    console.warn("Failed to fetch batch time slots for preview:", err);
  }
  return undefined;
}

export function RequestImpactPreviewDialog({
  open,
  onOpenChange,
  request,
  batchName,
  projectName,
  onRequestApprove,
  onRequestReject,
  canApprove = false,
}: RequestImpactPreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<AllocationResultPayload | null>(null);
  const [baselineSummary, setBaselineSummary] = useState<{
    assigned: number;
    unassigned: number;
    areaGradeUnassigned: Map<string, number>;
  }>({
    assigned: 0,
    unassigned: 0,
    areaGradeUnassigned: new Map(),
  });

  useEffect(() => {
    if (!open || !request) {
      setPreviewResult(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    async function runPreviewSimulation() {
      try {
        if (!request) return;
        const targetBatchId = request.batch_id;

        // 1. Fetch the canonical project roster; the request remains batch-specific.
        let projectId = request.project_id || null;
        if (!projectId) {
          const { data: batchRecord, error: batchError } = await supabase
            .from("batches")
            .select("project_id")
            .eq("id", targetBatchId)
            .maybeSingle();
          if (batchError) throw batchError;
          projectId = batchRecord?.project_id || null;
        }
        const upload = projectId ? await fetchProjectStudentRoster(projectId) : null;
        if (!upload || !upload.students || upload.students.length === 0) {
          throw new Error("No student records found in the project roster to run simulation.");
        }

        const activeStudents = upload.students.filter(isStudentActive);
        if (activeStudents.length === 0) {
          throw new Error("All students in this project roster are marked as dropped/inactive.");
        }
        const studentFile = createStudentFileFromRecords(activeStudents, upload.file_name || "students.xlsx", true);
        const activeGrades = sortGradeLevels(activeStudents.map((student) => Number(student.Grade)).filter(Number.isFinite));

        // 2. Fetch active labs, custom slots, and group settings
        const [dbLabs, batchSlots, groupSettings, existingOutput] = await Promise.all([
          fetchActiveDatabaseLabs(),
          fetchBatchTimeSlots(targetBatchId),
          fetchBatchGroupSettings(targetBatchId),
          fetchBatchAllocationOutput(targetBatchId),
        ]);

        // 3. Establish live baseline numbers
        let baseAssigned = existingOutput?.summary?.assigned_count ?? 0;
        let baseUnassigned = existingOutput?.summary?.unassigned_count ?? (activeStudents.length - baseAssigned);
        const baseAreaGradeMap = new Map<string, number>();

        if (existingOutput?.area_grade_summary) {
          existingOutput.area_grade_summary.forEach((r) => {
            baseAreaGradeMap.set(`${r["Physical Area"]}__${r.Grade}`, r.Unassigned ?? 0);
          });
        } else if (existingOutput?.dashboard_summary) {
          existingOutput.dashboard_summary.forEach((r) => {
            const area = r["Physical Area"];
            activeGrades.forEach((g) => {
              const u = Number(r[`G${g} Unassigned`]) || 0;
              baseAreaGradeMap.set(`${area}__${g}`, u);
            });
          });
        }

        // If no existing baseline output found, run solver once with clean prefs to get true baseline
        if (!existingOutput || !existingOutput.summary) {
          const cleanPrefs: AllocationPreferences = {
            overfillRules: [],
            preferredLabRules: [],
            extraLabs: [],
            batchGroupType: groupSettings.batch_group_type,
            defaultRepeatCount: groupSettings.default_repeat_count,
            customSlots: batchSlots,
            groupClassifications: (groupSettings.classifications || []).map((c) => ({
              group_id: c.group_id,
              visit_type: c.visit_type,
              repeat_count: c.repeat_count,
              area: c.area,
              grade: c.grade,
              lab_id: c.lab_id,
            })),
          };
          const baseRun = await runLabAllocationApi({
            studentFile,
            labFile: null,
            useDbLabs: true,
            labsJson: dbLabs,
            program: "CUSTOM",
            prefix: "Physical-DS-G",
            preferences: cleanPrefs,
          });
          baseAssigned = baseRun.summary.assigned_count;
          baseUnassigned = baseRun.summary.unassigned_count;
          baseRun.area_grade_summary?.forEach((r) => {
            baseAreaGradeMap.set(`${r["Physical Area"]}__${r.Grade}`, r.Unassigned ?? 0);
          });
        }

        if (!isMounted) return;
        setBaselineSummary({
          assigned: baseAssigned,
          unassigned: baseUnassigned,
          areaGradeUnassigned: baseAreaGradeMap,
        });

        // 4. Construct candidate preferences scoped specifically to this request
        const targetArea = request.area || "";
        const targetGrades = request.grades && request.grades.length > 0 ? request.grades : activeGrades;

        const simPrefs: AllocationPreferences = {
          overfillRules:
            request.type === "overfill"
              ? [
                  {
                    area: targetArea,
                    grades: targetGrades,
                    labIds: request.lab_id && request.lab_id !== "ALL" ? [request.lab_id] : ["ALL"],
                    maxOverfillPerLab: Number(request.max_overfill_per_lab || 2),
                  },
                ]
              : [],
          preferredLabRules: [],
          extraLabs:
            request.type === "new_lab"
              ? [
                  {
                    area: targetArea,
                    labId: request.lab_id || `NEW-LAB-${targetArea}`,
                    capacity: Number(request.requested_capacity || 25),
                    slots: [1, 2, 3, 4, 5, 6, 7],
                  },
                ]
              : [],
          batchGroupType: groupSettings.batch_group_type,
          defaultRepeatCount: groupSettings.default_repeat_count,
          customSlots: batchSlots,
          groupClassifications: (groupSettings.classifications || []).map((c) => ({
            group_id: c.group_id,
            visit_type: c.visit_type,
            repeat_count: c.repeat_count,
            area: c.area,
            grade: c.grade,
            lab_id: c.lab_id,
          })),
        };

        // 5. Run solver calculation in-memory with ZERO persistence
        const result = await runLabAllocationApi({
          studentFile,
          labFile: null,
          useDbLabs: true,
          labsJson: dbLabs,
          program: "CUSTOM",
          prefix: "Physical-DS-G",
          preferences: simPrefs,
        });

        if (!isMounted) return;
        setPreviewResult(result);
      } catch (err: any) {
        if (!isMounted) return;
        console.error("Preview simulation failed:", err);
        setError(err.message || "Failed to calculate simulation impact.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void runPreviewSimulation();

    return () => {
      isMounted = false;
    };
  }, [open, request]);

  // Derived metrics
  const simMetrics = useMemo(() => {
    if (!previewResult || !request) return null;

    const simAssigned = previewResult.summary.assigned_count;
    const simUnassigned = previewResult.summary.unassigned_count;
    const deltaAssigned = Math.max(0, simAssigned - baselineSummary.assigned);
    const deltaUnassigned = Math.max(0, baselineSummary.unassigned - simUnassigned);

    const targetArea = request.area || "";
    const grades = sortGradeLevels([
      ...(request.grades ?? []),
      ...previewResult.area_grade_summary
        .filter((row) => row["Physical Area"] === targetArea)
        .map((row) => Number(row.Grade))
        .filter(Number.isFinite),
    ]);

    let baseAreaUnassigned = 0;
    let simAreaUnassigned = 0;

    grades.forEach((g) => {
      const baseVal = baselineSummary.areaGradeUnassigned.get(`${targetArea}__${g}`) ?? 0;
      baseAreaUnassigned += baseVal;

      const simRow = previewResult.area_grade_summary?.find(
        (r) => r["Physical Area"] === targetArea && Number(r.Grade) === g
      );
      simAreaUnassigned += simRow?.Unassigned ?? 0;
    });

    const areaUnassignedDelta = Math.max(0, baseAreaUnassigned - simAreaUnassigned);

    const gradeBreakdown = grades.map((g) => {
      const baseVal = baselineSummary.areaGradeUnassigned.get(`${targetArea}__${g}`) ?? 0;
      const simRow = previewResult.area_grade_summary?.find(
        (r) => r["Physical Area"] === targetArea && Number(r.Grade) === g
      );
      const simVal = simRow?.Unassigned ?? 0;
      const seated = Math.max(0, baseVal - simVal);
      return {
        grade: g,
        baseUnassigned: baseVal,
        simUnassigned: simVal,
        seated,
      };
    });

    return {
      simAssigned,
      simUnassigned,
      deltaAssigned,
      deltaUnassigned,
      baseAreaUnassigned,
      simAreaUnassigned,
      areaUnassignedDelta,
      gradeBreakdown,
      overfillCount: previewResult.summary.overfill_count ?? 0,
      overfilledSessions: previewResult.summary.overfilled_sessions_count ?? 0,
    };
  }, [previewResult, baselineSummary, request]);

  if (!request) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
                <FlaskConical className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg font-bold">
                    Preview Impact Simulation
                  </DialogTitle>
                  <Badge className="bg-amber-500 text-amber-950 font-extrabold text-[10px] uppercase tracking-wide px-2 py-0.5 shadow-xs gap-1">
                    Preview — Not Saved
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Read-only dry-run simulation for{" "}
                  <strong>
                    {request.type === "overfill"
                      ? `Fair Overfill (+${request.max_overfill_per_lab || 2}/lab)`
                      : request.type === "new_lab"
                      ? `New Lab Venue (+${request.requested_capacity || 25} seats)`
                      : "Customer Service Outreach"}
                  </strong>{" "}
                  in <strong>{request.area}</strong> (Batch: {batchName || request.batch_id})
                </DialogDescription>
              </div>
            </div>
            {loading && (
              <Badge variant="secondary" className="animate-pulse flex items-center gap-1 text-xs">
                <RefreshCw className="h-3 w-3 animate-spin text-amber-600" /> Simulating...
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="h-8 w-8 animate-spin text-amber-500" />
              <p className="text-sm font-semibold text-foreground">
                Running Mixed-Integer Linear Program Simulation...
              </p>
              <p className="text-xs text-muted-foreground">
                Simulating student allocation under the requested capacity override (0 persistence).
              </p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <AlertCircle className="h-4 w-4" /> Simulation Error
              </div>
              <p className="text-xs">{error}</p>
            </div>
          ) : simMetrics ? (
            <div className="space-y-3.5">
              {/* Top 4 Comparison Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {/* 1. Assigned Students */}
                <Card className="border shadow-none bg-background/80">
                  <CardContent className="p-3 space-y-1">
                    <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                      Assigned Students
                    </div>
                    <div className="text-base font-bold text-foreground flex items-baseline gap-1.5 flex-wrap">
                      <span>{simMetrics.simAssigned.toLocaleString()}</span>
                      {simMetrics.deltaAssigned > 0 && (
                        <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                          (+{simMetrics.deltaAssigned} seated!)
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Baseline: {baselineSummary.assigned.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>

                {/* 2. Unassigned Remaining */}
                <Card className="border shadow-none bg-background/80">
                  <CardContent className="p-3 space-y-1">
                    <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                      Unassigned Remaining
                    </div>
                    <div className="text-base font-bold text-foreground flex items-baseline gap-1.5 flex-wrap">
                      <span>{simMetrics.simUnassigned.toLocaleString()}</span>
                      {simMetrics.deltaUnassigned > 0 && (
                        <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                          (-{simMetrics.deltaUnassigned})
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Baseline: {baselineSummary.unassigned.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>

                {/* 3. Extra Placed Seats */}
                <Card className="border shadow-none bg-background/80">
                  <CardContent className="p-3 space-y-1">
                    <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                      {request.type === "overfill" ? "Overfill Seats" : "Extra Capacity"}
                    </div>
                    <div className="text-base font-bold text-amber-600 dark:text-amber-400">
                      +{simMetrics.overfillCount || (request.type === "new_lab" ? request.requested_capacity || 25 : 0)} seats
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {request.type === "overfill"
                        ? `${simMetrics.overfilledSessions} sessions boosted`
                        : `${request.area} new venue`}
                    </div>
                  </CardContent>
                </Card>

                {/* 4. Target Area Shortfall */}
                <Card className="border shadow-none bg-background/80">
                  <CardContent className="p-3 space-y-1">
                    <div className="text-[10px] uppercase font-semibold text-muted-foreground truncate" title={`${request.area} Shortfall`}>
                      {request.area} Shortfall
                    </div>
                    <div className="text-base font-bold text-foreground flex items-baseline gap-1 flex-wrap">
                      <span>{simMetrics.simAreaUnassigned}</span>
                      {simMetrics.areaUnassignedDelta > 0 && (
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          (-{simMetrics.areaUnassignedDelta} seated)
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Baseline: {simMetrics.baseAreaUnassigned} unassigned
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Per-Grade Breakdown */}
              <div className="p-3.5 rounded-xl border bg-muted/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    Area Impact Breakdown: {request.area}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    Solver Optimization Result
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  {simMetrics.gradeBreakdown.map((g) => (
                    <div key={g.grade} className="p-2.5 rounded-lg bg-background border space-y-1">
                      <div className="font-bold text-xs text-foreground">{formatGradeLevel(g.grade)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Unassigned: <span className="line-through opacity-70">{g.baseUnassigned}</span> →{" "}
                        <strong className="text-foreground">{g.simUnassigned}</strong>
                      </div>
                      {g.seated > 0 ? (
                        <Badge variant="outline" className="text-[10px] font-bold text-emerald-600 bg-emerald-500/10 border-emerald-500/30">
                          +{g.seated} seated
                        </Badge>
                      ) : (
                        <div className="text-[10px] text-muted-foreground">0 change</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Zero-Persistence Guarantee Banner */}
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2">
                <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Zero-Persistence Guarantee:</strong> This calculation is an isolated, in-memory dry-run. No changes have been saved to the database, no audit log entries were created, and the ticket remains in <strong>pending</strong> state.
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <DialogFooter className="pt-3 border-t flex items-center justify-between gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Close Preview
          </Button>

          {canApprove && request.status === "pending" && (
            <div className="flex items-center gap-2">
              {onRequestReject && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs text-rose-600 border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  onClick={() => {
                    onRequestReject(request);
                    onOpenChange(false);
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Reject Request
                </Button>
              )}
              {onRequestApprove && (
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 text-xs font-bold gap-1 bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs"
                  onClick={() => {
                    onRequestApprove(request);
                    onOpenChange(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" /> Approve Request
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
