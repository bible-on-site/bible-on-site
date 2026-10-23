#!/usr/bin/env node
// Imports verified aliyah boundaries into the shared curated source
// `web/bible-on-site/src/data/parasha/parasha-aliyot.json` (issue #2519).
//
// Sources: hebcal-leyning `src/aliyot.json`, pinned to a reviewed commit —
// full-kriyah (Shabbat 7 + maftir) and weekday (3) schemes for all 54
// parashiot and all 7 joined pairs — plus OpenTorah's tanach `ot-*.xml`
// <week>/<day>/<aliyah> elements (Apache-2.0), from which documented
// minhag alternatives are derived (חב"ד/אשכנז/עדות המזרח Shabbat splits
// and an independent weekday division). See docs/data/aliyah-sources.md
// for the provenance/license/coverage audit.
//
//   node devops/import-parasha-aliyot.mjs [--check|--refresh]
//
// Both upstream files are vendored at pinned commits in
// `devops/data-sources/` so the import is deterministic and offline —
// `--refresh` re-fetches upstream and overwrites the vendored copies,
// and `--check` verifies the committed JSON matches what the import
// would produce (pre-commit drift detection).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(
	ROOT,
	"web/bible-on-site/src/data/parasha/parasha-aliyot.json",
);
const DIVISION = join(
	ROOT,
	"web/bible-on-site/src/data/parasha/parasha-division.json",
);

const HEBCAL_COMMIT = "ec5c7642e3";
const HEBCAL_URL = `https://raw.githubusercontent.com/hebcal/hebcal-leyning/${HEBCAL_COMMIT}/src/aliyot.json`;
const HEBCAL_VENDORED = join(
	HERE,
	`data-sources/hebcal-leyning-aliyot.${HEBCAL_COMMIT}.json`,
);

// OpenTorah carries per-minhag day boundaries (custom="Chabad"/
// "Ashkenaz") and an independent weekday <aliyah> division. The
// vendored extract is regenerated from the five ot-*.xml files on
// --refresh; the file name pins the upstream commit.
const OT_COMMIT = "7308989643";
const OT_VENDORED = join(
	HERE,
	`data-sources/opentorah-tanach-aliyot.${OT_COMMIT}.json`,
);
const OT_RAW_URL = (file) =>
	`https://raw.githubusercontent.com/opentorah/opentorah/${OT_COMMIT}/texts/src/main/resources/org/opentorah/texts/tanach/${file}`;
const OT_BOOKS = {
	Genesis: "ot-genesis.xml",
	Exodus: "ot-Exodus.xml",
	Leviticus: "ot-Leviticus.xml",
	Numbers: "ot-Numbers.xml",
	Deuteronomy: "ot-Deuteronomy.xml",
};

const ORDINAL_LABELS = [
	"ראשון",
	"שני",
	"שלישי",
	"רביעי",
	"חמישי",
	"שישי",
	"שביעי",
];
const MAFTIR_LABEL = "מפטיר";

// Reading id → { constituents in reading order, applicability }. The
// division JSON's joinedReadings.pairs lists the pairs joined in
// ארץ ישראל; חוקת-בלק joins only in חוץ לארץ *and* in מנהג תימן הבלדי
// (which joins it every year instead of מטות-מסעי), so both contexts
// carry applicability markers consumers must surface, not merge.
const JOINS = {
	"Vayakhel-Pekudei": { units: ["Vayakhel", "Pekudei"] },
	"Tazria-Metzora": { units: ["Tazria", "Metzora"] },
	"Achrei Mot-Kedoshim": { units: ["Achrei Mot", "Kedoshim"] },
	"Behar-Bechukotai": { units: ["Behar", "Bechukotai"] },
	"Chukat-Balak": {
		units: ["Chukat", "Balak"],
		applicability: "חוץ לארץ ומנהג תימן הבלדי",
	},
	"Matot-Masei": {
		units: ["Matot", "Masei"],
		applicability: "למעט מנהג תימן הבלדי",
	},
	"Nitzavim-Vayeilech": { units: ["Nitzavim", "Vayeilech"] },
};

