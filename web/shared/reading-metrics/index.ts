/**
 * Shared reading-metrics counter (#2607) — the single implementation behind
 * every persisted `*_metric` / `*_metric_block` row. Consumers never recount:
 * they read the stored decoration. See docs/data/reading-metrics.md.
 */
import { countTextWords } from "./count";
import { htmlToReadableSegments } from "./text";

export {
	countTextWords,
	normalizeForCount,
} from "./count";
export {
	decodeEntities,
	htmlToPlainText,
	htmlToReadableSegments,
	stripScriptsAndStyles,
} from "./text";
export {
	estimateReadingSeconds,
	READING_METRICS_CALC_VERSION,
	READING_WORDS_PER_MINUTE,
} from "./policy";
export { pasukCountedText } from "./perek";
export type { CorpusPasuk, CorpusSegment } from "./perek";

export interface BlockCounts {
	/** Total readable words — the `word_count` persisted on the metric row. */
	wordCount: number;
	/** Word count per readable block, in document order (empty blocks dropped). */
	blocks: number[];
}

/**
 * Count authored/stored HTML into whole-content words plus per-block counts.
 * A block is a top-level readable unit (paragraph, list item, section…);
 * blocks that carry no words are dropped so `blocks` only lists units that
 * consume reading time — their ordinals are the stored `block_idx` values.
 */
export function countHtmlBlocks(html: string | null | undefined): BlockCounts {
	if (!html) return { wordCount: 0, blocks: [] };
	const blocks = htmlToReadableSegments(html)
		.map((segment) => countTextWords(segment))
		.filter((count) => count > 0);
	return {
		wordCount: blocks.reduce((sum, count) => sum + count, 0),
		blocks,
	};
}
