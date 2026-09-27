import { capacityFirstPack } from "../distribute.js";
import { allocateSingleSessionArea } from "../ilp.js";
import type { SessionRow } from "../grid.js";
import { deduplicateDemandByStudentId } from "../run.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function sessions(labs: Array<{ id: string; capacities: number[] }>): SessionRow[] {
  return labs.flatMap((lab) => lab.capacities.map((capacity, index) => ({
    "Lab ID": lab.id,
    Area: "Area A",
    True_Capacity: capacity,
    Day: "2026-09-01",
    Date: "2026-09-01",
    Session: "AM",
    Slot_Num: index + 1,
    Slot_Label: `Slot ${index + 1}`,
    Slot_Key: `${lab.id}_${index + 1}`,
  })));
}

export function runSingleSessionPackingTests(): void {
  const duplicateDemand = deduplicateDemandByStudentId([
    { S_ID: "S-1", Grade: 4, "Physical Area": "Area A" },
    { S_ID: "S-1", Grade: 4, "Physical Area": "Area A" },
    { S_ID: "S-2", Grade: 4, "Physical Area": "Area A" },
  ]);
  assert(duplicateDemand.students.length === 2, "Duplicate student IDs must count once in canonical demand");
  assert(JSON.stringify(duplicateDemand.duplicateIds) === JSON.stringify(["S-1"]), "Duplicate IDs must be diagnosed exactly");

  const cases = [
    { demand: 46, capacities: [25, 25, 25], expected: [25, 21, 0], leftover: 0 },
    { demand: 70, capacities: [25, 25, 25, 25], expected: [25, 25, 20, 0], leftover: 0 },
    { demand: 52, capacities: [25, 25, 25], expected: [25, 25, 0], leftover: 2 },
    { demand: 57, capacities: [25, 25], expected: [25, 25], leftover: 7 },
  ];
  for (const testCase of cases) {
    const actual = capacityFirstPack(testCase.demand, testCase.capacities);
    assert(JSON.stringify(actual.counts) === JSON.stringify(testCase.expected), `Packing mismatch for demand ${testCase.demand}`);
    assert(actual.leftover === testCase.leftover, `Shortfall mismatch for demand ${testCase.demand}`);
    assert(actual.counts.reduce((sum, count) => sum + count, 0) + actual.leftover === testCase.demand, "Accounting invariant failed");
  }

  const labFirst = allocateSingleSessionArea(
    sessions([{ id: "L1", capacities: [20, 20] }, { id: "L2", capacities: [20, 20] }]),
    { 4: 40 },
  );
  const usedLabs = new Set(Object.keys(labFirst.slotAssignment).map((key) => key.split("_")[0]));
  assert(usedLabs.size === 1 && usedLabs.has("L1"), "Expected both sessions in one physical lab");

  const preferred = allocateSingleSessionArea(
    sessions([{ id: "L1", capacities: [25] }, { id: "L2", capacities: [25] }]),
    { 4: 20 },
    { preferredLabRules: [{ area: "Area A", labId: "L2", grades: [4] }] },
  );
  assert(Object.keys(preferred.slotAssignment)[0]?.startsWith("L2_"), "Expected preferred lab L2 to be selected");

  console.log("Single-session capacity-first packing tests passed.");
}
