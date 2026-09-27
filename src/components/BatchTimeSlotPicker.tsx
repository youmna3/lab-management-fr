import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  formatTimeSlot,
  isSupportedBatchTimeSlot,
  MAX_BATCH_TIME_SLOTS,
  normalizeTimeSlots,
  toggleBatchTimeSlotSelection,
} from "@/lib/time-slots";
import { Check, ChevronsUpDown, Clock, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

type BatchTimeSlotPickerProps = {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  id?: string;
};

const MAX_SLOTS_MESSAGE = "A batch can have a maximum of 4 time slots.";

export function BatchTimeSlotPicker({
  value,
  onChange,
  disabled = false,
  id,
}: BatchTimeSlotPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedSlots = normalizeTimeSlots(value, { preserveInvalid: true });
  const atLimit = selectedSlots.length >= MAX_BATCH_TIME_SLOTS;
  const hasUnsupportedSlots = selectedSlots.some((slot) => !isSupportedBatchTimeSlot(slot));

  function toggleSlot(slot: string) {
    const result = toggleBatchTimeSlotSelection(selectedSlots, slot);
    if (result.limitReached) {
      toast.error(MAX_SLOTS_MESSAGE);
      return;
    }
    onChange(result.values);
  }

  return (
    <div className="min-w-0 space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Choose batch time slots"
            disabled={disabled}
            className="h-auto min-h-10 w-full justify-between gap-2 bg-background px-3 py-2 font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {selectedSlots.length > 0
                  ? `${selectedSlots.length} time ${selectedSlots.length === 1 ? "slot" : "slots"} (${selectedSlots.map((s) => formatTimeSlot(s)).join(", ")})`
                  : "Default: Thursday/Friday Split (7 sessions)"}
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
        >
          <div className="border-b p-2">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Quick Presets (1 to 4 slots)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {BATCH_TIME_SLOT_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs truncate"
                  onClick={() => onChange([...preset.values])}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <Command>
            <CommandInput placeholder="Search time, e.g. 10:30 AM" />
            <CommandList className="max-h-64 overscroll-contain">
              <CommandEmpty>No matching time.</CommandEmpty>
              <CommandGroup heading="Every 30 minutes, 9:00 AM to 9:00 PM">
                {BATCH_TIME_SLOT_OPTIONS.map((slot) => {
                  const selected = selectedSlots.includes(slot);
                  const optionDisabled = atLimit && !selected;
                  return (
                    <CommandItem
                      key={slot}
                      value={`${slot} ${formatTimeSlot(slot)}`}
                      disabled={optionDisabled}
                      onSelect={() => toggleSlot(slot)}
                      className="min-h-9"
                    >
                      <Check className={selected ? "opacity-100" : "opacity-0"} />
                      <span>{formatTimeSlot(slot)}</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {slot}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedSlots.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Selected time slots">
          {selectedSlots.map((slot) => {
            const supported = isSupportedBatchTimeSlot(slot);
            return (
              <Badge
                key={slot}
                variant="outline"
                className={
                  supported
                    ? "gap-1.5 py-1 pl-2.5 pr-1 font-semibold font-mono bg-accent/70 hover:bg-accent text-accent-foreground border-border/90 shadow-2xs transition-colors"
                    : "gap-1.5 border-amber-400/80 bg-amber-500/15 py-1 pl-2.5 pr-1 font-semibold font-mono text-amber-900 dark:text-amber-200 shadow-2xs"
                }
              >
                {!supported && <TriangleAlert className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
                <span className="font-semibold text-foreground">{formatTimeSlot(slot)}</span>
                <button
                  type="button"
                  onClick={() => toggleSlot(slot)}
                  disabled={disabled}
                  aria-label={`Remove ${formatTimeSlot(slot)}`}
                  className="rounded-sm p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
        <span
          className={
            selectedSlots.length === 0 ? "font-medium text-rose-600" : "text-muted-foreground"
          }
        >
          {selectedSlots.length} of {MAX_BATCH_TIME_SLOTS} slots selected.
        </span>
        {atLimit && (
          <span className="font-medium text-amber-700 dark:text-amber-300">
            {MAX_SLOTS_MESSAGE}
          </span>
        )}
      </div>
      {hasUnsupportedSlots && (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
          Remove unsupported legacy times before saving this batch.
        </p>
      )}
    </div>
  );
}
