import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { isProjectSoftDeleted } from "@/lib/audit-logging";
import {
  Building2,
  CheckCircle2,
  DollarSign,
  Download,
  Droplets,
  Edit,
  FileSpreadsheet,
  FileText,
  Layers,
  Phone,
  Plus,
  RefreshCw,
  Sandwich,
  Save,
  Store,
  Trash2,
  User,
  Utensils,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { formatEGP } from "@/lib/format";
import { getAssignmentScheduleSummary, type AssignmentSession } from "@/lib/assignment-schedule";
import { downloadCsv } from "@/lib/sheet";
import { BrandIcon } from "@/components/BrandIcon";

export const Route = createFileRoute("/_authenticated/catering")({
  head: () => ({ meta: [{ title: "Catering & Vendors – iSchool" }] }),
  component: CateringPage,
});

type Project = Pick<Tables<"projects">, "id" | "name" | "program" | "code">;
type Batch = Pick<Tables<"batches">, "id" | "name" | "project_id" | "dates" | "time_slots">;
type Provider = Tables<"catering_providers">;
const EGYPTIAN_GOVERNORATES = [
  "Cairo",
  "Giza",
  "Alexandria",
  "Qalyubia",
  "Monufia",
  "Sharqia",
  "Dakahlia",
  "Gharbia",
  "Beheira",
  "Suez",
  "Ismailia",
  "Port Said",
  "Fayoum",
  "Beni Suef",
  "Minya",
  "Asyut",
  "Sohag",
  "Qena",
  "Luxor",
  "Aswan",
  "Matrouh",
  "Red Sea",
  "New Valley",
  "North Sinai",
  "South Sinai",
  "Damietta",
  "Kafr El-Sheikh",
];

function CateringPage() {
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["operations", "administration", "finance"]);
  const canEditPrice = hasAnyRole(["lab_manager", "administration", "finance"]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [projectId, setProjectId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [loading, setLoading] = useState(true);

  // New Provider Modal State
  const [openProviderModal, setOpenProviderModal] = useState(false);
  const [providerForm, setProviderForm] = useState({
    name: "",
    type: "both",
    unit_price: 45,
    contact_person: "",
    phone: "",
    city: "Cairo",
    area: "",
    notes: "",
  });
  const [submittingProvider, setSubmittingProvider] = useState(false);

  // Edit Vendor State
  const [openEditModal, setOpenEditModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    type: "both",
    unit_price: 0,
    contact_person: "",
    phone: "",
    city: "",
    area: "",
    notes: "",
  });
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Vendor Operations & Payment Ledger History State
  const [openHistoryModal, setOpenHistoryModal] = useState(false);
  const [historyProvider, setHistoryProvider] = useState<Provider | null>(null);
  const [historyLines, setHistoryLines] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    setLoading(true);
    try {
      const [projRes, provRes] = await Promise.all([
        supabase.from("projects").select("*").order("code"),
        supabase.from("catering_providers").select("*").order("name"),
      ]);

      if (projRes.error) throw projRes.error;
      const rawProjList = (projRes.data ?? []) as Project[];
      const projList = rawProjList.filter((p) => !isProjectSoftDeleted(p));
      setProjects(projList);
      if (projList.length > 0 && !projectId) {
        setProjectId(projList[0].id);
      }

      setProviders((provRes.data ?? []) as Provider[]);
    } catch (e: any) {
      toast.error(e.message || "Failed to load initial catering data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!projectId) {
      setBatches([]);
      setBatchId("");
      return;
    }
    void supabase
      .from("batches")
      .select("id, name, project_id, dates, time_slots")
      .eq("project_id", projectId)
      .order("created_at")
      .then(({ data }) => {
        const list = (data ?? []) as Batch[];
        setBatches(list);
        setBatchId(list[0]?.id ?? "");
      });
  }, [projectId]);

  async function handleCreateProvider() {
    if (!providerForm.name.trim()) return toast.error("Provider / Vendor name is required");
    if (providerForm.unit_price < 0) return toast.error("Unit price must be non-negative");

    setSubmittingProvider(true);
    try {
      const { error } = await supabase.from("catering_providers").insert({
        name: providerForm.name.trim(),
        type: providerForm.type,
        unit_price: providerForm.unit_price,
        contact_person: providerForm.contact_person.trim() || null,
        phone: providerForm.phone.trim() || null,
        city: providerForm.city.trim() || null,
        area: providerForm.area.trim() || null,
        notes: providerForm.notes.trim() || null,
      });

      if (error) throw error;
      toast.success(`Catering Provider "${providerForm.name}" created successfully!`);
      setOpenProviderModal(false);
      setProviderForm({
        name: "",
        type: "both",
        unit_price: 45,
        contact_person: "",
        phone: "",
        city: "Cairo",
        area: "",
        notes: "",
      });

      // Reload providers
      const { data } = await supabase.from("catering_providers").select("*").order("name");
      setProviders((data ?? []) as Provider[]);
    } catch (e: any) {
      toast.error(e.message || "Failed to create catering provider");
    } finally {
      setSubmittingProvider(false);
    }
  }

  async function handleDeleteProvider(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete vendor "${name}"?`)) return;
    const { error } = await supabase.from("catering_providers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Vendor "${name}" removed`);
    setProviders((prev) => prev.filter((p) => p.id !== id));
  }

  function handleOpenEdit(prov: Provider) {
    setEditingProvider(prov);
    setEditForm({
      name: prov.name,
      type: prov.type,
      unit_price: prov.unit_price,
      contact_person: prov.contact_person || "",
      phone: prov.phone || "",
      city: prov.city || "",
      area: prov.area || "",
      notes: prov.notes || "",
    });
    setOpenEditModal(true);
  }

  async function handleUpdateProvider() {
    if (!editingProvider) return;
    if (!editForm.name.trim()) return toast.error("Vendor name is required");
    if (editForm.unit_price < 0) return toast.error("Unit price must be non-negative");

    setSubmittingEdit(true);
    try {
      const { error } = await supabase
        .from("catering_providers")
        .update({
          name: editForm.name.trim(),
          type: editForm.type,
          unit_price: editForm.unit_price,
          contact_person: editForm.contact_person.trim() || null,
          phone: editForm.phone.trim() || null,
          city: editForm.city.trim() || null,
          area: editForm.area.trim() || null,
          notes: editForm.notes.trim() || null,
        })
        .eq("id", editingProvider.id);

      if (error) throw error;
      toast.success(`Vendor "${editForm.name}" updated successfully!`);
      setOpenEditModal(false);
      setEditingProvider(null);
      void loadInitialData();
    } catch (e: any) {
      toast.error(e.message || "Failed to update vendor");
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function handleOpenHistory(prov: Provider) {
    setHistoryProvider(prov);
    setOpenHistoryModal(true);
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("catering_lines")
        .select(`
          *,
          assignment:assignments (
            id,
            lab_id,
            batch_id,
            labs (id, name, lab_code, area, gov),
            batches (id, name, projects (code, name))
          )
        `)
        .eq("provider", prov.name);

      if (error) throw error;
      setHistoryLines(data ?? []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load vendor operations history");
    } finally {
      setLoadingHistory(false);
    }
  }

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId]
  );
  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === batchId),
    [batches, batchId]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <BrandIcon name="meeting" size={26} />
            Catering &amp; Meals Logistics Management
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sandwiches, mineral water orders, vendor catalog, and price calculations per confirmed lab session.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadInitialData} disabled={loading} className="gap-1.5 border-[#E6EDF1] dark:border-[#1F2A55]">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-[#056FEC]" : ""}`} /> Refresh
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setOpenProviderModal(true)} className="gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-xs">
              <Plus className="h-4 w-4" /> Add Vendor / Provider
            </Button>
          )}
        </div>
      </div>

      {/* Main Tabs: Sandwiches, Water, Vendor Catalog */}
      <Tabs defaultValue="sandwich" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <TabsList>
            <TabsTrigger value="sandwich" className="gap-1.5 text-xs font-semibold">
              <Sandwich className="h-4 w-4 text-amber-600" /> Sandwiches Order Sheet
            </TabsTrigger>
            <TabsTrigger value="water" className="gap-1.5 text-xs font-semibold">
              <Droplets className="h-4 w-4 text-blue-600" /> Mineral Water Order Sheet
            </TabsTrigger>
            <TabsTrigger value="providers" className="gap-1.5 text-xs font-semibold">
              <Store className="h-4 w-4 text-emerald-600" /> Vendors &amp; Price Catalog ({providers.length})
            </TabsTrigger>
          </TabsList>
        </div>

        {/* SANDWICHES TAB */}
        <TabsContent value="sandwich" className="space-y-4">
          <ProjectBatchSelectorBar
            projects={projects}
            batches={batches}
            projectId={projectId}
            batchId={batchId}
            onSelectProject={setProjectId}
            onSelectBatch={setBatchId}
            selectedProject={selectedProject}
            selectedBatch={selectedBatch}
          />

          {!batchId ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Please select a project and batch above to manage sandwich orders.
              </CardContent>
            </Card>
          ) : (
            <CateringTable
              batchId={batchId}
              batchName={selectedBatch?.name || ""}
              batchDates={selectedBatch?.dates || []}
              batchTimeSlots={selectedBatch?.time_slots || []}
              type="sandwich"
              providers={providers}
            />
          )}
        </TabsContent>

        {/* WATER TAB */}
        <TabsContent value="water" className="space-y-4">
          <ProjectBatchSelectorBar
            projects={projects}
            batches={batches}
            projectId={projectId}
            batchId={batchId}
            onSelectProject={setProjectId}
            onSelectBatch={setBatchId}
            selectedProject={selectedProject}
            selectedBatch={selectedBatch}
          />

          {!batchId ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Please select a project and batch above to manage mineral water orders.
              </CardContent>
            </Card>
          ) : (
            <CateringTable
              batchId={batchId}
              batchName={selectedBatch?.name || ""}
              batchDates={selectedBatch?.dates || []}
              batchTimeSlots={selectedBatch?.time_slots || []}
              type="water"
              providers={providers}
            />
          )}
        </TabsContent>

        {/* VENDORS & PRICE CATALOG TAB */}
        <TabsContent value="providers" className="space-y-4">
          <Card className="border-border/60 shadow-xs overflow-hidden">
            <CardHeader className="pb-3 border-b bg-muted/20 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Store className="h-5 w-5 text-emerald-600" />
                  Catering Providers &amp; Vendors Directory
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Registered meal &amp; beverage suppliers with default unit prices for automatic budget calculations.
                </p>
              </div>
              {canEdit && (
                <Button size="sm" onClick={() => setOpenProviderModal(true)} className="gap-1.5 bg-emerald-600 text-white">
                  <Plus className="h-4 w-4" /> Register Provider
                </Button>
              )}
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow className="text-xs">
                      <TableHead>Vendor / Provider Name</TableHead>
                      <TableHead>Service Category</TableHead>
                      <TableHead className="text-right font-bold">Default Unit Price (EGP)</TableHead>
                      <TableHead>Contact Person</TableHead>
                      <TableHead>Governorate</TableHead>
                      <TableHead>Area Coverage</TableHead>
                      <TableHead className="text-muted-foreground truncate max-w-[200px]">Notes</TableHead>
                      <TableHead className="w-36 text-right">Actions &amp; History</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                          No catering providers registered yet. Click <strong>"Register Provider"</strong> to add one.
                        </TableCell>
                      </TableRow>
                    ) : (
                      providers.map((prov) => (
                        <TableRow key={prov.id} className="text-xs hover:bg-muted/20">
                          <TableCell className="font-bold text-foreground flex items-center gap-2">
                            <Store className="h-4 w-4 text-emerald-600 shrink-0" />
                            <span>{prov.name}</span>
                          </TableCell>
                          <TableCell>
                            {prov.type === "sandwich" && (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px]">
                                Sandwiches
                              </Badge>
                            )}
                            {prov.type === "water" && (
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/30 text-[10px]">
                                Mineral Water
                              </Badge>
                            )}
                            {prov.type === "both" && (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 text-[10px]">
                                Full Catering &amp; Water
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatEGP(prov.unit_price)}
                          </TableCell>
                          <TableCell className="text-muted-foreground flex items-center gap-1">
                            <User className="h-3.5 w-3.5 text-muted-foreground/70" />
                            <span>{prov.contact_person || "—"}</span>
                          </TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {prov.phone || "—"}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground">{prov.city || "Cairo"}</TableCell>
                          <TableCell className="text-muted-foreground">{prov.area || "All Areas"}</TableCell>
                          <TableCell className="text-muted-foreground truncate max-w-[200px]">
                            {prov.notes || "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] gap-1 border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                onClick={() => handleOpenHistory(prov)}
                                title="View Full Operations History & Financial Ledger"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                <span>Report</span>
                              </Button>

                              {canEdit && (
                                <>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                                    onClick={() => handleOpenEdit(prov)}
                                    title="Edit Vendor & Default Price"
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                    onClick={() => handleDeleteProvider(prov.id, prov.name)}
                                    title="Delete Provider"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* REGISTER PROVIDER MODAL */}
      <Dialog open={openProviderModal} onOpenChange={setOpenProviderModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Store className="h-5 w-5 text-emerald-600" /> Register Catering Provider / Vendor
            </DialogTitle>
            <DialogDescription>
              Add a new food or beverage supplier with default pricing for direct budget calculations.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Vendor / Company Name *</Label>
              <Input
                value={providerForm.name}
                onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                placeholder="e.g. Domty Catering / Baraka Water"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Service Type</Label>
                <Select
                  value={providerForm.type}
                  onValueChange={(v) => setProviderForm({ ...providerForm, type: v })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandwich">Sandwiches Only</SelectItem>
                    <SelectItem value="water">Mineral Water Only</SelectItem>
                    <SelectItem value="both">Both Sandwiches &amp; Water</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Default Unit Price (EGP) *</Label>
                <Input
                  type="number"
                  step="0.5"
                  className="font-mono"
                  value={providerForm.unit_price}
                  onChange={(e) => setProviderForm({ ...providerForm, unit_price: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Contact Person</Label>
                <Input
                  value={providerForm.contact_person}
                  onChange={(e) => setProviderForm({ ...providerForm, contact_person: e.target.value })}
                  placeholder="e.g. Ahmed Hassan"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Phone Number</Label>
                <Input
                  value={providerForm.phone}
                  onChange={(e) => setProviderForm({ ...providerForm, phone: e.target.value })}
                  placeholder="010xxxxxxx"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Governorate Served *</Label>
                <Select
                  value={providerForm.city}
                  onValueChange={(v) => setProviderForm({ ...providerForm, city: v })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select Governorate..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {EGYPTIAN_GOVERNORATES.map((g) => (
                      <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Area / Coverage Zone</Label>
                <Input
                  value={providerForm.area}
                  onChange={(e) => setProviderForm({ ...providerForm, area: e.target.value })}
                  placeholder="e.g. Nasr City, Dokki, Zayed..."
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Notes &amp; Contract Details</Label>
              <Input
                value={providerForm.notes}
                onChange={(e) => setProviderForm({ ...providerForm, notes: e.target.value })}
                placeholder="e.g. Daily delivery at 11:30 AM"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpenProviderModal(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateProvider} disabled={submittingProvider} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {submittingProvider ? "Registering..." : "Create Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT PROVIDER MODAL */}
      <Dialog open={openEditModal} onOpenChange={setOpenEditModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Edit className="h-5 w-5 text-amber-600" /> Edit Vendor / Provider &amp; Prices
            </DialogTitle>
            <DialogDescription>
              Update company profile details, contact info, and default unit price.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Vendor / Company Name *</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Vendor name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Service Type</Label>
                <Select
                  value={editForm.type}
                  onValueChange={(v) => setEditForm({ ...editForm, type: v })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandwich">Sandwiches Only</SelectItem>
                    <SelectItem value="water">Mineral Water Only</SelectItem>
                    <SelectItem value="both">Both Sandwiches &amp; Water</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Default Unit Price (EGP) *</Label>
                <Input
                  type="number"
                  step="0.5"
                  className="font-mono font-bold"
                  value={editForm.unit_price}
                  onChange={(e) => setEditForm({ ...editForm, unit_price: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Contact Person</Label>
                <Input
                  value={editForm.contact_person}
                  onChange={(e) => setEditForm({ ...editForm, contact_person: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Phone Number</Label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Governorate Served *</Label>
                <Select
                  value={editForm.city}
                  onValueChange={(v) => setEditForm({ ...editForm, city: v })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select Governorate..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {EGYPTIAN_GOVERNORATES.map((g) => (
                      <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Area / Coverage Zone</Label>
                <Input
                  value={editForm.area}
                  onChange={(e) => setEditForm({ ...editForm, area: e.target.value })}
                  placeholder="e.g. Nasr City, Dokki, Zayed..."
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Notes &amp; Contract Details</Label>
              <Input
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpenEditModal(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleUpdateProvider} disabled={submittingEdit} className="bg-amber-600 hover:bg-amber-700 text-white">
              {submittingEdit ? "Updating..." : "Save Vendor Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VENDOR OPERATIONS HISTORY & PAYMENT LEDGER REPORT MODAL */}
      <Dialog open={openHistoryModal} onOpenChange={setOpenHistoryModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Store className="h-5 w-5 text-emerald-600" />
              Vendor Operations &amp; Payment Ledger: {historyProvider?.name}
            </DialogTitle>
            <DialogDescription>
              Complete historical log of supplied lab sessions, quantities delivered, unit costs, and budget transfer status.
            </DialogDescription>
          </DialogHeader>

          {loadingHistory ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading vendor operations ledger…
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Vendor Specs Summary */}
              <div className="grid gap-3 sm:grid-cols-4 text-xs">
                <div className="p-3 rounded-lg border bg-muted/20">
                  <div className="text-muted-foreground">Default Unit Price</div>
                  <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {formatEGP(historyProvider?.unit_price ?? 0)}
                  </div>
                </div>

                <div className="p-3 rounded-lg border bg-muted/20">
                  <div className="text-muted-foreground">Total Sessions Supplied</div>
                  <div className="text-lg font-bold font-mono text-foreground">
                    {historyLines.length} Lab Lines
                  </div>
                </div>

                <div className="p-3 rounded-lg border bg-muted/20">
                  <div className="text-muted-foreground">Total Budget Invoiced</div>
                  <div className="text-lg font-bold font-mono text-primary">
                    {formatEGP(
                      historyLines.reduce((sum, l) => {
                        const units = (l.students + 3) * l.sessions + l.extra_qty;
                        return sum + units * l.unit_price + l.extra_fee;
                      }, 0)
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-lg border bg-muted/20">
                  <div className="text-muted-foreground">Budget Transfer Status</div>
                  <Badge className="mt-1 bg-emerald-600 text-white text-[10px] gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Settled / Transferred
                  </Badge>
                </div>
              </div>

              {/* Table of Orders */}
              <Card className="border-border/60">
                <CardHeader className="py-2.5 px-3 bg-muted/30 border-b">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Lab Session Delivery Orders</span>
                    <span>Showing {historyLines.length} record(s)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-muted/20">
                      <TableRow className="text-xs">
                        <TableHead>Project / Batch</TableHead>
                        <TableHead>Lab Code &amp; Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Students</TableHead>
                        <TableHead className="text-right">Sessions</TableHead>
                        <TableHead className="text-right">Total Units</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right font-bold">Total (EGP)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyLines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                            No catering orders recorded for vendor "{historyProvider?.name}" yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        historyLines.map((line) => {
                          const units = (line.students + 3) * line.sessions + line.extra_qty;
                          const total = units * line.unit_price + line.extra_fee;
                          const projName = line.assignment?.batches?.projects?.name || "—";
                          const batchName = line.assignment?.batches?.name || "—";
                          const labName = line.assignment?.labs?.name || "—";
                          const labCode = line.assignment?.labs?.lab_code || "—";

                          return (
                            <TableRow key={line.id} className="text-xs">
                              <TableCell>
                                <div className="font-bold text-foreground">{projName}</div>
                                <div className="text-[11px] text-muted-foreground">{batchName}</div>
                              </TableCell>
                              <TableCell>
                                <div className="font-medium text-foreground">{labName}</div>
                                <div className="font-mono text-xs text-primary">{labCode}</div>
                              </TableCell>
                              <TableCell>
                                {line.type === "sandwich" ? (
                                  <Badge variant="outline" className="bg-amber-500/10 text-amber-700 text-[10px]">Sandwiches</Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-700 text-[10px]">Water</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono">{line.students}</TableCell>
                              <TableCell className="text-right font-mono">{line.sessions}</TableCell>
                              <TableCell className="text-right font-mono font-bold">{units}</TableCell>
                              <TableCell className="text-right font-mono">{formatEGP(line.unit_price)}</TableCell>
                              <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                {formatEGP(total)}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          <DialogFooter>
            <Button size="sm" onClick={() => setOpenHistoryModal(false)}>
              Close Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectBatchSelectorBar({
  projects,
  batches,
  projectId,
  batchId,
  onSelectProject,
  onSelectBatch,
  selectedProject,
  selectedBatch,
}: {
  projects: Project[];
  batches: Batch[];
  projectId: string;
  batchId: string;
  onSelectProject: (id: string) => void;
  onSelectBatch: (id: string) => void;
  selectedProject?: Project;
  selectedBatch?: Batch;
}) {
  return (
    <Card className="border-border/60 shadow-xs">
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground block">Select Project</span>
              <Select value={projectId} onValueChange={onSelectProject}>
                <SelectTrigger className="w-64 text-xs font-medium">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground block">Select Batch</span>
              <Select value={batchId} onValueChange={onSelectBatch} disabled={!batches.length}>
                <SelectTrigger className="w-64 text-xs font-medium">
                  <SelectValue placeholder="Select batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedProject && selectedBatch && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs font-mono bg-primary/10 text-primary border-primary/20">
                {selectedProject.code}
              </Badge>
              <Badge variant="secondary" className="text-xs font-medium">
                {selectedBatch.name}
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type Lab = Tables<"labs">;
type Line = Tables<"catering_lines">;
type Assignment = Pick<Tables<"assignments">, "id" | "batch_id" | "lab_id" | "days" | "sessions_per_day" | "time_slots">;

type Row = {
  assignment_id: string;
  lab: Lab | undefined;
  provider: string;
  students: number;
  sessions: number;
  unit_price: number;
  extra_qty: number;
  extra_fee: number;
  notes: string;
};

function computeTotal(r: Row): number {
  return ((r.students + 3) * r.sessions + r.extra_qty) * r.unit_price + r.extra_fee;
}

function computeUnits(r: Row): number {
  return (r.students + 3) * r.sessions + r.extra_qty;
}

function CateringTable({
  batchId,
  batchName,
  batchDates,
  batchTimeSlots,
  type,
  providers,
}: {
  batchId: string;
  batchName: string;
  batchDates: string[];
  batchTimeSlots: string[];
  type: "sandwich" | "water";
  providers: Provider[];
}) {
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["operations", "administration", "finance"]);
  const canEditPrice = hasAnyRole(["lab_manager", "administration", "finance"]);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // Available providers for this type
  const relevantProviders = useMemo(() => {
    return providers.filter((p) => p.type === type || p.type === "both");
  }, [providers, type]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, type]);

  async function load() {
    setLoading(true);
    const a = await supabase
      .from("assignments")
      .select("id, batch_id, lab_id, days, sessions_per_day, time_slots")
      .eq("batch_id", batchId)
      .eq("status", "confirmed");

    if (a.error) {
      toast.error(a.error.message);
      setLoading(false);
      return;
    }

    const assignments = (a.data ?? []) as Assignment[];
    const labIds = assignments.map((x) => x.lab_id);
    const assignmentIds = assignments.map((x) => x.id);

    const [l, cl, sessionRes] = await Promise.all([
      labIds.length
        ? supabase.from("labs").select("*").in("id", labIds)
        : Promise.resolve({ data: [] as Lab[], error: null }),
      assignmentIds.length
        ? supabase
            .from("catering_lines")
            .select("*")
            .eq("type", type)
            .in("assignment_id", assignmentIds)
        : Promise.resolve({ data: [] as Line[], error: null }),
      assignmentIds.length
        ? supabase.from("assignment_sessions").select("*").in("assignment_id", assignmentIds)
        : Promise.resolve({ data: [] as AssignmentSession[], error: null }),
    ]);

    const labMap = new Map<string, Lab>();
    for (const lab of (l.data ?? []) as Lab[]) labMap.set(lab.id, lab);

    const lineMap = new Map<string, Line>();
    for (const line of (cl.data ?? []) as Line[]) lineMap.set(line.assignment_id, line);

    const sessionsByAssignment = new Map<string, AssignmentSession[]>();
    for (const session of (sessionRes.data ?? []) as AssignmentSession[]) {
      const existing = sessionsByAssignment.get(session.assignment_id);
      if (existing) existing.push(session);
      else sessionsByAssignment.set(session.assignment_id, [session]);
    }

    const defaultProvider = relevantProviders[0]?.name || (type === "sandwich" ? "Domty Catering" : "Baraka Water");
    const defaultPrice = relevantProviders[0]?.unit_price || (type === "sandwich" ? 45 : 15);

    const built: Row[] = assignments.map((asg) => {
      const lab = labMap.get(asg.lab_id);
      const existing = lineMap.get(asg.id);
      const summary = getAssignmentScheduleSummary(
        asg,
        { dates: batchDates, time_slots: batchTimeSlots },
        sessionsByAssignment.get(asg.id) ?? [],
      );
      const totalSessions = Math.max(1, summary.totalSessions);

      return existing
        ? {
            assignment_id: asg.id,
            lab,
            provider: existing.provider ?? defaultProvider,
            students: existing.students,
            sessions: existing.sessions,
            unit_price: Number(existing.unit_price) || defaultPrice,
            extra_qty: existing.extra_qty,
            extra_fee: Number(existing.extra_fee),
            notes: existing.notes ?? "",
          }
        : {
            assignment_id: asg.id,
            lab,
            provider: defaultProvider,
            students: lab?.capacity ? Number(lab.capacity) : 25,
            sessions: totalSessions,
            unit_price: defaultPrice,
            extra_qty: 0,
            extra_fee: 0,
            notes: "",
          };
    });

    setRows(built);
    setLoading(false);
  }

  function patch(i: number, p: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }

  function handleSelectProvider(i: number, providerName: string) {
    const matchedProv = providers.find((p) => p.name === providerName);
    const newUnitPrice = matchedProv ? Number(matchedProv.unit_price) : rows[i].unit_price;
    patch(i, { provider: providerName, unit_price: newUnitPrice });
    if (canEdit) {
      saveRow({ ...rows[i], provider: providerName, unit_price: newUnitPrice });
    }
  }

  async function saveRow(r: Row) {
    const { error } = await supabase.from("catering_lines").upsert(
      {
        assignment_id: r.assignment_id,
        type,
        provider: r.provider || null,
        students: r.students,
        sessions: r.sessions,
        unit_price: r.unit_price,
        extra_qty: r.extra_qty,
        extra_fee: r.extra_fee,
        notes: r.notes || null,
      },
      { onConflict: "assignment_id,type" }
    );
    if (error) return toast.error(error.message);
    toast.success("Row saved");
  }

  async function saveAll() {
    const payload = rows.map((r) => ({
      assignment_id: r.assignment_id,
      type,
      provider: r.provider || null,
      students: r.students,
      sessions: r.sessions,
      unit_price: r.unit_price,
      extra_qty: r.extra_qty,
      extra_fee: r.extra_fee,
      notes: r.notes || null,
    }));
    if (!payload.length) return;

    const { error } = await supabase
      .from("catering_lines")
      .upsert(payload, { onConflict: "assignment_id,type" });

    if (error) return toast.error(error.message);
    toast.success(`Successfully saved ${payload.length} catering line(s)!`);
    void load();
  }

  function exportCsv() {
    if (!rows.length) return;
    const csvRows = rows.map((r) => ({
      "Lab Code": r.lab?.lab_code || "",
      "Lab Name": r.lab?.name || "",
      "Governorate": r.lab?.gov || "",
      "Area": r.lab?.area || "",
      "Provider Vendor": r.provider,
      "Sessions": r.sessions,
      "Students": r.students,
      "Unit Quantity": computeUnits(r),
      "Unit Price (EGP)": r.unit_price,
      "Extra Qty": r.extra_qty,
      "Extra Fee (EGP)": r.extra_fee,
      "Total Cost (EGP)": computeTotal(r),
      "Notes": r.notes,
    }));
    downloadCsv(`catering-${type}-${batchName.replace(/\s+/g, "-").toLowerCase()}.csv`, csvRows);
    toast.success(`Exported ${type} catering sheet.`);
  }

  const batchTotal = useMemo(() => rows.reduce((s, r) => s + computeTotal(r), 0), [rows]);
  const totalUnits = useMemo(() => rows.reduce((s, r) => s + computeUnits(r), 0), [rows]);
  const unitLabel = type === "sandwich" ? "Sandwiches" : "Water Boxes";

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading catering order sheet...</div>;
  }

  if (!rows.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No confirmed labs in this batch yet. Assign and confirm labs in Projects first.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total {unitLabel} Required</p>
              <div className="mt-1 text-2xl font-bold text-foreground">
                {totalUnits} Units
              </div>
              <p className="text-xs text-muted-foreground mt-1">Across {rows.length} confirmed labs</p>
            </div>
            <div className={`rounded-xl p-3 ${type === "sandwich" ? "bg-amber-500/10 text-amber-600" : "bg-blue-500/10 text-blue-600"}`}>
              {type === "sandwich" ? <Sandwich className="h-6 w-6" /> : <Droplets className="h-6 w-6" />}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Batch Catering Budget</p>
              <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatEGP(batchTotal)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Total calculated cost</p>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-600">
              <DollarSign className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Actions &amp; Export</p>
              <div className="mt-2 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1 text-xs">
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
                {canEdit && (
                  <Button size="sm" onClick={saveAll} className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Save className="h-3.5 w-3.5" /> Save All
                  </Button>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Catering Table */}
      <Card className="border-border/60 shadow-xs overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="text-xs">
                  <TableHead>Lab Code &amp; Name</TableHead>
                  <TableHead>Governorate / Area</TableHead>
                  <TableHead>Provider Vendor Dropdown</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Students</TableHead>
                  <TableHead className="text-right">Total Units</TableHead>
                  <TableHead className="text-right">Extra Qty</TableHead>
                  <TableHead className="text-right">Unit Price (EGP)</TableHead>
                  <TableHead className="text-right">Extra Fee (EGP)</TableHead>
                  <TableHead className="text-right font-bold">Lab Total (EGP)</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const units = computeUnits(r);
                  const total = computeTotal(r);

                  return (
                    <TableRow key={r.assignment_id} className="text-xs hover:bg-muted/20">
                      <TableCell className="min-w-[160px]">
                        <div className="font-bold text-foreground">{r.lab?.name ?? "—"}</div>
                        <div className="font-mono text-[10px] text-primary">{r.lab?.lab_code}</div>
                      </TableCell>
                      <TableCell>
                        {r.lab?.gov ?? "—"}
                        {r.lab?.area ? ` · ${r.lab.area}` : ""}
                      </TableCell>
                      {/* Provider Select Dropdown */}
                      <TableCell className="w-36">
                        <Select
                          value={r.provider}
                          onValueChange={(val) => handleSelectProvider(i, val)}
                          disabled={!canEdit}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Select vendor..." />
                          </SelectTrigger>
                          <SelectContent className="max-h-56">
                            {relevantProviders.map((p) => (
                              <SelectItem key={p.id} value={p.name} className="text-xs">
                                {p.name} ({formatEGP(p.unit_price)})
                              </SelectItem>
                            ))}
                            {/* Option for custom string if current provider isn't in list */}
                            {r.provider && !relevantProviders.some((p) => p.name === r.provider) && (
                              <SelectItem value={r.provider} className="text-xs italic">
                                {r.provider} (Custom)
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="h-7 w-16 text-right font-mono text-xs"
                          value={r.sessions}
                          disabled={!canEdit}
                          onChange={(e) => patch(i, { sessions: Number(e.target.value) })}
                          onBlur={() => canEdit && saveRow(r)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="h-7 w-16 text-right font-mono text-xs"
                          value={r.students}
                          disabled={!canEdit}
                          onChange={(e) => patch(i, { students: Number(e.target.value) })}
                          onBlur={() => canEdit && saveRow(r)}
                        />
                      </TableCell>
                      {/* Editable Total Units with Auto Extra Sync */}
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Input
                            type="number"
                            className="h-7 w-20 text-right font-mono font-bold text-xs text-primary border-primary/30"
                            value={units}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const targetUnits = Number(e.target.value);
                              const baseUnits = (r.students + 3) * r.sessions;
                              const newExtra = targetUnits - baseUnits;
                              patch(i, { extra_qty: newExtra });
                            }}
                            onBlur={() => canEdit && saveRow(r)}
                          />
                          {r.extra_qty !== 0 && (
                            <button
                              onClick={() => {
                                patch(i, { extra_qty: 0 });
                                if (canEdit) saveRow({ ...r, extra_qty: 0 });
                              }}
                              className="text-[9px] text-amber-700 dark:text-amber-300 hover:underline font-mono"
                              title="Reset Extra Qty to 0"
                            >
                              Reset ({r.extra_qty > 0 ? `+${r.extra_qty}` : r.extra_qty})
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="h-7 w-16 text-right font-mono text-xs"
                          value={r.extra_qty}
                          disabled={!canEdit}
                          onChange={(e) => patch(i, { extra_qty: Number(e.target.value) })}
                          onBlur={() => canEdit && saveRow(r)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-7 w-20 text-right font-mono text-xs"
                          value={r.unit_price}
                          disabled={!canEditPrice}
                          onChange={(e) => patch(i, { unit_price: Number(e.target.value) })}
                          onBlur={() => canEdit && saveRow(r)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-7 w-20 text-right font-mono text-xs"
                          value={r.extra_fee}
                          disabled={!canEditPrice}
                          onChange={(e) => patch(i, { extra_fee: Number(e.target.value) })}
                          onBlur={() => canEdit && saveRow(r)}
                        />
                      </TableCell>
                      <TableCell className="text-right font-bold font-mono text-emerald-600 dark:text-emerald-400">
                        {formatEGP(total)}
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-7 text-xs w-32"
                          value={r.notes}
                          disabled={!canEdit}
                          onChange={(e) => patch(i, { notes: e.target.value })}
                          onBlur={() => canEdit && saveRow(r)}
                          placeholder="Notes..."
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Formula Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground gap-2">
        <span>
          💡 Formula: Base Units = <strong>(Students + 3) &times; Sessions</strong>. Total Units = <strong>Base Units + Extra Qty</strong>. Total Cost = <strong>Total Units &times; Unit Price + Extra Fee</strong>.
        </span>
        <div className="text-sm font-bold text-foreground">
          Batch Total: <span className="text-emerald-600 dark:text-emerald-400 font-mono">{formatEGP(batchTotal)}</span>
        </div>
      </div>
    </div>
  );
}
