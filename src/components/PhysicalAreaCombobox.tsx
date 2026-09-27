import React, { useState, useMemo } from "react";
import { Check, ChevronsUpDown, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { EGYPT_PHYSICAL_AREAS, EgyptPhysicalArea } from "@/lib/egypt-areas";
import { Badge } from "@/components/ui/badge";

interface PhysicalAreaComboboxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function PhysicalAreaCombobox({
  value,
  onChange,
  placeholder = "Select or search physical area...",
  disabled = false,
  className = "",
}: PhysicalAreaComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Find currently selected item if any
  const selectedArea = useMemo(() => {
    if (!value) return null;
    const v = value.trim().toLowerCase();
    return (
      EGYPT_PHYSICAL_AREAS.find(
        (a) => a.area.toLowerCase() === v || a.areaEn.toLowerCase() === v,
      ) || null
    );
  }, [value]);

  // Group areas by Governorate
  const groupedAreas = useMemo(() => {
    const map = new Map<string, EgyptPhysicalArea[]>();
    for (const item of EGYPT_PHYSICAL_AREAS) {
      const list = map.get(item.gov) || [];
      list.push(item);
      map.set(item.gov, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={`w-full justify-between text-xs h-8.5 font-normal ${
            !value ? "text-muted-foreground" : "text-foreground font-medium"
          } ${className}`}
        >
          <div className="flex items-center gap-2 truncate">
            <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">
              {selectedArea
                ? `${selectedArea.area} (${selectedArea.gov})`
                : value || placeholder}
            </span>
          </div>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[320px] sm:w-[380px] p-0 z-50 shadow-lg border border-border/80"
        align="start"
      >
        <Command
          filter={(itemValue, search) => {
            const s = search.toLowerCase().trim();
            if (!s) return 1;
            return itemValue.toLowerCase().includes(s) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder="Search area in Arabic or English..."
            value={searchQuery}
            onValueChange={setSearchQuery}
            className="text-xs h-9"
          />

          <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No matching physical area found.
            </CommandEmpty>

            {groupedAreas.map(([govName, areas]) => (
              <CommandGroup key={govName} heading={`${govName} Governorate`}>
                {areas.map((item) => {
                  const isSelected =
                    value?.trim().toLowerCase() === item.area.toLowerCase() ||
                    value?.trim().toLowerCase() === item.areaEn.toLowerCase();

                  // Search match value includes area name, english name, and gov
                  const searchable = `${item.area} ${item.areaEn} ${item.gov} ${item.govEn}`;

                  return (
                    <CommandItem
                      key={item.area}
                      value={searchable}
                      onSelect={() => {
                        onChange(item.area);
                        setOpen(false);
                      }}
                      className="flex items-center justify-between py-1.5 px-2 text-xs cursor-pointer hover:bg-accent/60"
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        <Check
                          className={`h-3.5 w-3.5 text-primary shrink-0 ${
                            isSelected ? "opacity-100" : "opacity-0"
                          }`}
                        />
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-semibold text-foreground">
                            {item.area}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            · {item.areaEn}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className="text-[9px] px-1.5 py-0 h-4 shrink-0 font-normal"
                      >
                        {item.gov}
                      </Badge>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
