import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BATCH_TIME_SLOT_OPTIONS,
  BATCH_TIME_SLOT_PRESETS,
  DEFAULT_BATCH_TIME_SLOTS,
  formatTimeSlot,
  isSupportedBatchTimeSlot,
  MAX_SLOTS_PER_DAY,
  normalizeTimeSlot,
  sortTimeSlots,
} from "@/lib/time-slots";
import {
  Calendar,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

type BatchDayScheduleEditorProps = {
  dates: string[];
  daySlots: Record<string, string[]>;
  onChange: (newDaySlots: Record<string, string[]>) => void;
  onDatesChange?: (newDates: string[], newDaySlots: Record<string, string[]>) => void;
  onDateChange?: (oldDate: string, newDate: string) => void;
  allowDateEditing?: boolean;
  disabled?: boolean;
  minDate?: string;
};

export function BatchDayScheduleEditor({
  dates,
  daySlots,
  onChange,
  onDatesChange,
  onDateChange,
  allowDateEditing = true,
  disabled = false,
  minDate,
}: BatchDayScheduleEditorProps) {
  const [openPopoverDate, setOpenPopoverDate] = useState<string | null>(null);
  const [openDateChangerDate, setOpenDateChangerDate] = useState<string | null>(null);
  const [changerTargetDate, setChangerTargetDate] = useState<string>("");
  const [openAddDayPopover, setOpenAddDayPopover] = useState(false);
  const [newDayInputDate, setNewDayInputDate] = useState<string>("");

  const todayIso = useMemo(() => new Date().toLocaleDateString("en-CA"), []);
  const effectiveMinDate = minDate || todayIso;

  const sortedDates = useMemo(() => [...dates].sort(), [dates]);

  function formatDayHeader(dateStr: string): { dayName: string; formattedDate: string; fullWeekday: string } {
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) {
      return { dayName: "Day", formattedDate: dateStr, fullWeekday: "Day" };
    }
    const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
    const fullWeekday = d.toLocaleDateString("en-US", { weekday: "long" });
    const formattedDate = d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return { dayName, formattedDate, fullWeekday };
  }

  function handleToggleSlotForDate(date: string, rawSlot: string) {
    const norm = normalizeTimeSlot(rawSlot);
    if (!norm) return;

    const currentSlots = daySlots[date] || [];
    let updated: string[];
    if (currentSlots.includes(norm)) {
      updated = currentSlots.filter((s) => s !== norm);
    } else {
      if (currentSlots.length >= MAX_SLOTS_PER_DAY) {
        toast.error(`Maximum of ${MAX_SLOTS_PER_DAY} slots allowed per day.`);
        return;
      }
      updated = [...currentSlots, norm];
    }

    const updatedMap = {
      ...daySlots,
      [date]: sortTimeSlots(updated),
    };

    if (onDatesChange) {
      onDatesChange(sortedDates, updatedMap);
    } else {
      onChange(updatedMap);
    }
  }

  function handleRemoveSlot(date: string, slotToRemove: string) {
    const currentSlots = daySlots[date] || [];
    const updatedMap = {
      ...daySlots,
      [date]: currentSlots.filter((s) => s !== slotToRemove),
    };
    if (onDatesChange) {
      onDatesChange(sortedDates, updatedMap);
    } else {
      onChange(updatedMap);
    }
  }

  function handleApplyPresetToAll(slots: readonly string[] | string[]) {
    const next: Record<string, string[]> = {};
    sortedDates.forEach((d) => {
      next[d] = [...slots];
    });
    if (onDatesChange) {
      onDatesChange(sortedDates, next);
    } else {
      onChange(next);
    }
    toast.success(`Applied preset (${slots.length} slots) to all ${sortedDates.length} day(s).`);
  }

  function handleCopyFirstDayToAll() {
    if (sortedDates.length === 0) return;
    const firstDate = sortedDates[0];
    const firstSlots = daySlots[firstDate] || [];
    const next: Record<string, string[]> = {};
    sortedDates.forEach((d) => {
      next[d] = [...firstSlots];
    });
    if (onDatesChange) {
      onDatesChange(sortedDates, next);
    } else {
      onChange(next);
    }
    toast.success(`Copied Day 1 slots (${firstSlots.length} slots) to all days.`);
  }

  /**
   * Change / Swap the assigned calendar day of an existing batch day
   * e.g., switching Day 1 from 2026-09-10 (Thu) to 2026-09-09 (Wed)
   */
  function handleApplyDateChange(oldDate: string, newDate: string) {
    if (!newDate) return;
    if (newDate === oldDate) {
      setOpenDateChangerDate(null);
      return;
    }

    if (sortedDates.includes(newDate)) {
      toast.error(`"${newDate}" is already scheduled in this batch.`);
      return;
    }

    const nextDates = sortedDates.map((d) => (d === oldDate ? newDate : d)).sort();
    const nextDaySlots: Record<string, string[]> = {};

    sortedDates.forEach((d) => {
      if (d === oldDate) {
        nextDaySlots[newDate] = daySlots[oldDate] || [];
      } else {
        nextDaySlots[d] = daySlots[d] || [];
      }
    });

    const { fullWeekday: oldWeekday } = formatDayHeader(oldDate);
    const { fullWeekday: newWeekday, formattedDate: newFormatted } = formatDayHeader(newDate);

    onDateChange?.(oldDate, newDate);

    if (onDatesChange) {
      onDatesChange(nextDates, nextDaySlots);
    } else {
      onChange(nextDaySlots);
    }

    setOpenDateChangerDate(null);
    setChangerTargetDate("");
    toast.success(`Changed day from ${oldWeekday} (${oldDate}) to ${newWeekday} (${newFormatted})!`);
  }

  /**
   * Add a new calendar day to the batch
   */
  function handleAddNewDay(targetDate: string) {
    if (!targetDate) return;
    if (sortedDates.includes(targetDate)) {
      toast.error(`"${targetDate}" is already part of the batch.`);
      return;
    }

    const nextDates = [...sortedDates, targetDate].sort();
    const defaultSlots = sortedDates.length > 0 && daySlots[sortedDates[0]]?.length > 0
      ? [...daySlots[sortedDates[0]]]
      : [...DEFAULT_BATCH_TIME_SLOTS];

    const nextDaySlots: Record<string, string[]> = {
      ...daySlots,
      [targetDate]: defaultSlots,
    };

    const { fullWeekday, formattedDate } = formatDayHeader(targetDate);

    if (onDatesChange) {
      onDatesChange(nextDates, nextDaySlots);
    } else {
      onChange(nextDaySlots);
    }

    setOpenAddDayPopover(false);
    setNewDayInputDate("");
    toast.success(`Added ${fullWeekday}, ${formattedDate} to batch schedule.`);
  }

  /**
   * Remove a calendar day from the batch
   */
  function handleRemoveDay(dateToRemove: string) {
    if (sortedDates.length <= 1) {
      toast.error("Batch must have at least one calendar day.");
      return;
    }

    const nextDates = sortedDates.filter((d) => d !== dateToRemove);
    const nextDaySlots: Record<string, string[]> = { ...daySlots };
    delete nextDaySlots[dateToRemove];

    const { fullWeekday, formattedDate } = formatDayHeader(dateToRemove);

    if (onDatesChange) {
      onDatesChange(nextDates, nextDaySlots);
    } else {
      onChange(nextDaySlots);
    }

    toast.info(`Removed ${fullWeekday}, ${formattedDate} from schedule.`);
  }

  if (sortedDates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground bg-muted/20 space-y-2">
        <Calendar className="h-5 w-5 mx-auto mb-1 text-muted-foreground/60" />
        <p className="font-medium text-foreground">No calendar days scheduled yet.</p>
        {allowDateEditing && (
          <Popover open={openAddDayPopover} onOpenChange={setOpenAddDayPopover}>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="gap-1.5 mt-2 bg-background">
                <Plus className="h-3.5 w-3.5" /> Add First Calendar Day
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3 space-y-3" align="center">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Select Day</Label>
                <Input
                  type="date"
                  min={effectiveMinDate}
                  value={newDayInputDate}
                  onChange={(e) => setNewDayInputDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpenAddDayPopover(false)} className="h-7 text-xs">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleAddNewDay(newDayInputDate)}
                  disabled={!newDayInputDate}
                  className="h-7 text-xs bg-primary"
                >
                  Add Day
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    );
  }

  const totalSessionsAcrossBatch = sortedDates.reduce(
    (acc, d) => acc + (daySlots[d]?.length || 0),
    0,
  );

  return (
    <div className="space-y-3">
      {/* Top Presets & Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/40 border text-xs">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-medium text-foreground">
            {sortedDates.length} Day{sortedDates.length > 1 ? "s" : ""} •{" "}
            <strong className="text-primary">{totalSessionsAcrossBatch} Total Session Slots</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase font-semibold mr-1">
            Presets:
          </span>
          {BATCH_TIME_SLOT_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="h-6 px-2 text-[10px] font-medium bg-background"
              onClick={() => handleApplyPresetToAll(preset.values)}
            >
              <Sparkles className="h-2.5 w-2.5 mr-1 text-primary" />
              {preset.label}
            </Button>
          ))}
          {sortedDates.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={handleCopyFirstDayToAll}
              title="Copy Day 1 slots to all other days"
            >
              <Copy className="h-2.5 w-2.5 mr-1" />
              Copy Day 1
            </Button>
          )}

          {/* Add Day Button */}
          {allowDateEditing && (
            <Popover open={openAddDayPopover} onOpenChange={setOpenAddDayPopover}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={disabled}
                  className="h-6 px-2 text-[10px] gap-1 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-2xs"
                  title="Add another calendar day to this batch"
                >
                  <Plus className="h-2.5 w-2.5" />
                  Add Day
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3 space-y-3" align="end">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <CalendarDays className="h-3.5 w-3.5 text-primary" /> Add Calendar Day
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Choose a date to include in this batch schedule:
                  </p>
                  <Input
                    type="date"
                    min={effectiveMinDate}
                    value={newDayInputDate}
                    onChange={(e) => setNewDayInputDate(e.target.value)}
                    className="h-8 text-xs mt-1.5"
                  />
                  {newDayInputDate && (
                    <div className="text-[11px] font-semibold text-primary pt-0.5">
                      {formatDayHeader(newDayInputDate).fullWeekday}, {formatDayHeader(newDayInputDate).formattedDate}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-1 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpenAddDayPopover(false);
                      setNewDayInputDate("");
                    }}
                    className="h-7 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleAddNewDay(newDayInputDate)}
                    disabled={!newDayInputDate}
                    className="h-7 text-xs bg-primary"
                  >
                    Add Day
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Per-Day Cards List with Editable Calendar Days */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {sortedDates.map((date, idx) => {
          const { dayName, formattedDate, fullWeekday } = formatDayHeader(date);
          const currentSlots = daySlots[date] || [];
          const isSlotPopoverOpen = openPopoverDate === date;
          const isDateChangerOpen = openDateChangerDate === date;

          const targetHeader = changerTargetDate ? formatDayHeader(changerTargetDate) : null;

          return (
            <div
              key={date}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border bg-card/60 hover:bg-card transition-colors text-xs"
            >
              {/* Day info with Interactive Date Changer */}
              <div className="flex items-center gap-2 min-w-[180px] shrink-0">
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] px-1.5 py-0 bg-muted/60 font-semibold shrink-0"
                >
                  Day {idx + 1}
                </Badge>

                {allowDateEditing ? (
                  <Popover
                    open={isDateChangerOpen}
                    onOpenChange={(next) => {
                      if (next) {
                        setOpenDateChangerDate(date);
                        setChangerTargetDate(date);
                      } else {
                        setOpenDateChangerDate(null);
                        setChangerTargetDate("");
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={disabled}
                        className="group/date flex items-center gap-1.5 text-left rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-muted/80 transition-colors cursor-pointer"
                        title={`Click to edit or swap calendar date (currently ${dayName}, ${formattedDate})`}
                      >
                        <div>
                          <span className="font-semibold text-foreground group-hover/date:text-primary transition-colors">
                            {dayName}
                          </span>
                          , <span className="text-muted-foreground">{formattedDate}</span>
                        </div>
                        <Pencil className="h-3 w-3 text-muted-foreground/60 group-hover/date:text-primary transition-colors shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3 space-y-3" align="start">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <Calendar className="h-3.5 w-3.5 text-primary" />
                          <span>Change Day {idx + 1} Date</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-tight">
                          Select a new calendar day (e.g. switch Thursday to Wednesday). All configured time slots for this day will be preserved.
                        </p>

                        <div className="space-y-1 pt-1">
                          <Label className="text-[11px] font-medium text-muted-foreground">Assigned Date</Label>
                          <Input
                            type="date"
                            min={effectiveMinDate}
                            value={changerTargetDate || date}
                            onChange={(e) => setChangerTargetDate(e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                        </div>

                        {targetHeader && changerTargetDate !== date && (
                          <div className="text-[11px] p-2 rounded-md bg-primary/10 border border-primary/20 text-primary font-medium flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 shrink-0" />
                            <span>Switching to: <strong>{targetHeader.fullWeekday}</strong> ({targetHeader.formattedDate})</span>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-end gap-2 pt-1 border-t">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setOpenDateChangerDate(null);
                            setChangerTargetDate("");
                          }}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleApplyDateChange(date, changerTargetDate || date)}
                          disabled={!changerTargetDate || changerTargetDate === date}
                          className="h-7 text-xs bg-primary"
                        >
                          Apply Day
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <div>
                    <span className="font-semibold text-foreground">{dayName}</span>,{" "}
                    <span className="text-muted-foreground">{formattedDate}</span>
                  </div>
                )}
              </div>

              {/* Slot badges for this day */}
              <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
                {currentSlots.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground/70 italic">
                    No slots configured for this day
                  </span>
                ) : (
                  currentSlots.map((slot) => {
                    const supported = isSupportedBatchTimeSlot(slot);
                    return (
                      <Badge
                        key={slot}
                        variant="outline"
                        className={
                          supported
                            ? "gap-1.5 py-1 px-2.5 text-[11px] font-semibold font-mono bg-accent/70 hover:bg-accent text-accent-foreground border-border/90 shadow-2xs transition-colors"
                            : "gap-1.5 py-1 px-2.5 text-[11px] font-semibold font-mono bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/40 shadow-2xs"
                        }
                      >
                        <Clock className="h-3 w-3 text-muted-foreground/80 shrink-0" />
                        <span className="font-semibold text-foreground">{formatTimeSlot(slot)}</span>
                        {!disabled && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(date, slot)}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 p-0.5 rounded transition-colors ml-0.5"
                            aria-label={`Remove slot ${slot} from ${date}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </Badge>
                    );
                  })
                )}
              </div>

              {/* Add slot popover & Day Actions */}
              <div className="shrink-0 flex items-center gap-1">
                <Popover
                  open={isSlotPopoverOpen}
                  onOpenChange={(next) => setOpenPopoverDate(next ? date : null)}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      className="h-7 px-2 text-xs gap-1 bg-background"
                      aria-label={`Add time slot for ${formattedDate}`}
                    >
                      <Plus className="h-3 w-3" /> Add Slot
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-56 p-0 max-h-64 overflow-hidden"
                  >
                    <Command>
                      <CommandInput placeholder="Search time, e.g. 10:00" />
                      <CommandList className="max-h-52 overscroll-contain">
                        <CommandEmpty>No matching time.</CommandEmpty>
                        <CommandGroup heading="30-minute intervals">
                          {BATCH_TIME_SLOT_OPTIONS.map((opt) => {
                            const isSelected = currentSlots.includes(opt);
                            return (
                              <CommandItem
                                key={opt}
                                value={`${opt} ${formatTimeSlot(opt)}`}
                                onSelect={() => handleToggleSlotForDate(date, opt)}
                                className="text-xs"
                              >
                                <Check
                                  className={`h-3.5 w-3.5 mr-1.5 ${
                                    isSelected ? "opacity-100 text-primary" : "opacity-0"
                                  }`}
                                />
                                <span>{formatTimeSlot(opt)}</span>
                                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                                  {opt}
                                </span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {currentSlots.length > 0 && !disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      const updatedMap = { ...daySlots, [date]: [] };
                      if (onDatesChange) onDatesChange(sortedDates, updatedMap);
                      else onChange(updatedMap);
                    }}
                    title={`Clear slots for ${formattedDate}`}
                    aria-label={`Clear slots for ${formattedDate}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}

                {/* Remove Day Button (when >1 day exists) */}
                {allowDateEditing && sortedDates.length > 1 && !disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemoveDay(date)}
                    title={`Remove ${fullWeekday} (${date}) from batch schedule`}
                    aria-label={`Remove ${fullWeekday} (${date}) from batch schedule`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {/* Bottom Add Day Card Button */}
        {allowDateEditing && !disabled && (
          <Popover open={openAddDayPopover} onOpenChange={setOpenAddDayPopover}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 py-2 px-3 border border-dashed border-border/80 hover:border-primary/60 hover:bg-primary/5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-primary transition-all duration-200 cursor-pointer mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Add Day (e.g. Day {sortedDates.length + 1})</span>
              </button>
            </PopoverTrigger>
          </Popover>
        )}
      </div>
    </div>
  );
}
