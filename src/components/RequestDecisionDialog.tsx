import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  X,
  AlertTriangle,
  MessageSquare,
  Building2,
  MapPin,
  Send,
  PhoneCall,
  CheckCircle2,
} from "lucide-react";
import type { ResolutionRequest, ResolutionRequestStatus } from "@/lib/batch-allocation-storage";
import { formatGradeLevel } from "@/lib/project-grade-levels";

interface RequestDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ResolutionRequest | null;
  targetStatus: ResolutionRequestStatus | null;
  onConfirm: (comment: string) => Promise<void>;
  loading?: boolean;
}

export function RequestDecisionDialog({
  open,
  onOpenChange,
  request,
  targetStatus,
  onConfirm,
  loading = false,
}: RequestDecisionDialogProps) {
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (open) {
      setComment("");
    }
  }, [open]);

  if (!request || !targetStatus) return null;

  const isOverride = request.status !== "pending" && request.status !== targetStatus;

  const getDialogTitle = () => {
    if (isOverride) {
      if (targetStatus === "approved") return "Override Decision: Approve Request";
      if (targetStatus === "rejected") return "Override Decision: Reject Request";
      return `Override Decision: Mark ${targetStatus.toUpperCase()}`;
    }
    if (targetStatus === "approved") return "Approve Operation Request";
    if (targetStatus === "rejected") return "Reject Operation Request";
    if (targetStatus === "contacted") return "Mark as Contacted (CS Outreach)";
    if (targetStatus === "resolved") return "Mark Request Resolved";
    return `Update Request Status: ${targetStatus.toUpperCase()}`;
  };

  const getConfirmButtonColor = () => {
    if (targetStatus === "approved") return "bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold";
    if (targetStatus === "rejected") return "bg-rose-600 hover:bg-rose-700 text-white font-semibold";
    if (targetStatus === "contacted") return "bg-blue-600 hover:bg-blue-700 text-white font-semibold";
    return "bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConfirm(comment);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              {targetStatus === "approved" && <Check className="h-5 w-5 text-[#056FEC]" />}
              {targetStatus === "rejected" && <X className="h-5 w-5 text-rose-600" />}
              {targetStatus === "contacted" && <PhoneCall className="h-5 w-5 text-blue-600" />}
              {targetStatus === "resolved" && <CheckCircle2 className="h-5 w-5 text-[#056FEC]" />}
              <span>{getDialogTitle()}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {isOverride
                ? "This ticket already has a recorded decision. Your action will be logged as an explicit override."
                : "Record your decision and leave optional operational feedback or conditions for the team."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-3.5">
            {/* Request Summary Card */}
            <div className="p-3 rounded-lg border bg-muted/30 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="font-semibold text-[10px]">
                  {request.type === "overfill" && "⚡ Fair Overfill"}
                  {request.type === "new_lab" && "🏢 New Lab Request"}
                  {request.type === "nearby_lab" && "Nearby Existing Lab"}
                  {request.type === "cs_outreach" && "📞 CS Reassignment"}
                </Badge>
                <div className="text-[10px] text-muted-foreground font-mono">
                  Batch: {request.batch_id}
                </div>
              </div>

              <div className="font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>{request.area}</span>
                </div>
                <span className="text-muted-foreground">•</span>
                <span className="text-xs font-medium text-foreground/90">
                  {Array.isArray(request.grades) && request.grades.length === 3
                    ? "All Grades in Area (4, 5, 6)"
                    : Array.isArray(request.grades) && request.grades.length > 0
                    ? request.grades.map((grade) => formatGradeLevel(grade)).join(", ")
                    : "All Grades"}
                </span>
                {request.unassigned_count ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30 font-bold">
                    {request.unassigned_count} unassigned
                  </Badge>
                ) : null}
              </div>

              <div className="text-muted-foreground text-[11px]">
                {request.type === "overfill" && `Target: ${request.lab_id || "All Labs"} (+${request.max_overfill_per_lab || 2} extra seats/slot)`}
                {request.type === "new_lab" && `Requested Capacity: ${request.requested_capacity || 25} Seats • Reason: ${request.reason || "Shortfall"}`}
                {request.type === "nearby_lab" && `Requested Lab: ${request.nearby_lab_metadata?.lab_name || request.suggested_nearest_lab || request.lab_id} · ${request.nearby_lab_metadata?.destination_area || request.suggested_nearest_area || ""} · ${request.nearby_lab_metadata?.required_sessions?.length || 0} required sessions`}
                {request.type === "cs_outreach" && `Offer Nearest: ${request.suggested_nearest_lab || "Nearest with capacity"}`}
              </div>

              <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/50">
                Submitted by: <span className="font-medium text-foreground">{request.submitted_by_name || "Operations Team"}</span> ({request.submitted_by_role || "Operations"})
              </div>
            </div>

            {/* Override Warning Callout */}
            {isOverride && (
              <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5 leading-relaxed">
                  <div className="font-bold">Override Warning</div>
                  <p className="text-[11px]">
                    This request was previously <strong>{request.status.toUpperCase()}</strong> by <strong>{request.reviewed_by_name || "Lab Manager"}</strong>. Submitting this will change the active status to <strong>{targetStatus.toUpperCase()}</strong> and record an override action in the permanent audit trail.
                  </p>
                </div>
              </div>
            )}

            {/* Reply / Comment Input */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                <span>Reply / Decision Note (Visible to Operations)</span>
              </Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  targetStatus === "rejected"
                    ? "e.g. Reason for rejection: Lab venue cannot exceed safety limits; please request new venue."
                    : targetStatus === "approved"
                    ? "e.g. Approved on condition of +2 max extra seats for Grade 4 & 5 only."
                    : "e.g. Reassignment offer accepted by 3 parents; Friday morning slot selected."
                }
                className="text-xs h-24"
              />
              <p className="text-[10px] text-muted-foreground">
                This note will be attached to the ticket and visible to Operations and other Lab Managers.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={loading}
              className={`text-xs font-bold gap-1.5 ${getConfirmButtonColor()}`}
            >
              {targetStatus === "approved" && <Check className="h-3.5 w-3.5" />}
              {targetStatus === "rejected" && <X className="h-3.5 w-3.5" />}
              {targetStatus === "contacted" && <PhoneCall className="h-3.5 w-3.5" />}
              {targetStatus === "resolved" && <CheckCircle2 className="h-3.5 w-3.5" />}
              <span>{isOverride ? `Confirm Override (${targetStatus.toUpperCase()})` : `Confirm ${targetStatus.toUpperCase()}`}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
