import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, TrendingDown, Users, AlertTriangle, Layers, MapPin, Sparkles } from "lucide-react";
import type {
  AllocationSummary,
  ShortfallMathRow,
  UnassignedStudentRow,
  AreaGradeSummaryRow,
} from "@/lib/allocation-client";
import { formatGradeLabel } from "@/lib/lab-allocation-runner/parse";
import { formatGradeLevel, sortGradeLevels, type ProjectProgram } from "@/lib/project-grade-levels";

interface VisualizationsProps {
  summary: AllocationSummary;
  shortfallMath: ShortfallMathRow[];
  unassignedStudents: UnassignedStudentRow[];
  areaGradeSummary: AreaGradeSummaryRow[];
  shortfallText: string;
  program: ProjectProgram;
}

const PIE_COLORS = [
  "#056FEC", // Brand Blue
  "#FF7F1C", // Brand Orange
  "#05ACFF", // Sky Blue
  "#FFD700", // Yellow
  "#043FAD", // Deep Blue
  "#0EAA3A", // Success Green
  "#DE1F1F", // Semantic Error Red
  "#597587", // Neutral Slate
];

export function AllocationVisualizations({
  summary,
  unassignedStudents,
  areaGradeSummary,
  program,
}: VisualizationsProps) {
  // Aggregate area comparison data
  const areaComparisonData = useMemo(() => {
    const map = new Map<
      string,
      {
        area: string;
        demand: number;
        allocated: number;
        unassigned: number;
        fulfillmentRate: number;
      }
    >();

    areaGradeSummary.forEach((r) => {
      const existing = map.get(r["Physical Area"]) || {
        area: r["Physical Area"],
        demand: 0,
        allocated: 0,
        unassigned: 0,
        fulfillmentRate: 100,
      };
      existing.demand += r.Students_Assigned + r.Unassigned;
      existing.allocated += r.Students_Assigned;
      existing.unassigned += r.Unassigned;
      map.set(r["Physical Area"], existing);
    });

    return Array.from(map.values()).map((item) => {
      const total = item.demand || 1;
      const allocatedPercent = Math.round((item.allocated / total) * 100);
      return {
        ...item,
        fulfillmentRate: allocatedPercent,
      };
    });
  }, [areaGradeSummary]);

  // Unassigned breakdown by Area for Pie/Donut Chart
  const unassignedByArea = useMemo(() => {
    const counts: Record<string, number> = {};
    unassignedStudents.forEach((s) => {
      const area = s["Physical Area"] || "Unknown";
      counts[area] = (counts[area] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [unassignedStudents]);

  // Breakdown by Grade: Total demand vs Seated vs Unassigned
  const gradeBreakdown = useMemo(() => {
    const grades = sortGradeLevels(areaGradeSummary.map((row) => Number(row.Grade)).filter(Number.isFinite));
    return grades.map((g) => {
      const rows = areaGradeSummary.filter((r) => Number(r.Grade) === g);
      const assigned = rows.reduce((sum, r) => sum + (Number(r.Students_Assigned) || 0), 0);
      const unassigned = rows.reduce((sum, r) => sum + (Number(r.Unassigned) || 0), 0);
      const total = assigned + unassigned;
      const rate = total > 0 ? Math.round((assigned / total) * 100) : 100;
      const label = formatGradeLabel(g, program);
      return {
        grade: label,
        gradeNum: g,
        assigned,
        unassigned,
        total,
        rate,
      };
    });
  }, [areaGradeSummary, program]);

  const hasShortfall = summary.unassigned_count > 0;

  return (
    <div className="space-y-6">
      {/* Top Status Banner */}
      {hasShortfall ? (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-gradient-to-r from-rose-500/10 via-background to-amber-500/5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-600 shrink-0">
              <TrendingDown className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-rose-700 dark:text-rose-400">
                  Capacity Bottleneck: {summary.unassigned_count} Unassigned Student(s)
                </h4>
                <Badge variant="destructive" className="text-[10px]">
                  {Math.round(((summary.total_students - summary.unassigned_count) / (summary.total_students || 1)) * 100)}% Placed
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {unassignedByArea.length} area(s) require additional lab seats or sessions to seat all cohorts.
              </p>
            </div>
          </div>
          <div className="text-xs font-medium text-rose-600 bg-rose-50 dark:bg-rose-950/40 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 self-start md:self-auto">
            {summary.unassigned_count} / {summary.total_students} Unseated
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-[#056FEC]/30 bg-[#056FEC]/5 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                100% Demand Fulfilled — Zero Shortfall
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                All {summary.total_students.toLocaleString()} students across all physical areas and academic cohorts are placed in lab sessions.
              </p>
            </div>
          </div>
          <Badge className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold text-xs">
            Optimal Fit
          </Badge>
        </div>
      )}

      {/* 1. Academic cohort breakdown cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            {program === "DEMI" ? "Grade Cohort" : "Track / Level"} Placement &amp; Shortfall Overview
          </h3>
          <span className="text-xs text-muted-foreground">Placement rates per grade / track level</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {gradeBreakdown.map((g) => {
            const lower = g.grade.toLowerCase();
            let themeCls = "border-primary/20 bg-muted/20";
            let badgeCls = "bg-primary text-primary-foreground";
            let progressCls = "[&>div]:bg-primary bg-muted";

            if (lower.includes("cyber") || lower.includes("security")) {
              themeCls = "border-emerald-500/30 bg-emerald-500/5";
              badgeCls = "bg-emerald-600 hover:bg-emerald-700 text-white font-bold";
              progressCls = "[&>div]:bg-emerald-600 bg-muted";
            } else if (lower.includes("digital") || lower.includes("art")) {
              themeCls = "border-fuchsia-500/30 bg-fuchsia-500/5";
              badgeCls = "bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold";
              progressCls = "[&>div]:bg-fuchsia-600 bg-muted";
            } else if (lower.includes("web")) {
              themeCls = "border-blue-500/30 bg-blue-500/5";
              badgeCls = "bg-blue-600 hover:bg-blue-700 text-white font-bold";
              progressCls = "[&>div]:bg-blue-600 bg-muted";
            } else if (lower.includes("data")) {
              themeCls = "border-amber-500/30 bg-amber-500/5";
              badgeCls = "bg-amber-600 hover:bg-amber-700 text-white font-bold";
              progressCls = "[&>div]:bg-amber-600 bg-muted";
            } else if (lower.includes("embedded")) {
              themeCls = "border-teal-500/30 bg-teal-500/5";
              badgeCls = "bg-teal-600 hover:bg-teal-700 text-white font-bold";
              progressCls = "[&>div]:bg-teal-600 bg-muted";
            } else if (lower.includes("computer fund") || lower.includes("fundamentals")) {
              themeCls = "border-indigo-500/30 bg-indigo-500/5";
              badgeCls = "bg-indigo-600 hover:bg-indigo-700 text-white font-bold";
              progressCls = "[&>div]:bg-indigo-600 bg-muted";
            } else if (lower.includes("computer adv") || lower.includes("advanced")) {
              themeCls = "border-purple-500/30 bg-purple-500/5";
              badgeCls = "bg-purple-600 hover:bg-purple-700 text-white font-bold";
              progressCls = "[&>div]:bg-purple-600 bg-muted";
            } else if (g.gradeNum === 4 || lower === "grade 4" || lower === "g4") {
              themeCls = "border-[#056FEC]/30 bg-[#056FEC]/5";
              badgeCls = "bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold";
              progressCls = "[&>div]:bg-[#056FEC] bg-muted";
            } else if (g.gradeNum === 5 || lower === "grade 5" || lower === "g5") {
              themeCls = "border-[#FF7F1C]/30 bg-[#FF7F1C]/5";
              badgeCls = "bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white font-bold";
              progressCls = "[&>div]:bg-[#FF7F1C] bg-muted";
            } else if (g.gradeNum === 6 || lower === "grade 6" || lower === "g6") {
              themeCls = "border-[#05ACFF]/30 bg-[#05ACFF]/5";
              badgeCls = "bg-[#05ACFF] hover:bg-[#056FEC] text-white font-bold";
              progressCls = "[&>div]:bg-[#05ACFF] bg-muted";
            }

            const isShort = g.unassigned > 0;

            return (
              <Card key={g.grade} className={`border ${themeCls} shadow-xs`}>
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between gap-1">
                    <Badge className={`text-xs font-bold px-2.5 py-0.5 max-w-[180px] truncate ${badgeCls}`} title={g.grade}>
                      {g.grade}
                    </Badge>
                    <Badge
                      variant={isShort ? "destructive" : "default"}
                      className="text-[10px] font-semibold shrink-0"
                    >
                      {g.rate}% Seated
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-2xl font-bold text-foreground">
                        {g.assigned} <span className="text-xs text-muted-foreground font-normal">/ {g.total}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">Students Placed</div>
                    </div>
                    {isShort ? (
                      <div className="text-right">
                        <div className="text-lg font-bold text-rose-600">{g.unassigned}</div>
                        <div className="text-[10px] text-rose-500 font-medium">Unassigned</div>
                      </div>
                    ) : (
                      <div className="text-right">
                        <div className="text-xs font-bold text-[#056FEC] dark:text-[#05ACFF] flex items-center gap-1 justify-end">
                          <CheckCircle2 className="h-3.5 w-3.5" /> 100%
                        </div>
                        <div className="text-[10px] text-muted-foreground">No Gap</div>
                      </div>
                    )}
                  </div>

                  <Progress
                    value={g.rate}
                    className={`h-2 ${
                      isShort
                        ? "[&>div]:bg-rose-500 bg-rose-100 dark:bg-rose-950"
                        : progressCls
                    }`}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* 2. Physical Area Bottlenecks & Unassigned Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Card: Area Fulfillment Progress List */}
        <Card className="shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-[#056FEC]" />
                Physical Area Placement Status
              </CardTitle>
              <Badge variant="outline" className="text-[10px] font-semibold">
                {areaComparisonData.length} Areas
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Direct seating fulfillment percentage for each physical area.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5 max-h-[520px] overflow-y-auto pr-2">
            {areaComparisonData.map((item) => {
              const isBottleneck = item.unassigned > 0;
              return (
                <div key={item.area} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isBottleneck ? "bg-[#DE1F1F]" : "bg-[#FF7F1C]"
                        }`}
                      />
                      {item.area}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground font-mono">
                        {item.allocated} / {item.demand}
                      </span>
                      <Badge
                        variant={isBottleneck ? "destructive" : "default"}
                        className={`text-[10px] font-bold px-1.5 py-0 ${!isBottleneck ? "bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white" : "bg-[#DE1F1F] text-white"}`}
                      >
                        {item.fulfillmentRate}%
                      </Badge>
                    </div>
                  </div>

                  <Progress
                    value={item.fulfillmentRate}
                    className={`h-2 ${
                      isBottleneck
                        ? "[&>div]:bg-[#DE1F1F] bg-[#DE1F1F]/15"
                        : "[&>div]:bg-[#FF7F1C] bg-muted"
                    }`}
                  />
                  {isBottleneck && (
                    <div className="text-[11px] text-[#DE1F1F] font-semibold text-right">
                      Short by {item.unassigned} student(s)
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Right Card: Unassigned Share Donut Chart OR 100% Fit Summary */}
        {hasShortfall ? (
          <Card className="shadow-xs">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-[#DE1F1F]" />
                  Unassigned Demand Share by Area
                </CardTitle>
                <Badge variant="destructive" className="text-[10px] font-bold">
                  {summary.unassigned_count} Unseated
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Proportion of unassigned students across physical areas.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="h-64 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={unassignedByArea}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={4}
                      dataKey="value"
                      label={({ name, value, percent }) =>
                        `${name}: ${value} (${((percent || 0) * 100).toFixed(0)}%)`
                      }
                      labelLine={{ strokeWidth: 1 }}
                    >
                      {unassignedByArea.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any, name: any) => [
                        `${val} students (${(
                          (Number(val) / summary.unassigned_count) *
                          100
                        ).toFixed(1)}%)`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-[#056FEC]/30 bg-[#056FEC]/5 dark:bg-[#056FEC]/10 shadow-xs flex flex-col justify-center">
            <CardContent className="p-6 text-center space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-[#056FEC]/15 text-[#056FEC] dark:text-[#05ACFF] mx-auto flex items-center justify-center">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                Optimal Seating Distribution
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                No area or grade has an unseated student. The ILP optimizer balanced session capacity and cohort requirements cleanly.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
