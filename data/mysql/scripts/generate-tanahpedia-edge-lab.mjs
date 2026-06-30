/**
 * Generates data/mysql/tanahpedia_family_edge_lab_data.sql
 * Run: node data/mysql/scripts/generate-tanahpedia-edge-lab.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IDS = {
	bio: "40000000-0000-0000-0000-000000000001",
	adopt: "40000000-0000-0000-0000-000000000002",
	step: "40000000-0000-0000-0000-000000000003",
	foster: "40000000-0000-0000-0000-000000000004",
	father: "50000000-0000-0000-0000-000000000001",
	mother: "50000000-0000-0000-0000-000000000002",
	marriage: "20000000-0000-0000-0000-000000000001",
	pilegesh: "20000000-0000-0000-0000-000000000002",
	forbidden: "20000000-0000-0000-0000-000000000003",
	incest: "20000000-0000-0000-0000-000000000004",
	betrothal: "20000000-0000-0000-0000-000000000005",
	death: "30000000-0000-0000-0000-000000000001",
	divorce: "30000000-0000-0000-0000-000000000002",
};

const pad = (n, w = 12) => String(n).padStart(w, "0");
const E = (n) => `e3000000-0000-4000-8000-${pad(n)}`;
const P = (n) => `p3000000-0000-4000-8000-${pad(n)}`;
const EA = (n) => `ea300000-0000-4000-8000-${pad(n)}`;
const EE = (n) => `ee300000-0000-4000-8000-${pad(n)}`;
const AG = (n) => `ag300000-0000-4000-8000-${pad(n)}`;

class Lab {
	constructor(
		num,
		slug,
		title,
		sex,
		{ parents = [], spouses = [], children = [], siblings = [] } = {},
	) {
		this.num = num;
		this.slug = slug;
		this.title = title;
		this.sex = sex;
		this.parents = parents;
		this.spouses = spouses;
		this.children = children;
		this.siblings = siblings;
	}
}

/** @type {Lab[]} */
const labs = [];

let supportN = 1000;
let pcN = 1;
let uN = 1;

function nextSupport(name) {
	const n = supportN++;
	return { e: E(n), p: P(n), name };
}

function addLab(lab) {
	labs.push(lab);
}

// ——— Build scenarios (40 focal entries) ———

addLab(
	new Lab(1, "tanahpedia-lab-01-two-bio-parents", "מעבדה 01 — אב ואם ביולוגיים", "MALE", {
		parents: [
			{ role: "father", type: "bio", name: "אב דמו 01" },
			{ role: "mother", type: "bio", name: "אם דמו 01" },
		],
	}),
);

addLab(
	new Lab(2, "tanahpedia-lab-02-father-only", "מעבדה 02 — אב ביולוגי בלבד", "MALE", {
		parents: [{ role: "father", type: "bio", name: "אב דמו 02" }],
	}),
);

addLab(
	new Lab(3, "tanahpedia-lab-03-mother-only", "מעבדה 03 — אם ביולוגית בלבד", "MALE", {
		parents: [{ role: "mother", type: "bio", name: "אם דמו 03" }],
	}),
);

addLab(
	new Lab(
		4,
		"tanahpedia-lab-04-alt-two-fathers",
		"מעבדה 04 — שני אבות בחלופי (alt_group)",
		"MALE",
		{
			parents: [
				{ role: "father", type: "bio", name: "אב חלופי א׳", alt: 1 },
				{ role: "father", type: "bio", name: "אב חלופי ב׳", alt: 2 },
			],
		},
	),
);

addLab(
	new Lab(
		5,
		"tanahpedia-lab-05-stepfather-bio-mother",
		"מעבדה 05 — אב חורג + אם ביולוגית",
		"MALE",
		{
			parents: [
				{ role: "father", type: "step", name: "אב חורג 05" },
				{ role: "mother", type: "bio", name: "אם ביולוגית 05" },
			],
		},
	),
);

addLab(
	new Lab(
		6,
		"tanahpedia-lab-06-adoptive-mother",
		"מעבדה 06 — אם מאימוץ + אב ביולוגי",
		"MALE",
		{
			parents: [
				{ role: "father", type: "bio", name: "אב ביולוגי 06" },
				{ role: "mother", type: "adopt", name: "אם מאימוץ 06" },
			],
		},
	),
);

