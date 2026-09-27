import React, { useState, useMemo, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SlidersHorizontal,
  Plus,
  Trash2,
  Sparkles,
  Users,
  Building2,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import type {
  AllocationPreferences,
  OverfillRule,
  PreferredLabRule,
  ExtraLabDefinition,
  AreaGradeSummaryRow,
  LabPivotRow,
  SlotIdTemplate,
} from "@/lib/allocation-client";
import { formatGradeLevel, sortGradeLevels } from "@/lib/project-grade-levels";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areaGradeSummary: AreaGradeSummaryRow[];
  labPivot: LabPivotRow[];
  currentPreferences: AllocationPreferences;
  onApplyPreferences: (prefs: AllocationPreferences) => Promise<void>;
  loading?: boolean;
}

const TIME_SLOTS = [
  { num: 1, label: "Thu 9 AM (Morning)" },
  { num: 2, label: "Thu 12 PM (Afternoon)" },
  { num: 3, label: "Thu 3 PM (Evening)" },
  { num: 4, label: "Thu 6 PM (Night)" },
  { num: 5, label: "Fri 9 AM (Morning)" },
  { num: 6, label: "Fri 3 PM (Evening)" },
  { num: 7, label: "Fri 6 PM (Night)" },
];

export function AllocationPreferencesDialog({
  open,
  onOpenChange,
  areaGradeSummary,
  labPivot,
  currentPreferences,
  onApplyPreferences,
  loading = false,
}: Props) {
  // Staged preferences
  const [preferences, setPreferences] = useState<AllocationPreferences>(currentPreferences);

  // Hierarchy Step 1: Area
  const uniqueAreas = useMemo(() => {
    const set = new Set<string>();
    areaGradeSummary.forEach((r) => r["Physical Area"] && set.add(r["Physical Area"]));
    labPivot.forEach((r) => r["Physical Area"] && set.add(r["Physical Area"]));
    return Array.from(set).sort();
  }, [areaGradeSummary, labPivot]);

  const [selectedArea, setSelectedArea] = useState<string>(uniqueAreas[0] || "");

  const allAvailableGrades = useMemo(
    () => sortGradeLevels(areaGradeSummary.map((row) => Number(row.Grade)).filter(Number.isFinite)),
    [areaGradeSummary],
  );

  // Hierarchy Step 2: Available Grades in selected Area
  const availableGradesInArea = useMemo(() => {
    if (!selectedArea) return allAvailableGrades;
    const rows = areaGradeSummary.filter((r) => r["Physical Area"] === selectedArea);
    if (rows.length === 0) return allAvailableGrades;
    return sortGradeLevels(rows.map((r) => Number(r.Grade)).filter(Number.isFinite));
  }, [areaGradeSummary, selectedArea, allAvailableGrades]);

  const [selectedGrades, setSelectedGrades] = useState<number[]>(() => allAvailableGrades);

  useEffect(() => {
    setSelectedGrades(availableGradesInArea);
  }, [availableGradesInArea]);

  // Hierarchy Step 3: Available Labs in selected Area
  const availableLabsInArea = useMemo(() => {
    if (!selectedArea) return [];
    const set = new Set<string>();
    labPivot
      .filter((r) => r["Physical Area"] === selectedArea)
      .forEach((r) => r.Lab_ID && set.add(r.Lab_ID));
    return Array.from(set).sort();
  }, [labPivot, selectedArea]);

  // Tab 1 (Overfill) form state
  const [overfillMax, setOverfillMax] = useState<number>(2);
  const [overfillLabTarget, setOverfillLabTarget] = useState<string>("ALL");

  // Tab 2 (Preferred Lab) form state
  const [preferredLabId, setPreferredLabId] = useState<string>(availableLabsInArea[0] || "");
  const [preferredSlotNum, setPreferredSlotNum] = useState<string>("ALL");

  // Tab 3 (Extra Lab) form state
  const [extraLabId, setExtraLabId] = useState("");
  const [extraLabCapacity, setExtraLabCapacity] = useState<number>(25);

  // When area changes, update defaults
  React.useEffect(() => {
    if (uniqueAreas.length > 0 && !uniqueAreas.includes(selectedArea)) {
      setSelectedArea(uniqueAreas[0]);
    }
  }, [uniqueAreas]);

  React.useEffect(() => {
    setSelectedGrades(availableGradesInArea);
    setPreferredLabId(availableLabsInArea[0] || "");
  }, [selectedArea, availableGradesInArea, availableLabsInArea]);

  React.useEffect(() => {
    setPreferences(currentPreferences);
  }, [currentPreferences, open]);

  // Helpers for Grade toggle
  const toggleGrade = (grade: number) => {
    setSelectedGrades((prev) =>
      prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade].sort()
    );
  };

  const selectAllGrades = () => {
    setSelectedGrades(availableGradesInArea);
  };

  // Add Overfill Rule
  const handleAddOverfillRule = () => {
    if (!selectedArea || selectedGrades.length === 0) return;
    const newRule: OverfillRule = {
      area: selectedArea,
      grades: selectedGrades,
      labIds: overfillLabTarget === "ALL" ? ["ALL"] : [overfillLabTarget],
      maxOverfillPerLab: overfillMax,
    };
    setPreferences((prev) => ({
      ...prev,
      overfillRules: [
        ...prev.overfillRules.filter(
          (r) =>
            !(
              r.area === selectedArea &&
              JSON.stringify(r.grades) === JSON.stringify(selectedGrades) &&
              JSON.stringify(r.labIds) === JSON.stringify(newRule.labIds)
            )
        ),
        newRule,
      ],
    }));
  };

  // Add Preferred Lab Rule
  const handleAddPreferredLabRule = () => {
    if (!selectedArea || !preferredLabId || selectedGrades.length === 0) return;
    const newRule: PreferredLabRule = {
      area: selectedArea,
      grades: selectedGrades,
      labId: preferredLabId,
      slotNum: preferredSlotNum === "ALL" ? undefined : Number(preferredSlotNum),
    };
    setPreferences((prev) => ({
      ...prev,
      preferredLabRules: [
        ...prev.preferredLabRules.filter(
          (r) =>
            !(
              r.area === selectedArea &&
              r.labId === preferredLabId &&
              r.slotNum === newRule.slotNum
            )
        ),
        newRule,
      ],
    }));
  };

  // Add Extra Lab
  const handleAddExtraLab = () => {
    if (!selectedArea || !extraLabId.trim()) return;
    const newExtra: ExtraLabDefinition = {
      area: selectedArea,
      labId: extraLabId.trim().toUpperCase(),
      capacity: extraLabCapacity,
      slots: [1, 2, 3, 4, 5, 6, 7],
    };
    setPreferences((prev) => ({
      ...prev,
      extraLabs: [
        ...prev.extraLabs.filter((l) => l.labId !== newExtra.labId),
        newExtra,
      ],
    }));
    setExtraLabId("");
  };

  // Remove rule helpers
  const removeOverfillRule = (idx: number) => {
    setPreferences((prev) => ({
      ...prev,
      overfillRules: prev.overfillRules.filter((_, i) => i !== idx),
    }));
  };

  const removePreferredLabRule = (idx: number) => {
    setPreferences((prev) => ({
      ...prev,
      preferredLabRules: prev.preferredLabRules.filter((_, i) => i !== idx),
    }));
  };

  const removeExtraLab = (idx: number) => {
    setPreferences((prev) => ({
      ...prev,
      extraLabs: prev.extraLabs.filter((_, i) => i !== idx),
    }));
  };

  const resetAllPreferences = () => {
    setPreferences({
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
    });
  };

  const totalRulesCount =
    preferences.overfillRules.length +
    preferences.preferredLabRules.length +
    preferences.extraLabs.length;

  const handleApply = async () => {
    await onApplyPreferences(preferences);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              Explore Allocation Alternatives &amp; Preferences
            </DialogTitle>
            {totalRulesCount > 0 && (
              <Badge className="bg-primary/20 text-primary border-primary/30 font-semibold text-xs">
                {totalRulesCount} Staged Rule(s)
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs">
            Hierarchically choose <strong>Area → Grade(s) → Lab</strong> to configure fair overfills (+2 max per lab) or request preferred/extra lab sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* HIERARCHY SELECTOR BOX */}
          <div className="p-4 rounded-xl border border-primary/20 bg-muted/30 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <span>Step 1 &amp; 2: Target Area &amp; Grade Cohorts</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* 1. Area Selection */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" /> 1. Select Physical Area
                </Label>
                <Select value={selectedArea} onValueChange={setSelectedArea}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Choose physical area" />
                  </SelectTrigger>
                  <SelectContent>
                    {uniqueAreas.map((area) => (
                      <SelectItem key={area} value={area}>
                        {area}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Slot ID Format (Pre-Allocation Setting) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-primary" /> Slot ID Format (Max 6 Chars)
                </Label>
                <Select
                  value={preferences.slotIdTemplate || "original"}
                  onValueChange={(v) =>
                    setPreferences((prev) => ({ ...prev, slotIdTemplate: v as SlotIdTemplate }))
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Slot ID Template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="original">Keep Original (SLOT-LAB-DAY-TIME)</SelectItem>
                    <SelectItem value="template_a">Template A — Pure Integer (14000, 14001)</SelectItem>
                    <SelectItem value="template_b">Template B — Mixed (L556G4, L123G4)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 2. Grade Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-primary" /> 2. Select Grade(s) in {selectedArea}
                  </Label>
                  <button
                    type="button"
                    onClick={selectAllGrades}
                    className="text-[10px] text-primary hover:underline font-medium"
                  >
                    Select All
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {availableGradesInArea.map((g) => {
                    const active = selectedGrades.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => toggleGrade(g)}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-all ${
                          active
                            ? g === 4
                              ? "bg-[#056FEC] text-white border-[#056FEC] shadow-xs"
                              : g === 5
                              ? "bg-[#FF7F1C] text-white border-[#FF7F1C] shadow-xs"
                              : "bg-[#05ACFF] text-white border-[#05ACFF] shadow-xs"
                            : "bg-background text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {formatGradeLevel(g)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* HIERARCHY STEP 3: ACTION TABS */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Step 3: Choose Alternative Action for {selectedArea} (Grades: {selectedGrades.join(", ")})
            </div>

            <Tabs defaultValue="overfill" className="w-full">
              <TabsList className="grid grid-cols-3 h-9">
                <TabsTrigger value="overfill" className="text-xs">
                  ⚡ Fair Overfill (+2 Max)
                </TabsTrigger>
                <TabsTrigger value="preferred" className="text-xs">
                  ⭐ Request Preferred Lab
                </TabsTrigger>
                <TabsTrigger value="extra" className="text-xs">
                  ➕ Add Extra Lab
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: OVERFILL */}
              <TabsContent value="overfill" className="p-4 rounded-xl border space-y-4 mt-2">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    Equally &amp; Fairly Balanced Overfill
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Allows a maximum of <strong>2 extra students per lab session</strong>. The mathematical solver distributes extra students <strong>as equally and fairly as possible</strong> across eligible labs without manual slot assignment.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Max Overfill per Lab Session</Label>
                    <Select
                      value={String(overfillMax)}
                      onValueChange={(v) => setOverfillMax(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">+1 Extra Student / Lab</SelectItem>
                        <SelectItem value="2">+2 Extra Students / Lab (Max Allowed)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Target Labs in {selectedArea}</Label>
                    <Select value={overfillLabTarget} onValueChange={setOverfillLabTarget}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Labs in {selectedArea} (Fair Round-Robin)</SelectItem>
                        {availableLabsInArea.map((lab) => (
                          <SelectItem key={lab} value={lab}>
                            {lab} Only
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddOverfillRule}
                  disabled={selectedGrades.length === 0}
                  className="w-full gap-1.5 h-8 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" /> Stage Overfill Rule (+{overfillMax} for {selectedArea})
                </Button>
              </TabsContent>

              {/* TAB 2: REQUEST PREFERRED LAB */}
              <TabsContent value="preferred" className="p-4 rounded-xl border space-y-4 mt-2">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-blue-500" />
                    Request Another / Preferred Lab
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Prioritizes assigning your selected grade cohort to a specific lab or time slot in {selectedArea}.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Preferred Lab in {selectedArea}</Label>
                    <Select value={preferredLabId} onValueChange={setPreferredLabId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select lab" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableLabsInArea.map((lab) => (
                          <SelectItem key={lab} value={lab}>
                            {lab}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Preferred Weekly Time Slot</Label>
                    <Select value={preferredSlotNum} onValueChange={setPreferredSlotNum}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Any Available Slot</SelectItem>
                        {TIME_SLOTS.map((s) => (
                          <SelectItem key={s.num} value={String(s.num)}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddPreferredLabRule}
                  disabled={!preferredLabId || selectedGrades.length === 0}
                  className="w-full gap-1.5 h-8 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" /> Stage Preferred Lab Request
                </Button>
              </TabsContent>

              {/* TAB 3: ADD EXTRA LAB */}
              <TabsContent value="extra" className="p-4 rounded-xl border space-y-4 mt-2">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-emerald-500" />
                    Introduce Additional Physical Lab
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Add a newly available lab to {selectedArea} with 7 weekly sessions to accommodate extra demand.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <Label className="text-xs">New Lab ID</Label>
                    <Input
                      value={extraLabId}
                      onChange={(e) => setExtraLabId(e.target.value)}
                      placeholder={`e.g. ${selectedArea.replace(/\s+/g, "_").toUpperCase()}_EXTRA_1`}
                      className="h-8 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Seat Capacity per Session</Label>
                    <Input
                      type="number"
                      value={extraLabCapacity}
                      onChange={(e) => setExtraLabCapacity(Number(e.target.value))}
                      min={10}
                      max={100}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddExtraLab}
                  disabled={!extraLabId.trim()}
                  className="w-full gap-1.5 h-8 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" /> Stage Extra Lab ({extraLabCapacity} Seats)
                </Button>
              </TabsContent>
            </Tabs>
          </div>

          {/* ACTIVE RULES SUMMARY LIST */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Active Alternative Rules ({totalRulesCount})
              </span>
              {totalRulesCount > 0 && (
                <button
                  type="button"
                  onClick={resetAllPreferences}
                  className="text-xs text-destructive hover:underline flex items-center gap-1"
                >
                  <RotateCcw className="h-3 w-3" /> Clear All
                </button>
              )}
            </div>

            {totalRulesCount === 0 ? (
              <div className="p-3 rounded-lg border border-dashed text-center text-xs text-muted-foreground bg-muted/10">
                No custom overfills or preferred lab rules staged. Normal distribution is applied.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {/* Overfill rules */}
                {preferences.overfillRules.map((rule, idx) => (
                  <div
                    key={`of-${idx}`}
                    className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-50/10 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Badge className="bg-amber-600 text-white text-[10px] shrink-0 font-bold">
                        Overfill +{rule.maxOverfillPerLab}
                      </Badge>
                      <span className="font-semibold text-foreground truncate">
                        {rule.area}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        • Grades: {rule.grades.join(", ")}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        • Labs: {rule.labIds.join(", ")}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeOverfillRule(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}

                {/* Preferred lab rules */}
                {preferences.preferredLabRules.map((rule, idx) => (
                  <div
                    key={`pref-${idx}`}
                    className="p-2.5 rounded-lg border border-blue-500/30 bg-blue-50/10 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Badge className="bg-blue-600 text-white text-[10px] shrink-0 font-bold">
                        Preferred Lab
                      </Badge>
                      <span className="font-semibold text-foreground truncate">
                        {rule.labId} in {rule.area}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        • Grades: {rule.grades.join(", ")}
                      </span>
                      {rule.slotNum && (
                        <span className="text-muted-foreground text-[11px]">
                          • Slot {rule.slotNum}
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removePreferredLabRule(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}

                {/* Extra lab rules */}
                {preferences.extraLabs.map((extra, idx) => (
                  <div
                    key={`ext-${idx}`}
                    className="p-2.5 rounded-lg border border-[#056FEC]/30 bg-[#056FEC]/5 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Badge className="bg-[#056FEC] text-white text-[10px] shrink-0 font-bold">
                        Extra Lab
                      </Badge>
                      <span className="font-semibold text-foreground font-mono truncate">
                        {extra.labId}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        ({extra.area} • {extra.capacity} seats/slot)
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeExtraLab(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-3 pt-3 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleApply}
            disabled={loading}
            className="gap-1.5 bg-primary text-primary-foreground font-bold shadow-xs"
          >
            <Sparkles className="h-4 w-4" />
            {loading ? "Recalculating Optimization..." : "Recalculate with Preferences"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
