import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchBatchGroupSettings,
  saveBatchGroupSettings,
  autoDetectBatchGroupClassifications,
  type GroupClassificationRecord,
  type BatchGroupType,
  type BatchGroupClassificationSettings,
} from "@/lib/batch-group-classification-storage";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  Filter,
  Layers,
  MoreHorizontal,
  RefreshCw,
  Repeat,
  Search,
  Sparkles,
  Users,
  Building2,
  Save,
  Sliders,
  Settings2,
} from "lucide-react";

export interface GroupClassificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchName?: string;
  projectId?: string | null;
  expectedSessionsPerGroup?: number | null;
  masterAllocation?: Array<any>;
  studentRecords?: Array<any>;
  scheduleSessions?: Array<any>;
  canEdit?: boolean;
  onClassificationsSaved?: (classifications: GroupClassificationRecord[]) => void;
  onApplyAndRerun?: (classifications: GroupClassificationRecord[], batchGroupType?: BatchGroupType, defaultRepeatCount?: number) => void;
}

export function GroupClassificationDialog({
  open,
  onOpenChange,
  batchId,
  batchName = "Current Batch",
  projectId,
  expectedSessionsPerGroup,
  masterAllocation,
  studentRecords,
  scheduleSessions,
  canEdit = true,
  onClassificationsSaved,
  onApplyAndRerun,
}: GroupClassificationDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const defaultRepeatCount = Number(expectedSessionsPerGroup) > 1 ? Math.trunc(Number(expectedSessionsPerGroup)) : 1;
  const batchGroupType: BatchGroupType = defaultRepeatCount > 1 ? "multi_session" : "single_session";
  const [classifications, setClassifications] = useState<GroupClassificationRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"all" | "single_visit" | "multi_visit">("all");
  const [filterArea, setFilterArea] = useState<string>("all");

  // Load batch settings & classifications from authoritative backend on mount or batch change
  useEffect(() => {
    if (!open || !batchId) return;

    let isMounted = true;
    setLoading(true);

    async function loadData() {
      try {
        const storedSettings = await fetchBatchGroupSettings(batchId);
        if (!isMounted) return;

        if (storedSettings.classifications && storedSettings.classifications.length > 0) {
          setClassifications(storedSettings.classifications.map((classification) => ({
            ...classification,
            visit_type: batchGroupType === "multi_session" ? "multi_visit" : "single_visit",
            repeat_count: defaultRepeatCount,
          })));
        } else {
          // Auto-detect if no stored records exist yet
          const detected = autoDetectBatchGroupClassifications(batchId, {
            batchGroupType: storedSettings.batch_group_type,
            expectedSessionsPerGroup,
            masterAllocation,
            studentRecords,
            scheduleSessions,
          });
          setClassifications(detected);
        }
      } catch (err: any) {
        console.error("Failed to load group classifications:", err);
        toast.error("Failed to load classifications from backend");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [open, batchId, expectedSessionsPerGroup, masterAllocation, studentRecords, scheduleSessions, batchGroupType, defaultRepeatCount]);

  // Derived distinct areas for filtering
  const distinctAreas = useMemo(() => {
    const areas = new Set<string>();
    classifications.forEach((c) => {
      if (c.area) areas.add(c.area);
    });
    return Array.from(areas).sort();
  }, [classifications]);

  // Filtered rows
  const filteredClassifications = useMemo(() => {
    return classifications.filter((c) => {
      if (filterType !== "all" && c.visit_type !== filterType) return false;
      if (filterArea !== "all" && c.area !== filterArea) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchGid = c.group_id.toLowerCase().includes(q);
        const matchArea = c.area?.toLowerCase().includes(q) ?? false;
        const matchLab = c.lab_id?.toLowerCase().includes(q) ?? false;
        const matchGrade = String(c.grade ?? "").toLowerCase().includes(q);
        if (!matchGid && !matchArea && !matchLab && !matchGrade) return false;
      }
      return true;
    });
  }, [classifications, filterType, filterArea, searchTerm]);

  // Helper to format a single visit's day and session/time nicely
  function formatVisitLabel(v: { day: string; session: string; timeSlot: string; labId: string }): string {
    const rawDay = v.day.trim();
    let shortDay = rawDay;
    if (rawDay.toLowerCase().startsWith("thu")) shortDay = "Thu";
    else if (rawDay.toLowerCase().startsWith("fri")) shortDay = "Fri";
    else if (rawDay.toLowerCase().startsWith("sat")) shortDay = "Sat";
    else if (rawDay.toLowerCase().startsWith("sun")) shortDay = "Sun";
    else if (rawDay.toLowerCase().startsWith("mon")) shortDay = "Mon";
    else if (rawDay.toLowerCase().startsWith("tue")) shortDay = "Tue";
    else if (rawDay.toLowerCase().startsWith("wed")) shortDay = "Wed";
    else if (rawDay.includes("-")) {
      const d = new Date(`${rawDay}T00:00:00`);
      if (!isNaN(d.getTime())) {
        shortDay = d.toLocaleDateString("en-US", { weekday: "short" });
      }
    }

    const timeOrSession = v.timeSlot || v.session || "Slot";
    return `${shortDay} · ${timeOrSession}`;
  }

  // Derived group schedule assignments from masterAllocation
  const resolvedGroupSchedules = useMemo(() => {
    const map = new Map<string, Array<{ day: string; session: string; timeSlot: string; visitNum: number; labId: string }>>();
    if (!Array.isArray(masterAllocation)) return map;

    for (const row of masterAllocation) {
      const gid = (row.Group_ID || row.group_id || "")?.trim();
      if (!gid) continue;

      const normGid = gid.toLowerCase();
      if (!map.has(normGid)) {
        map.set(normGid, []);
      }
      const list = map.get(normGid)!;
      const visitNum = Number(row.Visit_Num ?? row.visit_num ?? 1);
      const day = String(row.Day || row.day || "").trim();
      const session = String(row.Session || row.session || "").trim();
      const timeSlot = String(row.Time_Slot || row.time_slot || "").trim();
      const labId = String(row.Lab_ID || row.lab_id || "").trim();

      if (!list.some((item) => item.visitNum === visitNum)) {
        list.push({ day, session, timeSlot, visitNum, labId });
      }
    }

    for (const list of map.values()) {
      list.sort((a, b) => a.visitNum - b.visitNum);
    }
    return map;
  }, [masterAllocation]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalGroups = classifications.length;
    const singleVisitCount = classifications.filter((c) => c.visit_type === "single_visit").length;
    const multiVisitCount = classifications.filter((c) => c.visit_type === "multi_visit").length;

    let totalSeatVisits = 0;
    classifications.forEach((c) => {
      const students = c.student_count || 1;
      const repeats = defaultRepeatCount;
      totalSeatVisits += students * repeats;
    });

    return {
      totalGroups,
      singleVisitCount,
      multiVisitCount,
      totalSeatVisits,
    };
  }, [classifications, defaultRepeatCount]);

  // Auto-Detect from Schedule & Batch
  const handleAutoDetect = () => {
    const detected = autoDetectBatchGroupClassifications(batchId, {
      batchGroupType,
      expectedSessionsPerGroup: defaultRepeatCount,
      masterAllocation,
      studentRecords,
      scheduleSessions,
    });
    setClassifications(detected);
    toast.success(`Auto-detected ${detected.length} group classification(s) from schedule`);
  };

  // Save classifications & batch settings to backend
  const handleSave = async (andRerun = false) => {
    if (saving) return;
    if (!canEdit) {
      toast.error("View only - allocation managed by another user.");
      return;
    }
    setSaving(true);
    try {
      const currentUserName = user?.user_metadata?.full_name || user?.email || "Operations User";
      const recordsToSave = classifications.map((c) => ({
        ...c,
        visit_type: batchGroupType === "multi_session" ? "multi_visit" as const : "single_visit" as const,
        repeat_count: defaultRepeatCount,
        updated_by_name: currentUserName,
      }));

      const savedSettings = await saveBatchGroupSettings(batchId, projectId, {
        batch_group_type: batchGroupType,
        default_repeat_count: defaultRepeatCount,
        classifications: recordsToSave,
      });

      setClassifications(savedSettings.classifications);
      onClassificationsSaved?.(savedSettings.classifications);

      toast.success("Group distribution settings saved to backend successfully!");

      if (andRerun && onApplyAndRerun) {
        onApplyAndRerun(savedSettings.classifications, batchGroupType, defaultRepeatCount);
        onOpenChange(false);
      }
    } catch (err: any) {
      console.error("Save failed:", err);
      toast.error(`Failed to save settings: ${err.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg text-primary">
                <Repeat className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  Group ID Classification & Weekly Distribution
                  <Badge variant="outline" className="text-xs font-normal">
                    {batchName}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Review group schedules inherited from the selected batch configuration.
                </DialogDescription>
              </div>
            </div>
            {loading && (
              <Badge variant="secondary" className="animate-pulse flex items-center gap-1 text-xs">
                <RefreshCw className="h-3 w-3 animate-spin" /> Loading...
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Batch-Level Default Setting Card */}
        <div className="py-2">
          <Card className="bg-muted/30 border shadow-none">
            <CardContent className="p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-primary" />
                <div>
                  <span className="text-xs font-bold text-foreground">
                    Batch Group Configuration:
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    All groups inherit this value from Batch Settings.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge variant="secondary">
                  {batchGroupType === "multi_session" ? "Multi-Session" : "Single-Session"}
                </Badge>
                <Badge variant="outline">{defaultRepeatCount} Sessions / Group</Badge>
                <span className="text-[11px] text-muted-foreground">Inherited from Batch Settings</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Metrics Overview Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-1">
          <Card className="bg-muted/40 border shadow-none">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Groups</p>
                <p className="text-lg font-bold">{summaryMetrics.totalGroups}</p>
              </div>
              <Layers className="h-4 w-4 text-muted-foreground opacity-70" />
            </CardContent>
          </Card>

          <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/50 shadow-none">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-blue-700 dark:text-blue-400 uppercase tracking-wider">Single-Visit (1x)</p>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{summaryMetrics.singleVisitCount}</p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-blue-600 opacity-70" />
            </CardContent>
          </Card>

          <Card className="bg-purple-50/50 dark:bg-purple-950/20 border-purple-200/50 shadow-none">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-purple-700 dark:text-purple-400 uppercase tracking-wider">Multi-Visit (Nx)</p>
                <p className="text-lg font-bold text-purple-700 dark:text-purple-300">{summaryMetrics.multiVisitCount}</p>
              </div>
              <Repeat className="h-4 w-4 text-purple-600 opacity-70" />
            </CardContent>
          </Card>

          <Card className="bg-muted/40 border shadow-none">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Seat-Visits</p>
                <p className="text-lg font-bold">{summaryMetrics.totalSeatVisits}</p>
              </div>
              <CalendarDays className="h-4 w-4 text-muted-foreground opacity-70" />
            </CardContent>
          </Card>
        </div>

        {/* Toolbar & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-y bg-muted/20 px-2 rounded-md">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search group, area, grade..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>

            <Select value={filterType} onValueChange={(val: any) => setFilterType(val)}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="Visit Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Types</SelectItem>
                <SelectItem value="single_visit" className="text-xs">Single-Visit</SelectItem>
                <SelectItem value="multi_visit" className="text-xs">Multi-Visit</SelectItem>
              </SelectContent>
            </Select>

            {distinctAreas.length > 0 && (
              <Select value={filterArea} onValueChange={(val) => setFilterArea(val)}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue placeholder="Area" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All Areas</SelectItem>
                  {distinctAreas.map((area) => (
                    <SelectItem key={area} value={area} className="text-xs">
                      {area}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoDetect}
              className="h-8 text-xs font-semibold gap-1 text-primary border-primary/30 hover:bg-primary/10"
              title="Auto-detect classifications from schedule and batch settings"
            >
              <Sparkles className="h-3.5 w-3.5" /> Auto-Detect
            </Button>

          </div>
        </div>

        {/* Groups Table */}
        <div className="flex-1 overflow-y-auto border rounded-md min-h-[220px]">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-[120px] text-xs">Group ID</TableHead>
                <TableHead className="text-xs">Physical Area</TableHead>
                <TableHead className="text-xs w-[60px]">Grade</TableHead>
                <TableHead className="text-xs w-[70px]">Students</TableHead>
                <TableHead className="text-xs w-[120px]">Classification</TableHead>
                <TableHead className="text-xs w-[110px]">Repeats / Week</TableHead>
                <TableHead className="text-xs min-w-[170px]">Assigned Sessions</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-xs text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin inline mr-2 text-primary" />
                    Loading group classifications...
                  </TableCell>
                </TableRow>
              ) : filteredClassifications.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-xs text-muted-foreground">
                    No group classifications found matching criteria. Click <strong>Auto-Detect</strong> to extract from schedule.
                  </TableCell>
                </TableRow>
              ) : (
                filteredClassifications.map((row) => {
                  const isMulti = row.visit_type === "multi_visit";
                  const repeatCount = defaultRepeatCount;
                  const resolvedVisits = resolvedGroupSchedules.get(row.group_id.trim().toLowerCase());

                  return (
                    <TableRow key={row.group_id} className="text-xs hover:bg-muted/40">
                      <TableCell className="font-semibold text-foreground">
                        {row.group_id}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.area || "—"}
                      </TableCell>
                      <TableCell>
                        {row.grade !== undefined ? (
                          <Badge variant="outline" className="text-[10px] font-normal px-1.5">
                            G{row.grade}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.student_count ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={isMulti ? "secondary" : "outline"}
                          className={`text-[10px] font-semibold gap-1 px-2 py-0.5 ${
                            isMulti
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300 dark:border-purple-700"
                              : "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                          }`}
                        >
                          {isMulti ? <Repeat className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                          {isMulti ? "Multi-Visit" : "Single-Visit"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] font-semibold">
                          {repeatCount} session{repeatCount === 1 ? "" : "s"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {resolvedVisits && resolvedVisits.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {resolvedVisits.map((v, i) => (
                              <span key={v.visitNum} className="inline-flex items-center gap-1">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-mono px-1.5 py-0.5 ${
                                    isMulti
                                      ? "bg-purple-500/10 text-purple-900 dark:text-purple-200 border-purple-300 dark:border-purple-800 font-semibold"
                                      : "bg-blue-500/10 text-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-800"
                                  }`}
                                  title={`Visit ${v.visitNum}: ${v.day} - ${v.timeSlot || v.session} (${v.labId})`}
                                >
                                  {isMulti && <span className="opacity-70 mr-0.5">V{v.visitNum}:</span>}
                                  {formatVisitLabel(v)}
                                </Badge>
                                {(i < resolvedVisits.length - 1 || (isMulti && resolvedVisits.length < repeatCount)) && (
                                  <span className="text-[10px] text-muted-foreground font-bold">+</span>
                                )}
                              </span>
                            ))}
                            {isMulti && resolvedVisits.length < repeatCount && (
                              Array.from({ length: repeatCount - resolvedVisits.length }).map((_, idx) => {
                                const pendingVisitNum = resolvedVisits.length + idx + 1;
                                return (
                                  <span key={`pending_v${pendingVisitNum}`} className="inline-flex items-center gap-1">
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] font-mono px-1.5 py-0.5 border-dashed bg-purple-50/40 dark:bg-purple-950/20 text-purple-700/70 dark:text-purple-300/70 border-purple-300/60"
                                      title={`Visit ${pendingVisitNum} will be assigned when 'Save & Run Allocation' is clicked`}
                                    >
                                      <span className="opacity-70 mr-0.5">V{pendingVisitNum}:</span>
                                      Pending Run
                                    </Badge>
                                    {idx < repeatCount - resolvedVisits.length - 1 && (
                                      <span className="text-[10px] text-muted-foreground font-bold">+</span>
                                    )}
                                  </span>
                                );
                              })
                            )}
                          </div>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-muted-foreground/80 font-normal border-dashed bg-muted/30"
                          >
                            Pending Allocation
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[10px] text-muted-foreground">
                        Inherited
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footer Actions */}
        <DialogFooter className="pt-3 border-t flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-muted-foreground">
            {classifications.length} total groups classified across batch
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="text-xs"
            >
              Cancel
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSave(false)}
              disabled={!canEdit || saving || loading || classifications.length === 0}
              className="text-xs font-semibold gap-1"
            >
              {saving ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save to Database
            </Button>

            {onApplyAndRerun && (
              <Button
                variant="default"
                size="sm"
                onClick={() => handleSave(true)}
                disabled={!canEdit || saving || loading || classifications.length === 0}
                className="text-xs font-bold gap-1 bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs"
              >
                {saving ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Repeat className="h-3.5 w-3.5" />
                )}
                Save & Run Allocation
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
