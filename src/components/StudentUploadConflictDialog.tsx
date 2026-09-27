import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, FileText, Layers, RefreshCw, GitMerge, CheckCircle2 } from "lucide-react";
import type { BatchStudentUploadRecord, StudentMergeStrategy } from "@/lib/batch-allocation-storage";

interface StudentUploadConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingUpload: BatchStudentUploadRecord | null;
  incomingFileName: string;
  incomingStudentCount: number;
  onResolve: (strategy: StudentMergeStrategy) => void;
  onCancel: () => void;
}

export function StudentUploadConflictDialog({
  open,
  onOpenChange,
  existingUpload,
  incomingFileName,
  incomingStudentCount,
  onResolve,
  onCancel,
}: StudentUploadConflictDialogProps) {
  const [strategy, setStrategy] = useState<StudentMergeStrategy>("replace");

  const existingCount = existingUpload?.student_count || existingUpload?.students?.length || 0;
  const existingName = existingUpload?.file_name || "Existing Upload";
  const existingDate = existingUpload?.updated_at || existingUpload?.created_at;
  const formattedDate = existingDate
    ? new Date(existingDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "previously";

  const handleConfirm = () => {
    onResolve(strategy);
    onOpenChange(false);
  };

  const handleClose = () => {
    onCancel();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Batch Student Data Already Exists
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            This batch already has uploaded student demand data. Choose how you would like to handle the new file.
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 space-y-4">
          {/* Comparison Cards */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg border bg-muted/30 space-y-1.5">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" /> Current Dataset
              </div>
              <div className="text-muted-foreground truncate font-mono text-[11px]" title={existingName}>
                {existingName}
              </div>
              <div className="text-emerald-600 dark:text-emerald-400 font-bold">
                {existingCount.toLocaleString()} students
              </div>
              <div className="text-[10px] text-muted-foreground">Uploaded {formattedDate}</div>
            </div>

            <div className="p-3 rounded-lg border border-primary/40 bg-primary/5 space-y-1.5">
              <div className="font-semibold text-primary flex items-center gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" /> Incoming File
              </div>
              <div className="text-foreground truncate font-mono text-[11px]" title={incomingFileName}>
                {incomingFileName}
              </div>
              <div className="text-primary font-bold">
                {incomingStudentCount.toLocaleString()} students
              </div>
              <div className="text-[10px] text-muted-foreground">Ready to process</div>
            </div>
          </div>

          {/* Strategy Selection Buttons */}
          <div className="space-y-2.5 pt-1">
            {/* 1. Replace */}
            <div
              onClick={() => setStrategy("replace")}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                strategy === "replace"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border/70 hover:bg-muted/40"
              }`}
              role="button"
              tabIndex={0}
            >
              <div className="mt-0.5">
                <div
                  className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                    strategy === "replace" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                  }`}
                >
                  {strategy === "replace" && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                  <RefreshCw className="h-3.5 w-3.5 text-amber-500" /> Replace Existing Dataset (Recommended)
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Discard the {existingCount.toLocaleString()} existing students and use only the new {incomingStudentCount.toLocaleString()} records.
                </p>
              </div>
            </div>

            {/* 2. Merge (Overwrite Duplicates) */}
            <div
              onClick={() => setStrategy("merge_overwrite")}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                strategy === "merge_overwrite"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border/70 hover:bg-muted/40"
              }`}
              role="button"
              tabIndex={0}
            >
              <div className="mt-0.5">
                <div
                  className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                    strategy === "merge_overwrite" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                  }`}
                >
                  {strategy === "merge_overwrite" && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                  <GitMerge className="h-3.5 w-3.5 text-blue-500" /> Merge &amp; Overwrite Conflicting S_IDs
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Combine both datasets. If an <code className="font-mono text-[10px]">S_ID</code> exists in both files, the new upload's values take precedence.
                </p>
              </div>
            </div>

            {/* 3. Merge (Skip Duplicates) */}
            <div
              onClick={() => setStrategy("merge_skip")}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                strategy === "merge_skip"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border/70 hover:bg-muted/40"
              }`}
              role="button"
              tabIndex={0}
            >
              <div className="mt-0.5">
                <div
                  className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                    strategy === "merge_skip" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                  }`}
                >
                  {strategy === "merge_skip" && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                  <Layers className="h-3.5 w-3.5 text-purple-500" /> Merge &amp; Keep Existing on Conflicts
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Add only new student records. Existing students with matching <code className="font-mono text-[10px]">S_ID</code> are preserved unchanged.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={handleClose}>
            Cancel Upload
          </Button>
          <Button size="sm" onClick={handleConfirm} className="font-semibold gap-1.5">
            Proceed with {strategy === "replace" ? "Replace" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
