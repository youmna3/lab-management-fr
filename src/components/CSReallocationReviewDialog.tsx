import React, { useState, useMemo } from "react";
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
  Check,
  X,
  Send,
  Building2,
  MapPin,
  Users,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  PhoneCall,
  UserCheck,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth, ROLE_LABELS } from "@/hooks/useAuth";
import {
  updateReallocationStudentItemStatus,
  forwardRequestToCSTeam,
  type ResolutionRequest,
  type ReallocationStudentItem,
} from "@/lib/batch-allocation-storage";
import { formatGradeLevel, sortGradeLevels } from "@/lib/project-grade-levels";

interface CSReallocationReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ResolutionRequest | null;
  onUpdateRequest: (updated: ResolutionRequest) => void;
  onReallocationApplied?: () => void;
}

export function CSReallocationReviewDialog({
  open,
  onOpenChange,
  request,
  onUpdateRequest,
  onReallocationApplied,
}: CSReallocationReviewDialogProps) {
  const { user, roles, hasAnyRole } = useAuth();
  const currentUserName = (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "Reviewer";
  const currentUserRole = roles.length > 0 ? roles.map((r) => (ROLE_LABELS as any)[r] || r).join(", ") : "Event Team";

  const canApprove = hasAnyRole(["lab_manager", "administration", "operations"]) || Boolean(user);

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [forwardComment, setForwardComment] = useState("");
  const [showForwardForm, setShowForwardForm] = useState(false);

  // 1. Unconditionally hydrate request metadata
  const effectiveRequest = useMemo(() => {
    if (!request) return null;
    const reqCopy = { ...request };
    if ((!reqCopy.reallocation_students || reqCopy.reallocation_students.length === 0) && reqCopy.notes) {
      try {
        if (reqCopy.notes.startsWith("__REALLOC_META__:")) {
          const parsed = JSON.parse(reqCopy.notes.slice(17));
          if (parsed?.realloc) reqCopy.reallocation_students = parsed.realloc;
          if (parsed?.destCap && !reqCopy.destination_lab_capacity) reqCopy.destination_lab_capacity = parsed.destCap;
          if (parsed?.destTotalCap !== undefined && reqCopy.destination_lab_total_capacity === undefined) reqCopy.destination_lab_total_capacity = parsed.destTotalCap;
          if (parsed?.forwarded !== undefined && reqCopy.forwarded_to_cs === undefined) reqCopy.forwarded_to_cs = parsed.forwarded;
        } else if (reqCopy.notes.startsWith('{"realloc":') || reqCopy.notes.startsWith('{"type":')) {
          const parsed = JSON.parse(reqCopy.notes);
          if (parsed?.realloc) reqCopy.reallocation_students = parsed.realloc;
          if (parsed?.destCap && !reqCopy.destination_lab_capacity) reqCopy.destination_lab_capacity = parsed.destCap;
          if (parsed?.destTotalCap !== undefined && reqCopy.destination_lab_total_capacity === undefined) reqCopy.destination_lab_total_capacity = parsed.destTotalCap;
          if (parsed?.forwarded !== undefined && reqCopy.forwarded_to_cs === undefined) reqCopy.forwarded_to_cs = parsed.forwarded;
        }
      } catch (_) {}
    }
    return reqCopy;
  }, [request]);

  const isCSTeam = effectiveRequest?.target_team === "CS Team" || effectiveRequest?.forwarded_to_cs;

  // 2. Extract students safely
  const students: ReallocationStudentItem[] = useMemo(() => {
    return effectiveRequest?.reallocation_students || [];
  }, [effectiveRequest?.reallocation_students]);

  const availableGrades = useMemo(() => sortGradeLevels([
    ...students.map((student) => Number(student.grade)).filter(Number.isFinite),
    ...((effectiveRequest?.grades ?? []).map(Number).filter(Number.isFinite)),
  ]), [students, effectiveRequest?.grades]);

  const pendingCount = useMemo(() => students.filter((s) => s.status === "pending").length, [students]);
  const approvedCount = useMemo(() => students.filter((s) => s.status === "approved").length, [students]);
  const declinedCount = useMemo(() => students.filter((s) => s.status === "declined").length, [students]);

  // 3. Calculate students count requested per grade
  const totalRequestedByGrade = useMemo<Record<number, number>>(() => {
    const counts: Record<number, number> = {};
    for (const s of students) {
      const g = Number(s.grade);
      if (!Number.isFinite(g)) continue;
      counts[g] = (counts[g] || 0) + 1;
    }
    return counts;
  }, [students]);

  // 4. Calculate approved students count per grade
  const approvedCountsByGrade = useMemo<Record<number, number>>(() => {
    const counts: Record<number, number> = {};
    for (const s of students) {
      if (s.status === "approved") {
        const g = Number(s.grade);
        if (!Number.isFinite(g)) continue;
        counts[g] = (counts[g] || 0) + 1;
      }
    }
    return counts;
  }, [students]);

  // 5. Baseline capacity per grade safely parsed
  const initialCapacityByGrade = useMemo<Record<number, number>>(() => {
    if (!effectiveRequest?.destination_lab_capacity) {
      return Object.fromEntries(availableGrades.map((grade) => [grade, 25]));
    }
    let cap: any = effectiveRequest.destination_lab_capacity;
    if (typeof cap === "string") {
      try {
        cap = JSON.parse(cap);
      } catch {
        return Object.fromEntries(availableGrades.map((grade) => [grade, 25]));
      }
    }
    if (typeof cap === "object" && cap !== null) {
      return Object.fromEntries(availableGrades.map((grade) => [grade, Number(cap[grade] ?? cap[String(grade)] ?? 25)]));
    }
    return Object.fromEntries(availableGrades.map((grade) => [grade, 25]));
  }, [effectiveRequest?.destination_lab_capacity, availableGrades]);

  const initialTotalCap = useMemo<number>(() => {
    if (effectiveRequest?.destination_lab_total_capacity !== undefined && !isNaN(Number(effectiveRequest.destination_lab_total_capacity))) {
      return Number(effectiveRequest.destination_lab_total_capacity);
    }
    return Object.values(initialCapacityByGrade).reduce((sum, capacity) => sum + capacity, 0) || 100;
  }, [effectiveRequest?.destination_lab_total_capacity, initialCapacityByGrade]);

  // 6. Live remaining seats per grade (Issue 2)
  const remainingSeatsByGrade = useMemo<Record<number, number>>(() => {
    const rem: Record<number, number> = {};
    for (const g of availableGrades) {
      const initial = initialCapacityByGrade[g] !== undefined ? initialCapacityByGrade[g] : 0;
      const approved = approvedCountsByGrade[g] || 0;
      rem[g] = Math.max(0, initial - approved);
    }
    return rem;
  }, [initialCapacityByGrade, approvedCountsByGrade, availableGrades]);

  const remainingTotalSeats = useMemo<number>(() => {
    return Math.max(0, initialTotalCap - approvedCount);
  }, [initialTotalCap, approvedCount]);

  // 7. Overbooking check (Issue 1)
  const overbookingInfo = useMemo(() => {
    const overbookedGrades: { grade: number; requested: number; capacity: number; excess: number }[] = [];
    if (effectiveRequest?.destination_lab_capacity) {
      for (const g of availableGrades) {
        const reqCount = totalRequestedByGrade[g] || 0;
        const cap = initialCapacityByGrade[g] || 0;
        if (reqCount > cap) {
          overbookedGrades.push({ grade: g, requested: reqCount, capacity: cap, excess: reqCount - cap });
        }
      }
    }
    const totalExcess = students.length > initialTotalCap ? students.length - initialTotalCap : 0;
    const isOverbooked = overbookedGrades.length > 0 || totalExcess > 0;

    return { isOverbooked, overbookedGrades, totalExcess };
  }, [effectiveRequest?.destination_lab_capacity, totalRequestedByGrade, initialCapacityByGrade, students.length, initialTotalCap, availableGrades]);

  // Early return check ONLY AFTER all hooks are called
  if (!effectiveRequest) return null;

  // Individual Student Decision with Live Capacity Validation
  const handleStudentDecision = async (
    studentId: string,
    newStatus: "approved" | "declined",
    declineReason?: string
  ) => {
    const targetStudent = students.find((s) => s.student_id === studentId);
    if (!targetStudent) return;
    const g = Number(targetStudent.grade) || 4;

    // Live capacity check when approving
    if (newStatus === "approved") {
      const remForGrade = remainingSeatsByGrade[g] !== undefined ? remainingSeatsByGrade[g] : 0;
      if (effectiveRequest.destination_lab_capacity && remForGrade <= 0) {
        toast.error(
          `Cannot approve Student ${studentId}: Destination lab has 0 remaining seats for Grade ${g} (${initialCapacityByGrade[g]} seats already full).`
        );
        return;
      }
      if (initialTotalCap > 0 && remainingTotalSeats <= 0) {
        toast.error(
          `Cannot approve Student ${studentId}: Destination lab total capacity limit (${initialTotalCap} seats) has been reached.`
        );
        return;
      }
    }

    setProcessingId(studentId);
    try {
      const reviewer = { name: currentUserName, role: currentUserRole };
      const updated = await updateReallocationStudentItemStatus(
        effectiveRequest.id,
        effectiveRequest.batch_id,
        studentId,
        newStatus,
        reviewer,
        declineReason
      );

      onUpdateRequest(updated);
      if (newStatus === "approved") {
        toast.success(`Approved move for Student ${studentId}. Applied to lab allocation!`);
        if (onReallocationApplied) onReallocationApplied();
      } else {
        toast.info(`Declined move for Student ${studentId}. Student remains in original area.`);
      }
    } catch (err: any) {
      console.error("Failed to update student reallocation status:", err);
      toast.error(err.message || "Failed to update student status");
    } finally {
      setProcessingId(null);
    }
  };

  // Bulk Approve Pending Students up to Live Available Capacity (Issue 1 Fix)
  const handleBulkApprovePending = async () => {
    const pendingStudents = students.filter((s) => s.status === "pending");
    if (pendingStudents.length === 0) return;

    setProcessingId("bulk_approve");
    try {
      const reviewer = { name: currentUserName, role: currentUserRole };
      const liveBudget: Record<number, number> = { ...remainingSeatsByGrade };
      let liveTotalBudget = remainingTotalSeats;

      let approvedCountSuccess = 0;
      let skippedOverCapCount = 0;
      let lastUpdated = effectiveRequest;

      for (const s of pendingStudents) {
        const g = Number(s.grade) || 4;
        const hasGradeCap = effectiveRequest.destination_lab_capacity ? (liveBudget[g] || 0) > 0 : true;
        const hasTotalCap = initialTotalCap > 0 ? liveTotalBudget > 0 : true;

        if (hasGradeCap && hasTotalCap) {
          lastUpdated = await updateReallocationStudentItemStatus(
            effectiveRequest.id,
            effectiveRequest.batch_id,
            s.student_id,
            "approved",
            reviewer
          );
          if (effectiveRequest.destination_lab_capacity) {
            liveBudget[g] = (liveBudget[g] || 1) - 1;
          }
          liveTotalBudget -= 1;
          approvedCountSuccess += 1;
        } else {
          skippedOverCapCount += 1;
        }
      }

      if (approvedCountSuccess > 0) {
        onUpdateRequest(lastUpdated);
        if (onReallocationApplied) onReallocationApplied();
      }

      if (skippedOverCapCount > 0) {
        toast.warning(
          `Approved ${approvedCountSuccess} student(s) up to available capacity. ${skippedOverCapCount} student(s) could NOT be approved because the destination lab reached maximum capacity for their grade.`
        );
      } else {
        toast.success(`Approved moves for ${approvedCountSuccess} student(s)!`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to bulk approve students");
    } finally {
      setProcessingId(null);
    }
  };

  const handleBulkDeclinePending = async () => {
    const pendingStudents = students.filter((s) => s.status === "pending");
    if (pendingStudents.length === 0) return;

    setProcessingId("bulk_decline");
    try {
      const reviewer = { name: currentUserName, role: currentUserRole };
      let lastUpdated = effectiveRequest;
      for (const s of pendingStudents) {
        lastUpdated = await updateReallocationStudentItemStatus(
          effectiveRequest.id,
          effectiveRequest.batch_id,
          s.student_id,
          "declined",
          reviewer,
          "Declined during batch review"
        );
      }
      onUpdateRequest(lastUpdated);
      toast.info(`Declined moves for ${pendingStudents.length} student(s).`);
    } catch (err: any) {
      toast.error(err.message || "Failed to bulk decline students");
    } finally {
      setProcessingId(null);
    }
  };

  const handleForwardToCS = async () => {
    setForwarding(true);
    try {
      const forwarder = { name: currentUserName, role: currentUserRole };
      const updated = await forwardRequestToCSTeam(
        effectiveRequest.id,
        effectiveRequest.batch_id,
        forwarder,
        forwardComment.trim() || undefined
      );

      onUpdateRequest(updated);
      toast.success("Request forwarded to CS Team for student outreach and placement sign-off!");
      setShowForwardForm(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to forward request to CS Team");
    } finally {
      setForwarding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-5 pb-3 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/15 text-purple-600">
                <PhoneCall className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  CS Lab Reallocation Review
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-semibold ${
                      isCSTeam
                        ? "text-purple-600 border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40"
                        : "text-blue-600 border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40"
                    }`}
                  >
                    Target: {effectiveRequest.target_team || "Event Team"}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Source Area: <strong>{effectiveRequest.area}</strong> ➔ Target: <strong>{effectiveRequest.suggested_nearest_lab || effectiveRequest.lab_id}</strong> ({effectiveRequest.suggested_nearest_area || effectiveRequest.area})
                </DialogDescription>
              </div>
            </div>

            {/* Status Pills */}
            <div className="flex items-center gap-1.5">
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px]">
                {pendingCount} Pending
              </Badge>
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px]">
                {approvedCount} Approved
              </Badge>
              {declinedCount > 0 && (
                <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[10px]">
                  {declinedCount} Declined
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Metadata & Live Per-Grade Remaining Seats (Issue 2) */}
          <div className="p-3.5 rounded-xl border bg-muted/20 space-y-2 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="space-y-0.5">
                <div className="text-foreground font-semibold flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                    <strong>{effectiveRequest.suggested_nearest_lab || effectiveRequest.lab_id}</strong>
                  </span>
                  <Badge variant="outline" className="text-[10px] font-medium">
                    <MapPin className="h-2.5 w-2.5 mr-0.5" />
                    {effectiveRequest.suggested_nearest_area || effectiveRequest.area}
                  </Badge>
                  {effectiveRequest.created_at && (
                    <span className="text-muted-foreground text-[11px]">• Submitted {new Date(effectiveRequest.created_at).toLocaleDateString()}</span>
                  )}
                </div>
                <div className="text-muted-foreground text-[11px]">
                  Source: <strong>{effectiveRequest.area}</strong> • {effectiveRequest.reason || "Shortfall reallocation"}
                </div>
              </div>

              {/* Forward to CS Button (if in Event Team review mode) */}
              {!effectiveRequest.forwarded_to_cs && effectiveRequest.target_team !== "CS Team" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowForwardForm(!showForwardForm)}
                  className="h-7 text-xs gap-1.5 border-purple-300 text-purple-700 dark:text-purple-300 hover:bg-purple-50 shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  Forward to CS Team
                </Button>
              ) : (
                <Badge variant="outline" className="text-xs text-purple-600 border-purple-300 bg-purple-50/50 shrink-0">
                  ✓ Handled by CS Team
                </Badge>
              )}
            </div>

            {/* Per-Grade Remaining Seats Indicator Bar */}
            <div className="pt-2 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Destination Lab Remaining Seats:</span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {availableGrades.map((g) => {
                  const initial = initialCapacityByGrade[g];
                  const remaining = remainingSeatsByGrade[g] ?? 0;
                  const requested = totalRequestedByGrade[g] || 0;
                  if (requested === 0 && (initial === undefined || initial === 0)) return null;

                  const isFull = remaining <= 0;

                  return (
                    <Badge
                      key={g}
                      variant="outline"
                      className={`text-[11px] font-bold px-2 py-0.5 transition-all ${
                        isFull
                          ? "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
                          : "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                      }`}
                    >
                      {formatGradeLevel(g, undefined, true)}: {remaining} seats left {initial !== undefined ? `(of ${initial})` : ""}
                    </Badge>
                  );
                })}

                <Badge variant="secondary" className="text-[10px] font-mono">
                  Total Remaining: {remainingTotalSeats} / {initialTotalCap}
                </Badge>
              </div>
            </div>
          </div>

          {/* Overbooking Alert Banner (Issue 1) */}
          {overbookingInfo.isOverbooked && (
            <div className="p-3.5 rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 space-y-1 text-xs animate-in fade-in">
              <div className="font-bold flex items-center gap-1.5 text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>Capacity Overbooking Detected in Request</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                This request bundles <strong>{students.length} students</strong>, but destination venue <strong>{effectiveRequest.suggested_nearest_lab || effectiveRequest.lab_id}</strong> only has capacity for {initialTotalCap} total students.
                {overbookingInfo.overbookedGrades.map((og) => (
                  <span key={og.grade} className="block font-medium">
                    • {formatGradeLevel(og.grade)}: {og.requested} students in request vs <strong>{og.capacity} available seats</strong> ({og.excess} over capacity).
                  </span>
                ))}
                Approval is capped at available seats per grade. Excess students cannot be approved and must be declined.
              </p>
            </div>
          )}

          {/* Forwarding Form (collapsible) */}
          {showForwardForm && (
            <div className="p-3.5 rounded-xl border border-purple-300/60 bg-purple-500/5 space-y-2.5">
              <Label className="text-xs font-bold text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5 text-purple-600" />
                Forward this request to Customer Success (CS) Team:
              </Label>
              <Textarea
                placeholder="Optional instruction or student contact context for CS team..."
                value={forwardComment}
                onChange={(e) => setForwardComment(e.target.value)}
                className="text-xs h-16 bg-background"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowForwardForm(false)}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleForwardToCS}
                  disabled={forwarding}
                  className="h-7 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white gap-1"
                >
                  <Send className="h-3 w-3" />
                  Confirm Forward
                </Button>
              </div>
            </div>
          )}

          {/* Students List Table with Individual Action Controls */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Users className="h-4 w-4 text-primary" />
                Affected Students Registry ({students.length})
              </Label>

              {pendingCount > 0 && canApprove && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkApprovePending}
                    disabled={Boolean(processingId) || remainingTotalSeats <= 0}
                    className="h-7 text-xs font-semibold gap-1 text-[#056FEC] hover:bg-[#056FEC]/10 border-[#056FEC]/30"
                    title={`Approve up to available capacity (${remainingTotalSeats} seats left)`}
                  >
                    <Check className="h-3 w-3" /> Approve Pending up to Capacity ({Math.min(pendingCount, remainingTotalSeats)})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleBulkDeclinePending}
                    disabled={Boolean(processingId)}
                    className="h-7 text-xs text-rose-600 hover:bg-rose-50"
                  >
                    <X className="h-3 w-3" /> Decline All Pending
                  </Button>
                </div>
              )}
            </div>

            <div className="border rounded-xl overflow-hidden bg-card">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-xs font-bold">Student ID</TableHead>
                    <TableHead className="text-xs font-bold">Grade</TableHead>
                    <TableHead className="text-xs font-bold">Current Area</TableHead>
                    <TableHead className="text-xs font-bold">Shortfall Reason</TableHead>
                    <TableHead className="text-xs font-bold">Destination Lab &amp; Area</TableHead>
                    <TableHead className="text-xs font-bold text-center">Status</TableHead>
                    <TableHead className="text-xs font-bold text-right">Individual Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-6 text-xs text-muted-foreground">
                        No student items attached to this reallocation request.
                      </TableCell>
                    </TableRow>
                  ) : (
                    students.map((student) => {
                      const isPending = student.status === "pending";
                      const isApproved = student.status === "approved";
                      const isDeclined = student.status === "declined";
                      const isItemLoading = processingId === student.student_id;

                      const g = Number(student.grade) || 4;
                      const remForGrade = remainingSeatsByGrade[g] ?? 0;
                      const canApproveThis = isPending && (effectiveRequest.destination_lab_capacity ? remForGrade > 0 : true) && remainingTotalSeats > 0;

                      return (
                        <TableRow key={student.student_id} className="hover:bg-muted/20 text-xs">
                          {/* 1. Student ID */}
                          <TableCell className="py-2.5 font-mono font-bold text-foreground">
                            {student.student_id}
                          </TableCell>

                          {/* 2. Grade */}
                          <TableCell className="py-2.5">
                            <Badge variant="outline" className="text-[10px]">
                              {formatGradeLevel(student.grade)}
                            </Badge>
                          </TableCell>

                          {/* 3. Source Area */}
                          <TableCell className="py-2.5 font-medium">
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span>{student.old_area}</span>
                            </div>
                          </TableCell>

                          {/* 4. Shortfall Reason */}
                          <TableCell className="py-2.5 text-muted-foreground text-[11px]">
                            {student.reason || "Capacity bottleneck in area"}
                          </TableCell>

                          {/* 5. Destination Lab & Area */}
                          <TableCell className="py-2.5">
                            <div className="font-semibold text-foreground flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                              <span>{student.new_lab_name || student.new_lab}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {student.new_area}
                            </span>
                          </TableCell>

                          {/* 6. Status */}
                          <TableCell className="py-2.5 text-center">
                            {isApproved && (
                              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] font-bold">
                                ✓ Approved &amp; Moved
                              </Badge>
                            )}
                            {isDeclined && (
                              <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 text-[10px] font-bold">
                                ✗ Declined
                              </Badge>
                            )}
                            {isPending && (
                              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px]">
                                Pending Review
                              </Badge>
                            )}
                            {student.decided_by_name && (
                              <div className="text-[9px] text-muted-foreground mt-0.5">
                                By {student.decided_by_name}
                              </div>
                            )}
                          </TableCell>

                          {/* 7. Individual Actions */}
                          <TableCell className="py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isPending ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleStudentDecision(student.student_id, "approved")}
                                    disabled={Boolean(processingId) || !canApproveThis}
                                    className={`h-7 text-[11px] px-2 gap-1 ${
                                      canApproveThis
                                        ? "text-[#056FEC] hover:bg-[#056FEC]/10 border-[#056FEC]/30"
                                        : "opacity-40 text-muted-foreground border-border cursor-not-allowed"
                                    }`}
                                    title={
                                      canApproveThis
                                        ? "Approve student move into destination lab"
                                        : `Cannot approve: destination lab has 0 free seats left for Grade ${g}`
                                    }
                                  >
                                    <Check className="h-3 w-3" />
                                    <span>{canApproveThis ? "Approve" : `G${g} Full`}</span>
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleStudentDecision(student.student_id, "declined")}
                                    disabled={Boolean(processingId)}
                                    className="h-7 text-[11px] text-rose-600 hover:bg-rose-50 border-rose-500/30 px-2 gap-1"
                                    title="Decline student move"
                                  >
                                    <X className="h-3 w-3" /> Decline
                                  </Button>
                                </>
                              ) : (
                                <div className="flex items-center gap-1">
                                  {isApproved && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleStudentDecision(student.student_id, "declined")}
                                      disabled={Boolean(processingId)}
                                      className="h-6 text-[10px] text-rose-600 hover:bg-rose-50 px-1.5"
                                      title="Change decision to Decline"
                                    >
                                      Change to Decline
                                    </Button>
                                  )}
                                  {isDeclined && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleStudentDecision(student.student_id, "approved")}
                                      disabled={Boolean(processingId) || (effectiveRequest.destination_lab_capacity ? (remainingSeatsByGrade[g] ?? 0) <= 0 : false)}
                                      className="h-6 text-[10px] text-[#056FEC] hover:bg-[#056FEC]/10 px-1.5"
                                      title="Change decision to Approve"
                                    >
                                      Change to Approve
                                    </Button>
                                  )}
                                </div>
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
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="p-4 border-t bg-muted/20 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {approvedCount > 0
              ? `Approved ${approvedCount} of ${students.length} student moves into destination lab.`
              : "Review each student move individually or approve in bulk up to capacity limits."}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