const NOTE_PREFIX = "some sources use ";

function aliyahEntries(fullkriyah, schemeId) {
	return Object.entries(fullkriyah).map(([ordinal, [start, end, note]]) => {
		const isMaftir = ordinal === "M";
		const num = isMaftir ? 8 : Number(ordinal);
		if (!isMaftir && (num < 1 || num > ORDINAL_LABELS.length)) {
			throw new Error(`unexpected ${schemeId} ordinal ${ordinal}`);
		}
		const entry = {
			ordinal: num,
			role: isMaftir ? "maftir" : "aliyah",
			label: isMaftir ? MAFTIR_LABEL : ORDINAL_LABELS[num - 1],
			start: {
				perek: Number(start.split(":")[0]),
				pasuk: Number(start.split(":")[1]),
			},
			end: {
				perek: Number(end.split(":")[0]),
				pasuk: Number(end.split(":")[1]),
			},
		};
		if (note?.startsWith(NOTE_PREFIX)) {
			// "some sources use 4:19-26" → an unattributed alternative
			// range (hebcal names no minhag for these two splits); the
			// end perek defaults to the start's when the note elides it.
			const match = /^(\d+):(\d+)-(?:(\d+):)?(\d+)$/.exec(
				note.slice(NOTE_PREFIX.length),
			);
			if (!match) throw new Error(`unparsed variant note: ${note}`);
			entry.alternatives = [
				{
					start: { perek: Number(match[1]), pasuk: Number(match[2]) },
					end: {
						perek: Number(match[3] ?? match[1]),
						pasuk: Number(match[4]),
					},
					source: "hebcal",
				},
			];
		}
		return entry;
	});
}

function parseVerseRef(ref) {
	const [perek, pasuk] = ref.split(":").map(Number);
	return { perek, pasuk };
}

function refStr(ref) {
	return `${ref.perek}:${ref.pasuk}`;
}

// sefer (Hebrew name) → perek → pasuk count, from the same corpus the
// site serves — needed when a variant boundary lands on a perek's
// first pasuk and the previous aliyah ends on the previous perek's
// last (e.g. נח weekday aliyah 3 ends ו:כב before שבת day2 at ז:א).
let perekLengths = null;
function loadPerekLengths() {
	if (perekLengths) return perekLengths;
	const corpusDir = join(ROOT, "web/bible-on-site/src/data/db");
	const corpusFiles = readdirSync(corpusDir).filter((name) =>
		/^sefaria-dump-.+\.tanah_view\.json$/.test(name),
	);
	if (corpusFiles.length !== 1) {
		throw new Error(
			`expected exactly one sefaria-dump-*.tanah_view.json, found ${corpusFiles.length}`,
		);
	}
	const corpus = JSON.parse(
		readFileSync(join(corpusDir, corpusFiles[0]), "utf8"),
	);
	perekLengths = new Map();
	for (const book of corpus) {
		const lengths = new Map();
		for (const [index, perek] of (book.perakim ?? []).entries()) {
			lengths.set(index + 1, perek.pesukim.length);
		}
		perekLengths.set(book.name, lengths);
	}
	return perekLengths;
}

// The pasuk right before `ref` — same perek, or the previous perek's
// last pasuk when the boundary is at its first.
function prevPasuk(seferName, ref) {
	if (ref.pasuk > 1) {
		return { perek: ref.perek, pasuk: ref.pasuk - 1 };
	}
	const last = loadPerekLengths().get(seferName)?.get(ref.perek - 1);
	if (!last) {
		throw new Error(
			`no perek length for ${seferName} ${ref.perek - 1} (boundary ${refStr(ref)})`,
		);
	}
	return { perek: ref.perek - 1, pasuk: last };
}

