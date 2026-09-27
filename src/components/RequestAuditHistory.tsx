import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  History,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Check,
  X,
  PhoneCall,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import type { ResolutionRequest, ResolutionRequestAction } from "@/lib/batch-allocation-storage";

interface RequestAuditHistoryProps {
  request: ResolutionRequest;
  compact?: boolean;
}

export function formatActionDate(isoString?: string | null): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString || "";
  }
}

export function RequestAuditHistory({ request, compact = false }: RequestAuditHistoryProps) {
  const [showHistory, setShowHistory] = useState(false);

  const history = Array.isArray(request?.history) ? request.history : [];
  const latestComment = request?.reviewer_comment;
  const isOverridden = history.some((h) => Boolean(h?.is_override));

  return (
    <div className="space-y-1.5 text-[11px]">
      {/* 1. Submitter Info */}
      <div className="text-muted-foreground flex items-center gap-1 flex-wrap">
        <span className="font-semibold text-foreground/80">Submitted by:</span>
        <span className="font-medium text-foreground">{request.submitted_by_name || "Operations Team"}</span>
        <span className="text-muted-foreground text-[10px]">({request.submitted_by_role || "Operations"})</span>
        {request.created_at && (
          <span className="text-[10px] text-muted-foreground/80">• {formatActionDate(request.created_at)}</span>
        )}
      </div>

      {/* 2. Reviewer / Current Decision Status */}
      {request.status === "pending" && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <span className="font-semibold text-foreground/80">Pending:</span>
          <span className={`font-medium ${request.target_team === "CS Team" || request.forwarded_to_cs ? "text-purple-600 dark:text-purple-400 font-semibold" : "text-amber-600 dark:text-amber-400"}`}>
            {request.target_team === "CS Team" || request.forwarded_to_cs ? "CS Team Review" : "Event Team Review"}
          </span>
        </div>
      )}

      {request.status !== "pending" && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {request.status === "approved" && (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
              <Check className="h-3 w-3 text-emerald-600 shrink-0" />
              <span className="font-semibold">Approved by:</span>
              <span>{request.reviewed_by_name || "Lab Manager"}</span>
              <span className="text-muted-foreground text-[10px]">({request.reviewed_by_role || "Event Team"})</span>
            </span>
          )}

          {request.status === "rejected" && (
            <span className="flex items-center gap-1 text-rose-700 dark:text-rose-300 font-medium">
              <X className="h-3 w-3 text-rose-600 shrink-0" />
              <span className="font-semibold">Rejected by:</span>
              <span>{request.reviewed_by_name || "Lab Manager"}</span>
              <span className="text-muted-foreground text-[10px]">({request.reviewed_by_role || "Event Team"})</span>
            </span>
          )}

          {request.status === "contacted" && (
            <span className="flex items-center gap-1 text-blue-700 dark:text-blue-300 font-medium">
              <PhoneCall className="h-3 w-3 text-blue-600 shrink-0" />
              <span className="font-semibold">Contacted by:</span>
              <span>{request.reviewed_by_name || "CS Agent"}</span>
              <span className="text-muted-foreground text-[10px]">({request.reviewed_by_role || "CS Team"})</span>
            </span>
          )}

          {request.status === "resolved" && (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
              <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
              <span className="font-semibold">Resolved by:</span>
              <span>{request.reviewed_by_name || "Operations / CS Team"}</span>
              <span className="text-muted-foreground text-[10px]">({request.reviewed_by_role || "Resolved"})</span>
            </span>
          )}

          {isOverridden && (
            <Badge
              variant="outline"
              className="text-[9px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-0.5 py-0"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              Overridden
            </Badge>
          )}

          {request.updated_at && (
            <span className="text-[10px] text-muted-foreground/80">• {formatActionDate(request.updated_at)}</span>
          )}
        </div>
      )}

      {/* 3. Reviewer Comment / Reply Note Box */}
      {latestComment && (
        <div className="mt-1 p-2 rounded-md bg-muted/60 border border-border/80 text-[11px] text-foreground/90 flex items-start gap-2 shadow-2xs">
          <MessageSquare className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="text-[10px] font-bold text-primary flex items-center gap-1">
              <span>Decision / Operational Note</span>
              <span className="font-normal text-muted-foreground">({request.reviewed_by_name || "Reviewer"})</span>:
            </div>
            <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
              "{latestComment}"
            </p>
          </div>
        </div>
      )}

      {/* 4. Action History Timeline (Collapsible when multiple actions exist) */}
      {history.length > 0 && (
        <div className="pt-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-primary hover:text-primary/80 hover:bg-primary/5 flex items-center gap-1 font-semibold"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-3 w-3" />
            <span>Audit History ({history.length} {history.length === 1 ? "action" : "actions"})</span>
            {showHistory ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
          </Button>

          {showHistory && (
            <div className="mt-1.5 pl-2 border-l-2 border-primary/30 space-y-2 py-1 bg-muted/20 rounded-r p-2 text-[10px]">
              {history.map((action, idx) => {
                const isActionOverride = action.is_override;
                return (
                  <div key={idx} className="space-y-0.5 relative">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-muted-foreground">{idx + 1}.</span>
                      <Badge
                        className={`text-[9px] uppercase font-bold py-0 ${
                          action.action === "approved"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                            : action.action === "rejected"
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30"
                            : action.action === "resolved"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                            : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
                        }`}
                      >
                        {action.action}
                      </Badge>

                      {isActionOverride && (
                        <Badge variant="outline" className="text-[8px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40 py-0">
                          Override
                        </Badge>
                      )}

                      <span className="font-medium text-foreground">
                        {action.by_name} <span className="text-muted-foreground">({action.by_role})</span>
                      </span>

                      <span className="text-[9px] text-muted-foreground">
                        • {formatActionDate(action.timestamp)}
                      </span>
                    </div>

                    {action.comment && (
                      <div className="ml-4 pl-1.5 border-l border-muted-foreground/30 text-muted-foreground italic text-[10px]">
                        "{action.comment}"
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
