#!/usr/bin/env node
// Imports verified aliyah boundaries into the shared curated source
// `web/bible-on-site/src/data/parasha/parasha-aliyot.json` (issue #2519).
//
// Source: hebcal-leyning `src/aliyot.json`, pinned to a reviewed commit —
// full-kriyah (Shabbat 7 + maftir) and weekday (3) schemes for all 54
// parashiot and all 7 joined pairs. See docs/data/aliyah-sources.md for
// the provenance/license/coverage audit.
//
//   node devops/import-parasha-aliyot.mjs [--check|--refresh]
//
// The upstream file is vendored at the pinned commit in
// `devops/data-sources/` so the import is deterministic and offline —
// `--refresh` re-fetches upstream and overwrites the vendored copy, and
// `--check` verifies the committed JSON matches what the import would
// produce (pre-commit drift detection).

import { readFileSync, writeFileSync } from "node:fs";
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
// ארץ ישראל; חוקת-בלק joins only in חוץ לארץ, so its context carries a
// restricted applicability marker consumers must surface, not merge.
const JOINS = {
	"Vayakhel-Pekudei": { units: ["Vayakhel", "Pekudei"] },
	"Tazria-Metzora": { units: ["Tazria", "Metzora"] },
	"Achrei Mot-Kedoshim": { units: ["Achrei Mot", "Kedoshim"] },
	"Behar-Bechukotai": { units: ["Behar", "Bechukotai"] },
	"Chukat-Balak": {
		units: ["Chukat", "Balak"],
		applicability: "חוץ לארץ בלבד",
	},
	"Matot-Masei": { units: ["Matot", "Masei"] },
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
			entry.note = `חלוקה חלופית: ${note.slice(NOTE_PREFIX.length)}`;
		}
		return entry;
	});
}

async function main() {
	const division = JSON.parse(readFileSync(DIVISION, "utf8"));
	if (process.argv.includes("--refresh")) {
		const upstream = await (await fetch(HEBCAL_URL)).text();
		writeFileSync(HEBCAL_VENDORED, upstream);
		console.log(`refreshed vendored source at ${HEBCAL_COMMIT}`);
	}
	const hebcal = JSON.parse(readFileSync(HEBCAL_VENDORED, "utf8"));

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
				"Inline 'some sources use' variants are preserved verbatim as aliyah notes.",
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
