export type PreservedContributionField =
	| "title"
	| "description"
	| "evidence"
	| "changes";

const FIELD =
	/(?<![\p{L}\p{N}_])(?:(?:(?:the|current|existing)\s+){0,2}(?:title|description|evidence|(?:change|operation)\s+sequence|changes)|ו?(?:ה?כותרת|ה?תיאור|ה?ראיות|ה?שינויים|רצף\s+ה?שינויים))(?![\p{L}\p{N}_])/giu;
const ACTION =
	/^(?:(?:please|נא|אנא|יש|אבקש)\s+)?(?:preserve|keep|retain|לשמר|שמר|שמרו|לשמור)(?=\s|$)\s*/iu;
const EDIT_WORDS = new Set(
	"change edit modify alter replace set append add remove delete rewrite improve update fix correct revise shorten expand polish שנה שנו לשנות תשנה תשנו ערוך ערכו לערוך החלף להחליף הוסף הוסיפו להוסיף צרף לצרף מחק למחוק הסר להסיר שפר לשפר עדכן לעדכן תקן לתקן תתקן שכתב לשכתב קצר לקצר הרחב להרחיב".split(
		" ",
	),
);
const READ_ONLY_ACTION =
	/^(?:(?:please|נא|אנא|יש)\s+)?(?:read|review|inspect|check|explain|describe|report|answer|קרא|בדוק|סקור|עיין|בחן|תאר|דווח|ענה)(?![\p{L}\p{N}_])/iu;
const OPAQUE_LABELS = new Set([
	"",
	"example:",
	"for example:",
	"source:",
	"evidence:",
	"context:",
	"note:",
	"דוגמה:",
	"לדוגמה:",
	"למשל:",
	"מקור:",
	"ראיות:",
	"ציטוט:",
	"הקשר:",
]);

function knownReadOnly(clause: string, question: boolean) {
	const words = clause.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
	const editing = words.some(
		(word) =>
			EDIT_WORDS.has(word) ||
			(word.startsWith("ו") && EDIT_WORDS.has(word.slice(1))),
	);
	return !editing && (question || READ_ONLY_ACTION.test(clause));
}

function fieldName(name: string): PreservedContributionField {
	if (/title|כותרת/iu.test(name)) return "title";
	if (/description|תיאור/iu.test(name)) return "description";
	if (/evidence|ראיות/iu.test(name)) return "evidence";
	return "changes";
}

/** Quoted examples and code are data, not imperative clauses. */
function instructionClauses(body: string) {
	const outside = body.replace(
		/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”|״[^״]*״|‘[^’]*’|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu,
		" [quoted data] ",
	);
	// Incomplete quotations/fences cannot establish which text is instruction.
	if (/[`"“”״‘’]/u.test(outside)) return [];
	const parts = outside
		.split("\n")
		.filter((line) => !line.trimStart().startsWith(">"))
		.join("\n")
		.split(/([.!?？;\n])/u);
	return parts.flatMap((part, index) => {
		const clause = part.trim();
		if (index % 2 !== 0 || !clause) return [];
		if (
			clause.includes("[quoted data]") &&
			OPAQUE_LABELS.has(
				clause.replaceAll("[quoted data]", "").trim().toLowerCase(),
			)
		)
			return [];
		return [{ clause, question: /[?？]/u.test(parts[index + 1] ?? "") }];
	});
}

function requestedFields(clause: string): PreservedContributionField[] {
	if (!ACTION.test(clause)) return [];
	const list = clause
		.replace(ACTION, "")
		.replace(/^(?:exactly\s+|בדיוק\s+)?(?:את\s+)?/iu, "")
		.replace(/\s+(?:exactly|unchanged|בדיוק|ללא שינוי)$/iu, "");
	const fields: PreservedContributionField[] = [];
	const remainder = list.replace(FIELD, (name) => {
		fields.push(fieldName(name));
		return "#";
	});
	// Only an entire finite field list is actionable. Qualifications, questions,
	// negatives and "preserve evidence AND add quotes" are not guessed.
	return /^#(?:(?:,?(?:and|ו)|,)?#)*$/iu.test(remainder.replace(/\s+/gu, ""))
		? fields
		: [];
}

/** Narrow, data-only locks from pending human comments, never source evidence. */
export function derivePreservationConstraints(
	comments: readonly { id: string; body: string }[],
): { field: PreservedContributionField; commentIds: string[] }[] {
	const clauses = comments.flatMap((comment) =>
		instructionClauses(comment.body).map(({ clause, question }) => ({
			commentId: comment.id,
			clause,
			question,
			fields: question ? [] : requestedFields(clause),
		})),
	);
	const requested = [...new Set(clauses.flatMap(({ fields }) => fields))];
	const uncertain = new Set(
		clauses
			.filter(
				({ fields, clause, question }) =>
					!fields.length && !knownReadOnly(clause, question),
			)
			.flatMap(({ clause }) => {
				const mentioned = [
					...[...clause.matchAll(FIELD)].map((match) => fieldName(match[0])),
					...(/\bquotes?\b|ציטוט/iu.test(clause)
						? (["evidence"] as const)
						: []),
				];
				// Unknown instructions may use pronouns or implicit targets. Only
				// known read-only context is harmless; never guess an unknown scope.
				return mentioned.length ? mentioned : requested;
			}),
	);
	const result = new Map<PreservedContributionField, Set<string>>();
	for (const { fields, commentId } of clauses)
		for (const field of fields) {
			if (uncertain.has(field)) continue;
			const ids = result.get(field) ?? new Set<string>();
			ids.add(commentId);
			result.set(field, ids);
		}
	return [...result].map(([field, ids]) => ({ field, commentIds: [...ids] }));
}
