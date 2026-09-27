import fs from "fs";
import path from "path";
import { parseSheet } from "@/lib/sheet";
import { isMasterLabScheduleSheet, parseMasterLabScheduleSheet } from "@/lib/lab-allocation/master-sheet-importer";

async function main() {
  const filePath = path.resolve("public/sample-files/DEMI_Summer_2026_Operations_Dashboard.csv");
  const content = fs.readFileSync(filePath, "utf-8");
  
  // Parse CSV lines into objects
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx].trim() : "";
    });
    rows.push(row);
  }

  console.log("Total rows in CSV:", rows.length);
  console.log("isMasterLabScheduleSheet:", isMasterLabScheduleSheet(rows));

  const result = parseMasterLabScheduleSheet(rows, {
    organization: "DEMI",
    groupCapacity: 25,
    defaultSlots: [],
    respectGradeSlots: true,
    allowFallbackToGov: false,
    preserveExistingAllocations: false,
  });

  console.log("Parsed Labs Count:", result.totalLabs);
  console.log("Parsed Groups Count:", result.totalGroups);
  console.log("Parsed Total Slots Occupied:", result.totalSlotsOccupied);
  console.log("Sample Lab:", {
    labCode: result.labs[0]?.labCode,
    name: result.labs[0]?.name,
    gov: result.labs[0]?.gov,
    area: result.labs[0]?.area,
    capacity: result.labs[0]?.capacity,
    supervisor: result.labs[0]?.supervisorName,
  });

  // Check unique areas & grades
  const areas = Array.from(new Set(result.labs.map((l) => l.area)));
  console.log("Unique Areas:", areas.length, areas.slice(0, 10));

  console.log("Summary Items Count:", result.result.summary.length);
  console.log("Sample Summary Item:", result.result.summary[0]);
}

main().catch(console.error);