addLab(
	new Lab(7, "tanahpedia-lab-07-foster-father", "מעבדה 07 — אב אומנה (FOSTER)", "MALE", {
		parents: [
			{ role: "father", type: "foster", name: "אב אומנה 07" },
			{ role: "mother", type: "bio", name: "אם ביולוגית 07" },
		],
	}),
);

addLab(
	new Lab(8, "tanahpedia-lab-08-one-marriage", "מעבדה 08 — בת זוג אחת (נישואין)", "MALE", {
		spouses: [{ type: "marriage", order: 1, name: "בת זוג 08" }],
	}),
);

addLab(
	new Lab(
		9,
		"tanahpedia-lab-09-two-wives-ordered",
		"מעבדה 09 — שתי נשים נישואין (סדר 1 ו־2)",
		"MALE",
		{
			spouses: [
				{ type: "marriage", order: 1, name: "אשה ראשונה 09" },
				{ type: "marriage", order: 2, name: "אשה שנייה 09" },
			],
		},
	),
);

addLab(
	new Lab(
		10,
		"tanahpedia-lab-10-wife-and-pilegesh",
		"מעבדה 10 — אישה ופילגש (סדר)",
		"MALE",
		{
			spouses: [
				{ type: "marriage", order: 1, name: "אשה 10" },
				{ type: "pilegesh", order: 2, name: "פילגש 10" },
			],
		},
	),
);

addLab(
	new Lab(
		11,
		"tanahpedia-lab-11-dual-opinion-fused",
		"מעבדה 11 — אותה בת זוג: נישואין + קשר פסול (ממוזג)",
		"MALE",
		{
			spouses: [
				{
					type: "marriage",
					order: 1,
					name: "בת זוג דו־שיטתית",
					cite: "הרמב״ם — דוגמה",
				},
				{
					type: "forbidden",
					order: 1,
					name: "בת זוג דו־שיטתית",
					cite: "רש״י — דוגמה",
				},
			],
		},
	),
);

addLab(
	new Lab(
		12,
		"tanahpedia-lab-12-dual-opinion-split-order",
		"מעבדה 12 — נישואין + פסול ללא אותו סדר (שני כרטיסים)",
		"MALE",
		{
			spouses: [
				{ type: "marriage", order: 1, name: "אותה אישה 12" },
				{ type: "forbidden", order: 2, name: "אותה אישה 12" },
			],
		},
	),
);

addLab(
	new Lab(
		13,
		"tanahpedia-lab-13-spouse-alt-identities",
		"מעבדה 13 — שתי זהויות בת זוג בחלופי (alt_group)",
		"MALE",
		{
			spouses: [
				{ type: "marriage", order: 1, name: "זהות א׳ לבת זוג", alt: 1 },
				{ type: "marriage", order: 1, name: "זהות ב׳ לבת זוג", alt: 2 },
			],
		},
	),
);

addLab(
	new Lab(
		14,
		"tanahpedia-lab-14-female-focal-husband",
		"מעבדה 14 — מוקדת נקבה + בן זוג (כותרת בני זוג)",
		"FEMALE",
		{
			spouses: [{ type: "marriage", order: 1, name: "בעל 14" }],
		},
	),
);

addLab(
	new Lab(
		15,
		"tanahpedia-lab-15-unknown-sex-spouse",
		"מעבדה 15 — מין מוקד לא ידוע + זיווג (כותרת נייטרלית)",
		null,
		{
			spouses: [{ type: "marriage", order: 1, name: "בן־בת זוג 15" }],
		},
	),
);

addLab(
	new Lab(16, "tanahpedia-lab-16-one-bio-child", "מעבדה 16 — ילד ביולוגי אחד", "MALE", {
		children: [{ role: "father", type: "bio", name: "ילד 16" }],
	}),
);

addLab(
	new Lab(17, "tanahpedia-lab-17-adoptive-child", "מעבדה 17 — ילד מאימוץ", "MALE", {
		children: [{ role: "father", type: "adopt", name: "ילד מאומץ 17" }],
	}),
);

addLab(
	new Lab(18, "tanahpedia-lab-18-step-child", "מעבדה 18 — ילד חורג (מנקודת המוקד)", "MALE", {
		children: [{ role: "father", type: "step", name: "ילד חורג 18" }],
	}),
);

addLab(
	new Lab(
		19,
		"tanahpedia-lab-19-child-two-relations",
		"מעבדה 19 — אותו ילד: שני קשרים שונים (ביולוגי + חורג)",
		"MALE",
		{
			children: [
				{ role: "father", type: "bio", name: "ילד כפול 19" },
				{ role: "father", type: "step", name: "ילד כפול 19" },
			],
		},
	),
);

