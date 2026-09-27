import React, { useState, useMemo } from "react";
import { Plus, MapPin, Building2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EGYPTIAN_GOVERNORATES,
  getAreasForGov,
  isValidEgyptLocation,
  isValidEgyptGov,
} from "@/lib/egypt-areas";
import { PhysicalAreaCombobox } from "@/components/PhysicalAreaCombobox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface AddNeedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchName?: string;
  onNeedAdded: () => void;
}

export function AddNeedModal({
  open,
  onOpenChange,
  batchId,
  batchName,
  onNeedAdded,
}: AddNeedModalProps) {
  const [gov, setGov] = useState<string>("القاهرة");
  const [area, setArea] = useState<string>("مدينة نصر");
  const [labsRequired, setLabsRequired] = useState<string>("1");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filter physical areas by the selected governorate
  const areasForGov = useMemo(() => {
    return getAreasForGov(gov);
  }, [gov]);

  // When governorate changes, auto-select the first area in that governorate
  const handleGovChange = (newGov: string) => {
    setGov(newGov);
    setErrorMsg(null);
    const areas = getAreasForGov(newGov);
    if (areas.length > 0 && !areas.some((a) => a.area === area)) {
      setArea(areas[0].area);
    }
  };

  const handleAreaChange = (newArea: string) => {
    setArea(newArea);
    setErrorMsg(null);
    // Auto-update governorate if area belongs to a known governorate
    const matched = areasForGov.find((a) => a.area === newArea);
    if (matched && matched.gov !== gov) {
      setGov(matched.gov);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // 1. Validate Governorate
    if (!gov || !gov.trim()) {
      setErrorMsg("Please select a valid Governorate.");
      return;
    }
    if (!isValidEgyptGov(gov)) {
      setErrorMsg("Invalid Governorate. Please select from the approved list.");
      return;
    }

    // 2. Validate Physical Area
    if (!area || !area.trim()) {
      setErrorMsg("Please enter or select a Physical Area.");
      return;
    }
    const cleanArea = area.trim();
    if (!isValidEgyptLocation(cleanArea)) {
      setErrorMsg(
        "Invalid Physical Area name. Numbers and special characters are not allowed.",
      );
      return;
    }

    // 3. Validate Labs Required (> 0 integer)
    const count = Number(labsRequired);
    if (isNaN(count) || !Number.isInteger(count) || count <= 0) {
      setErrorMsg(
        "Labs required must be a positive whole number greater than 0 (e.g. 1, 2, 3).",
      );
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("batch_needs").insert({
        batch_id: batchId,
        gov: gov.trim(),
        area: cleanArea,
        labs_required: count,
      });

      if (error) {
        throw error;
      }

      toast.success(
        `Added need: ${cleanArea} (${gov}) — ${count} lab(s) required!`,
      );
      onNeedAdded();
      onOpenChange(false);
      // Reset defaults
      setGov("القاهرة");
      setArea("مدينة نصر");
      setLabsRequired("1");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to add area need.");
      toast.error(err.message || "Failed to add area need.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Building2 className="h-5 w-5 text-[#056FEC]" />
            Add Batch Area Need
          </DialogTitle>
          <DialogDescription className="text-xs">
            Specify physical lab demand requirements for{" "}
            <strong>{batchName || "this batch"}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {errorMsg && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Governorate Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              Governorate <span className="text-destructive">*</span>
            </Label>
            <Select value={gov} onValueChange={handleGovChange}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select Egyptian Governorate..." />
              </SelectTrigger>
              <SelectContent className="max-h-56">
                {EGYPTIAN_GOVERNORATES.map((g) => (
                  <SelectItem key={g.ar} value={g.ar}>
                    {g.ar} ({g.en})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Physical Area Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              Physical Area / City <span className="text-destructive">*</span>
            </Label>
            <PhysicalAreaCombobox
              value={area}
              onChange={handleAreaChange}
              placeholder="Search or select physical area..."
            />
            {areasForGov.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                <span className="text-[10px] text-muted-foreground">
                  Quick pick in {gov}:
                </span>
                {areasForGov.slice(0, 4).map((a) => (
                  <button
                    key={a.area}
                    type="button"
                    onClick={() => handleAreaChange(a.area)}
                    className="text-[10px] bg-muted hover:bg-muted/80 px-1.5 py-0.5 rounded border border-border/40 text-foreground transition-colors"
                  >
                    {a.area}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Labs Required */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              Labs Required <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min="1"
              step="1"
              value={labsRequired}
              onChange={(e) => {
                setLabsRequired(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="e.g. 1, 2, 3..."
              className="h-9 text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Must be a positive integer greater than 0 ($&gt; 0$).
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold gap-1.5"
            >
              <Plus className="h-4 w-4" />
              {submitting ? "Adding..." : "Add Need"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
