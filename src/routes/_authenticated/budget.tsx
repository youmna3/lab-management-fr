import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  DollarSign,
  Download,
  FileSpreadsheet,
  Filter,
  Layers,
  PieChart,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Store,
  Trash2,
  User,
  Utensils,
  Wallet,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Tables } from "@/integrations/supabase/types";
import { formatEGP } from "@/lib/format";
import { downloadCsv } from "@/lib/sheet";
import { BrandIcon } from "@/components/BrandIcon";

export const Route = createFileRoute("/_authenticated/budget")({
  head: () => ({ meta: [{ title: "Budget & Financial Operations – iSchool" }] }),
  component: BudgetPage,
});

type Intake = Tables<"intake_budget_view">;
type ProjectBudget = Tables<"project_budget_view">;
type BatchBudget = Tables<"batch_budget_view">;
type Extra = Tables<"project_extra_costs">;

const BUDGET_CATEGORIES = [
  "Transportation",
  "Accommodation",
  "Meals (extra)",
  "Printing & materials",
  "Trainer / facilitator fees",
  "Venue / logistics",
  "Communications",
  "Equipment rental",
  "Other",
];

const ALL_PROGRAMS = "__all__";

function BudgetPage() {
  const { hasAnyRole } = useAuth();
  const isFinanceOrAdmin = hasAnyRole(["finance", "administration"]);

  if (!isFinanceOrAdmin) {
    return (
      <div className="mx-auto max-w-4xl p-8 text-center space-y-4">
        <Card className="border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 shadow-xs">
          <CardContent className="py-12 space-y-3">
            <ShieldAlert className="mx-auto h-12 w-12 text-rose-600 dark:text-rose-400" />
            <h2 className="text-xl font-bold text-foreground">Access Restricted</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Budget &amp; financial operations are restricted to Finance and Administration roles. Operations users do not have permission to view financial metrics.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canEdit = isFinanceOrAdmin;

  type CateringProv = Tables<"catering_providers">;
  type LabVendor = Tables<"labs">;

  const [loading, setLoading] = useState(true);
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [projectBudgets, setProjectBudgets] = useState<ProjectBudget[]>([]);
  const [batchBudgets, setBatchBudgets] = useState<BatchBudget[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [form, setForm] = useState({ label: "", amount: 0, category: "" });

  const [cateringProviders, setCateringProviders] = useState<CateringProv[]>([]);
  const [labVendors, setLabVendors] = useState<LabVendor[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedProgram, setSelectedProgram] = useState<string>(ALL_PROGRAMS);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [i, p, b, provRes, labRes] = await Promise.all([
        supabase.from("intake_budget_view").select("*"),
        supabase.from("project_budget_view").select("*").order("intake_label"),
        supabase.from("batch_budget_view").select("*"),
        supabase.from("catering_providers").select("*").order("name"),
        supabase.from("labs").select("*").eq("is_active", true).order("name"),
      ]);

      if (p.error) throw p.error;
      setIntakes((i.data ?? []) as Intake[]);
      setProjectBudgets((p.data ?? []) as ProjectBudget[]);
      setBatchBudgets((b.data ?? []) as BatchBudget[]);
      setCateringProviders((provRes.data ?? []) as CateringProv[]);
      setLabVendors((labRes.data ?? []) as LabVendor[]);

      if (!selectedProjectId && p.data && p.data.length > 0) {
        setSelectedProjectId((p.data[0] as ProjectBudget).project_id);
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to load budget data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedProjectId) return;
    void supabase
      .from("project_extra_costs")
      .select("*")
      .eq("project_id", selectedProjectId)
      .order("created_at")
      .then(({ data }) => setExtras((data ?? []) as Extra[]));
  }, [selectedProjectId]);

  const currentProject = useMemo(() => {
    return projectBudgets.find((p) => p.project_id === selectedProjectId) ?? null;
  }, [projectBudgets, selectedProjectId]);

  const currentBatches = useMemo(() => {
    return batchBudgets.filter((b) => b.project_id === selectedProjectId);
  }, [batchBudgets, selectedProjectId]);

  // Overall Financial Totals
  const grandTotals = useMemo(() => {
    let grandTotal = 0;
    let labTotal = 0;
    let cateringTotal = 0;
    let extrasTotal = 0;

    projectBudgets.forEach((p) => {
      grandTotal += Number(p.total_cost ?? 0);
      labTotal += Number(p.lab_cost ?? 0);
      cateringTotal += Number(p.sandwich_cost ?? 0) + Number(p.water_cost ?? 0);
      extrasTotal += Number(p.extras_cost ?? 0);
    });

    return { grandTotal, labTotal, cateringTotal, extrasTotal };
  }, [projectBudgets]);

  // Filtered Project Budgets
  const filteredProjectBudgets = useMemo(() => {
    return projectBudgets.filter((p) => {
      const q = search.toLowerCase().trim();

      if (q) {
        const matchName = p.name?.toLowerCase().includes(q);
        const matchIntake = p.intake_label?.toLowerCase().includes(q);
        if (!matchName && !matchIntake) return false;
      }

      if (selectedProgram !== ALL_PROGRAMS) {
        const pName = p.name?.toUpperCase() || "";
        if (!pName.includes(selectedProgram)) return false;
      }

      return true;
    });
  }, [projectBudgets, search, selectedProgram]);

  async function addExtra() {
    if (!selectedProjectId) return;
    if (!form.category) return toast.error("Choose a cost category");
    if (form.amount <= 0) return toast.error("Enter a valid cost amount");

    const { error } = await supabase.from("project_extra_costs").insert({
      project_id: selectedProjectId,
      label: form.label.trim() || form.category,
      amount: form.amount,
      category: form.category,
    });

    if (error) return toast.error(error.message);
    toast.success("Extra cost added");
    setForm({ label: "", amount: 0, category: "" });
    await loadAll();

    const { data } = await supabase
      .from("project_extra_costs")
      .select("*")
      .eq("project_id", selectedProjectId)
      .order("created_at");
    setExtras((data ?? []) as Extra[]);
  }

  async function removeExtra(id: string) {
    const { error } = await supabase.from("project_extra_costs").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Extra cost deleted");
    setExtras((prev) => prev.filter((e) => e.id !== id));
    void loadAll();
  }

  function exportCurrentProjectCsv() {
    if (!currentProject) return;
    const rows = [
      { Section: "Project", Item: currentProject.name ?? "", Amount: "" },
      { Section: "Lab Rental Fees", Item: "Physical Labs", Amount: Number(currentProject.lab_cost ?? 0).toFixed(2) },
      { Section: "Sandwiches Catering", Item: "Student Meals", Amount: Number(currentProject.sandwich_cost ?? 0).toFixed(2) },
      { Section: "Water Catering", Item: "Refreshments", Amount: Number(currentProject.water_cost ?? 0).toFixed(2) },
      { Section: "Extra Operational Costs", Item: "Logistics & Transport", Amount: Number(currentProject.extras_cost ?? 0).toFixed(2) },
      { Section: "TOTAL BUDGET", Item: "Grand Total", Amount: Number(currentProject.total_cost ?? 0).toFixed(2) },
      ...currentBatches.map((b) => ({
        Section: "Batch",
        Item: b.batch_name ?? "",
        Amount: Number(b.total_cost ?? 0).toFixed(2),
      })),
    ];
    downloadCsv(`budget-${(currentProject.name ?? "project").replace(/\s+/g, "-").toLowerCase()}.csv`, rows);
    toast.success("Exported project budget CSV.");
  }

  function exportGrandTotalBudgetCsv() {
    if (!projectBudgets.length) return;
    const rows = projectBudgets.map((p) => ({
      "Intake": p.intake_label ?? "",
      "Project": p.name ?? "",
      "Lab Cost (EGP)": Number(p.lab_cost ?? 0).toFixed(2),
      "Sandwich Cost (EGP)": Number(p.sandwich_cost ?? 0).toFixed(2),
      "Water Cost (EGP)": Number(p.water_cost ?? 0).toFixed(2),
      "Extra Costs (EGP)": Number(p.extras_cost ?? 0).toFixed(2),
      "Total Cost (EGP)": Number(p.total_cost ?? 0).toFixed(2),
    }));
    downloadCsv("master-budget-summary.csv", rows);
    toast.success("Exported Master Operations Budget CSV.");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <BrandIcon name="checkmark" size={26} />
            Financial Operations &amp; Budget Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Complete cost roll-up: Physical Labs &rarr; Batches &rarr; Projects &rarr; Intakes (EGP).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading} className="gap-1.5 border-[#E6EDF1] dark:border-[#1F2A55]">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-[#056FEC]" : ""}`} /> Refresh
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" size="sm" className="gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-xs">
                <Download className="h-4 w-4" /> Export Financials
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                Export Options
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={exportCurrentProjectCsv} disabled={!currentProject} className="text-xs cursor-pointer">
                <FileSpreadsheet className="mr-2 h-4 w-4 text-[#0EAA3A]" /> Selected Project Budget
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportGrandTotalBudgetCsv} className="text-xs cursor-pointer">
                <Download className="mr-2 h-4 w-4 text-[#056FEC]" /> Grand Total Master Budget
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* High-level Financial KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Grand Total Budget</p>
              <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatEGP(grandTotals.grandTotal)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Across all intakes &amp; batches</p>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-600">
              <Wallet className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Lab Rental Investment</p>
              <div className="mt-1 text-2xl font-bold text-foreground">
                {formatEGP(grandTotals.labTotal)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {grandTotals.grandTotal > 0 ? `${Math.round((grandTotals.labTotal / grandTotals.grandTotal) * 100)}% of total budget` : "0%"}
              </p>
            </div>
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <Building2 className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Catering &amp; Refreshments</p>
              <div className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {formatEGP(grandTotals.cateringTotal)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Sandwiches &amp; mineral water</p>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-3 text-amber-600">
              <Utensils className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Extra Operational Costs</p>
              <div className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">
                {formatEGP(grandTotals.extrasTotal)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Logistics, transport &amp; venue</p>
            </div>
            <div className="rounded-xl bg-blue-500/10 p-3 text-blue-600">
              <Sparkles className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Header */}
      <Tabs defaultValue="projects" className="space-y-6">
        <TabsList>
          <TabsTrigger value="projects" className="gap-1.5 text-xs font-semibold">
            <PieChart className="h-4 w-4 text-emerald-600" /> Projects &amp; Intakes Budget
          </TabsTrigger>
          <TabsTrigger value="vendors" className="gap-1.5 text-xs font-semibold">
            <Store className="h-4 w-4 text-blue-600" /> Master Vendors &amp; Suppliers Financial Ledger ({cateringProviders.length + labVendors.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-6">
          {/* Intake Budget Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2">
        {intakes.map((it) => {
          const tot = Number(it.total_cost ?? 0);
          const lCost = Number(it.lab_cost ?? 0);
          const cCost = Number(it.catering_cost ?? 0);
          const eCost = Number(it.extras_cost ?? 0);

          const labPct = tot > 0 ? Math.round((lCost / tot) * 100) : 0;
          const catPct = tot > 0 ? Math.round((cCost / tot) * 100) : 0;
          const extPct = tot > 0 ? Math.round((eCost / tot) * 100) : 0;

          return (
            <Card key={it.intake ?? "x"} className="border-border/60 shadow-xs overflow-hidden">
              <CardHeader className="pb-2 border-b bg-muted/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold text-foreground">
                    Intake: {it.intake} Total
                  </CardTitle>
                  <Badge variant="secondary" className="font-mono text-xs font-bold text-emerald-600">
                    {formatEGP(tot)}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3">
                {/* Cost Breakdown Progress Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Cost Composition Breakdown</span>
                    <span>Labs {labPct}% | Catering {catPct}% | Extras {extPct}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                    <div className="h-full bg-primary" style={{ width: `${labPct}%` }} title={`Labs: ${formatEGP(lCost)}`} />
                    <div className="h-full bg-amber-500" style={{ width: `${catPct}%` }} title={`Catering: ${formatEGP(cCost)}`} />
                    <div className="h-full bg-blue-500" style={{ width: `${extPct}%` }} title={`Extras: ${formatEGP(eCost)}`} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs text-center">
                  <div className="rounded bg-muted/30 p-2">
                    <span className="text-muted-foreground block text-[10px]">Labs</span>
                    <strong className="text-foreground">{formatEGP(lCost)}</strong>
                  </div>
                  <div className="rounded bg-muted/30 p-2">
                    <span className="text-muted-foreground block text-[10px]">Catering</span>
                    <strong className="text-amber-600 dark:text-amber-400">{formatEGP(cCost)}</strong>
                  </div>
                  <div className="rounded bg-muted/30 p-2">
                    <span className="text-muted-foreground block text-[10px]">Extras</span>
                    <strong className="text-blue-600 dark:text-blue-400">{formatEGP(eCost)}</strong>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search & Filter Bar */}
      <Card className="border-border/60 shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search project by name or intake..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedProgram} onValueChange={setSelectedProgram}>
                <SelectTrigger className="w-[160px] text-xs">
                  <SelectValue placeholder="Program Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROGRAMS}>All Programs</SelectItem>
                  <SelectItem value="DECI">DECI Projects</SelectItem>
                  <SelectItem value="DEMI">DEMI Projects</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Projects Financial Table */}
      <Card className="border-border/60 shadow-xs overflow-hidden">
        <CardHeader className="pb-3 border-b bg-muted/20">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span>Project Financial Roll-Up Overview</span>
            <span className="text-xs font-normal text-muted-foreground">
              Click any project row to inspect batch breakdown &amp; manage extra costs
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Project Name</TableHead>
                  <TableHead>Intake</TableHead>
                  <TableHead className="text-right">Physical Labs</TableHead>
                  <TableHead className="text-right">Sandwiches</TableHead>
                  <TableHead className="text-right">Water</TableHead>
                  <TableHead className="text-right">Extra Costs</TableHead>
                  <TableHead className="text-right font-bold">Total Budget (EGP)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      Loading financial ledger...
                    </TableCell>
                  </TableRow>
                ) : filteredProjectBudgets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No project budgets match your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProjectBudgets.map((p) => {
                    const isSelected = selectedProjectId === p.project_id;
                    return (
                      <TableRow
                        key={p.project_id}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-primary/10 font-semibold" : "hover:bg-muted/20"
                        }`}
                        onClick={() => setSelectedProjectId(p.project_id)}
                      >
                        <TableCell className="font-bold flex items-center gap-2">
                          {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
                          <span>{p.name}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.intake_label}</TableCell>
                        <TableCell className="text-right font-mono">{formatEGP(p.lab_cost)}</TableCell>
                        <TableCell className="text-right font-mono">{formatEGP(p.sandwich_cost)}</TableCell>
                        <TableCell className="text-right font-mono">{formatEGP(p.water_cost)}</TableCell>
                        <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                          {formatEGP(p.extras_cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {formatEGP(p.total_cost)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Selected Project Details Section */}
      {currentProject && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Batches Cost Breakdown */}
          <Card className="border-border/60 shadow-xs overflow-hidden">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>{currentProject.name} — Batches Cost Breakdown</span>
                <Badge variant="outline" className="text-xs font-mono">
                  {currentBatches.length} Batches
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="text-xs">
                    <TableHead>Batch Name</TableHead>
                    <TableHead className="text-right">Lab Fees</TableHead>
                    <TableHead className="text-right">Catering</TableHead>
                    <TableHead className="text-right font-bold">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentBatches.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                        No batches configured for this project yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    currentBatches.map((b) => (
                      <TableRow key={b.batch_id} className="text-xs">
                        <TableCell className="font-medium text-foreground">{b.batch_name}</TableCell>
                        <TableCell className="text-right font-mono">{formatEGP(b.lab_cost)}</TableCell>
                        <TableCell className="text-right font-mono">{formatEGP(b.catering_cost)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatEGP(b.total_cost)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Extra Operational Costs Manager */}
          <Card className="border-border/60 shadow-xs overflow-hidden">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Extra Operational Costs ({currentProject.name})</span>
                <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                  Total: {formatEGP(currentProject.extras_cost)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {canEdit && (
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
                  <span className="text-xs font-semibold text-foreground block">
                    Add New Extra Operational Expense
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-[11px] text-muted-foreground">Category</Label>
                      <Select
                        value={form.category}
                        onValueChange={(v) => setForm({ ...form, category: v })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          {BUDGET_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c} className="text-xs">
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="sm:col-span-2 grid gap-1">
                      <Label className="text-[11px] text-muted-foreground">Description / Purpose</Label>
                      <Input
                        className="h-8 text-xs"
                        value={form.label}
                        onChange={(e) => setForm({ ...form, label: e.target.value })}
                        placeholder="e.g. Bus transport Aswan &rarr; Edfu"
                      />
                    </div>

                    <div className="grid gap-1">
                      <Label className="text-[11px] text-muted-foreground">Amount (EGP)</Label>
                      <div className="flex gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 text-xs font-mono"
                          value={form.amount || ""}
                          onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                          placeholder="0.00"
                        />
                        <Button size="icon" className="h-8 w-8 shrink-0 bg-primary" onClick={addExtra}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow className="text-xs">
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount (EGP)</TableHead>
                      {canEdit && <TableHead className="w-10"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extras.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canEdit ? 4 : 3}
                          className="py-6 text-center text-xs text-muted-foreground"
                        >
                          No extra operational expenses recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      extras.map((x) => (
                        <TableRow key={x.id} className="text-xs">
                          <TableCell className="font-medium text-foreground">{x.label}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {x.category ?? "General"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatEGP(x.amount)}
                          </TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                onClick={() => removeExtra(x.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
        </TabsContent>

        {/* VENDORS & SUPPLIERS FINANCIAL LEDGER TAB */}
        <TabsContent value="vendors" className="space-y-4">
          <Card className="border-border/60 shadow-xs overflow-hidden">
            <CardHeader className="pb-3 border-b bg-muted/20 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Store className="h-5 w-5 text-blue-600" />
                  Master Vendor &amp; Supplier Financial Ledger
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Consolidated tracking for both Physical Lab Facility Owners and Catering Suppliers with payment transfer statuses.
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="text-xs">
                    <TableHead>Vendor / Partner Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Location / City</TableHead>
                    <TableHead className="text-right font-bold">Standard Rate (EGP)</TableHead>
                    <TableHead>Budget Transfer Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Catering Suppliers */}
                  {cateringProviders.map((cp) => (
                    <TableRow key={`cp-${cp.id}`} className="text-xs hover:bg-muted/20">
                      <TableCell className="font-bold text-foreground flex items-center gap-2">
                        <Utensils className="h-4 w-4 text-amber-600 shrink-0" />
                        <div>
                          <div>{cp.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{cp.contact_person || cp.phone || "Catering Vendor"}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px]">
                          Catering &amp; Beverage Supplier ({cp.type})
                        </Badge>
                      </TableCell>
                      <TableCell>{cp.city || "Cairo"}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {formatEGP(cp.unit_price)} / unit
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Transferred / Active
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => window.location.href = "/catering"}
                        >
                          Manage Catering
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Lab Facility Partners */}
                  {labVendors.map((lv) => (
                    <TableRow key={`lv-${lv.id}`} className="text-xs hover:bg-muted/20">
                      <TableCell className="font-bold text-foreground flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-blue-600 shrink-0" />
                        <div>
                          <div>{lv.vendor_name || lv.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{lv.lab_code} · {lv.name}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/30 text-[10px]">
                          Physical Lab Facility Owner
                        </Badge>
                      </TableCell>
                      <TableCell>{lv.gov} · {lv.area}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {formatEGP(lv.session_price)} / session
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Transferred / Active
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => window.location.href = "/lab-data"}
                        >
                          View Lab Specs
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
