/**
 * Utility for merging Istanbul coverage objects.
 * Used when multiple Jest workers each generate their own coverage data.
 *
 * This is CommonJS to be compatible with Jest's setup files.
 */

/**
 * Merge two Istanbul coverage objects. When both have coverage for the same file,
 * sum the hit counts for statements, functions, and branches.
 *
 * @param {Object} existing - Existing coverage object
 * @param {Object} incoming - New coverage to merge in
 * @returns {Object} Merged coverage object
 */
function mergeIstanbulCoverage(existing, incoming) {
	const merged = { ...existing };

	for (const [filePath, incomingData] of Object.entries(incoming)) {
		if (!merged[filePath]) {
			merged[filePath] = incomingData;
			continue;
		}

		const existingData = merged[filePath];

		// Merge statement counts
		for (const [key, count] of Object.entries(incomingData.s || {})) {
			existingData.s[key] = (existingData.s[key] || 0) + count;
		}

		// Merge function counts
		for (const [key, count] of Object.entries(incomingData.f || {})) {
			existingData.f[key] = (existingData.f[key] || 0) + count;
		}

		// Merge branch counts
		for (const [key, counts] of Object.entries(incomingData.b || {})) {
			if (!existingData.b[key]) {
				existingData.b[key] = counts;
			} else {
				existingData.b[key] = existingData.b[key].map(
					(c, i) => c + (counts[i] || 0),
				);
			}
		}
	}

	return merged;
}

module.exports = { mergeIstanbulCoverage };
