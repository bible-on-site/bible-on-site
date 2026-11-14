import type { MoedSummary } from "./types";

/**
 * מעגל השנה geometry (#3101, PR #3131 redesign): the wheel is a real
 * annual chart — every published moed gets an equal-arc sector in annual
 * order (opening at the top, clockwise), contiguous same-month sectors
 * merge into one coloured month band on the outer rim, and the moed name
 * radiates along its spoke. Everything here is pure data — no DOM — so
 * the model is unit-tested; page.tsx only paints it.
 */

/** Canonical Hebrew year, opening at תשרי where the catalogue opens. */
export const HEBREW_MONTHS = [
	"תשרי",
	"חשון",
	"כסלו",
	"טבת",
	"שבט",
	"אדר",
	"ניסן",
	"אייר",
	"סיון",
	"תמוז",
	"אב",
	"אלול",
] as const;

export type HebrewMonth = (typeof HEBREW_MONTHS)[number];

/**
 * One hue per month — seasonal but deliberately varied so neighbouring
 * months never read as the same band. Wheel fills derive every tint
 * (sector, band, index marker) from this single hue in the CSS.
 */
export const MONTH_HUES: Record<HebrewMonth, number> = {
	תשרי: 38, // harvest gold — סוכות וראש השנה
	חשון: 22, // late-autumn ochre
	כסלו: 198, // first-rains teal
	טבת: 232, // mid-winter indigo
	שבט: 152, // sapling green — ט"ו בשבט
	אדר: 330, // פורים magenta
	ניסן: 118, // spring green
	אייר: 212, // flag sky — יום העצמאות
	סיון: 266, // Torah royal violet — שבועות
	תמוז: 14, // summer ember
	אב: 348, // mourning crimson — תשעה באב
	אלול: 288, // selichot purple
};

/** Band key for moadim with no resolvable month (test fixtures, drafts). */
export const OTHER_BAND_KEY = "__moadim_no_month__";
export const OTHER_BAND_LABEL = "מועדים נוספים";

/**
 * Resolve the stored `hebrew_month` to a band key. Exact canonical names
 * win; a composite value ('אדר ב', 'כסלו-טבת') resolves to the earliest
 * canonical month it contains; anything else keeps its literal text as a
 * distinct band; `null` groups into the "other" band.
 */
export function monthKeyOf(hebrewMonth: string | null): string {
	if (hebrewMonth == null || hebrewMonth.trim() === "") {
		return OTHER_BAND_KEY;
	}
	const stored = hebrewMonth.trim();
	if ((HEBREW_MONTHS as readonly string[]).includes(stored)) {
		return stored;
	}
	let best: { month: HebrewMonth; at: number } | null = null;
	for (const month of HEBREW_MONTHS) {
		const at = stored.indexOf(month);
		if (at >= 0 && (best == null || at < best.at)) {
			best = { month, at };
		}
	}
	return best?.month ?? stored;
}

/** The band's hue — canonical months only; everything else is neutral. */
export function bandHue(bandKey: string): number | null {
	return (HEBREW_MONTHS as readonly string[]).includes(bandKey)
		? MONTH_HUES[bandKey as HebrewMonth]
		: null;
}

/** One moed sector on the wheel — equal arc for every published moed. */
export interface WheelSlice {
	moed: MoedSummary;
	bandKey: string;
	hue: number | null;
	/** Degrees, clockwise from twelve o'clock. */
	startDeg: number;
	endDeg: number;
	midDeg: number;
}

/** A contiguous run of same-month slices — the outer coloured band. */
export interface WheelBand {
	key: string;
	label: string;
	hue: number | null;
	startDeg: number;
	endDeg: number;
	midDeg: number;
}

export interface MoedWheel {
	slices: WheelSlice[];
	bands: WheelBand[];
}

/**
 * Lay the catalogue around the circle: slices keep the stored annual
 * order verbatim; bands are the maximal contiguous runs of one month.
 * A moed never moves to "fix" a month order — the data decides.
 */
