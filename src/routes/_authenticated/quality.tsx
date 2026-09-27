import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { toast } from "sonner";
import {
  AlertTriangle,
  Award,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  Eye,
  Filter,
  History,
  Layers,
  MapPin,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Video,
  Wrench,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { computeQualityScore, qualityBand, type QualityInput } from "@/lib/quality";
import { BrandIcon } from "@/components/BrandIcon";

export const Route = createFileRoute("/_authenticated/quality")({
  head: () => ({ meta: [{ title: "Lab Quality & Audit Trace – iSchool" }] }),
  component: QualityPage,
});

type Lab = Tables<"labs">;
type Quality = Tables<"lab_quality">;
type Incident = Tables<"lab_incidents">;
type PostSurvey = Tables<"lab_post_surveys">;
type Assignment = Tables<"assignments">;
type Batch = Tables<"batches">;

const ALL_STATUSES = "__all__";
const ALL_GOVS = "__all__";
const ALL_BANDS = "__all__";

interface LabSearchComboboxProps {
  labs: Lab[];
  value: string;
  onChange: (labId: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

function LabSearchCombobox({
  labs,
  value,
  onChange,
  placeholder = "Search and select a lab...",
  className,
  id,
}: LabSearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedLab = useMemo(() => labs.find((l) => l.id === value), [labs, value]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`w-full justify-between text-xs font-normal h-9 bg-background px-3 border-input hover:bg-accent/50 ${className || ""}`}
        >
          <span className="truncate flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-[#056FEC] shrink-0" />
            {selectedLab ? (
              <span className="truncate text-foreground font-medium">
                {selectedLab.name}{" "}
                <span className="font-mono text-primary text-[11px] font-semibold">
                  ({selectedLab.lab_code || "No ID"})
                </span>
                {selectedLab.gov && (
                  <span className="text-muted-foreground text-[11px]"> — {selectedLab.gov}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] max-w-[480px] p-0 shadow-lg border border-border/80"
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
            placeholder="Type lab name, code, or area to search..."
            className="text-xs h-9"
          />
          <CommandList className="max-h-60 overflow-y-auto overscroll-contain">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No matching labs found.
            </CommandEmpty>
            <CommandGroup heading={`Available Labs (${labs.length})`}>
              {labs.map((l) => {
                const isSelected = l.id === value;
                const searchString = `${l.name} ${l.lab_code || ""} ${l.gov || ""} ${l.area || ""} ${l.center_name || ""} ${l.vendor_name || ""}`;
                return (
                  <CommandItem
                    key={l.id}
                    value={searchString}
                    onSelect={() => {
                      onChange(l.id);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between py-2 px-2.5 text-xs cursor-pointer hover:bg-accent/60"
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="font-semibold text-foreground truncate flex items-center gap-1.5">
                        <span className="truncate">{l.name}</span>
                        {l.lab_code && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] px-1 py-0 h-4 shrink-0 bg-muted/40 font-semibold"
                          >
                            {l.lab_code}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {l.gov || "Unspecified"} {l.area ? `• ${l.area}` : ""} {l.center_name ? `• ${l.center_name}` : ""}
                      </div>
                    </div>
                    <Check
                      className={`h-4 w-4 shrink-0 text-primary ${
                        isSelected ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function QualityPage() {
  const { hasRole, user } = useAuth();
  const canEdit = hasRole("lab_manager") || hasRole("administration");

  const [loading, setLoading] = useState(true);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [qualities, setQualities] = useState<Quality[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [surveys, setSurveys] = useState<PostSurvey[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  // Search & Filter state
  const [search, setSearch] = useState("");
  const [selectedGov, setSelectedGov] = useState<string>(ALL_GOVS);
  const [selectedBand, setSelectedBand] = useState<string>(ALL_BANDS);
  const [selectedStatus, setSelectedStatus] = useState<string>(ALL_STATUSES);

  // Pagination state (10 items per page)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Header quick trace popover state
  const [traceSearchOpen, setTraceSearchOpen] = useState(false);

  // Trace Detail Modal state
  const [traceLab, setTraceLab] = useState<Lab | null>(null);

  // Incident Modal state
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  const [incidentLabId, setIncidentLabId] = useState<string>("");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentCategory, setIncidentCategory] = useState<string>("pc");
  const [incidentSeverity, setIncidentSeverity] = useState<string>("medium");
  const [incidentDesc, setIncidentDesc] = useState("");
  const [submittingIncident, setSubmittingIncident] = useState(false);

  // Survey Modal state
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [surveyLabId, setSurveyLabId] = useState<string>("");
  const [surveyOverall, setSurveyOverall] = useState<number>(5);
  const [surveyPc, setSurveyPc] = useState<number>(5);
  const [surveyInternet, setSurveyInternet] = useState<number>(5);
  const [surveyCleanliness, setSurveyCleanliness] = useState<number>(5);
  const [surveyFacilities, setSurveyFacilities] = useState<number>(5);
  const [surveyFeedback, setSurveyFeedback] = useState("");
  const [submittingSurvey, setSubmittingSurvey] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [labsRes, qualRes, incRes, survRes, asgRes, batchRes] = await Promise.all([
        supabase.from("labs").select("*").order("name"),
        supabase.from("lab_quality").select("*"),
        supabase.from("lab_incidents").select("*").order("reported_at", { ascending: false }),
        supabase.from("lab_post_surveys").select("*").order("created_at", { ascending: false }),
        supabase.from("assignments").select("*"),
        supabase.from("batches").select("*"),
      ]);

      if (labsRes.error) throw labsRes.error;
      setLabs(labsRes.data || []);
      setQualities(qualRes.data || []);
      setIncidents(incRes.data || []);
      setSurveys(survRes.data || []);
      setAssignments(asgRes.data || []);
      setBatches(batchRes.data || []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load quality metrics data");
    } finally {
      setLoading(false);
    }
  }

  // Lookup maps
  const qualityByLabId = useMemo(() => {
    const map = new Map<string, Quality>();
    qualities.forEach((q) => map.set(q.lab_id, q));
    return map;
  }, [qualities]);

  const labMap = useMemo(() => {
    const map = new Map<string, Lab>();
    labs.forEach((l) => map.set(l.id, l));
    return map;
  }, [labs]);

  const batchMap = useMemo(() => {
    const map = new Map<string, Batch>();
    batches.forEach((b) => map.set(b.id, b));
    return map;
  }, [batches]);

  const incidentsByLabId = useMemo(() => {
    const map = new Map<string, Incident[]>();
    incidents.forEach((inc) => {
      const list = map.get(inc.lab_id) || [];
      list.push(inc);
      map.set(inc.lab_id, list);
    });
    return map;
  }, [incidents]);

  const surveysByLabId = useMemo(() => {
    const map = new Map<string, PostSurvey[]>();
    surveys.forEach((surv) => {
      const list = map.get(surv.lab_id) || [];
      list.push(surv);
      map.set(surv.lab_id, list);
    });
    return map;
  }, [surveys]);

  const assignmentsByLabId = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    assignments.forEach((asg) => {
      const list = map.get(asg.lab_id) || [];
      list.push(asg);
      map.set(asg.lab_id, list);
    });
    return map;
  }, [assignments]);

  // Derived Governorates
  const governorates = useMemo(() => {
    const set = new Set<string>();
    labs.forEach((l) => {
      if (l.gov) set.add(l.gov);
    });
    return Array.from(set).sort();
  }, [labs]);

  // Computed metrics
  const labTraceData = useMemo(() => {
    return labs.map((lab) => {
      const q = qualityByLabId.get(lab.id);
      const incList = incidentsByLabId.get(lab.id) || [];
      const survList = surveysByLabId.get(lab.id) || [];
      const asgList = assignmentsByLabId.get(lab.id) || [];

      let score = q?.quality_score ?? 0;
      if (!q && (lab.quality_rating || 0) > 0) {
        score = (lab.quality_rating || 0) * 20;
      }
      const band = qualityBand(score);

      const avgSurveyScore = survList.length
        ? Math.round((survList.reduce((acc, s) => acc + s.overall_rating, 0) / survList.length) * 10) / 10
        : null;

      const activeStatus = lab.status || (lab.is_active ? "active" : "deactivated");

      return {
        lab,
        quality: q,
        score,
        band,
        status: activeStatus,
        usageCount: asgList.length,
        incidentCount: incList.length,
        criticalIncidents: incList.filter((i) => i.severity === "critical" || i.severity === "high").length,
        surveyCount: survList.length,
        avgSurveyScore,
        incidents: incList,
        surveys: survList,
        assignments: asgList,
      };
    });
  }, [labs, qualityByLabId, incidentsByLabId, surveysByLabId, assignmentsByLabId]);

  // High-level KPI aggregations
  const stats = useMemo(() => {
    const totalLabs = labTraceData.length;
    const assessedLabs = labTraceData.filter((d) => d.score > 0).length;
    const avgScore = assessedLabs
      ? Math.round(labTraceData.reduce((acc, d) => acc + d.score, 0) / assessedLabs)
      : 0;

    const highQuality = labTraceData.filter((d) => d.band === "high").length;
    const mediumQuality = labTraceData.filter((d) => d.band === "medium").length;
    const lowQuality = labTraceData.filter((d) => d.band === "low").length;

    const totalIncidents = incidents.length;
    const criticalIncidents = incidents.filter((i) => i.severity === "critical" || i.severity === "high").length;

    const totalSurveys = surveys.length;
    const avgPostSurvey = totalSurveys
      ? Math.round((surveys.reduce((acc, s) => acc + s.overall_rating, 0) / totalSurveys) * 10) / 10
      : 0;

    return {
      totalLabs,
      assessedLabs,
      avgScore,
      highQuality,
      mediumQuality,
      lowQuality,
      totalIncidents,
      criticalIncidents,
      totalSurveys,
      avgPostSurvey,
    };
  }, [labTraceData, incidents, surveys]);

  // Filtered rows
  const filteredLabs = useMemo(() => {
    return labTraceData.filter((item) => {
      const { lab, score, band, status } = item;
      const qText = search.toLowerCase().trim();

      if (qText) {
        const matchesCode = lab.lab_code?.toLowerCase().includes(qText);
        const matchesName = lab.name.toLowerCase().includes(qText);
        const matchesCenter = lab.center_name?.toLowerCase().includes(qText);
        const matchesVendor = lab.vendor_name?.toLowerCase().includes(qText);
        const matchesArea = lab.area?.toLowerCase().includes(qText);
        if (!matchesCode && !matchesName && !matchesCenter && !matchesVendor && !matchesArea) {
          return false;
        }
      }

      if (selectedGov !== ALL_GOVS && lab.gov !== selectedGov) return false;
      if (selectedBand !== ALL_BANDS && band !== selectedBand) return false;
      if (selectedStatus !== ALL_STATUSES && status !== selectedStatus) return false;

      return true;
    });
  }, [labTraceData, search, selectedGov, selectedBand, selectedStatus]);

  // Reset pagination when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedGov, selectedBand, selectedStatus]);

  const totalPages = Math.max(1, Math.ceil(filteredLabs.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedLabs = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredLabs.slice(start, start + pageSize);
  }, [filteredLabs, safeCurrentPage, pageSize]);

  // Incident Submit
  async function handleCreateIncident() {
    if (!incidentLabId || !incidentTitle.trim()) {
      return toast.error("Please select a lab and provide an incident title.");
    }
    setSubmittingIncident(true);
    try {
      const { error } = await supabase.from("lab_incidents").insert({
        lab_id: incidentLabId,
        title: incidentTitle.trim(),
        category: incidentCategory,
        severity: incidentSeverity,
        description: incidentDesc.trim() || null,
        reported_by: user?.id || null,
      });

      if (error) throw error;
      toast.success("Incident logged successfully.");
      setIncidentModalOpen(false);
      setIncidentTitle("");
      setIncidentDesc("");
      loadData();
    } catch (e: any) {
      toast.error(e.message || "Failed to log incident.");
    } finally {
      setSubmittingIncident(false);
    }
  }

  // Survey Submit
  async function handleCreateSurvey() {
    if (!surveyLabId) {
      return toast.error("Please select a lab.");
    }
    setSubmittingSurvey(true);
    try {
      const { error } = await supabase.from("lab_post_surveys").insert({
        lab_id: surveyLabId,
        overall_rating: surveyOverall,
        pc_rating: surveyPc,
        internet_rating: surveyInternet,
        cleanliness_rating: surveyCleanliness,
        facilities_rating: surveyFacilities,
        feedback: surveyFeedback.trim() || null,
        submitted_by: user?.id || null,
      });

      if (error) throw error;
      toast.success("Post-usage survey submitted successfully.");
      setSurveyModalOpen(false);
      setSurveyFeedback("");
      loadData();
    } catch (e: any) {
      toast.error(e.message || "Failed to submit survey.");
    } finally {
      setSubmittingSurvey(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <BrandIcon name="quiz" size={26} />
            Lab Quality & Usage Audit Trace
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track weighted quality metrics, lab operational incidents, post-usage surveys, and lab lifecycle history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5 border-[#E6EDF1] dark:border-[#1F2A55]">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-[#056FEC]" : ""}`} /> Refresh
          </Button>

          {/* Quick Search & Trace Lab Button */}
          <Popover open={traceSearchOpen} onOpenChange={setTraceSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-[#056FEC]/40 text-[#056FEC] dark:text-[#05ACFF] hover:bg-[#056FEC]/10 font-semibold shadow-xs"
              >
                <Eye className="h-4 w-4 text-[#056FEC]" /> Trace Lab
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] sm:w-[400px] p-0 shadow-lg border border-border/80" align="end">
              <Command
                filter={(itemValue, search) => {
                  const s = search.toLowerCase().trim();
                  if (!s) return 1;
                  return itemValue.toLowerCase().includes(s) ? 1 : 0;
                }}
              >
                <CommandInput
                  placeholder="Type to search lab to trace..."
                  className="text-xs h-9"
                />
                <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
                  <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                    No matching labs found.
                  </CommandEmpty>
                  <CommandGroup heading={`All Labs (${labs.length})`}>
                    {labs.map((l) => {
                      const searchStr = `${l.name} ${l.lab_code || ""} ${l.gov || ""} ${l.area || ""} ${l.center_name || ""} ${l.vendor_name || ""}`;
                      return (
                        <CommandItem
                          key={l.id}
                          value={searchStr}
                          onSelect={() => {
                            setTraceLab(l);
                            setTraceSearchOpen(false);
                          }}
                          className="flex items-center justify-between py-2 px-2.5 text-xs cursor-pointer hover:bg-accent/60"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <div className="font-semibold text-foreground truncate flex items-center gap-1.5">
                              <span className="truncate">{l.name}</span>
                              {l.lab_code && (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[10px] px-1 py-0 h-4 shrink-0 bg-muted/40 font-semibold"
                                >
                                  {l.lab_code}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {l.gov || "Unspecified"} {l.area ? `• ${l.area}` : ""} {l.center_name ? `• ${l.center_name}` : ""}
                            </div>
                          </div>
                          <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Button
            variant="default"
            size="sm"
            className="gap-1.5 bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white font-semibold shadow-xs"
            onClick={() => {
              setIncidentLabId(labs[0]?.id || "");
              setIncidentModalOpen(true);
            }}
          >
            <BrandIcon name="alert" size={16} /> Report Incident
          </Button>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold shadow-xs"
            onClick={() => {
              setSurveyLabId(labs[0]?.id || "");
              setSurveyModalOpen(true);
            }}
          >
            <BrandIcon name="checkmark" size={16} /> Add Post Survey
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-[#E6EDF1] dark:border-[#1F2A55] bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Avg. Quality Score</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{stats.avgScore}/100</span>
                <Badge className={stats.avgScore >= 75 ? "bg-[#0EAA3A] text-white" : stats.avgScore >= 50 ? "bg-[#FFBB1C] text-[#1F2A55]" : "bg-[#DE1F1F] text-white"}>
                  {qualityBand(stats.avgScore).toUpperCase()}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{stats.assessedLabs} of {stats.totalLabs} labs assessed</p>
            </div>
            <div className="rounded-xl bg-[#056FEC]/10 p-3 text-[#056FEC]">
              <BrandIcon name="quiz" size={24} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E6EDF1] dark:border-[#1F2A55] bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Quality Score Bands</p>
              <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
                <span className="rounded bg-[#BCECCA]/40 dark:bg-[#0A852D]/30 px-2 py-0.5 text-[#0EAA3A]">
                  High: {stats.highQuality}
                </span>
                <span className="rounded bg-[#FCF9E5] dark:bg-[#B4810B]/20 px-2 py-0.5 text-[#B4810B] dark:text-[#FFBB1C]">
                  Med: {stats.mediumQuality}
                </span>
                <span className="rounded bg-[#FFD1D1]/40 dark:bg-[#AA1818]/20 px-2 py-0.5 text-[#DE1F1F]">
                  Low: {stats.lowQuality}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">Distribution across evaluated labs</p>
            </div>
            <div className="rounded-xl bg-[#0EAA3A]/10 p-3 text-[#0EAA3A]">
              <BrandIcon name="checkmark" size={24} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Operational Incidents</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">{stats.totalIncidents}</span>
                {stats.criticalIncidents > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> {stats.criticalIncidents} Critical/High
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Logged across all lab assignments</p>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-3 text-amber-600">
              <Wrench className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Post-Usage Survey Rating</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">
                  {stats.avgPostSurvey > 0 ? `${stats.avgPostSurvey} / 5` : "N/A"}
                </span>
                {stats.avgPostSurvey > 0 && (
                  <div className="flex items-center text-amber-500 text-xs">
                    <Star className="h-3.5 w-3.5 fill-current" />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{stats.totalSurveys} surveys completed</p>
            </div>
            <div className="rounded-xl bg-[#FF7F1C]/10 p-3 text-[#FF7F1C]">
              <Star className="h-6 w-6 fill-[#FF7F1C]/30" />
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
                placeholder="Search by Lab ID, Name, Center, Vendor, or Area..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedGov} onValueChange={setSelectedGov}>
                <SelectTrigger className="w-[160px] text-xs">
                  <SelectValue placeholder="Governorate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_GOVS}>All Governorates</SelectItem>
                  {governorates.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedBand} onValueChange={setSelectedBand}>
                <SelectTrigger className="w-[145px] text-xs">
                  <SelectValue placeholder="Quality Band" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BANDS}>All Quality</SelectItem>
                  <SelectItem value="high">High (&ge;75)</SelectItem>
                  <SelectItem value="medium">Medium (50-74)</SelectItem>
                  <SelectItem value="low">Low (&lt;50)</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-[145px] text-xs">
                  <SelectValue placeholder="Lab Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="deactivated">Deactivated</SelectItem>
                  <SelectItem value="replaced">Replaced</SelectItem>
                </SelectContent>
              </Select>

              {(search || selectedGov !== ALL_GOVS || selectedBand !== ALL_BANDS || selectedStatus !== ALL_STATUSES) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setSelectedGov(ALL_GOVS);
                    setSelectedBand(ALL_BANDS);
                    setSelectedStatus(ALL_STATUSES);
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

      {/* Main Table */}
      <Card className="border-border/60 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-[110px]">Lab ID</TableHead>
                <TableHead>Lab & Center</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Quality Score</TableHead>
                <TableHead className="text-center">Usage Count</TableHead>
                <TableHead className="text-center">Incidents</TableHead>
                <TableHead className="text-center">Post Rating</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    Loading lab quality trace data...
                  </TableCell>
                </TableRow>
              ) : filteredLabs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    No labs matched your search criteria.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedLabs.map((item) => {
                  const { lab, score, band, status, usageCount, incidentCount, criticalIncidents, avgSurveyScore } = item;
                  return (
                    <TableRow key={lab.id} className="hover:bg-muted/20 transition-colors">
                      <TableCell className="font-mono text-xs font-semibold text-primary">
                        {lab.lab_code || "N/A"}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm text-foreground">{lab.name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          {lab.center_name && <span>{lab.center_name}</span>}
                          {lab.vendor_name && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                              {lab.vendor_name}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-foreground flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span>{lab.gov || "Unspecified"}</span>
                          {lab.area && <span className="text-muted-foreground">({lab.area})</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {status === "active" && (
                          <Badge variant="outline" className="bg-[#056FEC]/10 text-[#056FEC] dark:text-[#05ACFF] border-[#056FEC]/25 text-xs font-semibold">
                            Active
                          </Badge>
                        )}
                        {status === "suspended" && (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">
                            Suspended
                          </Badge>
                        )}
                        {status === "deactivated" && (
                          <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-500/20 text-xs">
                            Deactivated
                          </Badge>
                        )}
                        {status === "replaced" && (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">
                            Replaced
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className="font-bold text-sm text-foreground">{score}/100</span>
                          <Badge
                            className="text-[10px] px-1.5 py-0 h-4 mt-0.5"
                            variant={band === "high" ? "default" : band === "medium" ? "secondary" : "destructive"}
                          >
                            {band.toUpperCase()}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-medium text-xs">
                        <Badge variant="secondary" className="gap-1 font-mono">
                          <Layers className="h-3 w-3" /> {usageCount} {usageCount === 1 ? "time" : "times"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {incidentCount > 0 ? (
                          <Badge
                            variant={criticalIncidents > 0 ? "destructive" : "outline"}
                            className="gap-1 cursor-pointer"
                            onClick={() => setTraceLab(lab)}
                          >
                            <AlertTriangle className="h-3 w-3" /> {incidentCount}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {avgSurveyScore !== null ? (
                          <div className="inline-flex items-center gap-1 font-semibold text-xs text-amber-600 dark:text-amber-400">
                            <Star className="h-3.5 w-3.5 fill-current" />
                            <span>{avgSurveyScore}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          onClick={() => setTraceLab(lab)}
                        >
                          <Eye className="h-3.5 w-3.5 text-primary" /> Trace Lab
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Table Pagination Controls (10 per page) */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border/60 bg-muted/20 text-xs">
          <div className="text-muted-foreground font-medium">
            {filteredLabs.length > 0 ? (
              <>
                Showing <span className="font-semibold text-foreground">{(safeCurrentPage - 1) * pageSize + 1}</span> to{" "}
                <span className="font-semibold text-foreground">
                  {Math.min(safeCurrentPage * pageSize, filteredLabs.length)}
                </span>{" "}
                of <span className="font-semibold text-foreground">{filteredLabs.length}</span> labs
              </>
            ) : (
              "0 labs"
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1}
                className="h-8 w-8 p-0 rounded-lg"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {/* Page buttons */}
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1)
                  .map((p, idx, arr) => {
                    const prev = arr[idx - 1];
                    const isEllipsis = prev && p - prev > 1;
                    return (
                      <div key={p} className="flex items-center gap-1">
                        {isEllipsis && <span className="px-1 text-muted-foreground">...</span>}
                        <Button
                          variant={p === safeCurrentPage ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(p)}
                          className={`h-8 min-w-8 px-2 text-xs rounded-lg font-semibold ${
                            p === safeCurrentPage
                              ? "bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs"
                              : "text-foreground"
                          }`}
                        >
                          {p}
                        </Button>
                      </div>
                    );
                  })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage >= totalPages}
                className="h-8 w-8 p-0 rounded-lg"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* TRACE LAB HISTORY DIALOG */}
      {traceLab && (
        <Dialog open={Boolean(traceLab)} onOpenChange={(open) => !open && setTraceLab(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-xl font-bold flex items-center gap-2 truncate">
                    <Building2 className="h-5 w-5 text-primary shrink-0" />
                    <span className="truncate">{traceLab.name} ({traceLab.lab_code || "No Code"})</span>
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {traceLab.gov} — {traceLab.area || "Area unspecified"} | {traceLab.center_name || "Center unspecified"}
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                  <div className="w-[180px] sm:w-[220px]">
                    <LabSearchCombobox
                      labs={labs}
                      value={traceLab.id}
                      onChange={(id) => {
                        const found = labMap.get(id);
                        if (found) setTraceLab(found);
                      }}
                      placeholder="Switch lab..."
                    />
                  </div>
                  <Badge
                    variant={
                      traceLab.status === "active"
                        ? "default"
                        : traceLab.status === "suspended"
                        ? "secondary"
                        : "destructive"
                    }
                  >
                    {(traceLab.status || "active").toUpperCase()}
                  </Badge>
                </div>
              </div>
            </DialogHeader>

            {(() => {
              const q = qualityByLabId.get(traceLab.id);
              const incList = incidentsByLabId.get(traceLab.id) || [];
              const survList = surveysByLabId.get(traceLab.id) || [];
              const asgList = assignmentsByLabId.get(traceLab.id) || [];
              const score = q?.quality_score ?? ((traceLab.quality_rating || 0) * 20);
              const replacedByLab = traceLab.replaced_by_lab_id ? labMap.get(traceLab.replaced_by_lab_id) : null;

              return (
                <div className="space-y-6 py-2">
                  {/* Replacement Banner if applicable */}
                  {traceLab.status === "replaced" && (
                    <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <RefreshCw className="h-4 w-4" /> Lab Replaced Notice
                      </div>
                      <p>
                        This lab has been deactivated/replaced by{" "}
                        <strong>{replacedByLab ? `${replacedByLab.name} (${replacedByLab.lab_code})` : "another lab"}</strong>.
                      </p>
                      {traceLab.deactivation_reason && (
                        <p className="text-xs italic text-muted-foreground">Reason: {traceLab.deactivation_reason}</p>
                      )}
                    </div>
                  )}

                  {/* Top Stats Summary Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-muted/40 p-3 text-center">
                      <div className="text-xs text-muted-foreground">Quality Score</div>
                      <div className="text-lg font-bold text-primary mt-0.5">{score}/100</div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3 text-center">
                      <div className="text-xs text-muted-foreground">Total Batch Usage</div>
                      <div className="text-lg font-bold text-foreground mt-0.5">{asgList.length} Times</div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3 text-center">
                      <div className="text-xs text-muted-foreground">Incidents Logged</div>
                      <div className={`text-lg font-bold mt-0.5 ${incList.length > 0 ? "text-amber-600" : "text-foreground"}`}>
                        {incList.length}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3 text-center">
                      <div className="text-xs text-muted-foreground">Avg Post Survey</div>
                      <div className="text-lg font-bold text-amber-500 mt-0.5">
                        {survList.length ? (survList.reduce((a, b) => a + b.overall_rating, 0) / survList.length).toFixed(1) : "N/A"}
                      </div>
                    </div>
                  </div>

                  {/* Quality Component Breakdown */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-primary" /> Weighted Quality Parameters
                    </h3>
                    {q ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                        <div className="rounded border p-2 bg-card">
                          <span className="text-muted-foreground">PC Quality:</span>{" "}
                          <strong className="text-foreground">{q.pc_quality ? `${q.pc_quality} / 5` : "N/A"}</strong>
                        </div>
                        <div className="rounded border p-2 bg-card">
                          <span className="text-muted-foreground">Internet Quality:</span>{" "}
                          <strong className="text-foreground">{q.internet_quality ? `${q.internet_quality} / 5` : "N/A"}</strong>
                        </div>
                        <div className="rounded border p-2 bg-card">
                          <span className="text-muted-foreground">Cleanliness:</span>{" "}
                          <strong className="text-foreground">{q.cleanliness ? `${q.cleanliness} / 5` : "N/A"}</strong>
                        </div>
                        <div className="rounded border p-2 bg-card">
                          <span className="text-muted-foreground">Chairs Quality:</span>{" "}
                          <strong className="text-foreground">{q.chairs_quality ? `${q.chairs_quality} / 5` : "N/A"}</strong>
                        </div>
                        <div className="rounded border p-2 bg-card">
                          <span className="text-muted-foreground">Air Condition (AC):</span>{" "}
                          <strong className="text-foreground capitalize">{q.ac}</strong>
                        </div>
                        <div className="rounded border p-2 bg-card">
                          <span className="text-muted-foreground">Security:</span>{" "}
                          <strong className="text-foreground">{q.security ? "Yes" : "No"}</strong>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No detailed quality assessment record filed yet.</p>
                    )}
                  </div>

                  {/* Operational Incidents Log */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-amber-500" /> Operational Incidents Log ({incList.length})
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          setIncidentLabId(traceLab.id);
                          setIncidentModalOpen(true);
                        }}
                      >
                        <Plus className="h-3 w-3" /> Log Incident
                      </Button>
                    </div>

                    {incList.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic bg-muted/20 p-3 rounded text-center">
                        No incidents logged for this lab.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {incList.map((inc) => (
                          <div key={inc.id} className="rounded-lg border p-3 bg-card space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground">{inc.title}</span>
                              <Badge
                                variant={
                                  inc.severity === "critical" || inc.severity === "high" ? "destructive" : "outline"
                                }
                              >
                                {inc.severity.toUpperCase()}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{inc.description || "No detailed description."}</p>
                            <div className="text-[10px] text-muted-foreground pt-1 flex items-center gap-2">
                              <span>Category: {inc.category.toUpperCase()}</span>
                              <span>•</span>
                              <span>Date: {new Date(inc.reported_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Post Usage Surveys */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        <Star className="h-4 w-4 text-amber-500 fill-amber-500/20" /> Post-Usage Surveys ({survList.length})
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          setSurveyLabId(traceLab.id);
                          setSurveyModalOpen(true);
                        }}
                      >
                        <Plus className="h-3 w-3" /> Add Survey
                      </Button>
                    </div>

                    {survList.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic bg-muted/20 p-3 rounded text-center">
                        No post-usage surveys filed for this lab yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {survList.map((surv) => (
                          <div key={surv.id} className="rounded-lg border p-3 bg-card space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1 text-amber-500 font-bold">
                                <Star className="h-4 w-4 fill-current" />
                                <span>{surv.overall_rating} / 5 Stars</span>
                              </div>
                              <span className="text-muted-foreground text-[11px]">
                                {new Date(surv.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            {surv.feedback && <p className="text-xs text-foreground italic">"{surv.feedback}"</p>}
                            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                              {surv.pc_rating && <span>PC: {surv.pc_rating}/5</span>}
                              {surv.internet_rating && <span>Net: {surv.internet_rating}/5</span>}
                              {surv.cleanliness_rating && <span>Cleanliness: {surv.cleanliness_rating}/5</span>}
                              {surv.facilities_rating && <span>Facilities: {surv.facilities_rating}/5</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Usage History across Batches */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                      <History className="h-4 w-4 text-primary" /> Usage History across Batches ({asgList.length})
                    </h3>
                    {asgList.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic bg-muted/20 p-3 rounded text-center">
                        This lab has not been assigned to any batch yet.
                      </p>
                    ) : (
                      <div className="rounded-md border overflow-hidden">
                        <Table>
                          <TableHeader className="bg-muted/50">
                            <TableRow className="text-xs">
                              <TableHead>Batch Name</TableHead>
                              <TableHead className="text-center">Status</TableHead>
                              <TableHead className="text-center">Price / Session</TableHead>
                              <TableHead className="text-right">Confirmed Date</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {asgList.map((asg) => {
                              const batch = batchMap.get(asg.batch_id);
                              return (
                                <TableRow key={asg.id} className="text-xs">
                                  <TableCell className="font-medium text-foreground">
                                    {batch?.name || "Unknown Batch"}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <Badge variant="outline" className="capitalize text-[10px]">
                                      {asg.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-center font-mono">
                                    {asg.confirmed_price ? `${asg.confirmed_price} EGP` : "Default"}
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {new Date(asg.created_at).toLocaleDateString()}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setTraceLab(null)}>
                Close Trace
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* REPORT INCIDENT MODAL */}
      <Dialog open={incidentModalOpen} onOpenChange={setIncidentModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Log Lab Incident
            </DialogTitle>
            <DialogDescription>Report an operational failure or issue encountered at a lab.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Select Lab</Label>
              <LabSearchCombobox
                labs={labs}
                value={incidentLabId}
                onChange={setIncidentLabId}
                placeholder="Search lab by typing name, ID, or area..."
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Incident Title</Label>
              <Input
                placeholder="e.g. Internet connectivity dropped / AC non-functional"
                value={incidentTitle}
                onChange={(e) => setIncidentTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={incidentCategory} onValueChange={setIncidentCategory}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pc">PC / Hardware</SelectItem>
                    <SelectItem value="internet">Internet / Network</SelectItem>
                    <SelectItem value="ac">Air Conditioning (AC)</SelectItem>
                    <SelectItem value="cleanliness">Cleanliness</SelectItem>
                    <SelectItem value="facility">Facility / Furniture</SelectItem>
                    <SelectItem value="supervisor">Supervisor / Staff</SelectItem>
                    <SelectItem value="other">Other Issue</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Severity</Label>
                <Select value={incidentSeverity} onValueChange={setIncidentSeverity}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low Impact</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical / Blocker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Description & Notes</Label>
              <Textarea
                placeholder="Provide detailed information about the problem..."
                value={incidentDesc}
                onChange={(e) => setIncidentDesc(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIncidentModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleCreateIncident}
              disabled={submittingIncident}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {submittingIncident ? "Saving..." : "Submit Incident"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* POST USAGE SURVEY MODAL */}
      <Dialog open={surveyModalOpen} onOpenChange={setSurveyModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500 fill-amber-500/20" /> Post-Usage Lab Survey
            </DialogTitle>
            <DialogDescription>Submit feedback and ratings after lab session execution.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Select Lab</Label>
              <LabSearchCombobox
                labs={labs}
                value={surveyLabId}
                onChange={setSurveyLabId}
                placeholder="Search lab by typing name, ID, or area..."
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Overall Rating (1 to 5 Stars)</Label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setSurveyOverall(star)}
                    className="p-1 text-amber-500 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`h-6 w-6 ${star <= surveyOverall ? "fill-amber-500" : "text-muted stroke-muted-foreground"}`}
                    />
                  </button>
                ))}
                <span className="text-xs font-bold text-foreground ml-2">{surveyOverall} / 5</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <Label className="text-xs">PC Performance</Label>
                <Select value={String(surveyPc)} onValueChange={(v) => setSurveyPc(Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Star{n > 1 ? "s" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Internet Speed</Label>
                <Select value={String(surveyInternet)} onValueChange={(v) => setSurveyInternet(Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Star{n > 1 ? "s" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Cleanliness</Label>
                <Select value={String(surveyCleanliness)} onValueChange={(v) => setSurveyCleanliness(Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Star{n > 1 ? "s" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Facilities & Chairs</Label>
                <Select value={String(surveyFacilities)} onValueChange={(v) => setSurveyFacilities(Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} Star{n > 1 ? "s" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Feedback & Comments</Label>
              <Textarea
                placeholder="Share any feedback, issues, or suggestions..."
                value={surveyFeedback}
                onChange={(e) => setSurveyFeedback(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSurveyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleCreateSurvey}
              disabled={submittingSurvey}
              className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold"
            >
              {submittingSurvey ? "Saving..." : "Submit Survey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