// Where a variant day-set moves a boundary, BOTH neighbouring aliyot
// change (one end, one start). A span differs from the base exactly
// when its own start moved, or the following day's start moved — so an
// unchanged stretch is skipped *before* any end arithmetic, and the
// −1-pasuk computation only ever runs on a real change (all of which
// resolve inside one perek; see prevPasuk). `lastEnd` is the variant
// set's last-day end: the parasha end for Shabbat sets, the resolved
// third-aliyah end for weekday.
function diffSpans(seferName, baseBoundaries, dayStarts, lastEnd, alternative) {
	const sorted = [...dayStarts.keys()].sort((a, b) => a - b);
	for (let i = 0; i < sorted.length; i++) {
		const n = sorted[i];
		const base = baseBoundaries.find((b) => b.ordinal === n);
		if (!base) continue;
		const start = dayStarts.get(n);
		const nextStart =
			i + 1 < sorted.length ? dayStarts.get(sorted[i + 1]) : null;
		const baseNext = baseBoundaries.find(
			(b) => b.ordinal === n + 1 && b.role === "aliyah",
		);
		const startSame = refStr(start) === refStr(base.start);
		const endSame = nextStart
			? baseNext != null && refStr(nextStart) === refStr(baseNext.start)
			: refStr(lastEnd) === refStr(base.end);
		if (startSame && endSame) continue;
		const end = nextStart ? prevPasuk(seferName, nextStart) : lastEnd;
		addAlternative(base, { start, end, ...alternative });
	}
}

// Dedupes by range — an alternative already emitted (e.g. a hebcal
// note) is enriched with the newer attribution instead of duplicated.
function addAlternative(boundary, alternative) {
	const list = (boundary.alternatives ??= []);
	const existing = list.find(
		(a) =>
			refStr(a.start) === refStr(alternative.start) &&
			refStr(a.end) === refStr(alternative.end),
	);
	if (existing) {
		// Explicit field merge — no wholesale property copying.
		existing.custom ??= alternative.custom;
		existing.source = alternative.source;
	} else {
		list.push(alternative);
	}
}

// OpenTorah source names → the Hebrew minhag label consumers show.
const OT_CUSTOM_LABELS = { Chabad: 'חב"ד', Ashkenaz: "אשכנז" };

// OT's *Common* day-set is the unattributed default; where it differs
// from the imported base on Shabbat it is the documented עדות המזרח
// convention (on מסעי OpenTorah marks our base explicitly as Ashkenaz;
// תרומה's מנורה boundary is the well-known עדות המזרח split). Weekday
// <aliyah> elements are never custom-marked, so weekday alternatives
// stay unattributed.
const OT_COMMON_LABELS = {
	Terumah: "עדות המזרח",
	Masei: "עדות המזרח",
};

// Every distinct custom day-set for a reading: {label → n→start map}.
// A custom-marked day replaces the common start at its ordinal; days
// without a mark keep the common start.
function customDaySets(days) {
	const common = new Map(
		days.filter((d) => !d.custom).map((d) => [d.n, parseVerseRef(d.from)]),
	);
	const sets = new Map();
	for (const day of days.filter((d) => d.custom)) {
		const label = OT_CUSTOM_LABELS[day.custom];
		if (!label) throw new Error(`unknown OpenTorah custom "${day.custom}"`);
		if (!sets.has(label)) sets.set(label, new Map(common));
		sets.get(label).set(day.n, parseVerseRef(day.from));
	}
	return { common, sets };
}

/**
 * Derives `alternatives` on `schemes` (the hebcal base boundaries just
 * built) from the OpenTorah day/aliyah elements of one parasha.
 * `joined` selects combinedDays over days; `hebcalLastEnd` is the base
 * scheme's last-aliyah end for the variant set's last day.
 */
