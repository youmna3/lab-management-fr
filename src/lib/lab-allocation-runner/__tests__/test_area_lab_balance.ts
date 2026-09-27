import { balancedDistribute, fairBalancedDistribute } from "../distribute";
import { compareSlotsChronologically } from "../master";
import type { AugmentedSession } from "../distribute";

// Test 1: Area with 2 labs (Lab A and Lab B), each with 1 session of capacity 20, with 22 students in Grade 5
const slotA: AugmentedSession = {
  Area: "Nasr City",
  Grade: 5,
  "Lab ID": "Lab_A",
  True_Capacity: 20,
  Slot_Key: "Nasr_City__Lab_A__Slot1",
  Day: "Thu",
  Session: "Session 1",
  Time_Slot: "10:00 AM",
  Slot_Num: 1,
  Slot_Label: "10:00 AM",
};

const slotB: AugmentedSession = {
  Area: "Nasr City",
  Grade: 5,
  "Lab ID": "Lab_B",
  True_Capacity: 20,
  Slot_Key: "Nasr_City__Lab_B__Slot1",
  Day: "Thu",
  Session: "Session 1",
  Time_Slot: "10:00 AM",
  Slot_Num: 1,
  Slot_Label: "10:00 AM",
};

const res = balancedDistribute(22, [slotA, slotB]);
console.log("=== AREA WITH 2 LABS (22 STUDENTS ACROSS TWO 20-CAP LABS) ===");
console.log("Lab A count:", res.assigned.get(slotA.Slot_Key));
console.log("Lab B count:", res.assigned.get(slotB.Slot_Key));
console.log("Leftover:", res.leftover);

// Test 2: Area with 3 labs of capacities 25, 25, 25 and 46 students in Grade 4
const slot1: AugmentedSession = { ...slotA, "Lab ID": "Lab_1", Slot_Key: "L1", True_Capacity: 25 };
const slot2: AugmentedSession = { ...slotA, "Lab ID": "Lab_2", Slot_Key: "L2", True_Capacity: 25 };
const slot3: AugmentedSession = { ...slotA, "Lab ID": "Lab_3", Slot_Key: "L3", True_Capacity: 25 };

const res3 = balancedDistribute(46, [slot1, slot2, slot3]);
console.log("\n=== AREA WITH 3 LABS (46 STUDENTS ACROSS THREE 25-CAP LABS) ===");
console.log("Lab 1 count:", res3.assigned.get("L1"));
console.log("Lab 2 count:", res3.assigned.get("L2"));
console.log("Lab 3 count:", res3.assigned.get("L3"));
console.log("Leftover:", res3.leftover);
