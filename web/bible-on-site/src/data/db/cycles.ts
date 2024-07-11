import type { Cycles } from "./cycles-types";
import * as cyclesDB from "./cycles.json";

const cycles: Cycles = Array.from(
  process.env.IS_TEST_ENV
    ? (eval("require('./cycles.json')") as Cycles)
    : (cyclesDB as Cycles)
);

export { cycles };
