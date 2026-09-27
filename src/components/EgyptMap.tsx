import { useMemo, useState } from "react";
import { EGYPT_GOVS, EGYPT_VIEWBOX } from "@/lib/egypt-geo";
import { normalizeArabic } from "@/lib/arabic";

export type GovDatum = { gov: string; count: number; issues: number };

/**
 * Choropleth map of Egypt's 27 governorates shaded by lab count using iSchool Brand Palette.
 * Hover shows details; click calls onSelect with the governorate's Arabic name.
 */
export function EgyptMap({ data, onSelect }: { data: GovDatum[]; onSelect?: (govAr: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const lookup = useMemo(() => {
    const m: Record<string, GovDatum> = {};
    for (const d of data) m[normalizeArabic(d.gov)] = d;
    return m;
  }, [data]);

  const max = useMemo(() => Math.max(1, ...data.map((d) => d.count)), [data]);

  const rows = EGYPT_GOVS.map((g) => ({ ...g, datum: lookup[normalizeArabic(g.ar)] }));
  const active = hovered ? rows.find((r) => r.en === hovered) : null;
  const matchedCount = rows.filter((r) => r.datum && r.datum.count > 0).length;

  return (
    <div className="space-y-3">
      <div className="flex min-h-6 items-center justify-between text-xs sm:text-sm">
        {active ? (
          <span className="flex items-center gap-1.5">
            <span dir="auto" className="font-bold text-[#056FEC] dark:text-[#05ACFF]">{active.ar}</span>
            <span className="text-[#597587] dark:text-[#85A5B9]">({active.en})</span>
          </span>
        ) : (
          <span className="text-[#597587] dark:text-[#85A5B9]">
            Hover a governorate · <strong className="text-[#1F2A55] dark:text-[#F7FAFF]">{matchedCount}/27</strong> active
          </span>
        )}
        {active?.datum ? (
          <span className="text-[#597587] dark:text-[#85A5B9]">
            <strong className="text-[#056FEC] dark:text-[#05ACFF] font-bold">{active.datum.count}</strong> labs
            {active.datum.issues > 0 && <span className="text-[#FF7F1C] font-semibold"> · {active.datum.issues} issues</span>}
          </span>
        ) : active ? (
          <span className="text-[#85A5B9]">No labs allocated</span>
        ) : null}
      </div>

      <div className="mx-auto max-w-[500px] text-[#056FEC] dark:text-[#05ACFF] drop-shadow-sm">
        <svg
          viewBox={`0 0 ${EGYPT_VIEWBOX.w} ${EGYPT_VIEWBOX.h}`}
          className="h-auto w-full"
          role="img"
          aria-label="Egypt governorates lab coverage"
        >
          {rows.map((r) => {
            const count = r.datum?.count ?? 0;
            const t = count / max;
            const isActive = hovered === r.en;
            const fillOpacity = isActive ? 0.95 : count > 0 ? 0.35 + 0.6 * t : 0.12;
            return (
              <path
                key={r.en}
                d={r.d}
                fill={isActive ? "#056FEC" : "currentColor"}
                fillOpacity={fillOpacity}
                stroke={isActive ? "#FF7F1C" : "currentColor"}
                strokeOpacity={isActive ? 1 : 0.45}
                strokeWidth={isActive ? 2 : 0.8}
                strokeLinejoin="round"
                style={{ cursor: onSelect ? "pointer" : "default", transition: "all .15s ease" }}
                onMouseEnter={() => setHovered(r.en)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect && r.ar && onSelect(r.ar)}
              >
                <title>{`${r.ar} · ${r.en}: ${count} labs`}</title>
              </path>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 text-[11px] text-[#597587] dark:text-[#85A5B9]">
        <span>0</span>
        <div className="h-2 w-44 rounded-full bg-gradient-to-r from-[#056FEC]/10 via-[#05ACFF]/50 to-[#056FEC]" />
        <span className="font-semibold text-[#056FEC]">{max}</span>
        <span className="ml-1 text-[10px]">labs / gov</span>
      </div>
    </div>
  );
}
