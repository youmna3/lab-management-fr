import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { EgyptMap } from "@/components/EgyptMap";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABELS } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  FolderKanban,
  Wallet,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Star,
} from "lucide-react";
import { BrandIcon, type BrandIconName } from "@/components/BrandIcon";
import { formatEGP } from "@/lib/format";
import { qualityBand } from "@/lib/quality";
import { isProjectSoftDeleted } from "@/lib/audit-logging";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard – iSchool Lab Management" },
      { name: "description", content: "Executive overview of labs, projects, catering, and budget." },
    ],
  }),
  component: Dashboard,
});

type Stats = {
  totalLabs: number;
  govCount: number;
  issues: number;
  verified: number;
  unverified: number;
  mismatch: number;
  avgQuality: number;
  qualityBands: { high: number; medium: number; low: number; none: number };
  byGov: { gov: string; count: number; issues: number }[];
  projects: number;
  batches: number;
  needed: number;
  pending: number;
  confirmed: number;
  totalBudget: number;
  intakes: { intake: string; total: number }[];
};

function Dashboard() {
  const { user, roles, hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const [s, setS] = useState<Stats | null>(null);
  const isFinanceOrAdmin = hasAnyRole(["finance", "administration"]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const [labs, lq, projects, batches, needs, assigns, intakes] = await Promise.all([
      supabase.from("labs").select("id, gov, validation_status, maps_verified"),
      supabase.from("lab_quality").select("quality_score"),
      supabase.from("projects").select("*"),
      supabase.from("batches").select("id, project_id"),
      supabase.from("batch_needs").select("labs_required"),
      supabase.from("assignments").select("status"),
      supabase.from("intake_budget_view").select("intake, total_cost"),
    ]);

    const labRows = (labs.data ?? []) as { gov: string | null; validation_status: string; maps_verified: boolean | null }[];
    const govMap: Record<string, { count: number; issues: number }> = {};
    for (const l of labRows) {
      const g = l.gov ?? "—";
      govMap[g] ??= { count: 0, issues: 0 };
      govMap[g].count++;
      if (l.validation_status === "issues") govMap[g].issues++;
    }
    const byGov = Object.entries(govMap)
      .map(([gov, v]) => ({ gov, ...v }))
      .sort((a, b) => b.count - a.count);

    const scores = (lq.data ?? []).map((r: { quality_score: number }) => Number(r.quality_score));
    const bands = { high: 0, medium: 0, low: 0, none: 0 };
    for (const sc of scores) bands[qualityBand(sc)]++;
    bands.none = Math.max(0, labRows.length - scores.length);

    const aRows = (assigns.data ?? []) as { status: string }[];
    const intakeRows = (intakes.data ?? []) as { intake: string; total_cost: number }[];

    const activeProjects = (projects.data ?? []).filter((p) => !isProjectSoftDeleted(p));
    const activeProjectIds = new Set(activeProjects.map((p) => p.id));
    const activeBatches = (batches.data ?? []).filter((b) => activeProjectIds.has(b.project_id));

    setS({
      totalLabs: labRows.length,
      govCount: Object.keys(govMap).length,
      issues: labRows.filter((l) => l.validation_status === "issues").length,
      verified: labRows.filter((l) => l.maps_verified === true).length,
      unverified: labRows.filter((l) => l.maps_verified === null || l.maps_verified === undefined).length,
      mismatch: labRows.filter((l) => l.maps_verified === false).length,
      avgQuality: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      qualityBands: bands,
      byGov,
      projects: activeProjects.length,
      batches: activeBatches.length,
      needed: (needs.data ?? []).reduce((sum: number, n: { labs_required: number }) => sum + n.labs_required, 0),
      pending: aRows.filter((a) => a.status === "pending").length,
      confirmed: aRows.filter((a) => a.status === "confirmed").length,
      totalBudget: intakeRows.reduce((sum, i) => sum + Number(i.total_cost ?? 0), 0),
      intakes: intakeRows.map((i) => ({ intake: i.intake, total: Number(i.total_cost ?? 0) })),
    });
  }

  const maxGov = useMemo(() => Math.max(1, ...(s?.byGov.map((g) => g.count) ?? [1])), [s]);

  return (
    <div className="space-y-6">
      {/* Brand Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl brand-gradient-hero p-6 sm:p-8 shadow-sm text-white flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute bottom-0 right-1/3 h-48 w-48 rounded-full bg-[#FF7F1C]/20 blur-2xl" />

        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-white/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest text-white border border-white/25 backdrop-blur">
              iSchool B2G Portal
            </span>
            <span className="text-xs text-white/80 font-medium">Operations V1.0</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Lab Management &amp; Optimization Overview
          </h1>
          <p className="text-xs sm:text-sm text-white/85 font-medium">{user?.email}</p>
          <div className="pt-1 flex flex-wrap gap-1.5">
            {roles.length ? (
              roles.map((r) => (
                <span key={r} className="rounded-md bg-white/15 px-2 py-0.5 text-xs font-medium text-white border border-white/20">
                  {ROLE_LABELS[r]}
                </span>
              ))
            ) : (
              <Badge variant="outline" className="text-white border-white/40">No role assigned</Badge>
            )}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-3 shrink-0">
          <Link to="/lab-allocation">
            <Button size="default" className="gap-2 bg-white hover:bg-white/90 text-[#056FEC] font-bold shadow-sm transition-all">
              <BrandIcon name="process_on" size={18} /> Lab Allocation Engine
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4 xl:grid-cols-6">
        <StatTile brandIcon="module" fallbackIcon={Building2} label="Total Labs" value={s?.totalLabs ?? "—"} accent="blue" to="/lab-data" />
        <StatTile brandIcon="flags" fallbackIcon={MapPin} label="Governorates" value={s?.govCount ?? "—"} accent="sky" />
        <StatTile brandIcon="quiz" fallbackIcon={Star} label="Avg Quality" value={s ? s.avgQuality.toFixed(0) : "—"} accent="yellow" />
        <StatTile brandIcon="checkmark" fallbackIcon={ShieldCheck} label="Pins Verified" value={s ? `${s.verified}/${s.totalLabs}` : "—"} accent="success" to="/lab-data" />
        <StatTile brandIcon="project" fallbackIcon={FolderKanban} label="Batches" value={s?.batches ?? "—"} accent="orange" to="/projects" />
        {isFinanceOrAdmin ? (
          <StatTile brandIcon="checkmark" fallbackIcon={Wallet} label="Total Budget" value={s ? formatEGP(s.totalBudget) : "—"} accent="deepblue" to="/budget" small />
        ) : (
          <StatTile brandIcon="checkmark" fallbackIcon={CheckCircle2} label="Confirmed Labs" value={s?.confirmed ?? "—"} accent="success" to="/projects" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Governorate coverage */}
        <Card className="lg:col-span-2 shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>Egypt — Lab Geographic Coverage</CardTitle>
              <Badge variant="outline" className="border-primary/30 text-primary text-[10px] font-semibold">27 Governorates</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {!s ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading coverage telemetry…</p>
            ) : (
              <>
                <EgyptMap data={s.byGov} onSelect={(ar) => navigate({ to: "/lab-data", search: { gov: ar } })} />
                {s.byGov.length === 0 && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    No labs imported yet — import the sheet in Lab Data to shade the map.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Right column: Funnel + Quality + Budget */}
        <div className="space-y-6">
          <Card className="shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle>Allocation Funnel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3.5 text-sm">
              <FunnelRow label="Labs Needed" value={s?.needed ?? 0} total={s?.needed ?? 0} color="bg-muted-foreground" />
              <FunnelRow label="Assigned (Pending)" value={s?.pending ?? 0} total={s?.needed ?? 0} color="bg-[#FF7F1C]" />
              <FunnelRow label="Confirmed & Ready" value={s?.confirmed ?? 0} total={s?.needed ?? 0} color="bg-[#0EAA3A]" />
            </CardContent>
          </Card>

          <Card className="shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle>Quality Distribution</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <QualityPill label="High (≥80)" value={s?.qualityBands.high ?? 0} cls="bg-[#0EAA3A]" textCls="text-[#0EAA3A]" />
              <QualityPill label="Medium (50–79)" value={s?.qualityBands.medium ?? 0} cls="bg-[#FFBB1C]" textCls="text-[#B4810B] dark:text-[#FFBB1C]" />
              <QualityPill label="Low (<50)" value={s?.qualityBands.low ?? 0} cls="bg-[#DE1F1F]" textCls="text-[#DE1F1F]" />
              <QualityPill label="Unscored" value={s?.qualityBands.none ?? 0} cls="bg-muted-foreground" textCls="text-muted-foreground" />
            </CardContent>
          </Card>

          {isFinanceOrAdmin && (
            <Card className="shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle>Budget by Intake</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {!s || s.intakes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No budget data available.</p>
                ) : (
                  s.intakes.map((i) => (
                    <div key={i.intake} className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0">
                      <span className="text-muted-foreground font-medium">{i.intake}</span>
                      <span className="font-bold text-foreground">{formatEGP(i.total)}</span>
                    </div>
                  ))
                )}
                <Link to="/budget" className="block pt-1.5 text-xs font-semibold text-primary hover:underline">
                  Open Budget Details →
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Coverage bars */}
      {s && s.byGov.length > 0 && (
        <Card className="border-[#E6EDF1] dark:border-[#1F2A55] shadow-xs">
          <CardHeader className="pb-2 border-b border-[#E6EDF1] dark:border-[#1F2A55]">
            <CardTitle className="text-base font-bold text-[#1F2A55] dark:text-[#F7FAFF]">Labs by Governorate Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
              {s.byGov.map((g) => (
                <div key={g.gov} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 truncate text-right text-xs font-medium" dir="auto">{g.gov}</div>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-[#E6EDF1] dark:bg-[#182245]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#056FEC] to-[#05ACFF]"
                      style={{ width: `${(g.count / maxGov) * 100}%` }}
                    />
                  </div>
                  <div className="w-14 shrink-0 text-xs font-bold text-[#597587] dark:text-[#85A5B9]">
                    {g.count}
                    {g.issues > 0 && <span className="ml-1 text-[#FF7F1C]">⚠{g.issues}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Action Alerts */}
      {s && (s.issues > 0 || s.mismatch > 0 || s.unverified > 0) && (
        <div className="flex flex-wrap gap-3">
          {s.issues > 0 && (
            <AlertChip brandIcon="alert" text={`${s.issues} labs with data issues`} to="/lab-data" type="error" />
          )}
          {s.mismatch > 0 && (
            <AlertChip brandIcon="flags" text={`${s.mismatch} map location mismatches`} to="/lab-data" type="warning" />
          )}
          {s.unverified > 0 && (
            <AlertChip brandIcon="checkmark" text={`${s.unverified} pins to verify`} to="/lab-data" type="info" />
          )}
        </div>
      )}
    </div>
  );
}

const ACCENT_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: "bg-[#056FEC]/10", text: "text-[#056FEC]", border: "border-[#056FEC]/20" },
  orange: { bg: "bg-[#FF7F1C]/10", text: "text-[#FF7F1C]", border: "border-[#FF7F1C]/20" },
  yellow: { bg: "bg-[#FFD700]/15", text: "text-[#B4810B] dark:text-[#FFD700]", border: "border-[#FFD700]/30" },
  sky: { bg: "bg-[#05ACFF]/10", text: "text-[#05ACFF]", border: "border-[#05ACFF]/20" },
  deepblue: { bg: "bg-[#043FAD]/10", text: "text-[#043FAD] dark:text-[#05ACFF]", border: "border-[#043FAD]/20" },
  success: { bg: "bg-[#0EAA3A]/10", text: "text-[#0EAA3A]", border: "border-[#0EAA3A]/20" },
};

function StatTile({
  brandIcon,
  fallbackIcon: Icon,
  label,
  value,
  accent,
  to,
  small,
}: {
  brandIcon?: BrandIconName;
  fallbackIcon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  accent: string;
  to?: string;
  small?: boolean;
}) {
  const style = ACCENT_STYLES[accent] || ACCENT_STYLES.blue;
  const inner = (
    <Card className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm">
      <CardContent className="flex items-center gap-3.5 p-4">
        <div className={`rounded-xl p-2.5 ${style.bg} ${style.border} flex items-center justify-center shrink-0`}>
          {brandIcon ? (
            <BrandIcon name={brandIcon} size={22} />
          ) : (
            <Icon className={`h-5 w-5 ${style.text}`} />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className={`font-extrabold text-foreground ${small ? "text-base" : "text-xl"} truncate tracking-tight mt-0.5`}>
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function FunnelRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-medium">
        <span className="text-[#597587] dark:text-[#85A5B9]">{label}</span>
        <span className="font-bold text-[#1F2A55] dark:text-[#F7FAFF]">{value}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[#E6EDF1] dark:bg-[#182245]">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function QualityPill({ label, value, cls, textCls }: { label: string; value: number; cls: string; textCls?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-xl border border-[#E6EDF1] dark:border-[#1F2A55] bg-[#F7FAFF]/50 dark:bg-[#182245]/50 py-2.5">
      <span className={`mb-1.5 h-2.5 w-2.5 rounded-full ${cls}`} />
      <span className={`text-lg font-black ${textCls || "text-[#1F2A55] dark:text-[#F7FAFF]"}`}>{value}</span>
      <span className="text-[10px] font-semibold text-[#597587] dark:text-[#85A5B9]">{label}</span>
    </div>
  );
}

function AlertChip({
  brandIcon,
  text,
  to,
  type = "warning",
}: {
  brandIcon?: BrandIconName;
  text: string;
  to: string;
  type?: "warning" | "error" | "info";
}) {
  const chipStyles = {
    error: "border-[#FFD1D1] bg-[#FFD1D1]/30 text-[#DE1F1F] hover:bg-[#FFD1D1]/50 dark:border-[#AA1818] dark:bg-[#AA1818]/20 dark:text-[#FFD1D1]",
    warning: "border-[#FCF9E5] bg-[#FCF9E5] text-[#B4810B] hover:bg-[#FCF9E5]/80 dark:border-[#B4810B] dark:bg-[#B4810B]/20 dark:text-[#FFBB1C]",
    info: "border-[#B1D1E6] bg-[#F7FAFF] text-[#056FEC] hover:bg-[#E6EDF1] dark:border-[#043FAD] dark:bg-[#182245] dark:text-[#05ACFF]",
  };

  return (
    <Link to={to} className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-xs transition-colors ${chipStyles[type]}`}>
      {brandIcon ? <BrandIcon name={brandIcon} size={15} /> : <AlertTriangle className="h-4 w-4" />}
      {text}
    </Link>
  );
}
