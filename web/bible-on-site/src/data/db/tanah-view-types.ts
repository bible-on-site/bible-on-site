// types.ts
interface TimeSegment {
	type: "string";
	pattern: "^\\d{2}:\\d{2}:\\d{2}$";
}

interface Timeframe {
	from: TimeSegment;
	to: TimeSegment;
}

interface KtivSegment {
	type: "ktiv";
	value: string;
	recordingTimeFrame: Timeframe;
}

interface QriSegment {
	type: "qri";
	value: string;
	recordingTimeFrame: Timeframe;
}

interface StumaSegment {
	type: "stuma";
}

interface PtuhaSegment {
	type: "ptuha";
}

type Segment = KtivSegment | QriSegment | StumaSegment | PtuhaSegment;

interface Pasuk {
	segments: Segment[];
}

interface Perek {
	header: string;
	date: number[];
	pesukim: Pasuk[];
}

interface Additionals {
	letter: string;
	name: string;
	tanachUsName: string;
	pesukimCount: number;
	perakim: Perek[];
	perekFrom: number;
	perekTo: number;
}

interface SefarimItem {
	name: string;
	tanachUsName: string;
	helek: string;
	pesukimCount: number;
	perakim: Perek[];
	perekFrom: number;
	perekTo: number;
	additionals: Additionals[];
}

type Sefarim = SefarimItem[];

export type {
	TimeSegment,
	Timeframe,
	KtivSegment,
	QriSegment,
	StumaSegment,
	PtuhaSegment,
	Segment,
	Pasuk,
	Perek,
	Additionals,
	SefarimItem,
	Sefarim,
};