function applyOpenTorahAlternatives(
	readingKey,
	seferName,
	schemes,
	otParasha,
	joined,
) {
	const days = joined ? otParasha.combinedDays : otParasha.days;
	const baseShabbat = schemes.shabbat;
	const lastShabbatEnd = baseShabbat[baseShabbat.length - 1].end;

	const { common, sets } = customDaySets(days);
	diffSpans(seferName, baseShabbat, common, lastShabbatEnd, {
		source: "opentorah",
		...(OT_COMMON_LABELS[readingKey]
			? { custom: OT_COMMON_LABELS[readingKey] }
			: {}),
	});
	for (const [label, dayStarts] of sets) {
		diffSpans(seferName, baseShabbat, dayStarts, lastShabbatEnd, {
			source: "opentorah",
			custom: label,
		});
	}

	if (!joined && schemes.weekday && otParasha.weekday.length) {
		// OT weekday aliyot carry only n=2,3 starts; aliyah 1 opens the
		// parasha and aliyah 3 ends at the explicit `to` or at the OT
		// common first-Shabbat-aliyah end.
		const [a2, a3] = otParasha.weekday;
		if (a2.n !== 2 || a3.n !== 3) {
			throw new Error(`unexpected weekday aliyot in ${readingKey}`);
		}
		const lastWeekdayEnd = a3.to
			? parseVerseRef(a3.to)
			: prevPasuk(seferName, common.get(2));
		diffSpans(
			seferName,
			schemes.weekday,
			new Map([
				[1, parseVerseRef(weekFrom(otParasha))],
				[2, parseVerseRef(a2.from)],
				[3, parseVerseRef(a3.from)],
			]),
			lastWeekdayEnd,
			{ source: "opentorah" },
		);
	}
}

// The parasha's opening verse is the week's own `from` — needed for
// weekday aliyah 1, which OpenTorah leaves implicit.
function weekFrom(otParasha) {
	const day1 = otParasha.days.find((d) => d.n === 1 && !d.custom);
	if (!day1) throw new Error("missing common day 1 in OpenTorah extract");
	return day1.from;
}