addLab(
	new Lab(
		20,
		"tanahpedia-lab-20-children-alt-paternity",
		"מעבדה 20 — ילדים בחלופי (שני אבות אפשריים)",
		"MALE",
		{
			children: [
				{ role: "father", type: "bio", name: "ילד חלופי", alt: 1 },
				{ role: "father", type: "bio", name: "ילד חלופי", alt: 2 },
			],
		},
	),
);

addLab(
	new Lab(
		21,
		"tanahpedia-lab-21-siblings-shared-parents",
		"מעבדה 21 — שני אחים מלאים",
		"MALE",
		{
			parents: [
				{ role: "father", type: "bio", name: "אב משותף 21" },
				{ role: "mother", type: "bio", name: "אם משותפת 21" },
			],
			siblings: [{ name: "אח 21" }],
		},
	),
);

addLab(
	new Lab(
		22,
		"tanahpedia-lab-22-half-sibling",
		"מעבדה 22 — אחים מחצה (אב משותף)",
		"MALE",
		{
			parents: [{ role: "father", type: "bio", name: "אב משותף 22" }],
			siblings: [{ name: "אח מחצה 22", mother: "אם אחרת 22" }],
		},
	),
);

addLab(
	new Lab(
		23,
		"tanahpedia-lab-23-many-siblings",
		"מעבדה 23 — חמישה אחים (פריסה)",
		"MALE",
		{
			parents: [
				{ role: "father", type: "bio", name: "אב 23" },
				{ role: "mother", type: "bio", name: "אם 23" },
			],
			siblings: [
				{ name: "אח א׳ 23" },
				{ name: "אח ב׳ 23" },
				{ name: "אח ג׳ 23" },
				{ name: "אח ד׳ 23" },
				{ name: "אח ה׳ 23" },
			],
		},
	),
);

addLab(
	new Lab(
		24,
		"tanahpedia-lab-24-union-ended-death",
		"מעבדה 24 — זיווג שסיים בפטירה + תאריכים",
		"MALE",
		{
			spouses: [
				{
					type: "marriage",
					order: 1,
					name: "בת זוג נפטרת",
					end: IDS.death,
					startDate: 18000101,
					endDate: 18500101,
				},
			],
		},
	),
);

addLab(
	new Lab(
		25,
		"tanahpedia-lab-25-union-divorce",
		"מעבדה 25 — זיווג שסיים בגירושין",
		"MALE",
		{
			spouses: [
				{
					type: "marriage",
					order: 1,
					name: "בת זוג גרושה",
					end: IDS.divorce,
					startDate: 19000101,
					endDate: 19100101,
				},
			],
		},
	),
);

addLab(
	new Lab(26, "tanahpedia-lab-26-betrothal", "מעבדה 26 — אירוסין בלבד (BETROTHAL)", "MALE", {
		spouses: [{ type: "betrothal", order: 1, name: "מאורסת 26" }],
	}),
);

addLab(
	new Lab(27, "tanahpedia-lab-27-banned-incest-union", "מעבדה 27 — קשר אסור ערוה (דמו)", "MALE", {
		spouses: [{ type: "incest", order: 1, name: "דמו ערוה 27", cite: "דמו מעבדה בלבד" }],
	}),
);

addLab(
	new Lab(28, "tanahpedia-lab-28-pilegesh-alone", "מעבדה 28 — פילגש בלבד", "MALE", {
		spouses: [{ type: "pilegesh", order: 1, name: "פילגש 28" }],
	}),
);

addLab(
	new Lab(
		29,
		"tanahpedia-lab-29-spouses-no-parents",
		"מעבדה 29 — שני זיווגים בלי הורים במודל",
		"MALE",
		{
			spouses: [
				{ type: "marriage", order: 1, name: "ראשונה 29" },
				{ type: "marriage", order: 2, name: "שנייה 29" },
			],
		},
	),
);

addLab(
	new Lab(
		30,
		"tanahpedia-lab-30-parents-children-no-spouse",
		"מעבדה 30 — הורים + ילדים בלי בת זוג במודל",
		"MALE",
		{
			parents: [
				{ role: "father", type: "bio", name: "אב 30" },
				{ role: "mother", type: "bio", name: "אם 30" },
			],
			children: [{ role: "father", type: "bio", name: "ילד 30" }],
		},
	),
);

