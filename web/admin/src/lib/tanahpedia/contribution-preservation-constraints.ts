export type PreservedContributionField =
	| "title"
	| "description"
	| "evidence"
	| "changes";

const FIELD =
	/(?<![\p{L}\p{N}_])(?:(?:(?:the|current|existing)\s+){0,2}(?:title|description|evidence|(?:change|operation)\s+sequence|changes)|ו?(?:ה?כותרת|ה?תיאור|ה?ראיות|ה?שינויים|רצף\s+ה?שינויים))(?![\p{L}\p{N}_])/giu;
const ACTION =
	/^(?:(?:please|נא|אנא|יש|אבקש)\s+)?(?:preserve|keep|retain|לשמר|שמר|שמרו|לשמור)(?=\s|$)\s*/iu;

function fieldName(name: string): PreservedContributionField {
	if (/title|כותרת/iu.test(name)) return "title";
	if (/description|תיאור/iu.test(name)) return "description";
	if (/evidence|ראיות/iu.test(name)) return "evidence";
	return "changes";
}

/** Quoted examples and code are data, not imperative clauses. */
function instructionClauses(body: string): string[] {
	const outside = body.replace(
		/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”|״[^״]*״|‘[^’]*’|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu,
		" [quoted data] ",
	);
	// Incomplete quotations/fences cannot establish which text is instruction.
	if (/[`"“”״‘’]/u.test(outside)) return [];
	return outside
		.split("\n")
		.filter((line) => !line.trimStart().startsWith(">"))
		.join("\n")
		.split(/[.!?？;\n]/u)
		.map((clause) => clause.trim())
		.filter(Boolean);
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
		instructionClauses(comment.body).map((clause) => ({
			commentId: comment.id,
			clause,
			fields: requestedFields(clause),
		})),
	);
	const uncertain = new Set(
		clauses
			.filter(({ fields }) => !fields.length)
			.flatMap(({ clause }) => [
				...[...clause.matchAll(FIELD)].map((match) => fieldName(match[0])),
				...(/\bquotes?\b|ציטוט/iu.test(clause) ? (["evidence"] as const) : []),
			]),
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
