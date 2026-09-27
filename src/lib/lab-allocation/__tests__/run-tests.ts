import { runTestSuite } from "./allocation.test";

const result = runTestSuite();
console.log(`\n========================================`);
console.log(`LAB ALLOCATION TEST SUITE RESULTS:`);
console.log(`Passed: ${result.passed}`);
console.log(`Failed: ${result.failed}`);
if (result.failed > 0) {
  console.log(`\nERRORS:`);
  result.errors.forEach((err) => console.error(err));
  process.exit(1);
} else {
  console.log(`ALL TESTS PASSED SUCCESSFULLY!`);
  console.log(`========================================\n`);
  process.exit(0);
}
