import type { Cycles } from "./cycles-types";
import * as cyclesDB from "./cycles.json";

const cycles = Array.from(
	process.env.IS_TEST_ENV
		? eval("require('./cycles.json')")
		: (cyclesDB as never),
) as Cycles;

export { cycles };
