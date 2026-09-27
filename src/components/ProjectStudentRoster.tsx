import { useEffect, useMemo, useRef, useState, useDeferredValue, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import * as XLSX from "xlsx";
import type { Tables } from "@/integrations/supabase/types";
import {
  fetchProjectRosterPage,
  updateStudentStatusInBatch,
  updateStudentDetailsInBatch,
  addStudentToBatchRecord,
  removeStudentFromBatchRecord,
  saveProjectUnassignedUpload,
  bulkUpdateStudentStatuses,
  getProjectUnassignedBatchId,
  isStudentActive,
  formatRevocationDateTime,
  type StudentRecord,
  type StudentStatus,
  type StudentMergeStrategy,
  type BatchStudentUploadRecord,
} from "@/lib/batch-allocation-storage";
import { useAuth, ROLE_LABELS } from "@/hooks/useAuth";
import { logAuditAction } from "@/lib/audit-logging";
import { PhysicalAreaCombobox } from "@/components/PhysicalAreaCombobox";
import { isValidEgyptLocation } from "@/lib/egypt-areas";
import {
  formatGradeLevel,
  getDefaultGradeLevel,
  getGradeLevelOptions,
  mergeGradeLevelOptions,
  parseGradeLevel,
  sortGradeLevels,
  type ProjectProgram,
} from "@/lib/project-grade-levels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Filter,
  GraduationCap,
  Layers,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserCheck,
  UserMinus,
  Users,
  X,
  XCircle,
  FolderInput,
  Sparkles,
  FileSpreadsheet,
  CheckSquare,
  Square,
} from "lucide-react";

type Project = Tables<"projects">;
type Batch = Tables<"batches">;

export interface RosterStudentItem {
  id: string; // unique composite key
  S_ID: string;
  Grade: number;
  "Physical Area": string;
  Status: StudentStatus;
  batch_id: string;
  batch_name: string;
  is_unassigned: boolean;
  revoked_at?: string | null;
  rawStudent: StudentRecord;
}

interface ProjectStudentRosterProps {
  project: Project;
  batches: Batch[];
  canEdit: boolean;
  canRevoke?: boolean;
  onChanged?: () => void;
}

