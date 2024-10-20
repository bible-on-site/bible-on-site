import type { Cycles } from "./cycles-types";
import * as cyclesDB from "./cycles.json";

const cycles: Cycles = Array.from(
  process.env.IS_TEST_ENV
    ? // biome-ignore lint/security/noGlobalEval: for testing environment only
      (eval("require('./cycles.json')") as Cycles)
    : /* istanbul ignore next: will never be reached in testing env */ (cyclesDB as Cycles)
);

export { cycles };