export function buildMoedWheel(moadim: MoedSummary[]): MoedWheel {
	const total = Math.max(moadim.length, 1);
	const step = 360 / total;
	const slices: WheelSlice[] = moadim.map((moed, index) => {
		const bandKey = monthKeyOf(moed.hebrewMonth);
		const startDeg = index * step;
		const endDeg = (index + 1) * step;
		return {
			moed,
			bandKey,
			hue: bandHue(bandKey),
			startDeg,
			endDeg,
			midDeg: (startDeg + endDeg) / 2,
		};
	});
	const bands: WheelBand[] = [];
	for (const slice of slices) {
		const last = bands[bands.length - 1];
		if (last && last.key === slice.bandKey) {
			last.endDeg = slice.endDeg;
			last.midDeg = (last.startDeg + last.endDeg) / 2;
		} else {
			bands.push({
				key: slice.bandKey,
				label:
					slice.bandKey === OTHER_BAND_KEY
						? OTHER_BAND_LABEL
						: slice.bandKey,
				hue: slice.hue,
				startDeg: slice.startDeg,
				endDeg: slice.endDeg,
				midDeg: slice.midDeg,
			});
		}
	}
	return { slices, bands };
}

/** [x, y] on the circle — deg is clockwise from twelve o'clock. */
export function polar(
	cx: number,
	cy: number,
	r: number,
	deg: number,
): [number, number] {
	const rad = (deg * Math.PI) / 180;
	return [
		round2(cx + r * Math.sin(rad)),
		round2(cy - r * Math.cos(rad)),
	];
}

/**
 * Annulus-sector path between radii r0 < r1 and angles a0 → a1
 * (clockwise from twelve). A ~full-circle slice is emitted as two arcs —
 * a single arc cannot close on itself.
 */
export function sectorPath(
	cx: number,
	cy: number,
	r0: number,
	r1: number,
	a0: number,
	a1: number,
): string {
	const pt = (r: number, deg: number) => polar(cx, cy, r, deg).join(" ");
	const span = a1 - a0;
	const large = span > 180 ? 1 : 0;
	if (span >= 359.99) {
		const mid = a0 + 180;
		return [
			`M ${pt(r1, a0)}`,
			`A ${r1} ${r1} 0 0 1 ${pt(r1, mid)}`,
			`A ${r1} ${r1} 0 0 1 ${pt(r1, a0)}`,
			`M ${pt(r0, a0)}`,
			`A ${r0} ${r0} 0 0 0 ${pt(r0, mid)}`,
			`A ${r0} ${r0} 0 0 0 ${pt(r0, a0)}`,
			"Z",
		].join(" ");
	}
	return [
		`M ${pt(r1, a0)}`,
		`A ${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)}`,
		`L ${pt(r0, a1)}`,
		`A ${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)}`,
		"Z",
	].join(" ");
}

/**
 * Baseline rotation for a spoke label (moed name along its radius).
 * Right-half spokes read hub-ward, left-half read rim-ward — the classic
 * astrolabe layout — so no glyph ever sits upside down. Returns [0,360).
 */
export function spokeRotation(midDeg: number): number {
	const deg = ((midDeg % 360) + 360) % 360;
	return (((deg <= 180 ? deg - 90 : deg + 90) % 360) + 360) % 360;
}

/**
 * Baseline rotation for a band label (month name along the rim tangent),
 * kept within ±90° so it stays upright on both halves.
 */
export function bandRotation(midDeg: number): number {
	const deg = ((midDeg % 360) + 360) % 360;
	return deg <= 90 || deg > 270 ? deg : deg - 180;
}

/**
 * Split a moed name into at most two spoke lines at the word boundary
 * closest to balanced — short names stay one line.
 */
export function wrapMoedName(name: string, maxSingleLine = 12): string[] {
	const trimmed = name.trim();
	if (trimmed.length <= maxSingleLine) {
		return [trimmed];
	}
	const words = trimmed.split(/\s+/);
	if (words.length === 1) {
		return [trimmed];
	}
	let bestAt = 1;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let i = 1; i < words.length; i++) {
		const first = words.slice(0, i).join(" ").length;
		const second = trimmed.length - first - 1;
		const score = Math.max(first, second);
		if (score < bestScore) {
			bestScore = score;
			bestAt = i;
		}
	}
	return [
		words.slice(0, bestAt).join(" "),
		words.slice(bestAt).join(" "),
	];
}

/** Center-hub מגן דוד — two interlaced triangles as a single path. */
export function starOfDavidPath(cx: number, cy: number, r: number): string {
	const tri = (phase: number) =>
		[0, 1, 2]
			.map((i) => {
				const rad = ((phase + i * 120) * Math.PI) / 180;
				return `${round2(cx + r * Math.sin(rad))} ${round2(cy - r * Math.cos(rad))}`;
			})
			.join(" L ");
	return `M ${tri(0)} Z M ${tri(180)} Z`;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
