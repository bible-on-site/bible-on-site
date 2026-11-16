export interface VerbatimFieldConstraint {
	field: "title" | "description";
	expected: string;
	commentIds: string[];
}

interface CopyRequest {
	field: VerbatimFieldConstraint["field"];
	mode: "append" | "replace";
	quote: string;
}

const COPY_ACTION =
	/^(?:(?:please|נא|אנא|יש|אבקש)\s+)?(append|add|set|replace|להוסיף|הוסף|הוסיפו|לצרף|צרף|צרפו|להחליף|החלף|החליפו|לקבוע|קבע|קבעו|להגדיר|הגדר|הגדירו)(?=\s|$)/iu;
const COPY_ACTIONS =
	/(?<![\p{L}\p{N}_])(?:append|add|set|replace|להוסיף|הוסף|הוסיפו|לצרף|צרף|צרפו|להחליף|החלף|החליפו|לקבוע|קבע|קבעו|להגדיר|הגדר|הגדירו)(?![\p{L}\p{N}_])/giu;
const EXACT_INTENT =
	/\b(?:exact|exactly|verbatim|byte-for-byte)\b|(?<![\p{L}\p{N}_])(?:ה?מדויק(?:ת|ים|ות)?|בדיוק|במדויק|כלשונ[וה]|מילה\s+במילה)(?![\p{L}\p{N}_])/iu;
const CONDITIONAL_OR_QUESTION =
	/[?？]|\b(?:if|unless|whether|could|would|should|can)\b|(?<![\p{L}\p{N}_])(?:אם|אילו|אולי|האם|למשל|לדוגמה)(?![\p{L}\p{N}_])/iu;
