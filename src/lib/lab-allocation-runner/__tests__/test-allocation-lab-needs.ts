import { calculateReplacementAvailability, deriveAllocationLabUsage } from "../../allocation-lab-needs.js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export function runAllocationLabNeedsTests() {
  const allocation = {
    run_id: "run-1",
    preferences_applied: { customSlots: ["2026-09-01@10:00", "2026-09-02@12:30"] },
    master_allocation: [
      { Lab_ID: "L239", S_ID: "S1", Group_ID: "G1", Grade: 4, Governorate: "Aswan", "Physical Area": "Area A", Lab_Capacity: 20, Slot_Num: 1, Day: "2026-09-01", Time_Slot: "10:00" },
      { Lab_ID: "L239", S_ID: "S2", Group_ID: "G1", Grade: 4, Governorate: "Aswan", "Physical Area": "Area A", Lab_Capacity: 20, Slot_Num: 1, Day: "2026-09-01", Time_Slot: "10:00" },
      { Lab_ID: "L239", S_ID: "S1", Group_ID: "G1", Grade: 4, Governorate: "Aswan", "Physical Area": "Area A", Lab_Capacity: 20, Slot_Num: 2, Day: "2026-09-02", Time_Slot: "12:30" },
      { Lab_ID: "ONLINE", S_ID: "VP1", Group_ID: "VP1", Grade: 4, Governorate: "Aswan", "Physical Area": "Area A", Lab_Capacity: 30, Slot_Num: 1, Day: "2026-09-01", Time_Slot: "10:00" },
    ],
  } as any;
  const usage = deriveAllocationLabUsage(allocation);
  assert(usage.length === 1, "online rows must be excluded and the physical lab must appear once");
  assert(usage[0].uniqueStudents === 2, "students must be distinct across visits");
  assert(usage[0].seatVisits === 3, "seat visits must count allocation rows");
  assert(usage[0].totalSessions === 2 && usage[0].occupiedDays === 2, "exact occupied sessions and days must be retained");
  assert(usage[0].requiredSessionCapacity === 2, "required capacity must use the maximum simultaneous session demand");

  const availability = calculateReplacementAvailability(
    [{ date: "2026-09-01", time: "10:00" }, { date: "2026-09-02", time: "12:30" }],
    [{ date: "2026-09-01", time: "10:00" }, { date: "2026-09-01", time: "16:00" }],
  );
  assert(availability.status === "partially_conflicted", "one exact collision must be partially conflicted");
  assert(availability.availableSessions === 1 && availability.conflicts.length === 1, "only exact date/time collisions count");
}

if (import.meta.url === `file://${process.argv[1]}`) runAllocationLabNeedsTests();
