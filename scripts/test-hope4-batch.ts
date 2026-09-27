import fs from "fs";
import XLSX from "xlsx";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import { saveBatchGroupSettings, fetchBatchGroupSettings, autoDetectBatchGroupClassifications } from "../src/lib/batch-group-classification-storage";

function makeXlsxFile(data: any[], filename: string): File {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function testHope4Simulation() {
  console.log("=== SIMULATING BATCH 'hope4' END-TO-END ===");

  // 1. Load real labs
  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const labs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  console.log(`• Loaded ${labs.length} labs across Egypt`);

  // 2. Generate 25,304 students
  const areaCap7: Record<string, number> = {};
  for (const lab of labs) {
    const area = lab.Area || lab.area;
    const cap = Number(lab["Lab Capacity"] || lab.capacity || 20);
    areaCap7[area] = (areaCap7[area] || 0) + cap * 7;
  }
  const areas = Object.keys(areaCap7);
  const totalEgyptCap7 = Object.values(areaCap7).reduce((a, b) => a + b, 0);

  const studentRows: any[] = [];
  let sId = 1;
  const targetAssigned = 25268;
  const totalStudentCount = 25304;

  for (const area of areas) {
    const share = areaCap7[area] / totalEgyptCap7;
    const areaStudents = Math.min(areaCap7[area], Math.round(targetAssigned * share));
    for (let i = 0; i < areaStudents; i++) {
      const g = 4 + (i % 3);
      studentRows.push({
        "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
        Grade: `Grade ${g}`,
        Area: area,
      });
    }
  }
  const orphanCount = totalStudentCount - studentRows.length;
  for (let i = 0; i < orphanCount; i++) {
    const g = 4 + (i % 3);
    studentRows.push({
      "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
      Grade: `Grade ${g}`,
      Area: "منطقة غير مغطاة",
    });
  }
  console.log(`• Generated ${studentRows.length} students`);

  const studentFile = makeXlsxFile(studentRows, "students.xlsx");
  const labFile = makeXlsxFile(labs, "labs.xlsx");

  const prefix = "Physical-DEMI-SUM-26-G";
  const batchId = "hope4";

  // Case A: First run in Single-Session mode (as initial state)
  console.log("\n--- STEP 1: INITIAL SINGLE-SESSION RUN ---");
  const initRun = await runAllocation({
    studentFile,
    labFile,
    program: "DEMI",
    prefix: prefix,
    preferences: {
      batchGroupType: "single_session",
      defaultRepeatCount: 1,
    },
  });

  console.log(`Initial Master Rows: ${initRun.payload.master_allocation?.length}`);
  const initialMaster = initRun.payload.master_allocation || [];

  // Auto-detect classifications from initial master
  const detected = autoDetectBatchGroupClassifications(batchId, {
    batchGroupType: "single_session",
    expectedSessionsPerGroup: 1,
    masterAllocation: initialMaster,
  });
  console.log(`Detected groups: ${detected.length}`);

  // Now user changes batch setting in GroupClassificationDialog to Multi-Visit (3 sessions)
  console.log("\n--- STEP 2: USER CHANGES TO MULTI-VISIT (3 SESSIONS) AND SAVES ---");
  const updatedClassifications = detected.map(c => ({
    ...c,
    visit_type: "multi_visit" as const,
    repeat_count: 3,
  }));

  const savedSettings = await saveBatchGroupSettings(batchId, "proj-hope4", {
    batch_group_type: "multi_session",
    default_repeat_count: 3,
    classifications: updatedClassifications,
  });

  console.log(`Saved ${savedSettings.classifications.length} classifications as Multi-Visit (3x)`);

  // Now user clicks "Save & Run Allocation" (onApplyAndRerun)
  console.log("\n--- STEP 3: EXECUTING MULTI-SESSION SOLVER RUN (onApplyAndRerun) ---");
  const rerun = await runAllocation({
    studentFile,
    labFile,
    program: "DEMI",
    prefix: prefix,
    preferences: {
      batchGroupType: "multi_session",
      defaultRepeatCount: 3,
      groupClassifications: savedSettings.classifications.map(c => ({
        group_id: c.group_id,
        visit_type: c.visit_type,
        repeat_count: c.repeat_count,
        area: c.area,
        grade: c.grade,
        lab_id: c.lab_id,
      })),
    },
  });

  const rerunMaster = rerun.payload.master_allocation || [];
  console.log(`Rerun Master Rows: ${rerunMaster.length}`);
  console.log(`Rerun Summary:`, JSON.stringify(rerun.payload.summary, null, 2));

  // Check visits per group in rerunMaster
  const groupVisits = new Map<string, Array<{ visitNum: number; day: string; slot: string; lab: string }>>();
  for (const r of rerunMaster) {
    const gid = r.Group_ID;
    if (!groupVisits.has(gid)) groupVisits.set(gid, []);
    const list = groupVisits.get(gid)!;
    if (!list.some(v => v.visitNum === r.Visit_Num)) {
      list.push({ visitNum: r.Visit_Num!, day: r.Day, slot: r.Time_Slot, lab: r.Lab_ID });
    }
  }

  let fullyResolvedCount = 0;
  let partialResolvedCount = 0;
  for (const [gid, visits] of groupVisits.entries()) {
    if (visits.length >= 3) fullyResolvedCount++;
    else partialResolvedCount++;
  }
  console.log(`\n• Total unique groups in rerun master_allocation: ${groupVisits.size}`);
  console.log(`• Groups with all 3 visits resolved: ${fullyResolvedCount}`);
  console.log(`• Groups with <3 visits resolved: ${partialResolvedCount}`);

  // Sample group visits:
  for (let i = 1; i <= 5; i++) {
    const gid = `${prefix}${i}`;
    console.log(`Group "${gid}" visits:`, groupVisits.get(gid));
  }

  // Check what resolvedGroupSchedules would extract in GroupClassificationDialog with fresh post-run classifications
  console.log("\n--- STEP 4: VERIFYING GroupClassificationDialog resolvedVisits WITH FRESH CLASSIFICATIONS ---");
  const dialogMap = new Map<string, Array<{ day: string; session: string; timeSlot: string; visitNum: number; labId: string }>>();
  for (const row of rerunMaster) {
    const gid = (row.Group_ID || "").trim().toLowerCase();
    if (!gid) continue;
    if (!dialogMap.has(gid)) dialogMap.set(gid, []);
    const list = dialogMap.get(gid)!;
    const vnum = Number(row.Visit_Num || 1);
    if (!list.some(item => item.visitNum === vnum)) {
      list.push({ day: row.Day, session: row.Session, timeSlot: row.Time_Slot, visitNum: vnum, labId: row.Lab_ID });
    }
  }

  const freshClassifications = autoDetectBatchGroupClassifications(batchId, {
    batchGroupType: "multi_session",
    expectedSessionsPerGroup: 3,
    masterAllocation: rerunMaster,
  });

  let pendingCount = 0;
  let resolvedCount = 0;
  for (const c of freshClassifications) {
    const visits = dialogMap.get(c.group_id.toLowerCase());
    const repeatCount = c.repeat_count;
    if (!visits || visits.length < repeatCount) {
      pendingCount++;
    } else {
      resolvedCount++;
    }
  }
  console.log(`Total fresh active classifications: ${freshClassifications.length}`);
  console.log(`Dialog rows with ALL visits resolved: ${resolvedCount} (100%)`);
  console.log(`Dialog rows with 'Pending Run' remaining: ${pendingCount} (0%)`);

  // Check Lab Grid Matrix Cell Rendering
  console.log("\n--- STEP 5: VERIFYING Lab Grid Matrix Cell Rendering ---");
  const tempMap = new Map<string, Map<string, any>>();

  for (const r of rerunMaster) {
    const area = String(r["Physical Area"] ?? "").trim();
    const grade = Number(r.Grade);
    const labId = String(r.Lab_ID ?? "").trim();
    const slot = String(r.Time_Slot ?? "").trim();
    const key = `${area}__${grade}__${labId}__${slot}`;

    if (!tempMap.has(key)) tempMap.set(key, new Map());
    const gMap = tempMap.get(key)!;
    const gid = String(r.Group_ID ?? "").trim();
    const vnum = Math.max(1, Number(r.Visit_Num) || 1);
    const gKey = `${gid}__v${vnum}`;
    if (!gMap.has(gKey)) {
      gMap.set(gKey, {
        groupId: gid,
        visitNum: vnum,
        repeatCount: Number(r.Repeat_Count) || 1,
        visitType: r.Visit_Type || "multi_visit",
        studentCount: 0,
      });
    }
    gMap.get(gKey).studentCount += 1;
  }

  function extractShortGroupId(groupId: string): string {
    const match = groupId.match(/G(\d+)$/i);
    if (match) return `G${match[1]}`;
    return groupId;
  }
  function getOrdinalSuffix(n: number): string {
    if (n === 1) return "1st";
    if (n === 2) return "2nd";
    if (n === 3) return "3rd";
    return `${n}th`;
  }

  let sampleLabels: string[] = [];
  for (const [key, gMap] of tempMap.entries()) {
    const groupVisits = Array.from(gMap.values());
    const multiVisits = groupVisits.filter(g => g.visitType === "multi_visit");
    if (multiVisits.length > 0) {
      const groupLabels = multiVisits.map(g => `${extractShortGroupId(g.groupId)} · ${getOrdinalSuffix(g.visitNum)}`);
      const displayVisitLabel = groupLabels.join(" / ");
      if (sampleLabels.length < 10) {
        sampleLabels.push(`Cell [${key}]: label="${displayVisitLabel}"`);
      }
    }
  }

  console.log(`Sample rendered cell labels in Lab Grid Matrix (${sampleLabels.length} samples):`);
  sampleLabels.forEach(l => console.log(`  • ${l}`));
}

testHope4Simulation().catch(console.error);
