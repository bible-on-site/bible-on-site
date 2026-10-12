import type { PerekIllustration } from "@/lib/seo/perek-illustrations";

/** Only **emphasis** is supported. All other input remains escaped React text. */
export function ImageCaption({
	image,
}: {
	image: Pick<PerekIllustration, "caption" | "captionMarkdown" | "credit">;
}) {
	const text = image.captionMarkdown ?? image.caption;
	return (
		<>
			{!image.captionMarkdown
				? image.caption
				: text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
						part.startsWith("**") && part.endsWith("**") ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: immutable text tokens have no separate identity
							<strong key={index}>{part.slice(2, -2)}</strong>
						) : (
							part
						),
					)}
			{image.credit ? ` · ${image.credit}` : ""}
		</>
	);
}
