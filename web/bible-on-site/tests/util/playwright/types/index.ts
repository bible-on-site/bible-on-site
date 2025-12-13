interface TestConfigWebServer {
	command: string;
	cwd?: string;
	env?: { [key: string]: string };
	gracefulShutdown?: {
		signal: "SIGINT" | "SIGTERM";

		timeout: number;
	};
	ignoreHTTPSErrors?: boolean;
	name?: string;
	port?: number;
	reuseExistingServer?: boolean;
	stderr?: "pipe" | "ignore";
	stdout?: "pipe" | "ignore";
	wait?: {
		stdout?: RegExp;
		stderr?: RegExp;
	};
	timeout?: number;
	url?: string;
}
export enum TestType {
	E2E = "e2e",
	PERF = "perf",
	UNIT = "unit",
}

export type { TestConfigWebServer };
