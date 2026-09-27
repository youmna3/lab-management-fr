import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, Ban, Calendar, ChevronDown, Layers, Plus, Trash2 } from "lucide-react";
import type { MegaGroupDefinition } from "@/lib/allocation-client";
import {
  deriveMegaGroupActiveDates,
  getLatestValidMegaGroupEndDate,
  validateMegaGroupDateRange,
} from "@/lib/lab-allocation-runner/schedule";
import { formatGradeLevel, getGradeLevelOptions, parseGradeLevel, type ProjectProgram } from "@/lib/project-grade-levels";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BatchBlockedDaysAndMegaGroupsProps {
  dates: string[];
  blockedDays: string[];
  onBlockedDaysChange: (days: string[]) => void;
  megaGroups: MegaGroupDefinition[];
  onMegaGroupsChange: (groups: MegaGroupDefinition[]) => void;
  program: ProjectProgram;
  distributionMode: "single_session" | "multi_session";
  sessionsPerGroup: number;
  disabled?: boolean;
}

export function BatchBlockedDaysAndMegaGroups({
  dates,
  blockedDays,
  onBlockedDaysChange,
  megaGroups,
  onMegaGroupsChange,
  program,
  distributionMode,
  sessionsPerGroup,
  disabled = false,
}: BatchBlockedDaysAndMegaGroupsProps) {
  const [megaGroupsOpen, setMegaGroupsOpen] = React.useState(megaGroups.length > 0);
  const gradeOptions = getGradeLevelOptions(program);
  const inheritedSessionsPerGroup = distributionMode === "multi_session" ? Math.max(2, sessionsPerGroup) : 1;

  const toggleDayBlocked = (d: string) => {
    if (disabled) return;
    if (blockedDays.includes(d)) {
      onBlockedDaysChange(blockedDays.filter((x) => x !== d));
    } else {
      onBlockedDaysChange([...blockedDays, d].sort());
    }
  };

  const blockDayOfWeek = (targetDayOfWeek: number) => {
    if (disabled) return;
    const toBlock = dates.filter((d) => {
      const dt = new Date(`${d}T00:00:00`);
      return dt.getDay() === targetDayOfWeek;
    });
    const combined = Array.from(new Set([...blockedDays, ...toBlock])).sort();
    onBlockedDaysChange(combined);
  };

  const clearBlockedDays = () => {
    if (disabled) return;
    onBlockedDaysChange([]);
  };

  const addMegaGroup = () => {
    if (disabled || dates.length === 0) return;
    const defaultStart = dates[0] || "";
    const defaultEnd = getLatestValidMegaGroupEndDate(
      dates,
      defaultStart,
      blockedDays,
      inheritedSessionsPerGroup,
    ) || defaultStart;
    const nextIndex = megaGroups.length + 1;
    const newGroup: MegaGroupDefinition = {
      name: `Mega Group ${nextIndex}`,
      start_date: defaultStart,
      end_date: defaultEnd,
    };
    onMegaGroupsChange([...megaGroups, newGroup]);
    setMegaGroupsOpen(true);
  };

  const updateMegaGroup = (index: number, patch: Partial<MegaGroupDefinition>) => {
    if (disabled) return;
    const updated = megaGroups.map((mg, i) => (i === index ? { ...mg, ...patch } : mg));
    onMegaGroupsChange(updated);
  };

  const removeMegaGroup = (index: number) => {
    if (disabled) return;
    onMegaGroupsChange(megaGroups.filter((_, i) => i !== index));
  };

  const formatDayLabel = (dateStr: string) => {
    try {
      const dt = new Date(`${dateStr}T00:00:00`);
      const dayName = dt.toLocaleDateString("en-US", { weekday: "short" });
      return `${dateStr} (${dayName})`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-3">
      {/* Blocked Days / Day-Off Section */}
      <div className="grid gap-2 p-3 rounded-lg border border-border/80 bg-muted/20">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            <Ban className="h-3.5 w-3.5 text-rose-500" />
            Blocked Days &amp; Days Off
          </Label>
          <div className="flex items-center gap-1.5">
            {blockedDays.length > 0 ? (
              <Badge variant="destructive" className="text-[10px] font-medium py-0 h-5">
                {blockedDays.length} blocked day{blockedDays.length === 1 ? "" : "s"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground py-0 h-5">
                0 blocked
              </Badge>
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground leading-tight">
          Click any date to exclude it from the solver grid. No lab slots or sessions will be scheduled on blocked days.
        </p>

        {dates.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 pt-1">
              {dates.map((d) => {
                const isBlocked = blockedDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleDayBlocked(d)}
                    className={`text-xs px-2.5 py-1 rounded-md border font-mono transition-all flex items-center gap-1.5 ${
                      isBlocked
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40 line-through font-semibold shadow-xs"
                        : "bg-background text-foreground/80 border-border/70 hover:border-primary/50 hover:bg-muted/50"
                    }`}
                  >
                    {isBlocked && <Ban className="h-3 w-3 text-rose-500 no-underline shrink-0" />}
                    <span>{formatDayLabel(d)}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-muted-foreground font-medium">Quick actions:</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                onClick={() => blockDayOfWeek(5)} // 5 = Friday
                disabled={disabled}
              >
                + Block Fridays
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                onClick={() => blockDayOfWeek(4)} // 4 = Thursday
                disabled={disabled}
              >
                + Block Thursdays
              </Button>
              {blockedDays.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  onClick={clearBlockedDays}
                  disabled={disabled}
                >
                  Clear All
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground italic py-1">
            Configure batch dates above to toggle blocked days.
          </div>
        )}
      </div>

      {/* Mega Groups / Sub-Batches Section */}
      <div className="grid gap-2 p-3 rounded-lg border border-border/80 bg-muted/20">
        <Collapsible open={megaGroupsOpen} onOpenChange={setMegaGroupsOpen}>
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors text-left"
              >
                <Layers className="h-3.5 w-3.5 text-indigo-500" />
                <span>Mega Groups &amp; Sub-Batches</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
                    megaGroupsOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <div className="flex items-center gap-1.5">
              {megaGroups.length > 0 && (
                <Badge variant="outline" className="text-[10px] font-medium py-0 h-5 text-indigo-600 border-indigo-300 dark:border-indigo-800">
                  {megaGroups.length} sub-batch{megaGroups.length === 1 ? "" : "es"}
                </Badge>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 gap-1"
                onClick={addMegaGroup}
                disabled={disabled || dates.length === 0}
              >
                <Plus className="h-3 w-3" />
                Add Mega Group
              </Button>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-tight pt-1">
            Partition cohort students into independent sub-batches with isolated date ranges. The solver guarantees students only get scheduled within their assigned date window.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-indigo-200/70 bg-indigo-50/40 px-2.5 py-2 text-[11px] dark:border-indigo-900/60 dark:bg-indigo-950/20">
            <span className="font-semibold text-foreground">Group Distribution:</span>
            <span>{distributionMode === "multi_session" ? "Multi-Session" : "Single-Session"}</span>
            <Badge variant="outline" className="h-5 text-[10px]">
              {inheritedSessionsPerGroup} {inheritedSessionsPerGroup === 1 ? "day" : "days"}/group
            </Badge>
            <span className="text-muted-foreground">Inherited from Batch Settings</span>
          </div>

          <CollapsibleContent className="space-y-2.5 pt-3">
            {megaGroups.length === 0 ? (
              <div className="text-center p-3 rounded border border-dashed border-border/60 bg-background/50 text-[11px] text-muted-foreground">
                No mega groups defined. The entire cohort will be scheduled across the full batch date range.
              </div>
            ) : (
              megaGroups.map((mg, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-md border border-border bg-card space-y-2 shadow-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="text-[10px] font-bold text-muted-foreground font-mono">#{idx + 1}</span>
                      <Input
                        value={mg.name}
                        onChange={(e) => updateMegaGroup(idx, { name: e.target.value })}
                        placeholder="Mega Group Name (e.g. Cohort A - Week 1)"
                        className="h-7 text-xs font-semibold"
                        disabled={disabled}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeMegaGroup(idx)}
                      disabled={disabled}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-muted-foreground">Start Date</Label>
                      <Select
                        value={mg.start_date || dates[0]}
                        onValueChange={(v) => {
                          updateMegaGroup(idx, {
                            start_date: v,
                            end_date: !mg.end_date || mg.end_date < v ? v : mg.end_date,
                          });
                        }}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-7 text-xs bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dates.map((d) => (
                            <SelectItem key={d} value={d} className="text-xs">
                              {formatDayLabel(d)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-1">
                      <Label className="text-[10px] text-muted-foreground">End Date</Label>
                      <Select
                        value={mg.end_date || dates[dates.length - 1]}
                        onValueChange={(v) => updateMegaGroup(idx, { end_date: v })}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-7 text-xs bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dates
                            .filter((d) => !mg.start_date || d >= mg.start_date)
                            .map((d) => (
                              <SelectItem key={d} value={d} className="text-xs">
                                {formatDayLabel(d)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {(() => {
                    const scheduledDates = dates.filter(
                      (date) => (!mg.start_date || date >= mg.start_date) && (!mg.end_date || date <= mg.end_date),
                    );
                    const activeDates = deriveMegaGroupActiveDates(dates, mg, blockedDays);
                    const blockedCount = scheduledDates.length - activeDates.length;
                    const validation = validateMegaGroupDateRange(
                      dates,
                      mg,
                      blockedDays,
                      inheritedSessionsPerGroup,
                    );
                    return (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-[11px]">
                          <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                          <span className="font-semibold">{activeDates.length} active day{activeDates.length === 1 ? "" : "s"}</span>
                          {activeDates.length > inheritedSessionsPerGroup ? (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              ({inheritedSessionsPerGroup} primary + {activeDates.length - inheritedSessionsPerGroup} overflow reserve)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">of {inheritedSessionsPerGroup} standard limit</span>
                          )}
                          {blockedCount > 0 && <span className="text-rose-600">{blockedCount} blocked</span>}
                        </div>
                        {!validation.valid && (
                          <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{validation.message}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-muted-foreground">Target Grades / Levels <span className="text-[9px]">(Optional)</span></Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="outline" className="h-7 w-full justify-between px-2 text-[11px] font-normal" disabled={disabled}>
                            {mg.grades?.length
                              ? mg.grades.length === 1
                                ? formatGradeLevel(mg.grades[0], program)
                                : `${mg.grades.length} selected`
                              : "All grades / levels"}
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="max-h-72 w-72 overflow-y-auto" align="start">
                          {gradeOptions.map((option) => {
                            const selected = (mg.grades ?? []).some((value) => parseGradeLevel(value, program) === option.value);
                            return (
                              <DropdownMenuCheckboxItem
                                key={option.value}
                                checked={selected}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(checked) => {
                                  const current = (mg.grades ?? [])
                                    .map((value) => parseGradeLevel(value, program))
                                    .filter((value): value is number => value != null);
                                  const next = checked
                                    ? Array.from(new Set([...current, option.value]))
                                    : current.filter((value) => value !== option.value);
                                  updateMegaGroup(idx, { grades: next.length ? next : undefined });
                                }}
                              >
                                {option.label}
                              </DropdownMenuCheckboxItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px] text-muted-foreground">
                        Target Areas <span className="text-[9px]">(Optional, comma separated)</span>
                      </Label>
                      <Input
                        value={mg.areas?.join(", ") || ""}
                        onChange={(e) => {
                          const val = e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean);
                          updateMegaGroup(idx, { areas: val.length > 0 ? val : undefined });
                        }}
                        placeholder="All areas or e.g. Nasr City, Maadi"
                        className="h-7 text-[11px]"
                        disabled={disabled}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
