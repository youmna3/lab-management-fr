import fs from "fs";
import XLSX from "xlsx";
import { generateMasterAllocation } from "../src/lib/lab-allocation-runner/master";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";

function makeXlsxFile(data: any[], filename: string): File {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function testAreaGradeTracks() {
  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const labs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

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

  const studentFile = makeXlsxFile(studentRows, "students.xlsx");
  const labFile = makeXlsxFile(labs, "labs.xlsx");
  const prefix = "Physical-DEMI-SUM-26-G";

  console.log("Running Multi-Session (3x) run on full nationwide dataset...");
  const res = await runAllocation({
    studentFile,
    labFile,
    program: "DEMI",
    prefix,
    preferences: {
      batchGroupType: "multi_session",
      defaultRepeatCount: 3,
    },
  });

  const master = res.payload.master_allocation || [];
  console.log(`Master rows: ${master.length}`);
  console.log(`Summary:`, res.payload.summary);

  const groupVisits = new Map<string, number[]>();
  for (const r of master) {
    const gid = r.Group_ID;
    if (!groupVisits.has(gid)) groupVisits.set(gid, []);
    const list = groupVisits.get(gid)!;
    if (!list.includes(r.Visit_Num!)) list.push(r.Visit_Num!);
  }

  let fullyResolved = 0;
  let partialResolved = 0;
  for (const [gid, vlist] of groupVisits.entries()) {
    if (vlist.length === 3) fullyResolved++;
    else partialResolved++;
  }

  console.log(`Total Groups: ${groupVisits.size}`);
  console.log(`Fully Resolved (all 3 visits): ${fullyResolved}`);
  console.log(`Partial Resolved (<3 visits): ${partialResolved}`);
}

testAreaGradeTracks().catch(console.error);