addLab(
	new Lab(
		31,
		"tanahpedia-lab-31-citation-on-parent",
		"מעבדה 31 — מקור על קשר הורה בלבד",
		"MALE",
		{
			parents: [
				{
					role: "father",
					type: "bio",
					name: "אב עם מקור",
					cite: "דוגמה למקור על קשר אב־בן",
				},
				{ role: "mother", type: "bio", name: "אם 31" },
			],
		},
	),
);

addLab(
	new Lab(
		32,
		"tanahpedia-lab-32-unlinked-child",
		"מעבדה 32 — ילד בלי רשומת כניסה (שם בלבד)",
		"MALE",
		{
			children: [
				{ role: "father", type: "bio", name: "ילד ללא ערך", noEntry: true },
			],
		},
	),
);

addLab(
	new Lab(
		33,
		"tanahpedia-lab-33-unlinked-spouse",
		"מעבדה 33 — בת זוג בלי רשומת כניסה",
		"MALE",
		{
			spouses: [{ type: "marriage", order: 1, name: "בת זוג ללא ערך", noEntry: true }],
		},
	),
);

addLab(
	new Lab(
		34,
		"tanahpedia-lab-34-triple-union-types",
		"מעבדה 34 — שלוש קורות טיב לבת זוג אחת",
		"MALE",
		{
			spouses: [
				{
					type: "marriage",
					order: 1,
					name: "בת זוג משולשת",
					cite: "נישואין",
					alt: 1,
				},
				{
					type: "forbidden",
					order: 1,
					name: "בת זוג משולשת",
					cite: "פסול גוי",
					alt: 1,
				},
				{
					type: "incest",
					order: 1,
					name: "בת זוג משולשת",
					cite: "דמו ערוה",
					alt: 1,
				},
			],
		},
	),
);

addLab(
	new Lab(
		35,
		"tanahpedia-lab-35-marriage-plus-betrothal",
		"מעבדה 35 — נישואין + אירוסין (חלופי דעות)",
		"MALE",
		{
			spouses: [
				{ type: "marriage", order: 1, name: "אישה 35", cite: "נשואה" },
				{ type: "betrothal", order: 1, name: "אישה 35", cite: "מאורסת בלבד" },
			],
		},
	),
);

addLab(
	new Lab(
		36,
		"tanahpedia-lab-36-parent-bio-and-step-same-side",
		"מעבדה 36 — אב ביולוגי + אב חורג (שני קשרים)",
		"MALE",
		{
			parents: [
				{ role: "father", type: "bio", name: "אב ביולוגי 36" },
				{ role: "father", type: "step", name: "אב חורג 36" },
				{ role: "mother", type: "bio", name: "אם 36" },
			],
		},
	),
);

addLab(
	new Lab(
		37,
		"tanahpedia-lab-37-child-foster",
		"מעבדה 37 — ילד באומנה",
		"MALE",
		{
			children: [{ role: "father", type: "foster", name: "ילד אומנה 37" }],
		},
	),
);

addLab(
	new Lab(
		38,
		"tanahpedia-lab-38-full-stack",
		"מעבדה 38 — הורים + אח + בת זוג + ילד",
		"MALE",
		{
			parents: [
				{ role: "father", type: "bio", name: "אב 38" },
				{ role: "mother", type: "bio", name: "אם 38" },
			],
			siblings: [{ name: "אח 38" }],
			spouses: [{ type: "marriage", order: 1, name: "בת זוג 38" }],
			children: [{ role: "father", type: "bio", name: "נכד דמו 38" }],
		},
	),
);

// ——— Emit SQL ———

function typeId(key) {
	if (key === "bio") return IDS.bio;
	if (key === "adopt") return IDS.adopt;
	if (key === "step") return IDS.step;
	if (key === "foster") return IDS.foster;
	throw new Error(key);
}

function unionTypeId(key) {
	if (key === "marriage") return IDS.marriage;
	if (key === "pilegesh") return IDS.pilegesh;
	if (key === "forbidden") return IDS.forbidden;
	if (key === "incest") return IDS.incest;
	if (key === "betrothal") return IDS.betrothal;
	throw new Error(key);
}

function roleId(role) {
	return role === "father" ? IDS.father : IDS.mother;
}

function nextPcId() {
	const id = `pc300000-0000-4000-8000-${pad(pcN++, 12)}`;
	return id;
}

