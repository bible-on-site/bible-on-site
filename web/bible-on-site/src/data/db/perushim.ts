import * as perushimDB from "./sefaria-dump-5784-sivan-4.perushim.json";

export interface PerushimListItem {
	id: number;
	name: string;
	parshanId: number;
	priority: number;
}

const perushim: PerushimListItem[] = Array.from(
	process.env.IS_TEST_ENV
		? // biome-ignore lint/security/noGlobalEval: didn't manage to ignore for the entire directory. this code runs just in testing env
			(eval(
				"require('./sefaria-dump-5784-sivan-4.perushim.json')",
			) as PerushimListItem[])
		: /* istanbul ignore next: will never be reached in testing env */ (perushimDB as unknown as PerushimListItem[]),
);

export { perushim };
