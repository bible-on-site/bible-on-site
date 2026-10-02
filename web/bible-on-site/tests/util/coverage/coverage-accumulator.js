const { mergeIstanbulCoverage } = require("./merge-istanbul-coverage");

/** Preserve counters before jest.resetModules replaces a file's coverage object. */
class CoverageAccumulator {
	constructor() {
		this.previous = new Map();
		/** @type {Record<string, {s: Record<string, number>, f: Record<string, number>, b: Record<string, number[]>}>} */
		this.coverage = {};
	}

	collect(coverage) {
		for (const [file, data] of Object.entries(coverage || {})) {
			const previous = this.previous.get(file);
			const counts = previous?.data === data ? previous.counts : undefined;
			const delta = {
				...data,
				s: counterDelta(data.s, counts?.s),
				f: counterDelta(data.f, counts?.f),
				b: Object.fromEntries(
					Object.entries(data.b || {}).map(([key, values]) => [
						key,
						values.map((value, i) => value - (counts?.b[key]?.[i] || 0)),
					]),
				),
			};
			this.coverage = mergeIstanbulCoverage(this.coverage, { [file]: delta });
			this.previous.set(file, {
				data,
				counts: {
					s: { ...data.s },
					f: { ...data.f },
					b: Object.fromEntries(
						Object.entries(data.b || {}).map(([key, values]) => [
							key,
							[...values],
						]),
					),
				},
			});
		}
	}
}

function counterDelta(current = {}, previous = {}) {
	return Object.fromEntries(
		Object.entries(current).map(([key, count]) => [
			key,
			count - (previous[key] || 0),
		]),
	);
}

module.exports = { CoverageAccumulator };
