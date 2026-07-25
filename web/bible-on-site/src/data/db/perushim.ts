import perushimDB from "./sefaria-dump-5784-sivan-4.perushim.json";

export interface PerushimListItem {
	id: number;
	name: string;
	parshanId: number;
	priority: number;
}

const perushim: PerushimListItem[] = Array.from(perushimDB);

export { perushim };
