import fs from "fs";
import XLSX from "xlsx";
import { runAllocation } from "../run";

interface GradeLabStats {
  grade: number;
  totalStudents: number;
  labCount: number;
  min: number;
  max: number;
  spread: number;
  mean: number;
  stdDev: number;
}

export function calculateGradeLabStats(masterRows: any[]): Record<number, GradeLabStats> {
  const gradeLabMap = new Map<number, Map<string, Set<string>>>();
  const gradeStudents = new Map<number, Set<string>>();

  for (const r of masterRows) {
    if (r.Lab_ID === "ONLINE" || !r.Lab_ID) continue;
    const g = Number(r.Grade);
    const sId = String(r.S_ID);
    const labId = String(r.Lab_ID);

    if (!gradeLabMap.has(g)) gradeLabMap.set(g, new Map());
    if (!gradeStudents.has(g)) gradeStudents.set(g, new Set());

    gradeStudents.get(g)!.add(sId);

    const lMap = gradeLabMap.get(g)!;
    if (!lMap.has(labId)) lMap.set(labId, new Set());
    lMap.get(labId)!.add(sId);
  }

  const results: Record<number, GradeLabStats> = {};

  for (const [grade, lMap] of gradeLabMap.entries()) {
    const counts: number[] = [];
    for (const [, studentSet] of lMap.entries()) {
      counts.push(studentSet.size);
    }

    if (counts.length === 0) continue;

    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const sum = counts.reduce((a, b) => a + b, 0);
    const mean = sum / counts.length;
    const variance = counts.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    results[grade] = {
      grade,
      totalStudents: gradeStudents.get(grade)?.size || 0,
      labCount: counts.length,
      min,
      max,
      spread: max - min,
      mean: Math.round(mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
    };
  }

  return results;
}

export async function runBalanceBenchmark() {
  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const rawLabs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  const areaCap7: Record<string, number> = {};
  for (const lab of rawLabs) {
    const area = lab.Area || lab.area;
    const cap = Number(lab["Lab Capacity"] || lab.capacity || 20);
    areaCap7[area] = (areaCap7[area] || 0) + cap * 7;
  }

  const areas = Object.keys(areaCap7);
  const totalEgyptCap7 = Object.values(areaCap7).reduce((a, b) => a + b, 0);

  const studentRows: Array<{ "Student ID": string; Grade: string; Area: string }> = [];
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
      Area: "Orphan Desert Valley",
    });
  }

  const studentCsv = [
    "Student ID,Grade,Physical Area",
    ...studentRows.map((r) => `${r["Student ID"]},${r.Grade},${r.Area}`),
  ].join("\n");

  const studentFile = new File([Buffer.from(studentCsv)], "students.csv", { type: "text/csv" });
  const labFile = new File([labBuf], "labs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const { payload } = await runAllocation({
    studentFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DS-G",
  });

  const stats = calculateGradeLabStats(payload.master_allocation);
  return stats;
}

if (process.argv[1]?.includes("benchmark_balance")) {
  runBalanceBenchmark().then((stats) => {
    console.log("=========================================================================");
    console.log("GRADE-BY-GRADE LAB DISTRIBUTION BENCHMARK");
    console.log("=========================================================================");
    for (const [grade, s] of Object.entries(stats)) {
      console.log(`Grade ${grade}:`);
      console.log(`  • Total Students Seated : ${s.totalStudents}`);
      console.log(`  • Active Physical Labs  : ${s.labCount}`);
      console.log(`  • Min Students per Lab  : ${s.min}`);
      console.log(`  • Max Students per Lab  : ${s.max}`);
      console.log(`  • Max-Min Spread        : ${s.spread}`);
      console.log(`  • Mean Students per Lab : ${s.mean}`);
      console.log(`  • Standard Deviation    : ${s.stdDev}\n`);
    }
  }).catch(console.error);
}
