import type { Graph, Thing, WithContext } from "schema-dts";
import { renderJsonLd } from "@/lib/seo/jsonld";

/**
 * Server component that emits a single sanitized JSON-LD `<script>` block.
 * Crawlers see it in the server-rendered HTML (no client JS required).
 */
export function JsonLd({ data }: { data: Graph | WithContext<Thing> }) {
	return (
		<script
			type="application/ld+json"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized by renderJsonLd (escapes <, >, &, ', U+2028/9)
			dangerouslySetInnerHTML={{ __html: renderJsonLd(data) }}
		/>
	);
}