function nextUId() {
	return `u3000000-0000-4000-8000-${pad(uN++, 12)}`;
}

const entities = [];
const persons = [];
const entries = [];
const entryEntities = [];
const sexRows = [];
const pcRows = [];
const unionRows = [];

for (const lab of labs) {
	const fn = lab.num;
	const focalE = E(fn);
	const focalP = P(fn);
	const ea = EA(fn);
	const ee = EE(fn);
	entities.push({ id: focalE, name: lab.title });
	persons.push({ id: focalP, entityId: focalE });
	entries.push({ id: ea, slug: lab.slug, title: lab.title });
	entryEntities.push({ id: ee, entryId: ea, entityId: focalE });
	if (lab.sex) {
		sexRows.push({
			id: `sx300000-0000-4000-8000-${pad(fn, 12)}`,
			personId: focalP,
			sex: lab.sex,
		});
	}

	const support = new Map();

	function getSupport(name, { noEntry = false } = {}) {
		const k = `${name}|${noEntry}`;
		if (!support.has(k)) {
			const s = nextSupport(name);
			entities.push({ id: s.e, name });
			persons.push({ id: s.p, entityId: s.e });
			support.set(k, { ...s, noEntry });
		}
		return support.get(k);
	}

	for (const pr of lab.parents) {
		const s = getSupport(pr.name);
		const alt = pr.alt != null ? AG(pr.alt + 50) : null;
		pcRows.push({
			id: nextPcId(),
			parent_id: s.p,
			child_id: focalP,
			relationship_type_id: typeId(pr.type),
			parent_role_id: roleId(pr.role),
			alt_group_id: alt,
			source_citation: pr.cite ?? null,
		});
	}

	for (const sp of lab.spouses) {
		const s = getSupport(sp.name, { noEntry: sp.noEntry });
		const alt = sp.alt != null ? AG(sp.alt + 70) : null;
		unionRows.push({
			id: nextUId(),
			person1_id: focalP,
			person2_id: s.p,
			union_type_id: unionTypeId(sp.type),
			union_order: sp.order ?? null,
			start_date: sp.startDate ?? null,
			end_date: sp.endDate ?? null,
			end_reason_id: sp.end ?? null,
			alt_group_id: alt,
			source_citation: sp.cite ?? null,
		});
	}

	for (const ch of lab.children) {
		const s = getSupport(ch.name, { noEntry: ch.noEntry });
		const alt = ch.alt != null ? AG(ch.alt + 90) : null;
		pcRows.push({
			id: nextPcId(),
			parent_id: focalP,
			child_id: s.p,
			relationship_type_id: typeId(ch.type),
			parent_role_id: roleId(ch.role),
			alt_group_id: alt,
			source_citation: ch.cite ?? null,
		});
	}

	for (const sb of lab.siblings) {
		const sib = getSupport(sb.name);

		if (lab.num === 22 && sb.mother) {
			const fa = getSupport(lab.parents[0].name).p;
			const mo2 = getSupport(sb.mother).p;
			pcRows.push({
				id: nextPcId(),
				parent_id: fa,
				child_id: sib.p,
				relationship_type_id: IDS.bio,
				parent_role_id: IDS.father,
				alt_group_id: null,
				source_citation: null,
			});
			pcRows.push({
				id: nextPcId(),
				parent_id: mo2,
				child_id: sib.p,
				relationship_type_id: IDS.bio,
				parent_role_id: IDS.mother,
				alt_group_id: null,
				source_citation: null,
			});
			continue;
		}

		const pf = lab.parents.find((p) => p.role === "father");
		const pm = lab.parents.find((p) => p.role === "mother");
		if (!pf || !pm) continue;

		const fp = getSupport(pf.name).p;
		const mp = getSupport(pm.name).p;
		for (const [pid, rid] of [
			[fp, IDS.father],
			[mp, IDS.mother],
		]) {
			pcRows.push({
				id: nextPcId(),
				parent_id: pid,
				child_id: sib.p,
				relationship_type_id: IDS.bio,
				parent_role_id: rid,
				alt_group_id: null,
				source_citation: null,
			});
		}
	}
}

function q(v) {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number") return String(v);
	return `'${String(v).replace(/'/g, "''")}'`;
}

