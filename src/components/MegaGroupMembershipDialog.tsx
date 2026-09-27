import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Calendar,
  Layers,
  Trash2,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { MegaGroupDefinition, MasterAllocationRow } from "@/lib/allocation-client";
import { formatGradeLevel } from "@/lib/project-grade-levels";

import { partitionGroupsEvenlyAcrossMegaGroups, extractShortGroupId } from "@/lib/lab-allocation-runner/mega-groups";

export interface MegaGroupMembershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId?: string;
  batchName?: string;
  megaGroups: MegaGroupDefinition[];
  masterAllocation?: MasterAllocationRow[];
  students?: any[];
  onSaveMegaGroups: (updatedMegaGroups: MegaGroupDefinition[]) => Promise<void>;
  onReRunAllocation?: () => void;
  canEdit?: boolean;
  isLoading?: boolean;
}

interface GroupMembershipItem {
  groupId: string;
  shortGroupId: string;
  grade?: number;
  physicalArea?: string;
  studentCount: number;
  studentIds: string[];
  isExcluded: boolean;
}

export function MegaGroupMembershipDialog({
  open,
  onOpenChange,
  batchId,
  batchName = "Current Batch",
  megaGroups = [],
  masterAllocation = [],
  students = [],
  onSaveMegaGroups,
  onReRunAllocation,
  canEdit = true,
  isLoading = false,
}: MegaGroupMembershipDialogProps) {
  const [localMegaGroups, setLocalMegaGroups] = useState<MegaGroupDefinition[]>(megaGroups);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMgIndex, setSelectedMgIndex] = useState(0);

  // Sync state when dialog opens or megaGroups prop changes
  React.useEffect(() => {
    if (open) {
      setLocalMegaGroups(megaGroups);
      setSelectedMgIndex(0);
    }
  }, [open, megaGroups]);

  // Derive group memberships per mega group from masterAllocation or raw students pre-division
  const megaGroupMemberships = useMemo(() => {
    // 1. If masterAllocation is populated with Mega_Group tags, extract directly from masterAllocation
    const hasAllocatedMegaRows = masterAllocation && masterAllocation.some((r: any) => Boolean(r.Mega_Group ?? r.MegaGroup ?? r["Mega Group"]));

    if (hasAllocatedMegaRows) {
      return localMegaGroups.map((mg) => {
        const mgNameLower = String(mg.name || "").trim().toLowerCase();
        const mgIdLower = String(mg.id || "").trim().toLowerCase();
        const excludedGroupSet = new Set(
          (mg.excluded_group_ids || []).map((g) => String(g).trim().toLowerCase())
        );

        const groupMap = new Map<string, GroupMembershipItem>();

        for (const row of masterAllocation) {
          const r = row as any;
          const rMg = String(r.Mega_Group ?? r.MegaGroup ?? r["Mega Group"] ?? r.mega_group ?? "").trim().toLowerCase();
          const rGid = String(r.Group_ID ?? r.GroupId ?? r["Group ID"] ?? r.group_id ?? "").trim();
          if (!rGid) continue;

          const isRowInMg = rMg === mgNameLower || (mgIdLower && rMg === mgIdLower);
          const isExcludedGid = excludedGroupSet.has(rGid.toLowerCase()) || excludedGroupSet.has(extractShortGroupId(rGid).toLowerCase());

          if (isRowInMg || isExcludedGid) {
            if (!groupMap.has(rGid)) {
              groupMap.set(rGid, {
                groupId: rGid,
                shortGroupId: extractShortGroupId(rGid),
                grade: Number(r.Grade ?? r.grade),
                physicalArea: String(r["Physical Area"] ?? r.Physical_Area ?? r.Area ?? r.area ?? ""),
                studentCount: 0,
                studentIds: [],
                isExcluded: isExcludedGid,
              });
            }
            const item = groupMap.get(rGid)!;
            const sId = String(r.S_ID ?? r.Student_ID ?? r.StudentID ?? r["Student ID"] ?? "");
            if (sId && !item.studentIds.includes(sId)) {
              item.studentIds.push(sId);
              item.studentCount += 1;
            } else if (!sId) {
              item.studentCount += 1;
            }
          }
        }

        const groups = Array.from(groupMap.values());
        const totalStudents = groups.reduce((acc, g) => acc + (g.isExcluded ? 0 : g.studentCount), 0);
        const activeGroups = groups.filter((g) => !g.isExcluded);

        const excludedGroups = groups.filter((g) => g.isExcluded);
        return {
          megaGroup: mg,
          allGroups: groups,
          groups,
          activeGroups,
          excludedGroups,
          totalActiveStudents: totalStudents,
          totalStudents,
          totalGroups: groups.length,
          activeGroupCount: activeGroups.length,
        };
      });
    }

    // 2. Pre-allocation division: partition raw students evenly across the super groups
    const { groupMembershipsByMg } = partitionGroupsEvenlyAcrossMegaGroups(students, localMegaGroups);

    return localMegaGroups.map((mg) => {
      const excludedGroupSet = new Set(
        (mg.excluded_group_ids || []).map((g) => String(g).trim().toLowerCase())
      );

      const assignedGroups = groupMembershipsByMg.get(mg.name) || [];
      const groupsWithExclusion = assignedGroups.map((g) => ({
        ...g,
        isExcluded: excludedGroupSet.has(g.groupId.toLowerCase()) || excludedGroupSet.has(g.shortGroupId.toLowerCase()),
      }));

      const activeGroups = groupsWithExclusion.filter((g) => !g.isExcluded);
      const excludedGroups = groupsWithExclusion.filter((g) => g.isExcluded);
      const totalStudents = activeGroups.reduce((acc, g) => acc + g.studentCount, 0);

      return {
        megaGroup: mg,
        allGroups: groupsWithExclusion,
        groups: groupsWithExclusion,
        activeGroups,
        excludedGroups,
        totalActiveStudents: totalStudents,
        totalStudents,
        totalGroups: groupsWithExclusion.length,
        activeGroupCount: activeGroups.length,
      };
    });
  }, [localMegaGroups, masterAllocation, students]);

  // Handle removing a group from mega group
  const handleRemoveGroup = (mgIndex: number, group: GroupMembershipItem) => {
    const updated = [...localMegaGroups];
    const targetMg = { ...updated[mgIndex] };
    const curExcludedGroups = new Set(targetMg.excluded_group_ids || []);
    const curExcludedStudents = new Set(targetMg.excluded_student_ids || []);

    curExcludedGroups.add(group.groupId);
    if (group.shortGroupId) curExcludedGroups.add(group.shortGroupId);

    // Also add student IDs to excluded_student_ids for complete determinism
    group.studentIds.forEach((sId) => curExcludedStudents.add(sId));

    // Remove from group_ids if explicitly listed there
    if (targetMg.group_ids) {
      targetMg.group_ids = targetMg.group_ids.filter((g) => g !== group.groupId && g !== group.shortGroupId);
    }

    targetMg.excluded_group_ids = Array.from(curExcludedGroups);
    targetMg.excluded_student_ids = Array.from(curExcludedStudents);

    updated[mgIndex] = targetMg;
    setLocalMegaGroups(updated);

    toast.info(`Removed ${group.shortGroupId || group.groupId} from "${targetMg.name}". Click Save & Apply to persist.`);
  };

  // Handle restoring an excluded group back to the mega group
  const handleRestoreGroup = (mgIndex: number, group: GroupMembershipItem) => {
    const updated = [...localMegaGroups];
    const targetMg = { ...updated[mgIndex] };
    const curExcludedGroups = (targetMg.excluded_group_ids || []).filter(
      (g) => g !== group.groupId && g !== group.shortGroupId
    );
    const curExcludedStudents = (targetMg.excluded_student_ids || []).filter(
      (sId) => !group.studentIds.includes(sId)
    );

    targetMg.excluded_group_ids = curExcludedGroups;
    targetMg.excluded_student_ids = curExcludedStudents;

    updated[mgIndex] = targetMg;
    setLocalMegaGroups(updated);

    toast.success(`Restored ${group.shortGroupId || group.groupId} to "${targetMg.name}".`);
  };

  // Save changes to database and parent state
  const handleSave = async () => {
    if (!canEdit) {
      toast.error("View only - allocation managed by another user.");
      return;
    }
    try {
      setSaving(true);
      await onSaveMegaGroups(localMegaGroups);
      toast.success("Mega group membership updated successfully!");
      if (onReRunAllocation) {
        onReRunAllocation();
      }
      onOpenChange(false);
    } catch (err: any) {
      console.error("Failed to save mega groups:", err);
      toast.error(`Failed to update mega groups: ${err.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  if (megaGroups.length === 0 && localMegaGroups.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Layers className="h-5 w-5 text-purple-600" />
              Mega Groups &amp; Sub-Batches
            </DialogTitle>
            <DialogDescription className="text-xs">
              No Mega Groups or Sub-Batches are configured for <strong>{batchName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 text-center text-sm text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
            Mega Groups allow partitioning batches into isolated date windows (e.g. Week 1 vs Week 2). You can configure Mega Groups in the Batch settings dialog.
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const activeMgData = megaGroupMemberships[selectedMgIndex] || megaGroupMemberships[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#1F2A55] dark:text-[#F7FAFF]">
                <Layers className="h-5 w-5 text-purple-600" />
                Mega Group Membership &amp; Partitioning
              </DialogTitle>
              <DialogDescription className="text-xs">
                Inspect which groups/students belong to which Mega Group. Removing a group reverts it to the batch's default scheduling window.
              </DialogDescription>
            </div>
            <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 font-mono text-xs">
              {batchName}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Mega Group Selector Tabs */}
          {megaGroupMemberships.length > 1 && (
            <div className="flex flex-wrap gap-2 border-b pb-3">
              {megaGroupMemberships.map((m, idx) => (
                <Button
                  key={idx}
                  size="sm"
                  variant={selectedMgIndex === idx ? "default" : "outline"}
                  onClick={() => setSelectedMgIndex(idx)}
                  className={`text-xs gap-1.5 h-8 rounded-xl ${
                    selectedMgIndex === idx
                      ? "bg-purple-600 hover:bg-purple-700 text-white font-bold"
                      : "text-muted-foreground"
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  {m.megaGroup.name}
                  <Badge
                    variant="secondary"
                    className={`ml-1 text-[10px] px-1.5 py-0 ${
                      selectedMgIndex === idx ? "bg-white/20 text-white" : ""
                    }`}
                  >
                    {m.activeGroups.length} Groups
                  </Badge>
                </Button>
              ))}
            </div>
          )}

          {/* Active Mega Group Summary Card */}
          {activeMgData && (
            <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-950/10 shadow-xs">
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-[#1F2A55] dark:text-[#F7FAFF] flex items-center gap-2">
                      {activeMgData.megaGroup.name}
                      <Badge className="bg-purple-600 text-white text-[10px] px-2 py-0.5">
                        {activeMgData.activeGroups.length} Active Group(s)
                      </Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground font-mono">
                        {activeMgData.totalActiveStudents} Students
                      </Badge>
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activeMgData.megaGroup.start_date && activeMgData.megaGroup.end_date
                        ? `Isolated Window: ${activeMgData.megaGroup.start_date} to ${activeMgData.megaGroup.end_date}`
                        : activeMgData.megaGroup.dates && activeMgData.megaGroup.dates.length > 0
                        ? `Dates: ${activeMgData.megaGroup.dates.join(", ")}`
                        : "All Dates"}
                      {activeMgData.megaGroup.grades && activeMgData.megaGroup.grades.length > 0 && ` · Grades: ${activeMgData.megaGroup.grades.join(", ")}`}
                      {activeMgData.megaGroup.areas && activeMgData.megaGroup.areas.length > 0 && ` · Areas: ${activeMgData.megaGroup.areas.join(", ")}`}
                    </p>
                  </div>

                  <div className="w-48 sm:w-56">
                    <Input
                      placeholder="Filter groups..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 text-xs bg-background"
                    />
                  </div>
                </div>

                {/* Active Groups Table */}
                <div className="rounded-xl border bg-background overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs font-bold w-24">Group</TableHead>
                        <TableHead className="text-xs font-bold">Full Group ID</TableHead>
                        <TableHead className="text-xs font-bold w-20">Grade</TableHead>
                        <TableHead className="text-xs font-bold">Physical Area</TableHead>
                        <TableHead className="text-xs font-bold text-center w-24">Students</TableHead>
                        <TableHead className="text-xs font-bold text-right w-36">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeMgData.activeGroups.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">
                            No active groups assigned to this Mega Group.
                          </TableCell>
                        </TableRow>
                      ) : (
                        activeMgData.activeGroups
                          .filter((g) => {
                            if (!searchQuery.trim()) return true;
                            const q = searchQuery.toLowerCase().trim();
                            return (
                              g.groupId.toLowerCase().includes(q) ||
                              g.shortGroupId.toLowerCase().includes(q) ||
                              (g.physicalArea || "").toLowerCase().includes(q)
                            );
                          })
                          .map((g, gIdx) => (
                            <TableRow key={gIdx} className="hover:bg-muted/30">
                              <TableCell className="text-xs font-mono font-bold text-purple-700 dark:text-purple-300">
                                <Badge variant="outline" className="border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-mono font-bold text-xs px-2 py-0.5">
                                  {g.shortGroupId || g.groupId}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-[200px]" title={g.groupId}>
                                {g.groupId}
                              </TableCell>
                              <TableCell className="text-xs">
                                {g.grade ? (
                                  <Badge className="bg-[#043FAD] text-white text-[10px] px-1.5 py-0">
                                    {formatGradeLevel(g.grade)}
                                  </Badge>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="text-xs font-medium">
                                {g.physicalArea || "—"}
                              </TableCell>
                              <TableCell className="text-xs text-center font-bold">
                                {g.studentCount}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleRemoveGroup(selectedMgIndex, g)}
                                  className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 gap-1 rounded-lg"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Remove
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Excluded Groups Subsection */}
                {activeMgData.excludedGroups.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-dashed">
                    <h5 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                      Excluded from Mega Group (Reverted to Default Window — {activeMgData.excludedGroups.length} Group(s)):
                    </h5>
                    <div className="flex flex-wrap gap-2">
                      {activeMgData.excludedGroups.map((ex, exIdx) => (
                        <div
                          key={exIdx}
                          className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 text-xs font-mono"
                        >
                          <span className="font-bold text-amber-800 dark:text-amber-300">
                            {ex.shortGroupId || ex.groupId}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ({ex.studentCount} std)
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRestoreGroup(selectedMgIndex, ex)}
                            className="h-5 px-1.5 text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 gap-1 rounded"
                            title="Restore group back to this Mega Group"
                          >
                            <RotateCcw className="h-2.5 w-2.5" />
                            Restore
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Removed groups will be allocated across the batch's default date range on the next solver run.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canEdit || saving || isLoading}
              className="bg-purple-600 hover:bg-purple-700 text-white font-bold gap-1.5 shadow-xs"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save & Apply"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
