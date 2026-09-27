import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarRange,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  FolderKanban,
  FolderPlus,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { formatEGP } from "@/lib/format";
import { calculateAssignmentPrice, getAssignmentScheduleSummary, type AssignmentSession } from "@/lib/assignment-schedule";
import { BrandIcon } from "@/components/BrandIcon";
import { ProjectTimelineCreationDialog } from "@/components/ProjectTimelineCreationDialog";
import { softDeleteProject, isProjectSoftDeleted } from "@/lib/audit-logging";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects & Intakes – iSchool" }] }),
  component: ProjectsPage,
});

type Project = Tables<"projects">;
type Batch = Tables<"batches">;
type Need = Tables<"batch_needs">;
type Assignment = Tables<"assignments">;
type Lab = Tables<"labs">;

const ALL_PROGRAMS = "__all__";

function ProjectsPage() {
  const [loading, setLoading] = useState(true);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentSessions, setAssignmentSessions] = useState<AssignmentSession[]>([]);
  const [labs, setLabs] = useState<Lab[]>([]);

  const { user, roles, hasAnyRole } = useAuth();
  const canDeleteProject = hasAnyRole(["lab_manager", "operations", "administration"]);

  const actorInfo = useMemo(() => {
    return {
      id: user?.id || null,
      name: (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "Administrator",
      email: user?.email || null,
      role: roles.length > 0 ? roles.join(", ") : "Administrator",
    };
  }, [user, roles]);

  // Delete project state
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  // Search & Filter state
  const [search, setSearch] = useState("");
  const [selectedProgram, setSelectedProgram] = useState<string>(ALL_PROGRAMS);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [projRes, batchRes, needRes, asgRes, sessionRes, labRes] = await Promise.all([
        supabase.from("projects").select("*").order("code"),
        supabase.from("batches").select("*"),
        supabase.from("batch_needs").select("*"),
        supabase.from("assignments").select("*"),
        supabase.from("assignment_sessions").select("*"),
        supabase.from("labs").select("*"),
      ]);

      if (projRes.error) throw projRes.error;
      const activeProjects = (projRes.data || []).filter((p) => !isProjectSoftDeleted(p));
      const activeProjIds = new Set(activeProjects.map((p) => p.id));
      const activeBatches = (batchRes.data || []).filter((b) => activeProjIds.has(b.project_id));

      setProjects(activeProjects);
      setBatches(activeBatches);
      setNeeds(needRes.data || []);
      setAssignments(asgRes.data || []);
      setAssignmentSessions((sessionRes.data ?? []) as AssignmentSession[]);
      setLabs(labRes.data || []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load projects data");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProject() {
    if (!projectToDelete) return;
    if (!canDeleteProject) {
      toast.error("Unauthorized: You do not have permission to delete projects.");
      return;
    }
    setDeletingProject(true);
    try {
      const res = await softDeleteProject({
        projectId: projectToDelete.id,
        actor: actorInfo,
      });
      if (!res.success) throw new Error(res.error || "Failed to soft-delete project");
      toast.success(`Project "${projectToDelete.name}" soft-deleted and archived. You can restore or purge it in the Admin Control Panel.`);
      setProjectToDelete(null);
      await loadData();
    } catch (err: any) {
      console.error("Delete project error:", err);
      toast.error(err.message || "Failed to delete project");
    } finally {
      setDeletingProject(false);
    }
  }

  // Lab Lookup
  const labMap = useMemo(() => {
    const map = new Map<string, Lab>();
    labs.forEach((l) => map.set(l.id, l));
    return map;
  }, [labs]);

  const batchMap = useMemo(() => {
    const map = new Map<string, Batch>();
    batches.forEach((batch) => map.set(batch.id, batch));
    return map;
  }, [batches]);

  const sessionsByAssignment = useMemo(() => {
    const map = new Map<string, AssignmentSession[]>();
    assignmentSessions.forEach((session) => {
      const existing = map.get(session.assignment_id);
      if (existing) existing.push(session);
      else map.set(session.assignment_id, [session]);
    });
    return map;
  }, [assignmentSessions]);

  // Aggregate project metrics
  const projectMetrics = useMemo(() => {
    return projects.map((p) => {
      const pBatches = batches.filter((b) => b.project_id === p.id);
      const batchIds = new Set(pBatches.map((b) => b.id));

      const pNeeds = needs.filter((n) => batchIds.has(n.batch_id));
      const requiredLabs = pNeeds.reduce((sum, n) => sum + (n.labs_required || 0), 0);

      const pAssignments = assignments.filter((a) => batchIds.has(a.batch_id) && a.status !== "denied");
      const confirmedAssignments = pAssignments.filter((a) => a.status === "confirmed");

      let totalEstCost = 0;
      let totalSeatedCapacity = 0;

      pAssignments.forEach((a) => {
        const lab = labMap.get(a.lab_id);
        const batch = batchMap.get(a.batch_id);
        const summary = getAssignmentScheduleSummary(
          a,
          batch ?? { dates: [], time_slots: [] },
          sessionsByAssignment.get(a.id) ?? [],
        );
        const price = Number(a.confirmed_price ?? lab?.session_price ?? 0);
        totalEstCost += calculateAssignmentPrice(price, summary);

        if (lab?.capacity) {
          totalSeatedCapacity += Number(lab.capacity);
        }
      });

      const fulfillmentRate = requiredLabs > 0
        ? Math.round((confirmedAssignments.length / requiredLabs) * 100)
        : 0;

      return {
        project: p,
        batches: pBatches,
        requiredLabs,
        assignedLabsCount: pAssignments.length,
        confirmedLabsCount: confirmedAssignments.length,
        fulfillmentRate,
        totalEstCost,
        totalSeatedCapacity,
      };
    });
  }, [projects, batches, needs, assignments, labMap, batchMap, sessionsByAssignment]);

  const deferredSearch = useDeferredValue(search);

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return projectMetrics.filter((m) => {
      const { project } = m;
      const q = deferredSearch.toLowerCase().trim();

      if (q) {
        const matchName = project.name.toLowerCase().includes(q);
        const matchCode = project.code?.toLowerCase().includes(q);
        const matchIntake = project.intake_label?.toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchIntake) return false;
      }

      if (selectedProgram !== ALL_PROGRAMS && project.program !== selectedProgram) {
        return false;
      }

      return true;
    });
  }, [projectMetrics, deferredSearch, selectedProgram]);

  // High-level Overall KPI Statistics
  const overallStats = useMemo(() => {
    const totalProj = projects.length;
    const totalBatches = batches.length;
    const totalRequired = needs.reduce((sum, n) => sum + (n.labs_required || 0), 0);
    const activeAssignments = assignments.filter((a) => a.status !== "denied");
    const confirmedCount = assignments.filter((a) => a.status === "confirmed").length;

    let totalBudget = 0;
    activeAssignments.forEach((a) => {
      const lab = labMap.get(a.lab_id);
      const batch = batchMap.get(a.batch_id);
      const summary = getAssignmentScheduleSummary(
        a,
        batch ?? { dates: [], time_slots: [] },
        sessionsByAssignment.get(a.id) ?? [],
      );
      const price = Number(a.confirmed_price ?? lab?.session_price ?? 0);
      totalBudget += calculateAssignmentPrice(price, summary);
    });

    const overallFulfillment = totalRequired > 0
      ? Math.round((confirmedCount / totalRequired) * 100)
      : 0;

    return {
      totalProj,
      totalBatches,
      totalRequired,
      confirmedCount,
      overallFulfillment,
      totalBudget,
    };
  }, [projects, batches, needs, assignments, labMap, batchMap, sessionsByAssignment]);

  // Group by Program
  const groupedByProgram = useMemo(() => {
    const groups: { program: string; items: typeof projectMetrics }[] = [];
    const programs = ["DECI", "DEMI"];

    programs.forEach((prog) => {
      const items = filteredProjects.filter((m) => m.project.program === prog);
      if (items.length) {
        groups.push({ program: prog, items });
      }
    });

    const otherItems = filteredProjects.filter(
      (m) => !m.project.program || !programs.includes(m.project.program)
    );
    if (otherItems.length) {
      groups.push({ program: "Other", items: otherItems });
    }

    return groups;
  }, [filteredProjects]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <BrandIcon name="project" size={26} />
            Projects &amp; Program Intakes
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Master management of DECI &amp; DEMI physical session intakes, lab demand needs, and batch execution workspaces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setCreateProjectOpen(true)}
            className="gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-xs"
          >
            <FolderPlus className="h-4 w-4" /> Create Project / Timeline
          </Button>
          <Link to="/lab-allocation">
            <Button variant="outline" size="sm" className="gap-1.5 border-[#056FEC]/40 text-[#056FEC] hover:bg-[#056FEC]/10">
              <BrandIcon name="process_on" size={16} /> Lab Allocation Engine
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5 border-[#E6EDF1] dark:border-[#1F2A55]">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-[#056FEC]" : ""}`} /> Refresh
          </Button>
          <Link to="/timeline">
            <Button variant="outline" size="sm" className="gap-1.5">
              <CalendarRange className="h-4 w-4" /> Master Timeline
            </Button>
          </Link>
        </div>
      </div>

      {/* High-level KPI Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Active Projects &amp; Programs</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{overallStats.totalProj}</span>
                <Badge variant="secondary" className="text-xs font-mono">
                  {overallStats.totalBatches} Batches
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">DECI &amp; DEMI Active Intakes</p>
            </div>
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <FolderKanban className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Overall Lab Fulfillment</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#056FEC] dark:text-[#05ACFF]">
                  {overallStats.overallFulfillment}%
                </span>
                <span className="text-xs text-muted-foreground">
                  ({overallStats.confirmedCount}/{overallStats.totalRequired})
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Confirmed vs required labs</p>
            </div>
            <div className="rounded-xl bg-[#056FEC]/10 p-3 text-[#056FEC]">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Est. Total Ops Budget</p>
              <div className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">
                {formatEGP(overallStats.totalBudget)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">All confirmed lab session fees</p>
            </div>
            <div className="rounded-xl bg-blue-500/10 p-3 text-blue-600">
              <DollarSign className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Demand Fulfillment Status</p>
              <div className="mt-2 flex items-center gap-2 text-xs font-semibold">
                <span className="flex items-center gap-1 text-[#056FEC]">
                  <CheckCircle2 className="h-3.5 w-3.5" /> High Ready
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Tracked across governorates</p>
            </div>
            <div className="rounded-xl bg-indigo-500/10 p-3 text-indigo-600">
              <Activity className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card className="border-border/60 shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by Project Name, Code (e.g. DECI4), or Intake Label..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedProgram} onValueChange={setSelectedProgram}>
                <SelectTrigger className="w-[160px] text-xs">
                  <SelectValue placeholder="Program" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROGRAMS}>All Programs</SelectItem>
                  <SelectItem value="DECI">DECI Program</SelectItem>
                  <SelectItem value="DEMI">DEMI Program</SelectItem>
                </SelectContent>
              </Select>

              {(search || selectedProgram !== ALL_PROGRAMS) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setSelectedProgram(ALL_PROGRAMS);
                  }}
                  className="text-xs"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MAIN PROJECT CARDS BY PROGRAM */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Loading project intakes workspace...
        </div>
      ) : groupedByProgram.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No projects matched your search criteria.
          </CardContent>
        </Card>
      ) : (
        groupedByProgram.map((group) => (
          <div key={group.program} className="space-y-4">
            <div className="flex items-center gap-2 border-b border-primary/20 pb-2">
              <Badge className="bg-primary text-primary-foreground font-bold text-xs px-2.5 py-0.5">
                {group.program} PROGRAM
              </Badge>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Intakes &amp; Execution Workspaces
              </span>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {group.items.map((m) => {
                const {
                  project,
                  batches: pBatches,
                  requiredLabs,
                  confirmedLabsCount,
                  fulfillmentRate,
                  totalEstCost,
                  totalSeatedCapacity,
                } = m;

                return (
                  <Card key={project.id} className="border-border/60 hover:border-primary/60 transition-all shadow-xs overflow-hidden flex flex-col justify-between">
                    <div>
                      <CardHeader className="pb-3 border-b bg-muted/20">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <CardTitle className="text-lg font-bold text-foreground">
                              {project.name}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                              {project.intake_label && <span>Intake: {project.intake_label}</span>}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant="secondary" className="font-mono text-xs font-bold">
                              {project.code}
                            </Badge>
                            {canDeleteProject && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setProjectToDelete(project);
                                }}
                                title={`Delete ${project.name}`}
                                aria-label={`Delete ${project.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Progress Fulfillment Bar */}
                        <div className="mt-3 space-y-1">
                          <div className="flex items-center justify-between text-xs font-medium">
                            <span className="text-muted-foreground">Lab Demand Fulfillment</span>
                            <span className="text-[#056FEC] dark:text-[#05ACFF] font-bold font-mono">
                              {fulfillmentRate}% ({confirmedLabsCount}/{requiredLabs} Labs)
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-[#056FEC] transition-all duration-500 rounded-full"
                              style={{ width: `${fulfillmentRate}%` }}
                            />
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="p-4 space-y-4">
                        {/* Key Project Metrics Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                            <span className="text-muted-foreground block text-[11px]">Batches</span>
                            <strong className="text-sm font-bold text-foreground">{pBatches.length}</strong>
                          </div>
                          <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                            <span className="text-muted-foreground block text-[11px]">Required Labs</span>
                            <strong className="text-sm font-bold text-foreground">{requiredLabs}</strong>
                          </div>
                          <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                            <span className="text-muted-foreground block text-[11px]">Seated Capacity</span>
                            <strong className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{totalSeatedCapacity}</strong>
                          </div>
                          <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                            <span className="text-muted-foreground block text-[11px]">Est. Budget</span>
                            <strong className="text-sm font-bold text-blue-600 dark:text-blue-400">{formatEGP(totalEstCost)}</strong>
                          </div>
                        </div>

                        {/* Quick Batches Chips Preview */}
                        <div className="space-y-1.5">
                          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                            <Layers className="h-3.5 w-3.5" /> Scheduled Batches:
                          </span>
                          {pBatches.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">No batches created yet.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {pBatches.map((b) => (
                                <Badge
                                  key={b.id}
                                  variant="outline"
                                  className="text-xs font-mono py-1 px-2.5 bg-background border-border/70 flex items-center gap-1.5"
                                >
                                  <span className={`h-2 w-2 rounded-full ${b.status === "exported" || b.status === "ready" ? "bg-[#056FEC]" : "bg-[#FF7F1C]"}`}></span>
                                  <span>{b.name}</span>
                                  <span className="text-muted-foreground text-[10px]">({b.dates?.length || 0}d)</span>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </div>

                    {/* Card Footer Action */}
                    <div className="p-4 pt-0">
                      <Link to="/projects/$id" params={{ id: project.id }} className="block">
                        <Button className="w-full justify-between bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs">
                          <span>Open Project Workspace</span>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ))
      )}

      <ProjectTimelineCreationDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onProjectCreated={() => {
          loadData();
        }}
      />

      <AlertDialog open={Boolean(projectToDelete)} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Archive / Soft-Delete Project
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Are you sure you want to delete <strong>{projectToDelete?.name}</strong> ({projectToDelete?.code})?
              </p>
              <p className="text-xs text-muted-foreground">
                This project and all its associated batches, student rosters, and lab allocations will be soft-deleted and archived. You can view, restore, or permanently purge it from the Admin Control Panel.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingProject}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteProject();
              }}
              disabled={deletingProject}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deletingProject ? "Archiving..." : "Archive & Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