const allEntityIds = entities.map((e) => e.id);
const allPersonIds = persons.map((p) => p.id);
const allEaIds = entries.map((e) => e.id);
const allEeIds = entryEntities.map((e) => e.id);
const allPcIds = pcRows.map((r) => r.id);
const allUIds = unionRows.map((r) => r.id);
const allSexIds = sexRows.map((r) => r.id);

const out = [];
out.push(`-- Tanahpedia family edge-case lab (generated). UUID prefix e300/p300/ea300/ee300/pc300/u300/sx300.
-- Regenerate: node data/mysql/scripts/generate-tanahpedia-edge-lab.mjs
-- Idempotent: DELETE only these fixed ids, then INSERT.

DELETE FROM tanahpedia_person_union WHERE id IN (${allUIds.map((x) => q(x)).join(",\n\t")});

DELETE FROM tanahpedia_person_parent_child WHERE id IN (${allPcIds.map((x) => q(x)).join(",\n\t")});

DELETE FROM tanahpedia_person_sex WHERE id IN (${allSexIds.map((x) => q(x)).join(",\n\t")});

DELETE FROM tanahpedia_entry_entity WHERE id IN (${allEeIds.map((x) => q(x)).join(",\n\t")});

DELETE FROM tanahpedia_entry WHERE id IN (${allEaIds.map((x) => q(x)).join(",\n\t")});

DELETE FROM tanahpedia_person WHERE id IN (${allPersonIds.map((x) => q(x)).join(",\n\t")});

DELETE FROM tanahpedia_entity WHERE id IN (${allEntityIds.map((x) => q(x)).join(",\n\t")});
`);

out.push(`
INSERT INTO tanahpedia_entry (id, unique_name, title, content, created_at, updated_at) VALUES
${entries.map((e) => `\t(${q(e.id)}, ${q(e.slug)}, ${q(e.title)}, '<p>דמו מעבדת מקרי קצה — לא לעריכה פומבית.</p>', NOW(), NOW())`).join(",\n")};
`);

out.push(`
INSERT INTO tanahpedia_entity (id, entity_type, name, created_at, updated_at) VALUES
${entities.map((e) => `\t(${q(e.id)}, 'PERSON', ${q(e.name)}, NOW(), NOW())`).join(",\n")};
`);

out.push(`
INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_id) VALUES
${entryEntities.map((e) => `\t(${q(e.id)}, ${q(e.entryId)}, ${q(e.entityId)})`).join(",\n")};
`);

out.push(`
INSERT INTO tanahpedia_person (id, entity_id) VALUES
${persons.map((p) => `\t(${q(p.id)}, ${q(p.entityId)})`).join(",\n")};
`);

out.push(`
INSERT INTO tanahpedia_person_sex (id, person_id, sex) VALUES
${sexRows.map((s) => `\t(${q(s.id)}, ${q(s.personId)}, ${q(s.sex)})`).join(",\n")};
`);

out.push(`
INSERT INTO tanahpedia_person_parent_child (
\tid, parent_id, child_id, relationship_type_id, parent_role_id, alt_group_id, source_citation
) VALUES
${pcRows
	.map(
		(r) =>
			`\t(${q(r.id)}, ${q(r.parent_id)}, ${q(r.child_id)}, ${q(r.relationship_type_id)}, ${q(r.parent_role_id)}, ${r.alt_group_id ? q(r.alt_group_id) : "NULL"}, ${r.source_citation ? q(r.source_citation) : "NULL"})`,
	)
	.join(",\n")};
`);

out.push(`
INSERT INTO tanahpedia_person_union (
\tid, person1_id, person2_id, union_type_id, union_order, start_date, end_date, end_reason_id, alt_group_id, source_citation
) VALUES
${unionRows
	.map(
		(r) =>
			`\t(${q(r.id)}, ${q(r.person1_id)}, ${q(r.person2_id)}, ${q(r.union_type_id)}, ${r.union_order != null ? r.union_order : "NULL"}, ${r.start_date != null ? r.start_date : "NULL"}, ${r.end_date != null ? r.end_date : "NULL"}, ${r.end_reason_id ? q(r.end_reason_id) : "NULL"}, ${r.alt_group_id ? q(r.alt_group_id) : "NULL"}, ${r.source_citation ? q(r.source_citation) : "NULL"})`,
	)
	.join(",\n")};
`);

const dest = path.join(__dirname, "..", "tanahpedia_family_edge_lab_data.sql");
fs.writeFileSync(dest, out.join("\n"), "utf8");
console.log("Wrote", dest, "labs=", labs.length, "entities=", entities.length);