const NEGATIVE_DIRECTIVE =
	/\b(?:not|never|avoid|without|don't|do\s+not|instead\s+of)\b|(?<![\p{L}\p{N}_])(?:לא|אל|בלי|ללא)(?![\p{L}\p{N}_])/iu;
const NEGATIVE_COPY =
	/\b(?:do\s+not|don't|never)\s+(?:append|add|set|replace|copy)\b|(?<![\p{L}\p{N}_])(?:אל|לא)\s+(?:תוסיף|תוסיפו|תצרף|תחליף|תחליפו|תגדיר|תקבע|תעתיק|להוסיף|להחליף|להעתיק)(?![\p{L}\p{N}_])/iu;
const NEGATIVE_FIELD_EDIT =
	/\b(?:do\s+not|don't|never)\s+(?:change|edit|modify|alter|touch)\b|(?<![\p{L}\p{N}_])(?:אל|לא)\s+(?:תשנה|תשנו|תערוך|תערכו|לשנות|לערוך)(?![\p{L}\p{N}_])/iu;

/** Only one balanced quotation is actionable; its contents remain opaque data. */
function quotedRequest(body: string) {
	const double = body.match(
		/^([^"“”״]*)(?:"([^"]+)"|“([^“”]+)”|״([^״]+)״)([^"“”״]*)$/su,
	);
	if (double)
		return {
			before: double[1],
			quote: double[2] ?? double[3] ?? double[4],
			after: double[5],
		};
	if (/["“”״]/u.test(body)) return undefined;
	const single = body.match(/^([^'‘’]*)(?:'([^']+)'|‘([^‘’]+)’)([^'‘’]*)$/su);
	return single
		? {
				before: single[1],
				quote: single[2] ?? single[3],
				after: single[4],
			}
		: undefined;
}

function namedFields(outside: string): VerbatimFieldConstraint["field"][] {
	const result: VerbatimFieldConstraint["field"][] = [];
	for (const match of outside.matchAll(
		/(?<![\p{L}\p{N}_])(?:title|description|[לב]?ה?כותרת|[לב]?ה?תיאור)(?![\p{L}\p{N}_])/giu,
	))
		result.push(/title|כותרת/iu.test(match[0]) ? "title" : "description");
	return result;
}

function hasFiniteQuoteTail(after: string): boolean {
	// Unknown attached prose may qualify/criticize the quotation. Do not guess.
	const clause = after
		.split(/[.!?;\n]/u, 1)[0]
		.replace(/[,\s:]+/gu, " ")
		.replace(/(?:^|\s)[-–—]+(?=\s|$)/gu, " ")
		.trim();
	return (
		/^(?:(?:verbatim|exactly|byte-for-byte)\s*)?(?:(?:to|in)\s+(?:the\s+)?(?:title|description)\s*)?(?:(?:verbatim|exactly|byte-for-byte))?$/iu.test(
			clause,
		) ||
		/^(?:(?:בדיוק|כלשונ[וה]|מילה במילה)\s*)?(?:[לב](?:ה?כותרת|ה?תיאור)\s*)?(?:(?:בדיוק|כלשונ[וה]|מילה במילה))?$/u.test(
			clause,
		)
	);
}

function copyRequest(body: string): CopyRequest | undefined {
	const quoted = quotedRequest(body);
	if (!quoted?.quote.trim()) return undefined;
	const before = quoted.before.trim();
	const outside = `${quoted.before} ${quoted.after}`;
	const action = before.match(COPY_ACTION);
	const fields = namedFields(outside);
	if (
		!action ||
		fields.length !== 1 ||
		[...outside.matchAll(COPY_ACTIONS)].length !== 1 ||
		!EXACT_INTENT.test(outside) ||
		CONDITIONAL_OR_QUESTION.test(outside) ||
		NEGATIVE_DIRECTIVE.test(before) ||
		NEGATIVE_COPY.test(quoted.after) ||
		!hasFiniteQuoteTail(quoted.after)
	)
		return undefined;
	const mode = /^(?:append|add|להוסיף|הוסף|הוסיפו|לצרף|צרף|צרפו)$/iu.test(
		action[1],
	)
		? "append"
		: "replace";
	if (mode === "replace") {
		// Replacing a word *inside* a field does not mean replacing the whole field.
		const target = before.slice(action[0].length).trim();
		if (
			!/^(?:(?:the\s+)?(?:title|description)\s+(?:to|with|as)\b|(?:את\s+)?(?:ה?כותרת|ה?תיאור)\s+[בלכ])/iu.test(
				target,
			)
		)
			return undefined;
	}
	return { field: fields[0], mode, quote: quoted.quote };
}

function expectedValue(request: CopyRequest, current: string): string {
	if (request.mode === "replace") return request.quote;
	const separator = request.field === "description" ? "\n" : " ";
	if (current === request.quote || current.endsWith(separator + request.quote))
		return current;
	return current + (current.length ? separator : "") + request.quote;
}

function negatedCopyFields(body: string): VerbatimFieldConstraint["field"][] {
	const quoted = quotedRequest(body);
	// Unbalanced/multiple quotes cannot establish which field names are data.
	if (!quoted && /["“”״‘’]|(?<![A-Za-z])'|'(?![A-Za-z])/u.test(body)) return [];
	const outside = quoted ? `${quoted.before} ${quoted.after}` : body;
	return outside
		.split(/[.!?;\n]/u)
		.filter(
			(clause) =>
				NEGATIVE_COPY.test(clause) || NEGATIVE_FIELD_EDIT.test(clause),
		)
		.flatMap(namedFields);
}

/**
 * Derive data-only constraints from pending human instructions, never evidence.
 * Deliberately narrow: unclear intent is left for clarification, not guessed.
 */
export function deriveVerbatimFieldConstraints(
	comments: readonly { id: string; body: string }[],
	current: { title: string; description: string },
): VerbatimFieldConstraint[] {
	const negated = new Set(
		comments.flatMap((comment) => negatedCopyFields(comment.body)),
	);
	const requests = new Map<
		VerbatimFieldConstraint["field"],
		{ request: CopyRequest; commentIds: string[]; conflicting: boolean }
	>();
	for (const comment of comments) {
		const request = copyRequest(comment.body);
		if (!request || negated.has(request.field)) continue;
		const previous = requests.get(request.field);
		if (!previous) {
			requests.set(request.field, {
				request,
				commentIds: [comment.id],
				conflicting: false,
			});
			continue;
		}
		if (
			previous.request.mode !== request.mode ||
			previous.request.quote !== request.quote
		)
			previous.conflicting = true;
		if (!previous.commentIds.includes(comment.id))
			previous.commentIds.push(comment.id);
	}
	return [...requests.values()]
		.filter(({ conflicting }) => !conflicting)
		.map(({ request, commentIds }) => ({
			field: request.field,
			expected: expectedValue(request, current[request.field]),
			commentIds,
		}));
}
