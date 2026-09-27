import { fairBalancedDistribute } from "../distribute";

console.log("Unit test 1 (22 into [20, 20]):", fairBalancedDistribute(22, [20, 20]));
console.log("Unit test 2 (30 into [25, 25]):", fairBalancedDistribute(30, [25, 25]));
console.log("Unit test 3 (25 into [10, 20]):", fairBalancedDistribute(25, [10, 20]));
console.log("Unit test 4 (70 into [25, 25, 25]):", fairBalancedDistribute(70, [25, 25, 25]));