async function parseRawStudentsWithStatus(file: File, program: ProjectProgram): Promise<StudentRecord[]> {
  const isCsv = /\.csv$/i.test(file.name);
  let rawRows: any[] = [];
  if (isCsv) {
    const text = await file.text();
    const workbook = XLSX.read(text, { type: "string", raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
  } else {
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
  }

  const results: StudentRecord[] = [];
  for (const r of rawRows) {
    const sId = String(r["S_ID"] || r["Student ID"] || r["Student_ID"] || r["SID"] || r["{{S_ID}}"] || "").trim();
    if (!sId) continue;
    const gradeRaw = r["Grade"] || r["Grade(25-26)"] || r["Class"] || r["Level"] || getDefaultGradeLevel(program);
    const gNum = parseGradeLevel(gradeRaw, program) ?? getDefaultGradeLevel(program);
    const area = String(r["Physical Area"] || r["Physical_Area"] || r["Area"] || r["Location"] || "Unspecified Area").trim();
    const rawStatus = String(r["Status"] || r["status"] || r["Student_Status"] || "Enrolled").trim();
    let parsedStatus: StudentStatus = "Enrolled";
    if (rawStatus.toLowerCase().includes("revok") || rawStatus.toLowerCase().includes("drop") || rawStatus.toLowerCase().includes("fail")) {
      parsedStatus = "Dropped Out";
    }

    const rawRevokedAt = String(r["Revoked At"] || r["revoked_at"] || r["Revocation Date"] || r["Revoked Date"] || r["Revoked on"] || "").trim();
    let parsedRevokedAt: string | null = null;
    if (parsedStatus === "Dropped Out") {
      parsedRevokedAt = rawRevokedAt ? new Date(rawRevokedAt).toISOString() : new Date().toISOString();
    }

    results.push({
      ...r,
      S_ID: sId,
      Grade: gNum,
      "Physical Area": area,
      Status: parsedStatus,
      status: parsedStatus,
      revoked_at: parsedRevokedAt,
      "Revoked At": parsedRevokedAt,
    });
  }
  return results;
}

export function ProjectStudentRoster({ project, batches, canEdit, canRevoke, onChanged }: ProjectStudentRosterProps) {
  const { user, roles, hasAnyRole, isAdmin } = useAuth();
  const currentActorName = (user?.user_metadata?.full_name as string) || user?.email?.split("@")[0] || "Admin";
  const currentActorRole = roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "Administrator";

  const isOperationsOrAdmin = hasAnyRole(["operations", "administration"]) || isAdmin;
  const isRevokeAllowed = canRevoke !== undefined ? (canRevoke && isOperationsOrAdmin) : isOperationsOrAdmin;
  const projectProgram = (project.program || "DECI") as ProjectProgram;
  const configuredGradeOptions = getGradeLevelOptions(projectProgram);
  const defaultGrade = getDefaultGradeLevel(projectProgram);

  const unassignedBatchId = getProjectUnassignedBatchId(project.id);
  const [loading, setLoading] = useState(true);
  const [uploadRecords, setUploadRecords] = useState<BatchStudentUploadRecord[]>([]);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [rosterSummary, setRosterSummary] = useState({ total: 0, active: 0, revoked: 0, physicalAreas: 0 });
  const [serverGrades, setServerGrades] = useState<number[]>([]);
  const [serverAreas, setServerAreas] = useState<string[]>([]);

  // Selection state for bulk operations
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  // Filtering state
  const [searchQuery, setSearchQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [areaFilter, setAreaFilter] = useState<string>("ALL");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Project Level Upload Modal State
  const projectFileRef = useRef<HTMLInputElement>(null);
  const [projectUploadModalOpen, setProjectUploadModalOpen] = useState(false);
  const [projectFile, setProjectFile] = useState<File | null>(null);
  const [parsedProjectStudents, setParsedProjectStudents] = useState<StudentRecord[]>([]);
  const [parsingProjectFile, setParsingProjectFile] = useState(false);
  const [projectUploadStrategy, setProjectUploadStrategy] = useState<StudentMergeStrategy>("merge_overwrite");
  const [savingProjectUpload, setSavingProjectUpload] = useState(false);

  // Modals state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStudentId, setNewStudentId] = useState<string>("");
  const [newGrade, setNewGrade] = useState<string>(String(defaultGrade));
  const [newArea, setNewArea] = useState<string>("");
  const [newStatus, setNewStatus] = useState<StudentStatus>("Enrolled");
  const [savingNewStudent, setSavingNewStudent] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<RosterStudentItem | null>(null);
  const [editGrade, setEditGrade] = useState<string>(String(defaultGrade));
  const [editArea, setEditArea] = useState<string>("");
  const [editStatus, setEditStatus] = useState<StudentStatus>("Enrolled");
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<RosterStudentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const notifyRosterChanged = (action: string) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("batch-student-data-changed", {
      detail: { batchId: unassignedBatchId, projectId: project.id, action },
    }));
  };

  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Normal page viewing fetches only one filtered page; allocation uses the separate full-roster API.
  const loadRoster = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const page = await fetchProjectRosterPage({
        projectId: project.id,
        page: currentPage,
        pageSize,
        search: deferredSearchQuery,
        grade: gradeFilter,
        status: statusFilter,
        area: areaFilter,
      });
      const metadata = page.metadata;
      setUploadRecords(metadata ? [{ ...metadata, student_count: page.summary.total, students: page.rows }] : []);
      setFilteredTotal(page.total);
      setRosterSummary(page.summary);
      setServerGrades(page.grades);
      setServerAreas(page.areas.sort((a, b) => a.localeCompare(b)));
    } catch (err: any) {
      toast.error("Failed to load project student roster: " + (err.message || "Unknown error"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [project.id, currentPage, pageSize, deferredSearchQuery, gradeFilter, statusFilter, areaFilter]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  // Map upload records into a unified list of RosterStudentItems
  const allStudents = useMemo<RosterStudentItem[]>(() => {
    const items: RosterStudentItem[] = [];

    for (const record of uploadRecords) {
      const isUnassigned = record.batch_id === unassignedBatchId;
      const bName = "Project Roster";

      if (Array.isArray(record.students)) {
        for (const s of record.students) {
          const sId = String(s.S_ID || "").trim();
          if (!sId) continue;
          const gNum = parseGradeLevel(s.Grade, projectProgram) ?? defaultGrade;
          const areaStr = String(s["Physical Area"] || "").trim() || "Unspecified Area";
          const rawStatus = String(s.Status || s.status || "Enrolled").trim();
          let parsedStatus: StudentStatus = "Enrolled";
          if (rawStatus.toLowerCase().includes("revok") || rawStatus.toLowerCase().includes("drop") || rawStatus.toLowerCase().includes("fail")) {
            parsedStatus = "Dropped Out";
          }
          const isRevoked = parsedStatus === "Dropped Out";
          const revokedAtVal = isRevoked ? (s.revoked_at || (s as any)["Revoked At"] || (s as any).revocation_date || null) : null;

          items.push({
            id: `${sId}_${record.batch_id}`,
            S_ID: sId,
            Grade: gNum,
            "Physical Area": areaStr,
            Status: parsedStatus,
            batch_id: record.batch_id,
            batch_name: bName,
            is_unassigned: isUnassigned,
            revoked_at: revokedAtVal,
            rawStudent: s,
          });
        }
      }
    }

    return items;
  }, [uploadRecords, unassignedBatchId, projectProgram, defaultGrade]);

  const uniqueAreas = serverAreas;
  const uniqueGrades = useMemo(() => sortGradeLevels(serverGrades), [serverGrades]);
  const stats = {
    total: rosterSummary.total,
    enrolled: rosterSummary.active,
    dropped: rosterSummary.revoked,
    failed: 0,
    unassigned: rosterSummary.total,
  };

  const selectableGradeOptions = useMemo(
    () => mergeGradeLevelOptions(projectProgram, uniqueGrades),
    [projectProgram, uniqueGrades],
  );

  const filteredStudents = allStudents;

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const pagedStudents = filteredStudents;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, gradeFilter, statusFilter, areaFilter, pageSize]);

  // Selection handlers
  const handleToggleSelectAll = () => {
    if (selectedStudentIds.size === pagedStudents.length && pagedStudents.length > 0) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(pagedStudents.map((s) => s.id)));
    }
  };

  const handleToggleSelectStudent = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedStudentIds(new Set());
  };

  // Lightning-fast optimistic inline status updater (<1ms perceptual UI latency)
  const handleStatusChange = async (student: RosterStudentItem, newStat: StudentStatus) => {
    if (student.Status === newStat) return;

    if (newStat === "Dropped Out" && !isRevokeAllowed) {
      toast.error("Revoking students is restricted to the Operations team.");
      return;
    }

    const prevRecords = uploadRecords;
    const targetRecord = uploadRecords.find((r) => r.batch_id === student.batch_id);
    const oldStatusVal = student.Status;
    const isRevoking = newStat === "Dropped Out";
    const revocationTimestamp = isRevoking ? (student.revoked_at || new Date().toISOString()) : null;

    // 1. Instant optimistic local update (UI, badges, counters, filter react immediately)
    setUploadRecords((prev) =>
      prev.map((rec) => {
        if (rec.batch_id !== student.batch_id) return rec;
        return {
          ...rec,
          students: (rec.students || []).map((s) =>
            s.S_ID === student.S_ID
              ? {
                  ...s,
                  Status: newStat,
                  status: newStat,
                  revoked_at: revocationTimestamp,
                  "Revoked At": revocationTimestamp,
                }
              : s
          ),
        };
      })
    );
    const formattedTime = revocationTimestamp ? formatRevocationDateTime(revocationTimestamp).display : "";
    toast.success(
      isRevoking
        ? `Revoked ${student.S_ID} (Recorded: ${formattedTime})`
        : `Updated ${student.S_ID} status to "${newStat}"`
    );

    // 2. Audit Trail Log (non-blocking)
    logAuditAction({
      userId: user?.id,
      userName: currentActorName,
      userEmail: user?.email,
      userRole: currentActorRole,
      tab: "Projects",
      section: "Project Student Roster",
      actionType: "STATUS_CHANGE",
      actionTitle: isRevoking
        ? `Revoked student ${student.S_ID} at ${formattedTime}`
        : `Changed student ${student.S_ID} status from "${oldStatusVal}" to "${newStat}"`,
      entityType: "student",
      entityId: student.S_ID,
      projectId: project.id,
      batchId: student.batch_id,
      oldValue: {
        S_ID: student.S_ID,
        Status: oldStatusVal,
        revoked_at: student.revoked_at || null,
        Grade: student.Grade,
        "Physical Area": student["Physical Area"],
        batch_id: student.batch_id,
      },
      newValue: {
        S_ID: student.S_ID,
        Status: newStat,
        revoked_at: revocationTimestamp,
        Grade: student.Grade,
        "Physical Area": student["Physical Area"],
        batch_id: student.batch_id,
      },
      isRestorable: true,
    });

    // 3. Background sync to Supabase (bypasses redundant full-roster refetch)
    try {
      await updateStudentStatusInBatch(student.batch_id, student.S_ID, newStat, targetRecord, revocationTimestamp);
      notifyRosterChanged("status");
      await loadRoster(true);
      onChanged?.();
    } catch (err: any) {
      setUploadRecords(prevRecords);
      toast.error("Failed to sync status update to cloud: " + (err.message || "Unknown error"));
    }
  };

  // Optimized bulk status change (optimistic UI + single batch write per batch)
  const handleBulkStatusChange = async (newStat: StudentStatus) => {
    const selectedItems = allStudents.filter((s) => selectedStudentIds.has(s.id));
    if (selectedItems.length === 0) return;

    if (newStat === "Dropped Out" && !isRevokeAllowed) {
      toast.error("Bulk revoking students is restricted to the Operations team.");
      return;
    }

    const prevRecords = uploadRecords;
    const selectedSet = new Set(selectedItems.map((s) => s.id));
    const isRevoking = newStat === "Dropped Out";
    const nowIso = new Date().toISOString();

    // 1. Instant optimistic state update
    setUploadRecords((prev) =>
      prev.map((rec) => ({
        ...rec,
        students: (rec.students || []).map((s) => {
          const compId = `${s.S_ID}_${rec.batch_id}`;
          if (!selectedSet.has(compId)) return s;
          const revokedAtVal = isRevoking ? (s.revoked_at || (s as any)["Revoked At"] || nowIso) : null;
          return {
            ...s,
            Status: newStat,
            status: newStat,
            revoked_at: revokedAtVal,
            "Revoked At": revokedAtVal,
          };
        }),
      }))
    );
    toast.success(`Updated ${selectedItems.length.toLocaleString()} students to "${newStat}"`);

    // 2. Audit Trail Log (non-blocking)
    logAuditAction({
      userId: user?.id,
      userName: currentActorName,
      userEmail: user?.email,
      userRole: currentActorRole,
      tab: "Projects",
      section: "Project Student Roster (Bulk)",
      actionType: "STATUS_CHANGE",
      actionTitle: `Bulk updated status of ${selectedItems.length} students to "${newStat}"`,
      entityType: "student",
      entityId: `${selectedItems.length} Students`,
      projectId: project.id,
      oldValue: selectedItems.map((s) => ({ S_ID: s.S_ID, Status: s.Status, batch_id: s.batch_id })),
      newValue: selectedItems.map((s) => ({ S_ID: s.S_ID, Status: newStat, batch_id: s.batch_id })),
      isRestorable: false,
    });

    // 3. Efficient parallel batch writes to Supabase
    const updates = selectedItems.map((s) => ({
      batchId: s.batch_id,
      studentId: s.S_ID,
      status: newStat,
    }));
    const existingMap = new Map(uploadRecords.map((r) => [r.batch_id, r]));

    try {
      await bulkUpdateStudentStatuses(updates, existingMap);
      notifyRosterChanged("bulk-status");
      await loadRoster(true);
      onChanged?.();
    } catch (err: any) {
      setUploadRecords(prevRecords);
      toast.error("Failed to sync bulk status updates: " + (err.message || "Unknown error"));
    }
  };

  // Open Project Upload Modal
  const handleOpenProjectUpload = () => {
    setProjectFile(null);
    setParsedProjectStudents([]);
    setProjectUploadStrategy("merge_overwrite");
    setProjectUploadModalOpen(true);
  };

  const handleProjectFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsingProjectFile(true);
    setProjectFile(file);
    try {
      const parsed = await parseRawStudentsWithStatus(file, projectProgram);
      if (parsed.length === 0) {
        toast.error("No valid student records found. Ensure columns include S_ID, Grade, and Physical Area.");
        setProjectFile(null);
        setParsedProjectStudents([]);
        return;
      }
      setParsedProjectStudents(parsed);
      toast.success(`Found ${parsed.length.toLocaleString()} students in "${file.name}"!`);
    } catch (err: any) {
      toast.error("Failed to parse student file: " + (err.message || "Unknown error"));
      setProjectFile(null);
      setParsedProjectStudents([]);
    } finally {
      setParsingProjectFile(false);
    }
  };

  const handleSaveProjectUpload = async () => {
    if (!projectFile || parsedProjectStudents.length === 0) {
      toast.error("Please select a valid student file first.");
      return;
    }
    setSavingProjectUpload(true);
    try {
      await saveProjectUnassignedUpload(
        project.id,
        projectFile.name,
        projectFile.size,
        parsedProjectStudents,
        undefined,
        projectUploadStrategy
      );
      toast.success(
        `Saved ${parsedProjectStudents.length.toLocaleString()} students to the Project Student Roster.`
      );

      setProjectUploadModalOpen(false);
      setProjectFile(null);
      setParsedProjectStudents([]);
      if (projectFileRef.current) projectFileRef.current.value = "";
      await loadRoster(true);
      notifyRosterChanged("upload");
      onChanged?.();
    } catch (err: any) {
      toast.error("Failed to save project student upload: " + (err.message || "Unknown error"));
    } finally {
      setSavingProjectUpload(false);
    }
  };

  // Open add student modal
  const handleOpenAddModal = () => {
    const prefixTag = (project.code || "PROJ").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
    const nextNum = rosterSummary.total + 1;
    setNewStudentId(`STU-${prefixTag}-${String(nextNum).padStart(4, "0")}`);
    setNewGrade(String(defaultGrade));
    setNewArea(uniqueAreas[0] || "مدينة نصر");
    setNewStatus("Enrolled");
    setAddModalOpen(true);
  };

  // Submit new student (Optimistic UI)
  const handleSaveNewStudent = async () => {
    if (!newStudentId.trim()) {
      toast.error("Please enter a Student ID.");
      return;
    }
    if (!newArea.trim() || !isValidEgyptLocation(newArea.trim())) {
      toast.error("Please select a valid Egyptian physical area from the dropdown menu.");
      return;
    }

    if (newStatus === "Dropped Out" && !isRevokeAllowed) {
      toast.error("Setting student status to Revoked is restricted to the Operations team.");
      return;
    }

    const prevRecords = uploadRecords;
    const targetBatchId = unassignedBatchId;
    const isRevoked = newStatus === "Dropped Out";
    const nowIso = new Date().toISOString();
    const studentRec: StudentRecord = {
      S_ID: newStudentId.trim(),
      Grade: parseGradeLevel(newGrade, projectProgram) ?? defaultGrade,
      "Physical Area": newArea.trim(),
      Status: newStatus,
      status: newStatus,
      revoked_at: isRevoked ? nowIso : null,
      "Revoked At": isRevoked ? nowIso : null,
    };

    // 1. Instant optimistic state update (<1ms)
    setUploadRecords((prev) => {
      const found = prev.some((r) => r.batch_id === targetBatchId);
      if (!found) {
        const newRecord: BatchStudentUploadRecord = {
          batch_id: targetBatchId,
          project_id: project.id,
          file_name: `batch_${targetBatchId}_students.csv`,
          file_size: 1024,
          student_count: 1,
          students: [studentRec],
          updated_at: new Date().toISOString(),
        };
        return [newRecord, ...prev];
      }
      return prev.map((rec) => {
        if (rec.batch_id !== targetBatchId) return rec;
        const nextStudents = [studentRec, ...(rec.students || [])];
        return { ...rec, students: nextStudents, student_count: nextStudents.length };
      });
    });

    toast.success(`Student ${studentRec.S_ID} added successfully!`);
    setAddModalOpen(false);
    setSavingNewStudent(false);

    // Cross-tab & Lab Allocation real-time sync notification
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("batch-student-data-changed", {
          detail: { batchId: targetBatchId, projectId: project.id, student: studentRec, action: "add" },
        })
      );
    }

    // 2. Audit Trail Log (non-blocking)
    logAuditAction({
      userId: user?.id,
      userName: currentActorName,
      userEmail: user?.email,
      userRole: currentActorRole,
      tab: "Projects",
      section: "Add Student Modal",
      actionType: "CREATE",
      actionTitle: `Added student ${studentRec.S_ID} (Grade ${studentRec.Grade}, ${studentRec["Physical Area"]})`,
      entityType: "student",
      entityId: studentRec.S_ID,
      projectId: project.id,
      batchId: targetBatchId,
      oldValue: null,
      newValue: studentRec,
      isRestorable: true,
    });

    // 3. Background async sync to Supabase
    try {
      await addStudentToBatchRecord(targetBatchId, project.id, studentRec);
      await loadRoster(true);
      onChanged?.();
    } catch (err: any) {
      setUploadRecords(prevRecords);
      toast.error("Failed to add student to database: " + (err.message || "Unknown error"));
    }
  };

  // Open edit modal
  const handleOpenEditModal = (s: RosterStudentItem) => {
    setEditingStudent(s);
    setEditGrade(String(s.Grade));
    setEditArea(s["Physical Area"]);
    setEditStatus(s.Status);
    setEditModalOpen(true);
  };

  // Save edited student (Instant Optimistic UI + Background Cloud Sync)
  const handleSaveEdit = async () => {
    if (!editingStudent) return;

    if (!editArea.trim() || !isValidEgyptLocation(editArea.trim())) {
      toast.error("Please select a valid Egyptian physical area from the dropdown menu.");
      return;
    }

    if (editingStudent.Status !== "Dropped Out" && editStatus === "Dropped Out" && !isRevokeAllowed) {
      toast.error("Revoking students is restricted to the Operations team.");
      return;
    }

    const prevRecords = uploadRecords;
    const currentStudent = editingStudent;
    const targetBatchId = unassignedBatchId;
    const newGradeNum = parseGradeLevel(editGrade, projectProgram) ?? defaultGrade;
    const newAreaStr = editArea.trim();
    const newStatusVal = editStatus;
    const isRevoking = newStatusVal === "Dropped Out";
    const existingRevokedAt = currentStudent.revoked_at || (currentStudent.rawStudent as any)?.revoked_at || (currentStudent.rawStudent as any)?.["Revoked At"] || null;
    const revocationTimestamp = isRevoking ? (existingRevokedAt || new Date().toISOString()) : null;

    // 1. Instant optimistic local UI update (<1ms)
    setUploadRecords((prev) => prev.map((rec) => ({
      ...rec,
      students: (rec.students || []).map((s) =>
        s.S_ID === currentStudent.S_ID
          ? {
              ...s,
              Grade: newGradeNum,
              "Physical Area": newAreaStr,
              Status: newStatusVal,
              status: newStatusVal,
              revoked_at: revocationTimestamp,
              "Revoked At": revocationTimestamp,
            }
          : s
      ),
    })));

    // 2. Immediately close modal and show success toast (Zero user waiting time)
    toast.success(`Student ${currentStudent.S_ID} updated successfully.`);
    setEditModalOpen(false);
    setEditingStudent(null);
    setSavingEdit(false);

    // Cross-tab & Lab Allocation real-time sync notification
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("batch-student-data-changed", {
          detail: { batchId: targetBatchId, projectId: project.id, student: currentStudent, action: "edit" },
        })
      );
    }

    // 3. Audit Trail Log (non-blocking)
    logAuditAction({
      userId: user?.id,
      userName: currentActorName,
      userEmail: user?.email,
      userRole: currentActorRole,
      tab: "Projects",
      section: "Edit Student Modal",
      actionType: "UPDATE",
      actionTitle: isRevoking
        ? `Edited and revoked student ${currentStudent.S_ID}`
        : `Edited student ${currentStudent.S_ID} details`,
      entityType: "student",
      entityId: currentStudent.S_ID,
      projectId: project.id,
      batchId: targetBatchId,
      oldValue: {
        S_ID: currentStudent.S_ID,
        Grade: currentStudent.Grade,
        "Physical Area": currentStudent["Physical Area"],
        Status: currentStudent.Status,
        revoked_at: currentStudent.revoked_at || null,
        batch_id: currentStudent.batch_id,
      },
      newValue: {
        S_ID: currentStudent.S_ID,
        Grade: newGradeNum,
        "Physical Area": newAreaStr,
        Status: newStatusVal,
        revoked_at: revocationTimestamp,
        batch_id: targetBatchId,
      },
      isRestorable: true,
    });

    // 4. Asynchronously sync to Supabase in the background
    try {
      const targetRec = prevRecords.find((r) => r.batch_id === unassignedBatchId);
      await updateStudentDetailsInBatch(
        unassignedBatchId,
        currentStudent.S_ID,
        {
          Grade: newGradeNum,
          "Physical Area": newAreaStr,
          Status: newStatusVal,
          status: newStatusVal,
          revoked_at: revocationTimestamp,
          "Revoked At": revocationTimestamp,
        },
        targetRec
      );
      await loadRoster(true);
      onChanged?.();
    } catch (err: any) {
      // Rollback on remote error
      setUploadRecords(prevRecords);
      toast.error("Failed to sync student update to database: " + (err.message || "Unknown error"));
    }
  };

  // Confirm delete student (Optimistic UI)
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const prevRecords = uploadRecords;
    const target = deleteTarget;

    // 1. Instant optimistic state update (<1ms)
    setUploadRecords((prev) =>
      prev.map((rec) => {
        if (rec.batch_id !== target.batch_id) return rec;
        const filtered = (rec.students || []).filter((s) => s.S_ID !== target.S_ID);
        return { ...rec, students: filtered, student_count: filtered.length };
      })
    );

    toast.success(`Removed student ${target.S_ID}.`);
    setDeleteTarget(null);
    setDeleting(false);

    // Cross-tab & Lab Allocation real-time sync notification
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("batch-student-data-changed", {
          detail: { batchId: target.batch_id, projectId: project.id, studentId: target.S_ID, action: "remove" },
        })
      );
    }

    // 2. Audit Trail Log (non-blocking)
    logAuditAction({
      userId: user?.id,
      userName: currentActorName,
      userEmail: user?.email,
      userRole: currentActorRole,
      tab: "Projects",
      section: "Project Student Roster",
      actionType: "DELETE",
      actionTitle: `Deleted student ${target.S_ID} from project roster`,
      entityType: "student",
      entityId: target.S_ID,
      projectId: project.id,
      batchId: target.batch_id,
      oldValue: {
        S_ID: target.S_ID,
        Grade: target.Grade,
        "Physical Area": target["Physical Area"],
        Status: target.Status,
        batch_id: target.batch_id,
      },
      newValue: null,
      isRestorable: true,
    });

    // 3. Background async sync to Supabase
    try {
      await removeStudentFromBatchRecord(unassignedBatchId, target.S_ID);
      await loadRoster(true);
      onChanged?.();
    } catch (err: any) {
      setUploadRecords(prevRecords);
      toast.error("Failed to delete student: " + (err.message || "Unknown error"));
    }
  };

  // Export filtered roster to CSV or XLSX with Revocation Timestamp
  const handleExportRoster = (format: "csv" | "xlsx" = "csv") => {
    if (filteredStudents.length === 0) {
      toast.error("No students to export.");
      return;
    }
    const projectCode = project.code || "PROJECT";
    const fileName = `${projectCode}_student_roster`;

    if (format === "xlsx") {
      const rows = filteredStudents.map((s) => {
        const isRevoked = s.Status === "Dropped Out";
        const timeInfo = isRevoked && s.revoked_at ? formatRevocationDateTime(s.revoked_at) : null;
        return {
          "Student ID": s.S_ID,
          "Batch": s.batch_name,
          "Grade / Level": formatGradeLevel(s.Grade, projectProgram),
          "Physical Area": s["Physical Area"],
          "Status": isRevoked ? "Revoked" : "Active",
          "Revoked At": timeInfo ? timeInfo.full : "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Student Roster");
      XLSX.writeFile(wb, `${fileName}.xlsx`);
      toast.success(`Exported ${filteredStudents.length} visible student records to Excel (.xlsx).`);
      return;
    }

    const headers = ["Student ID", "Batch", "Grade / Level", "Physical Area", "Status", "Revoked At"];
    const rows = filteredStudents.map((s) => {
      const isRevoked = s.Status === "Dropped Out";
      const timeInfo = isRevoked && s.revoked_at ? formatRevocationDateTime(s.revoked_at) : null;
      const revokedAtStr = timeInfo ? timeInfo.full : "";
      return [
        `"${s.S_ID}"`,
        `"${s.batch_name}"`,
        `"${formatGradeLevel(s.Grade, projectProgram)}"`,
        `"${s["Physical Area"]}"`,
        `"${isRevoked ? "Revoked" : "Active"}"`,
        `"${revokedAtStr}"`,
      ];
    });
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${fileName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredStudents.length} visible student records with revocation timestamps to CSV.`);
  };

  // Helper badge rendering with revocation timestamp
  const renderStatusBadge = (status: StudentStatus | string, revokedAt?: string | null) => {
    switch (status) {
      case "Enrolled":
        return (
          <Badge className="bg-[#0EAA3A]/15 text-[#0EAA3A] border-[#0EAA3A]/30 hover:bg-[#0EAA3A]/25 gap-1 text-[11px] font-semibold">
            <CheckCircle2 className="h-3 w-3 text-[#0EAA3A]" />
            Active
          </Badge>
        );
      case "Dropped Out":
      default: {
        const timeInfo = revokedAt ? formatRevocationDateTime(revokedAt) : null;
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge
              className="bg-[#DE1F1F]/15 text-[#DE1F1F] border-[#DE1F1F]/30 hover:bg-[#DE1F1F]/25 gap-1 text-[11px] font-semibold"
              title={timeInfo ? `Revoked At: ${timeInfo.full}` : "Revoked"}
            >
              <UserMinus className="h-3 w-3 text-[#DE1F1F]" />
              Revoked
            </Badge>
            {timeInfo && (
              <span
                className="text-[10px] text-muted-foreground font-mono inline-flex items-center gap-1 bg-rose-500/10 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/20 whitespace-nowrap"
                title={`Revoked At: ${timeInfo.full}`}
              >
                <Clock className="h-2.5 w-2.5 text-rose-500 shrink-0" />
                <span>Revoked on: {timeInfo.display}</span>
              </span>
            )}
          </div>
        );
      }
    }
  };

  const renderGradeBadge = (grade: number) => {
    return (
      <Badge className="bg-[#056FEC] hover:bg-[#043FAD] text-white font-bold text-[10px] px-2 py-0">
        {formatGradeLevel(grade, projectProgram)}
      </Badge>
    );
  };

  const isAllVisibleSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((s) => selectedStudentIds.has(s.id));

  return (
    <Card className="shadow-xs mt-8">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-[#056FEC]" />
              <CardTitle className="text-lg font-bold">Project Student Roster &amp; Lifecycle</CardTitle>
              <Badge variant="secondary" className="font-mono text-xs font-semibold ml-1">
                {rosterSummary.total.toLocaleString()} Students Total
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Canonical project-wide student repository shared by every batch for allocation demand.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadRoster(true)}
              className="h-8 text-xs gap-1.5 rounded-xl font-semibold"
              title="Refresh roster from database"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rosterSummary.total === 0}
                  className="h-8 text-xs gap-1.5 rounded-xl font-semibold"
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  Export Roster
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 text-xs">
                <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
                  Export Filtered Roster
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleExportRoster("csv")}
                  className="gap-2 cursor-pointer text-xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <div>
                    <p className="font-semibold">Export as CSV (.csv)</p>
                    <p className="text-[10px] text-muted-foreground">With Revoked At timestamps</p>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleExportRoster("xlsx")}
                  className="gap-2 cursor-pointer text-xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-[#056FEC]" />
                  <div>
                    <p className="font-semibold">Export as Excel (.xlsx)</p>
                    <p className="text-[10px] text-muted-foreground">With formatted timestamp columns</p>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {canEdit && (
              <>
                <Button
                  size="sm"
                  onClick={handleOpenProjectUpload}
                  className="h-8 text-xs gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white font-semibold rounded-xl shadow-xs"
                  title="Upload a full student list for the entire project"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Project List
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenAddModal}
                  className="h-8 text-xs gap-1.5 border-[#056FEC]/30 text-[#056FEC] hover:bg-[#056FEC]/10 font-semibold rounded-xl"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Student
                </Button>
              </>
            )}
          </div>
        </div>

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-4">
          <div className="p-2.5 rounded-xl border border-[#056FEC]/20 bg-[#056FEC]/5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-[#056FEC] flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-[#056FEC]" /> Total Students
            </span>
            <span className="text-lg font-bold text-foreground mt-1">{stats.total.toLocaleString()}</span>
          </div>

          <div className="p-2.5 rounded-xl border border-[#0EAA3A]/20 bg-[#0EAA3A]/5 flex flex-col justify-between">
            <span className="text-[11px] text-[#0EAA3A] font-semibold flex items-center gap-1">
              <UserCheck className="h-3.5 w-3.5" /> Active
            </span>
            <span className="text-lg font-bold text-[#0EAA3A] mt-1">
              {stats.enrolled.toLocaleString()}
            </span>
          </div>

          <div className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold flex items-center gap-1">
                <FolderInput className="h-3.5 w-3.5 text-amber-600" /> Project Roster
              </span>
            </div>
            <span className="text-lg font-bold text-amber-700 dark:text-amber-300 mt-1">
              {stats.unassigned.toLocaleString()}
            </span>
          </div>

          <div className="p-2.5 rounded-xl border border-[#DE1F1F]/20 bg-[#DE1F1F]/5 flex flex-col justify-between">
            <span className="text-[11px] text-[#DE1F1F] font-semibold flex items-center gap-1">
              <UserMinus className="h-3.5 w-3.5" /> Revoked
            </span>
            <span className="text-lg font-bold text-[#DE1F1F] mt-1">
              {(stats.dropped + stats.failed).toLocaleString()}
            </span>
          </div>

          <div className="p-2.5 rounded-xl border border-border/60 bg-muted/10 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-[#056FEC]" /> Physical Areas
            </span>
            <span className="text-lg font-bold text-foreground mt-1">{uniqueAreas.length}</span>
          </div>

          <div className="p-2.5 rounded-xl border border-border/60 bg-muted/10 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-[#FF7F1C]" /> Batches Using Roster
            </span>
            <span className="text-lg font-bold text-foreground mt-1">
              {batches.length}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Filter Controls Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 flex-wrap">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Student ID or Name..."
              className="h-8.5 pl-8 text-xs bg-background"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filter Dropdowns */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Grade Filter */}
            <Select value={gradeFilter} onValueChange={setGradeFilter}>
              <SelectTrigger className="h-8.5 text-xs min-w-[110px] bg-background">
                <SelectValue placeholder={projectProgram === "DEMI" ? "All Grades" : "All Tracks / Levels"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{projectProgram === "DEMI" ? "All Grades" : "All Tracks / Levels"}</SelectItem>
                {selectableGradeOptions.filter((option) => uniqueGrades.includes(option.value)).map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8.5 text-xs min-w-[120px] bg-background">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="Enrolled">Active</SelectItem>
                <SelectItem value="Dropped Out">Revoked</SelectItem>
              </SelectContent>
            </Select>

            {/* Area Filter */}
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger className="h-8.5 text-xs min-w-[130px] bg-background">
                <SelectValue placeholder="All Areas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Areas ({uniqueAreas.length})</SelectItem>
                {uniqueAreas.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(gradeFilter !== "ALL" || statusFilter !== "ALL" || areaFilter !== "ALL" || searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setGradeFilter("ALL");
                  setStatusFilter("ALL");
                  setAreaFilter("ALL");
                }}
                className="h-8.5 text-xs text-muted-foreground hover:text-foreground px-2"
              >
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Floating / Sticky Bulk Action Bar */}
        {selectedStudentIds.size > 0 && canEdit && (
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/30 flex flex-col sm:flex-row items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <CheckSquare className="h-4 w-4 text-primary" />
              <span>
                <strong>{selectedStudentIds.size.toLocaleString()}</strong> student(s) selected
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7.5 text-xs gap-1">
                    Set Status <MoreHorizontal className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuItem onClick={() => void handleBulkStatusChange("Enrolled")} className="text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Mark Active
                  </DropdownMenuItem>
                  {isRevokeAllowed ? (
                    <DropdownMenuItem onClick={() => void handleBulkStatusChange("Dropped Out")} className="text-rose-600">
                      <UserMinus className="h-3.5 w-3.5 mr-2" /> Mark Revoked
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled
                      className="text-muted-foreground opacity-50 cursor-not-allowed"
                      title="Bulk revoking students is restricted to the Operations team"
                    >
                      <UserMinus className="h-3.5 w-3.5 mr-2" /> Mark Revoked (Operations only)
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearSelection}
                className="h-7.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear Selection
              </Button>
            </div>
          </div>
        )}

        {/* Results Counter */}
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span>
            Showing <strong>{filteredStudents.length.toLocaleString()}</strong> rows on this page of{" "}
            <strong>{filteredTotal.toLocaleString()}</strong> matching students
            {statusFilter === "Enrolled" && " (Active)"}
            {statusFilter === "Dropped Out" && " (Revoked)"}
          </span>
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-6 text-xs bg-background border border-border/80 rounded px-1"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Interactive Roster Table */}
        {loading ? (
          <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
            Loading project student roster...
          </div>
        ) : rosterSummary.total === 0 ? (
          <div className="p-10 text-center border rounded-lg bg-muted/10 space-y-3">
            <GraduationCap className="h-8 w-8 text-muted-foreground/60 mx-auto" />
            <div className="space-y-1">
              <div className="font-semibold text-sm text-foreground">No students in project yet</div>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Upload a student dataset for the entire project, or add individual student records.
              </p>
            </div>
            {canEdit && (
              <div className="pt-2 flex items-center justify-center gap-2">
                <Button size="sm" onClick={handleOpenProjectUpload} className="text-xs gap-1.5 bg-[#056FEC] hover:bg-[#043FAD] text-white">
                  <Upload className="h-3.5 w-3.5" /> Upload Project Student List
                </Button>
              </div>
            )}
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-8 text-center border rounded-lg bg-muted/10 text-xs text-muted-foreground">
            No students match the selected filter criteria. Try broadening your filters.
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  {canEdit && (
                    <TableHead className="w-[40px] text-center">
                      <button
                        type="button"
                        onClick={handleToggleSelectAll}
                        className="text-muted-foreground hover:text-foreground flex items-center justify-center"
                        title={isAllVisibleSelected ? "Deselect all visible" : "Select all visible"}
                      >
                        {isAllVisibleSelected ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    </TableHead>
                  )}
                  <TableHead className="w-[180px] text-xs font-semibold">Student ID</TableHead>
                  <TableHead className="text-xs font-semibold">Student Source</TableHead>
                  <TableHead className="text-xs font-semibold">Grade Cohort</TableHead>
                  <TableHead className="text-xs font-semibold">Physical Area</TableHead>
                  <TableHead className="text-xs font-semibold">Status (Allocation State)</TableHead>
                  {canEdit && <TableHead className="w-[120px] text-right text-xs font-semibold">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedStudents.map((s) => {
                  const isSelected = selectedStudentIds.has(s.id);
                  return (
                    <TableRow key={s.id} className={`hover:bg-muted/30 transition-colors ${isSelected ? "bg-primary/5" : ""}`}>
                      {/* Checkbox */}
                      {canEdit && (
                        <TableCell className="text-center py-2">
                          <button
                            type="button"
                            onClick={() => handleToggleSelectStudent(s.id)}
                            className="text-muted-foreground hover:text-foreground flex items-center justify-center mx-auto"
                          >
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-primary" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </TableCell>
                      )}

                      {/* Student ID */}
                      <TableCell className="font-mono text-xs font-semibold text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{s.S_ID}</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(s.S_ID);
                              toast.success(`Copied "${s.S_ID}"`);
                            }}
                            className="opacity-0 hover:opacity-100 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                            title="Copy Student ID"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </TableCell>

                      {/* Canonical source */}
                      <TableCell>
                        <Badge variant="outline" className="font-semibold text-[11px] gap-1 py-0.5 px-2 bg-primary/5 text-primary border-primary/20">
                          <FolderInput className="h-3 w-3 shrink-0" />
                          <span>Project Roster</span>
                        </Badge>
                      </TableCell>

                      {/* Grade */}
                      <TableCell>{renderGradeBadge(s.Grade)}</TableCell>

                      {/* Physical Area */}
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1 text-foreground">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span>{s["Physical Area"]}</span>
                        </div>
                      </TableCell>

                      {/* Status Dropdown */}
                      <TableCell>
                        {canEdit ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="focus:outline-hidden rounded-md transition-all hover:ring-2 hover:ring-primary/40 cursor-pointer text-left"
                                title={!isRevokeAllowed && s.Status === "Enrolled" ? "Active (Revocation restricted to Operations)" : s.Status === "Dropped Out" && s.revoked_at ? `Revoked on: ${formatRevocationDateTime(s.revoked_at).display}` : "Click to update student status"}
                              >
                                {renderStatusBadge(s.Status, s.revoked_at)}
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="text-xs">
                              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                                Update Status
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => void handleStatusChange(s, "Enrolled")}
                                className="gap-2 text-emerald-600 focus:text-emerald-700"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                <span>Active</span>
                              </DropdownMenuItem>
                              {isRevokeAllowed ? (
                                <DropdownMenuItem
                                  onClick={() => void handleStatusChange(s, "Dropped Out")}
                                  className="gap-2 text-rose-600 focus:text-rose-700"
                                >
                                  <UserMinus className="h-3.5 w-3.5 text-rose-600" />
                                  <span>Revoked</span>
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  disabled
                                  className="gap-2 text-muted-foreground cursor-not-allowed opacity-50"
                                  title="Revoking students is restricted to Operations"
                                >
                                  <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="flex items-center gap-1.5">
                                    Revoked <span className="text-[10px] font-normal text-muted-foreground/80">(Operations only)</span>
                                  </span>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          renderStatusBadge(s.Status, s.revoked_at)
                        )}
                      </TableCell>

                      {/* Actions */}
                      {canEdit && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleOpenEditModal(s)}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Edit Student Details"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteTarget(s)}
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Remove Student"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination Navigation */}
        {filteredStudents.length > 0 && (
          <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
            <div>
              Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-7 text-xs px-2.5 gap-1"
              >
                <ChevronLeft className="h-3 w-3" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="h-7 text-xs px-2.5 gap-1"
              >
                Next <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* ------------------------------------------------------------------ */}
      {/* 1. Project-Level Student Upload Dialog */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={projectUploadModalOpen} onOpenChange={setProjectUploadModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Sparkles className="h-5 w-5 text-primary" />
              Upload Project Student List ({project.name})
            </DialogTitle>
            <DialogDescription className="text-xs">
              Upload the canonical student dataset shared by every batch in this project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <input
              ref={projectFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleProjectFilePicked}
            />

            {/* File Dropper / Selector */}
            <div
              onClick={() => projectFileRef.current?.click()}
              className={`p-6 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all ${
                projectFile ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20"
              }`}
            >
              {projectFile ? (
                <div className="space-y-1">
                  <FileSpreadsheet className="h-8 w-8 text-primary mx-auto" />
                  <div className="font-semibold text-xs text-foreground">{projectFile.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {(projectFile.size / 1024).toFixed(1)} KB • {parsedProjectStudents.length.toLocaleString()} records parsed
                  </div>
                  <Button variant="outline" size="sm" className="mt-2 text-xs h-7">
                    Choose Another File
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 text-muted-foreground/60 mx-auto" />
                  <div className="font-semibold text-xs text-foreground">Click to upload Excel or CSV file</div>
                  <p className="text-[11px] text-muted-foreground">
                    Required headers: <code className="bg-muted px-1 py-0.5 rounded font-mono">S_ID</code>, <code className="bg-muted px-1 py-0.5 rounded font-mono">Grade</code>, <code className="bg-muted px-1 py-0.5 rounded font-mono">Physical Area</code>
                  </p>
                </div>
              )}
            </div>

            {/* Parsed Summary Preview */}
            {parsedProjectStudents.length > 0 && (
              <div className="p-3 rounded-lg border bg-muted/40 space-y-2 text-xs">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>File Analysis Breakdown</span>
                  <Badge className="bg-[#056FEC] text-white font-mono text-[10px]">
                    {parsedProjectStudents.length.toLocaleString()} Students
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="p-1.5 rounded bg-background border">
                    <div className="text-muted-foreground text-[10px]">Active</div>
                    <div className="font-bold text-[#056FEC] dark:text-[#05ACFF]">
                      {parsedProjectStudents.filter(isStudentActive).length.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-background border">
                    <div className="text-muted-foreground text-[10px]">Revoked / Inactive</div>
                    <div className="font-bold text-rose-600">
                      {parsedProjectStudents.filter((s) => !isStudentActive(s)).length.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-background border">
                    <div className="text-muted-foreground text-[10px]">Unique Areas</div>
                    <div className="font-bold text-foreground">
                      {new Set(parsedProjectStudents.map((s) => s["Physical Area"])).size}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Merge Strategy Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Conflict Resolution Strategy</Label>
              <Select value={projectUploadStrategy} onValueChange={(v) => setProjectUploadStrategy(v as StudentMergeStrategy)}>
                <SelectTrigger className="h-8.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge_overwrite">Merge &amp; Update (Add new, update existing, preserve revoked status)</SelectItem>
                  <SelectItem value="merge_skip">Merge &amp; Keep Existing (Only insert new students)</SelectItem>
                  <SelectItem value="replace">Replace Entire Destination Dataset</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setProjectUploadModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveProjectUpload}
              disabled={savingProjectUpload || parsedProjectStudents.length === 0}
              className="bg-primary text-primary-foreground font-semibold"
            >
              {savingProjectUpload ? "Saving to Project..." : "Confirm & Save Students"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* 4. Add Student Modal */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" /> Add Student to Project Roster
            </DialogTitle>
            <DialogDescription>
              Add a new student directly into this project workspace. The student will instantly become available in Lab Allocation demand.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Student ID (S_ID)</Label>
              <Input
                value={newStudentId}
                onChange={(e) => setNewStudentId(e.target.value)}
                placeholder="e.g. STU-B1-0001"
                className="h-8.5 font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Grade / Level</Label>
                <Select value={newGrade} onValueChange={setNewGrade}>
                  <SelectTrigger className="h-8.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {configuredGradeOptions.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Status</Label>
                <Select
                  value={newStatus}
                  onValueChange={(v) => {
                    if (v === "Dropped Out" && !isRevokeAllowed) {
                      toast.error("Setting student status to Revoked is restricted to the Operations team.");
                      return;
                    }
                    setNewStatus(v as StudentStatus);
                  }}
                >
                  <SelectTrigger className="h-8.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Enrolled">Active</SelectItem>
                    {isRevokeAllowed ? (
                      <SelectItem value="Dropped Out">Revoked</SelectItem>
                    ) : (
                      <SelectItem
                        value="Dropped Out"
                        disabled
                        className="text-muted-foreground opacity-50 cursor-not-allowed"
                      >
                        Revoked (Operations only)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {!isRevokeAllowed && (
                  <p className="text-[10px] text-muted-foreground">
                    Note: Revoking students is restricted to the Operations team.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Physical Area / City</Label>
              <PhysicalAreaCombobox
                value={newArea}
                onChange={setNewArea}
                placeholder="Search Egypt areas or governorates..."
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setAddModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveNewStudent}
              disabled={savingNewStudent}
              className="bg-primary text-primary-foreground font-semibold"
            >
              {savingNewStudent ? "Saving..." : "Add Student"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* 5. Edit Student Modal */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" /> Edit Student: {editingStudent?.S_ID}
            </DialogTitle>
            <DialogDescription>
              Modify the student details in the canonical project roster.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Grade / Level</Label>
                <Select value={editGrade} onValueChange={setEditGrade}>
                  <SelectTrigger className="h-8.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {mergeGradeLevelOptions(projectProgram, editingStudent ? [editingStudent.Grade] : []).map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Status</Label>
                <Select
                  value={editStatus}
                  onValueChange={(v) => {
                    if (v === "Dropped Out" && !isRevokeAllowed && editingStudent?.Status !== "Dropped Out") {
                      toast.error("Revoking students is restricted to the Operations team.");
                      return;
                    }
                    setEditStatus(v as StudentStatus);
                  }}
                >
                  <SelectTrigger className="h-8.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Enrolled">Active</SelectItem>
                    {isRevokeAllowed ? (
                      <SelectItem value="Dropped Out">Revoked</SelectItem>
                    ) : (
                      <SelectItem
                        value="Dropped Out"
                        disabled={editingStudent?.Status !== "Dropped Out"}
                        className="text-muted-foreground opacity-50 cursor-not-allowed"
                      >
                        Revoked (Operations only)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {!isRevokeAllowed && (
                  <p className="text-[10px] text-muted-foreground">
                    Note: Revoking students is restricted to the Operations team.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Physical Area / City</Label>
              <PhysicalAreaCombobox
                value={editArea}
                onChange={setEditArea}
                placeholder="Search Egypt areas or governorates..."
              />
            </div>

            {editStatus === "Dropped Out" && (
              <div className="rounded-md border border-rose-200 bg-rose-50/60 p-2.5 text-xs text-rose-800 flex items-start gap-2">
                <Clock className="h-4 w-4 mt-0.5 text-rose-600 shrink-0" />
                <div>
                  <p className="font-semibold">Revocation Tracking</p>
                  <p className="text-[11px] text-rose-700">
                    {editingStudent?.revoked_at
                      ? `Revoked on: ${formatRevocationDateTime(editingStudent.revoked_at).display} (${formatRevocationDateTime(editingStudent.revoked_at).full})`
                      : "Revocation timestamp will be recorded automatically upon saving."}
                  </p>
                </div>
              </div>
            )}

            {editingStudent?.Status === "Dropped Out" && editStatus === "Enrolled" && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs text-emerald-800 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-semibold">Reactivating Student</p>
                  <p className="text-[11px] text-emerald-700">
                    Saving will clear the revocation timestamp and return this student to the active roster.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEdit}
              disabled={savingEdit}
              className="bg-primary text-primary-foreground font-semibold"
            >
              {savingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* 6. Delete Confirmation Dialog */}
      {/* ------------------------------------------------------------------ */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Remove Student Record
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove student <strong className="text-foreground">{deleteTarget?.S_ID}</strong> from the Project Student Roster?
              This updates the single student demand dataset used by every batch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleting ? "Removing..." : "Remove Student"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