// Rebuilds the vendored OpenTorah extract from the five ot-*.xml files:
// each <week> is one parasha (book order = canonical order); its <day>
// elements are Shabbat boundaries (optionally custom- or
// combined-marked) and its <aliyah> elements the weekday split.
async function refreshOpenTorah() {
	const extract = {
		provenance: {
			name: "OpenTorah — tanach ot-*.xml <week>/<day>/<aliyah> elements",
			repository: "https://github.com/opentorah/opentorah",
			license: "Apache-2.0",
			commit: OT_COMMIT,
			retrieved: new Date().toISOString().slice(0, 10),
		},
		parashiot: {},
	};
	let offset = 0;
	for (const [book, file] of Object.entries(OT_BOOKS)) {
		const xml = await (await fetch(OT_RAW_URL(file))).text();
		const weeks = [...xml.matchAll(/<week from="(\d+:\d+)"[^>]*>([\s\S]*?)<\/week>/g)];
		const perBook = BOOK_PARASHA_COUNT[book];
		if (weeks.length !== perBook) {
			throw new Error(`${file}: expected ${perBook} weeks, found ${weeks.length}`);
		}
		weeks.forEach((week, index) => {
			const key = KEYS[offset + index];
			const pick = (attrs) => {
				const element = { n: Number(attrs.n), from: attrs.from };
				if (attrs.to) element.to = attrs.to;
				if (attrs.custom) element.custom = attrs.custom;
				return element;
			};
			const days = [];
			const combinedDays = [];
			const weekday = [];
			for (const m of week[2].matchAll(/<day ([^>]*?)\/>/g)) {
				const attrs = Object.fromEntries(
					[...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
				);
				(attrs.combined === "true" ? combinedDays : days).push(pick(attrs));
			}
			for (const m of week[2].matchAll(/<aliyah ([^>]*?)\/>/g)) {
				weekday.push(
					pick(
						Object.fromEntries(
							[...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
						),
					),
				);
			}
			extract.parashiot[key] = { days, combinedDays, weekday };
		});
		offset += perBook;
	}
	writeFileSync(OT_VENDORED, `${JSON.stringify(extract, null, "\t")}\n`);
	console.log(`refreshed OpenTorah extract at ${OT_COMMIT}`);
}

const BOOK_PARASHA_COUNT = {
	Genesis: 12,
	Exodus: 11,
	Leviticus: 10,
	Numbers: 10,
	Deuteronomy: 11,
};

async function main() {
	const division = JSON.parse(readFileSync(DIVISION, "utf8"));
	if (process.argv.includes("--refresh")) {
		const upstream = await (await fetch(HEBCAL_URL)).text();
		writeFileSync(HEBCAL_VENDORED, upstream);
		console.log(`refreshed vendored source at ${HEBCAL_COMMIT}`);
		await refreshOpenTorah();
	}
	const hebcal = JSON.parse(readFileSync(HEBCAL_VENDORED, "utf8"));
	const opentorah = JSON.parse(readFileSync(OT_VENDORED, "utf8"));

	// Standalone units are ordered 1..54 in both sources — map each unit's
	// Hebrew name/sefer onto the hebcal key at the same index so no manual
	// transliteration table can drift. KEYS (below) defines the canonical
	// order; a hyphen is not a join marker (Lech-Lecha is standalone).
	const standaloneKeys = KEYS;
	if (standaloneKeys.length !== division.units.length) {
		throw new Error(
			`parasha count mismatch: hebcal ${standaloneKeys.length} vs division ${division.units.length}`,
		);
	}

	const readings = [];
	const byHebrewName = new Map();
	division.units.forEach((unit, index) => {
		const key = standaloneKeys[index];
		byHebrewName.set(unit.name, { key, sefer: unit.sefer });
		const entry = hebcal[key];
		const schemes = { shabbat: aliyahEntries(entry.fullkriyah, "shabbat") };
		if (entry.weekday)
			schemes.weekday = aliyahEntries(entry.weekday, "weekday");
		applyOpenTorahAlternatives(
			key,
			unit.sefer,
			schemes,
			opentorah.parashiot[key],
			false,
		);
		readings.push({ id: key, units: [unit.name], sefer: unit.sefer, schemes });
	});

	for (const [joinedId, join] of Object.entries(JOINS)) {
		const entry = hebcal[joinedId];
		if (!entry)
			throw new Error(`joined reading ${joinedId} missing from source`);
		const names = join.units.map((k) => {
			const found = byHebrewName.get(hebrewNameFor(k, division));
			if (!found) throw new Error(`constituent ${k} of ${joinedId} not found`);
			return hebrewNameFor(k, division);
		});
		const sefer = byHebrewName.get(names[0]).sefer;
		const schemes = { shabbat: aliyahEntries(entry.fullkriyah, "shabbat") };
		if (entry.weekday)
			schemes.weekday = aliyahEntries(entry.weekday, "weekday");
		// Combined boundaries span the join: OpenTorah stores the early
		// days on the first constituent's week and the rest on the second's.
		const otJoined = {
			days: [],
			combinedDays: join.units.flatMap(
				(unit) => opentorah.parashiot[unit].combinedDays,
			),
			weekday: [],
		};
		applyOpenTorahAlternatives(joinedId, sefer, schemes, otJoined, true);
		const reading = { id: joinedId, units: names, sefer, schemes };
		if (join.applicability) reading.applicability = join.applicability;
		readings.push(reading);
	}

	const output = {
		version: 1,
		provenance: {
			name: "@hebcal/leyning — src/aliyot.json",
			repository: "https://github.com/hebcal/hebcal-leyning",
			license: "BSD-2-Clause",
			commit: HEBCAL_COMMIT,
			retrieved: "2026-10-23",
			notes: [
				"Full-kriyah Shabbat boundaries and weekday splits for all 54 parashiot and 7 joined pairs.",
				"Cross-validated against Sefaria /api/sheets/{parasha}/get_aliyot: identical on every parasha Sefaria serves (its endpoint lacks Achrei Mot-Kedoshim, Nitzavim-Vayeilech and several standalone parashot).",
				"Maftir is the plain repeated-tail reading; seasonal maftir overrides (e.g. HaChodesh) are a calendar concern, not stored here.",
				"Alternative divisions are structured per-aliyah `alternatives` ranges: hebcal's inline 'some sources use' notes plus the per-minhag <day custom=…> and weekday <aliyah> divisions of OpenTorah (Apache-2.0, commit 7308989643).",
			],
		},
		schemes: [
			{ id: "shabbat", label: "שבת", description: "מניין שבעה עולים ומפטיר" },
			{
				id: "weekday",
				label: "חול",
				description: "מניין שלושה עולים בקריאת הציבור בחול",
			},
		],
		readings,
	};

	const text = `${JSON.stringify(output, null, "\t")}\n`;
	if (process.argv.includes("--check")) {
		const current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
		if (current !== text) {
			console.error(
				"parasha-aliyot.json is out of date — rerun devops/import-parasha-aliyot.mjs",
			);
			process.exit(1);
		}
		console.log("parasha-aliyot.json is up to date");
		return;
	}
	writeFileSync(OUT, text);
	console.log(`wrote ${readings.length} readings → ${OUT}`);
}

const KEYS = [
	"Bereshit",
	"Noach",
	"Lech-Lecha",
	"Vayera",
	"Chayei Sara",
	"Toldot",
	"Vayetzei",
	"Vayishlach",
	"Vayeshev",
	"Miketz",
	"Vayigash",
	"Vayechi",
	"Shemot",
	"Vaera",
	"Bo",
	"Beshalach",
	"Yitro",
	"Mishpatim",
	"Terumah",
	"Tetzaveh",
	"Ki Tisa",
	"Vayakhel",
	"Pekudei",
	"Vayikra",
	"Tzav",
	"Shmini",
	"Tazria",
	"Metzora",
	"Achrei Mot",
	"Kedoshim",
	"Emor",
	"Behar",
	"Bechukotai",
	"Bamidbar",
	"Nasso",
	"Beha'alotcha",
	"Sh'lach",
	"Korach",
	"Chukat",
	"Balak",
	"Pinchas",
	"Matot",
	"Masei",
	"Devarim",
	"Vaetchanan",
	"Eikev",
	"Re'eh",
	"Shoftim",
	"Ki Teitzei",
	"Ki Tavo",
	"Nitzavim",
	"Vayeilech",
	"Ha'azinu",
	"Vezot Haberakhah",
];

// English key → the division JSON's Hebrew unit name, via canonical order.
// Kept as an explicit table (not index pairing) so a mistake fails loudly.
function hebrewNameFor(englishKey, division) {
	const ORDER = [
		"בראשית",
		"נח",
		"לך לך",
		"וירא",
		"חיי שרה",
		"תולדות",
		"ויצא",
		"וישלח",
		"וישב",
		"מקץ",
		"ויגש",
		"ויחי",
		"שמות",
		"וארא",
		"בא",
		"בשלח",
		"יתרו",
		"משפטים",
		"תרומה",
		"תצוה",
		"כי תשא",
		"ויקהל",
		"פקודי",
		"ויקרא",
		"צו",
		"שמיני",
		"תזריע",
		"מצורע",
		"אחרי מות",
		"קדושים",
		"אמור",
		"בהר",
		"בחוקותי",
		"במדבר",
		"נשא",
		"בהעלתך",
		"שלח",
		"קרח",
		"חוקת",
		"בלק",
		"פינחס",
		"מטות",
		"מסעי",
		"דברים",
		"ואתחנן",
		"עקב",
		"ראה",
		"שופטים",
		"כי תצא",
		"כי תבוא",
		"נצבים",
		"וילך",
		"האזינו",
		"וזאת הברכה",
	];
	const index = KEYS.indexOf(englishKey);
	if (index < 0) throw new Error(`unknown parasha key ${englishKey}`);
	const name = ORDER[index];
	if (division.units[index].name !== name) {
		throw new Error(
			`name table drift at index ${index}: ${name} vs ${division.units[index].name}`,
		);
	}
	return name;
}

await main();
