import fs from "fs";
import XLSX from "xlsx";
import { runAllocation } from "../run";

async function analyzeLabSizes() {
  console.log("=========================================================================");
  console.log("ANALYZING LAB SIZES & FRAGMENTS (< 8 STUDENTS) BEFORE FIX");
  console.log("=========================================================================");

  // Scenario 1: Multi-session scenario with 55 students and 3x 25-cap labs
  const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
  const students55Csv = [
    "Student ID,Grade,Physical Area",
    ...Array.from({ length: 55 }, (_, i) => `STU-${i + 1},Grade 4,Test Area`),
  ].join("\n");
  const studentFile55 = new File([Buffer.from(students55Csv)], "students.csv", { type: "text/csv" });

  function dateSlots(dates: string[]): string[] {
    return dates.map((date) => `${date}@10:00`);
  }

  const customSlots = dateSlots(dates);

  const res55 = await runAllocation({
    studentFile: studentFile55,
    labFile: null,
    useDbLabs: true,
    labsJson: ["LAB-1", "LAB-2", "LAB-3"].map((id) => ({ "Lab ID": id, Area: "Test Area", "Lab Capacity": 25 })),
    program: "CUSTOM",
    prefix: "Physical-G",
    preferences: {
      overfillRules: [], preferredLabRules: [], extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 5,
      batchDates: dates,
      customSlots: customSlots as any,
      mega_groups: [{ name: "Capacity Group", start_date: dates[0], end_date: dates.at(-1) }],
    },
  });

  const groupSizes55 = new Map<string, number>();
  for (const r of res55.payload.master_allocation) {
    if (r.Visit_Num === 1) {
      groupSizes55.set(r.Group_ID, (groupSizes55.get(r.Group_ID) || 0) + 1);
    }
  }
  console.log("Scenario 1 (55 students across 3x25-cap labs): Group sizes:", [...groupSizes55.entries()]);
  const under8_S1 = [...groupSizes55.entries()].filter(([, size]) => size < 8);
  console.log("  -> Groups under 8 students:", under8_S1);
  console.log("  -> Overflow fragment notices:", res55.payload.overflow_fragment_notices);
  console.log("  -> Unassigned count:", res55.payload.unassigned_students.length);

  // Scenario 2: Mega Group A has 31 students (cap 30), Mega Group B has 20 students (cap 30)
  const students51 = [
    ...Array.from({ length: 31 }, (_, i) => ({ "Student ID": `MGA-${i + 1}`, Grade: "Grade 4", Area: "Area-X", Mega_Group: "Mega Group A" })),
    ...Array.from({ length: 20 }, (_, i) => ({ "Student ID": `MGB-${i + 1}`, Grade: "Grade 4", Area: "Area-X", Mega_Group: "Mega Group B" })),
  ];
  const csv51 = [
    "Student ID,Grade,Physical Area,Mega Group",
    ...students51.map((s) => `${s["Student ID"]},${s.Grade},${s.Area},${s.Mega_Group}`),
  ].join("\n");
  const datesA = ["2026-10-01", "2026-10-02", "2026-10-03"];
  const datesB = ["2026-10-06", "2026-10-07", "2026-10-08"];
  const customSlots51 = dateSlots([...datesA, ...datesB]);

  const res51 = await runAllocation({
    studentFile: new File([Buffer.from(csv51)], "students.csv", { type: "text/csv" }),
    labFile: null,
    useDbLabs: true,
    labsJson: [
      { "Lab ID": "LAB-X1", Area: "Area-X", "Lab Capacity": 30 },
      { "Lab ID": "LAB-X2", Area: "Area-X", "Lab Capacity": 30 },
    ],
    program: "CUSTOM",
    prefix: "Physical-G",
    preferences: {
      overfillRules: [], preferredLabRules: [], extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 3,
      batchDates: [...datesA, ...datesB],
      customSlots: customSlots51 as any,
      mega_groups: [
        { name: "Mega Group A", start_date: datesA[0], end_date: datesA.at(-1), student_ids: students51.filter(s => s.Mega_Group === "Mega Group A").map(s => s["Student ID"]) },
        { name: "Mega Group B", start_date: datesB[0], end_date: datesB.at(-1), student_ids: students51.filter(s => s.Mega_Group === "Mega Group B").map(s => s["Student ID"]) },
      ],
    },
  });

  // Scenario 3: MG A has 31 students with 1 lab (cap 30), MG B has 20 students with 1 lab (cap 30)
  const customSlotsSingle = dateSlots([...datesA, ...datesB]);
  const resSingle = await runAllocation({
    studentFile: new File([Buffer.from(csv51)], "students.csv", { type: "text/csv" }),
    labFile: null,
    useDbLabs: true,
    labsJson: [
      { "Lab ID": "LAB-X1", Area: "Area-X", "Lab Capacity": 30 },
    ],
    program: "CUSTOM",
    prefix: "Physical-G",
    preferences: {
      overfillRules: [], preferredLabRules: [], extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 3,
      batchDates: [...datesA, ...datesB],
      customSlots: customSlotsSingle as any,
      mega_groups: [
        { name: "Mega Group A", start_date: datesA[0], end_date: datesA.at(-1), student_ids: students51.filter(s => s.Mega_Group === "Mega Group A").map(s => s["Student ID"]) },
        { name: "Mega Group B", start_date: datesB[0], end_date: datesB.at(-1), student_ids: students51.filter(s => s.Mega_Group === "Mega Group B").map(s => s["Student ID"]) },
      ],
    },
  });

  const groupSizesSingle = new Map<string, number>();
  for (const r of resSingle.payload.master_allocation) {
    if (r.Visit_Num === 1) {
      groupSizesSingle.set(r.Group_ID, (groupSizesSingle.get(r.Group_ID) || 0) + 1);
    }
  }
  console.log("\nScenario 3 (MG A=31, MG B=20, ONLY 1 lab cap 30): Group sizes:", [...groupSizesSingle.entries()]);
  const under8_S3 = [...groupSizesSingle.entries()].filter(([, size]) => size < 8);
  console.log("  -> Groups under 8 students:", under8_S3);
  console.log("  -> Overflow fragment notices:", resSingle.payload.overflow_fragment_notices);
  console.log("  -> Unassigned count:", resSingle.payload.unassigned_students.length);
  if (resSingle.payload.unassigned_students.length > 0) {
    console.log("  -> Unassigned students:", resSingle.payload.unassigned_students.map(u => ({ id: u.S_ID, area: u["Physical Area"], reason: u.Reason })));
  }

  // Scenario 4: MG A has 31 students, ONLY 1 lab cap 30, and NO OTHER MEGA GROUP exists (standalone 31 into 30)
  const students31Csv = [
    "Student ID,Grade,Physical Area",
    ...Array.from({ length: 31 }, (_, i) => `STU-${i + 1},Grade 4,Area-X`),
  ].join("\n");
  const res31 = await runAllocation({
    studentFile: new File([Buffer.from(students31Csv)], "students.csv", { type: "text/csv" }),
    labFile: null,
    useDbLabs: true,
    labsJson: [{ "Lab ID": "LAB-X1", Area: "Area-X", "Lab Capacity": 30 }],
    program: "CUSTOM",
    prefix: "Physical-G",
    preferences: {
      overfillRules: [], preferredLabRules: [], extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 3,
      batchDates: datesA,
      customSlots: dateSlots(datesA) as any,
    },
  });

  // Scenario 5: Scenario 4 with Fair Overfill sign-off (+1 or +2)
  const resOverfill = await runAllocation({
    studentFile: new File([Buffer.from(students31Csv)], "students.csv", { type: "text/csv" }),
    labFile: null,
    useDbLabs: true,
    labsJson: [{ "Lab ID": "LAB-X1", Area: "Area-X", "Lab Capacity": 30 }],
    program: "CUSTOM",
    prefix: "Physical-G",
    preferences: {
      overfillRules: [{ area: "Area-X", grades: [4], labIds: ["ALL"], maxOverfillPerLab: 2 }],
      preferredLabRules: [], extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 3,
      batchDates: datesA,
      customSlots: dateSlots(datesA) as any,
    },
  });

  const groupSizesOverfill = new Map<string, number>();
  for (const r of resOverfill.payload.master_allocation) {
    if (r.Visit_Num === 1) {
      groupSizesOverfill.set(r.Group_ID, (groupSizesOverfill.get(r.Group_ID) || 0) + 1);
    }
  }
  console.log("\nScenario 5 (Fair Overfill +2 sign-off applied to 31 students in 30-cap lab): Group sizes:", [...groupSizesOverfill.entries()]);
  console.log("  -> Groups under 8 students:", [...groupSizesOverfill.entries()].filter(([, size]) => size < 8));
  console.log("  -> Unassigned count:", resOverfill.payload.unassigned_students.length);
  console.log("  -> Overfill count in summary:", resOverfill.payload.summary.overfill_count);
  console.log("  -> Overfill details:", resOverfill.payload.overfill_details);
}

analyzeLabSizes().catch(console.error);
