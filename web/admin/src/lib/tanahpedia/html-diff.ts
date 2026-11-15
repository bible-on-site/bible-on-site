/**
 * Word-level diff over HTML source. Tokens are tags, whitespace runs, and
 * word runs, so concatenating any token subsequence reproduces the source
 * exactly — no escaping/re-serialization involved.
 */

export type DiffPartType = "same" | "add" | "del";

export interface DiffPart {
	type: DiffPartType;
	text: string;
}

const TOKEN_RE = /<[^>]*>|\s+|[^\s<]+/g;

/**
 * When the differing middle is larger than this on either side, give up on
 * LCS and emit the whole middle as del+add — keeps the O(n·m) DP bounded on
 * pathological inputs (e.g. fully rewritten entries).
 */
const MAX_LCS_TOKENS = 1500;

export function tokenizeHtml(text: string): string[] {
	return text.match(TOKEN_RE) ?? [];
}

export function diffHtmlWords(before: string, after: string): DiffPart[] {
	if (before === after) {
		return before ? [{ type: "same", text: before }] : [];
	}
	const a = tokenizeHtml(before);
	const b = tokenizeHtml(after);

	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start++;
	}
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}

	const parts: DiffPart[] = [];
	pushPart(parts, "same", a.slice(0, start).join(""));

	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);
	if (midA.length <= MAX_LCS_TOKENS && midB.length <= MAX_LCS_TOKENS) {
		for (const part of lcsDiff(midA, midB)) {
			pushPart(parts, part.type, part.text);
		}
	} else {
		pushPart(parts, "del", midA.join(""));
		pushPart(parts, "add", midB.join(""));
	}

	pushPart(parts, "same", a.slice(endA).join(""));
	return parts;
}

function pushPart(parts: DiffPart[], type: DiffPartType, text: string): void {
	if (!text) return;
	const last = parts[parts.length - 1];
	if (last && last.type === type) {
		last.text += text;
	} else {
		parts.push({ type, text });
	}
}

/** Classic DP LCS backtrack producing same/del/add parts in order. */
function lcsDiff(a: string[], b: string[]): DiffPart[] {
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];
	if (n === 0) return [{ type: "add", text: b.join("") }];
	if (m === 0) return [{ type: "del", text: a.join("") }];

	const width = m + 1;
	const dp = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i * width + j] =
				a[i] === b[j]
					? dp[(i + 1) * width + j + 1] + 1
					: Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
		}
	}

	const parts: DiffPart[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			pushPart(parts, "same", a[i]);
			i++;
			j++;
		} else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
			pushPart(parts, "del", a[i]);
			i++;
		} else {
			pushPart(parts, "add", b[j]);
			j++;
		}
	}
	while (i < n) pushPart(parts, "del", a[i++]);
	while (j < m) pushPart(parts, "add", b[j++]);
	return parts;
}
