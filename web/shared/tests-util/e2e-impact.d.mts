import type { Reporter, TestInfo } from "@playwright/test";

export declare function impactEvidenceDir(): string | null;
export declare function impactIdParts(titlePath: string[]): {
	project: string;
	file: string;
	titlePath: string[];
};
export declare function impactTestId(titlePath: string[]): string;
export declare function dumpImpactCoverage(
	testInfo: TestInfo,
	realm: "browser" | "server",
	coverage: Record<string, unknown>,
): void;

declare const reporter: new () => Reporter;
export default reporter;
