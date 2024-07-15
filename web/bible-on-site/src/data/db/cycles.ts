import type { Cycles } from "./cycles-types.ts";
import * as cyclesDB from "./cycles.json";

const cycles: Cycles = Array.from(
  process.env.IS_TEST_ENV
    ? (eval("require('./cycles.json')") as Cycles)
    : /* istanbul ignore next: will never be reached in testing env */ (cyclesDB as Cycles),
);

export { cycles };
