/**
 * `Accept` header parsing for the text/markdown content negotiation
 * (issue #3257). Public learning routes serve their HTML representation
 * by default and switch to Markdown when the client explicitly prefers
 * `text/markdown` — the same opt-in contract agents get from the
 * `.md` URL suffix, so a plain browser or `Accept: *\/*` is never
 * surprised by a non-HTML body.
 *
 * Effective quality follows RFC 7231 §5.3.2: for a concrete media type
 * the q-value comes from its most specific matching range —
 * `text/markdown` beats `text/*` which beats the full wildcard. Markdown wins only when
 * its effective quality is positive and strictly higher than
 * `text/html`'s; ties and `q=0` fall back to HTML.
 */

interface MediaRange {
	type: string;
	subtype: string;
	quality: number;
}

/**
 * Parse one media-range parameter value as a q-value. Anything that is
 * not a valid `q=`/`Q=` number inside [0, 1] fails the whole entry —
 * a malformed range grants no preference (an invalid `q=2` must not
 * silently act as 1).
 */
function parseQuality(params: string[]): number {
	for (const param of params) {
		const eq = param.indexOf("=");
		if (eq === -1) continue;
		const name = param.slice(0, eq).trim().toLowerCase();
		if (name !== "q") continue;
		const raw = param.slice(eq + 1).trim();
		const value = Number(raw);
		// `q=`, `q=abc`, `q=1.5` and negative values are all invalid.
		if (raw === "" || !Number.isFinite(value) || value < 0 || value > 1) {
			return Number.NaN;
		}
		return value;
	}
	return 1;
}

/**
 * Parse an Accept header into usable media ranges. Malformed entries —
 * no `/`, empty type, or an invalid q-value — are dropped. A malformed
 * header (`""`, `null`, all-garbage) parses to an empty list.
 */
export function parseAccept(accept: string | null): MediaRange[] {
	if (!accept) return [];
	const ranges: MediaRange[] = [];
	for (const entry of accept.split(",")) {
		const [mediaType, ...paramParts] = entry.split(";");
		const slash = mediaType.indexOf("/");
		if (slash === -1) continue;
		const type = mediaType.slice(0, slash).trim().toLowerCase();
		const subtype = mediaType.slice(slash + 1).trim().toLowerCase();
		if (!type || !subtype) continue;
		// Parameters other than q (e.g. `text/markdown;level=1`) do not
		// change the range's matching shape for our negotiation.
		const quality = parseQuality(
			paramParts.map((part) => part.trim()).filter(Boolean),
		);
		if (Number.isNaN(quality)) continue;
		ranges.push({ type, subtype, quality });
	}
	return ranges;
}

const SPECIFICITY = { exact: 2, typeWildcard: 1, wildcard: 0 } as const;

function rangeSpecificity(range: MediaRange): number {
	if (range.type === "*") return SPECIFICITY.wildcard;
	if (range.subtype === "*") return SPECIFICITY.typeWildcard;
	return SPECIFICITY.exact;
}

function matches(range: MediaRange, type: string, subtype: string): boolean {
	if (range.type !== "*" && range.type !== type) return false;
	return range.subtype === "*" || range.subtype === subtype;
}

/**
 * The effective quality the client assigns a media type: the q of the
 * most specific range matching it, `0` when nothing matches (an
 * unmatched `q=0` and an absent match both mean "not wanted").
 */
export function acceptQuality(
	ranges: MediaRange[],
	fullType: string,
): number {
	const slash = fullType.indexOf("/");
	const type = fullType.slice(0, slash);
	const subtype = fullType.slice(slash + 1);
	let best = -1;
	let quality = 0;
	for (const range of ranges) {
		if (!matches(range, type, subtype)) continue;
		const specificity = rangeSpecificity(range);
		if (specificity > best) {
			best = specificity;
			quality = range.quality;
		}
	}
	return quality;
}

/**
 * Whether an `Accept` header prefers the Markdown representation over
 * HTML. Only an explicit `text/markdown` match counts — `text/*` and
 * the wildcard ranges alone keep the HTML default — and the HTML quality
 * it beats is the full RFC chain (`text/html`, then `text/*`, then the
 * catch-all wildcard).
 */
export function markdownPreferred(accept: string | null): boolean {
	const ranges = parseAccept(accept);
	const markdownQ = acceptQuality(ranges, "text/markdown");
	const htmlQ = acceptQuality(ranges, "text/html");
	return markdownQ > 0 && markdownQ > htmlQ;
}
