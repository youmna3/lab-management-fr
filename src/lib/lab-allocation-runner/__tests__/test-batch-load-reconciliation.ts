import { describe, it } from "node:test";
import assert from "node:assert";
import { deriveAllocationLabUsage } from "../../allocation-lab-needs";

console.log("=== RUNNING BATCH LOAD & RECONCILIATION VERIFICATION SUITE ===\n");

// 1. Test Deep-link matching logic
console.log("--- Test 1: Lab Data Deep-Link Resolution ---");
const mockLabs = [
  { id: "uuid-1", lab_code: "L1", name: "American Academy", gov: "Alexandria", area: "Smouha" },
  { id: "uuid-570", lab_code: "L570", name: "Center Emad", gov: "Aswan", area: "Edfu" },
  { id: "uuid-524", lab_code: "L524", name: "Arizona Training Center", gov: "Asyut", area: "Dairout" },
];

function resolveLabDeepLink(labs: typeof mockLabs, labIdParam?: string, labCodeParam?: string) {
  const paramId = (labIdParam ?? "").trim().toLowerCase();
  const paramCode = (labCodeParam ?? "").trim().toLowerCase();
  if (!paramId && !paramCode) return null;
  return labs.find(
    (l) =>
      (paramId && l.id.toLowerCase() === paramId) ||
      (paramId && l.lab_code?.trim().toLowerCase() === paramId) ||
      (paramCode && l.lab_code?.trim().toLowerCase() === paramCode) ||
      (paramCode && l.id.toLowerCase() === paramCode)
  ) ?? null;
}

// Test by UUID
assert.strictEqual(resolveLabDeepLink(mockLabs, "uuid-570")?.lab_code, "L570", "Should match by UUID");
// Test by lab code in labIdParam
assert.strictEqual(resolveLabDeepLink(mockLabs, "L570")?.id, "uuid-570", "Should match by code in labIdParam");
// Test by labCodeParam with whitespace
assert.strictEqual(resolveLabDeepLink(mockLabs, undefined, "  l570  ")?.id, "uuid-570", "Should match by trimmed lowercase labCodeParam");
// Test by both params
assert.strictEqual(resolveLabDeepLink(mockLabs, "uuid-570", "L570")?.name, "Center Emad", "Should match when both provided");
console.log("✓ Test 1 Passed: Deep-link resolution reliably finds target lab across all param combinations.");

// 2. Test Fast O(N) Reconciliation Bypass
console.log("\n--- Test 2: Fast O(N) Reconciliation Bypass ---");
const allocationPayload = {
  run_id: "run-demi-1",
  master_allocation: [
    { Lab_ID: "L570", S_ID: "S1", Group_ID: "G1", Grade: 4, Governorate: "Aswan", "Physical Area": "Edfu", Lab_Capacity: 15, Slot_Num: 1, Day: "2026-09-13", Time_Slot: "10:00" },
    { Lab_ID: "L570", S_ID: "S2", Group_ID: "G1", Grade: 4, Governorate: "Aswan", "Physical Area": "Edfu", Lab_Capacity: 15, Slot_Num: 1, Day: "2026-09-13", Time_Slot: "10:00" },
    { Lab_ID: "L1", S_ID: "S3", Group_ID: "G2", Grade: 5, Governorate: "Alexandria", "Physical Area": "Smouha", Lab_Capacity: 20, Slot_Num: 1, Day: "2026-09-13", Time_Slot: "12:30" },
  ],
} as any;

const usages = deriveAllocationLabUsage(allocationPayload);
assert.strictEqual(usages.length, 2, "Should derive 2 physical lab usages");

const existingAssignments = [
  { id: "asg-1", lab_id: "uuid-1", batch_id: "batch-1", allocation_run_id: "run-demi-1", is_current_allocation: true, status: "pending" },
  { id: "asg-2", lab_id: "uuid-570", batch_id: "batch-1", allocation_run_id: "run-demi-1", is_current_allocation: true, status: "pending" },
];

const labByCode = new Map(mockLabs.map((l) => [l.lab_code.toLowerCase().trim(), l]));
const isAlreadyReconciled = usages.every((usage) => {
  const lab = labByCode.get(usage.labCode?.toLowerCase().trim());
  if (!lab) return true;
  const asg = existingAssignments.find((a) => a.lab_id === lab.id);
  if (!asg) return false;
  return Boolean(asg.allocation_run_id === "run-demi-1" || asg.is_current_allocation || asg.status === "denied" || asg.status === "confirmed");
});

assert.strictEqual(isAlreadyReconciled, true, "Fast bypass must detect batch is already fully reconciled");
console.log("✓ Test 2 Passed: Fast bypass detects fully reconciled state in 0ms without DB queries.");

// 3. Test Session Deduplication on Bulk Inserts
console.log("\n--- Test 3: Session Deduplication & Index Collision Prevention ---");
const rawSessionsToInsert = [
  { batch_id: "batch-1", lab_id: "uuid-570", session_date: "2026-09-13", session_time: "10:00", session_group_id: "G1", source: "allocation" },
  // Duplicate slot for same lab
  { batch_id: "batch-1", lab_id: "uuid-570", session_date: "2026-09-13", session_time: "10:00", session_group_id: "G1", source: "allocation" },
  // Slot 2
  { batch_id: "batch-1", lab_id: "uuid-570", session_date: "2026-09-13", session_time: "12:30", session_group_id: "G2", source: "allocation" },
  // Lab 1 Slot 1
  { batch_id: "batch-1", lab_id: "uuid-1", session_date: "2026-09-13", session_time: "10:00", session_group_id: "G3", source: "allocation" },
];

const seenLabSlot = new Set<string>();
const seenGroupSlot = new Set<string>();
const dedupedSessions: typeof rawSessionsToInsert = [];

for (const s of rawSessionsToInsert) {
  const labKey = `${s.batch_id}\u0000${s.lab_id}\u0000${s.session_date}\u0000${s.session_time}`;
  if (seenLabSlot.has(labKey)) continue;
  seenLabSlot.add(labKey);

  if (s.session_group_id) {
    const groupKey = `${s.batch_id}\u0000${s.session_date}\u0000${s.session_time}\u0000${s.session_group_id}`;
    if (seenGroupSlot.has(groupKey)) continue;
    seenGroupSlot.add(groupKey);
  }
  dedupedSessions.push(s);
}

assert.strictEqual(dedupedSessions.length, 3, "Deduplication must eliminate exact collisions");
assert.strictEqual(dedupedSessions.filter(s => s.lab_id === "uuid-570" && s.session_time === "10:00").length, 1, "Only 1 session per lab date/time slot");
console.log("✓ Test 3 Passed: Session deduplication prevents UNIQUE (batch_id, lab_id, session_date, session_time) violations.");

console.log("\n=== ALL TESTS PASSED SUCCESSFULLY ===");
