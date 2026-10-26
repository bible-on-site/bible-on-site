/**
 * Browser-side download helpers (#2621): read the filename a route
 * advertises through Content-Disposition and hand the fetched bytes to the
 * browser's real download flow via a temporary object-URL anchor.
 */

/**
 * Extracts `filename=`/`filename*=` from a Content-Disposition header.
 * Falls back to the provided name when the header is absent or carries no
 * usable value (e.g. a cross-origin response that hides the header).
 */
export function attachmentFilename(
	header: string | null,
	fallback: string,
): string {
	if (header) {
		const utf8 = /filename\*=([^;]+)/i.exec(header);
		if (utf8) {
			try {
				const decoded = decodeURIComponent(
					utf8[1].trim().replace(/^UTF-8''/i, "").replace(/^"|"$/g, ""),
				);
				if (decoded) {
					return decoded;
				}
			} catch {
				/* malformed percent-encoding — try the plain form below */
			}
		}
		const plain = /filename="([^"]*)"|filename=([^;\s]+)/i.exec(header);
		const name = (plain?.[1] ?? plain?.[2] ?? "").trim();
		if (name) {
			return name;
		}
	}
	return fallback;
}

/**
 * Saves the blob through the browser's normal download machinery, so the
 * file lands in the user's downloads with the expected name and UI — the
 * same outcome a direct `download` link would produce.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = "noopener";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
