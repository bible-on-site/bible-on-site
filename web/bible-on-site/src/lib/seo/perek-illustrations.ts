/** Editorial illustrations available for individual perek pages. */
export interface PerekIllustration {
	src: string;
	avifSrcSet: string;
	socialSrc: string;
	alt: string;
	caption: string;
	summary: string;
}

const illustrations: Partial<Record<number, PerekIllustration>> = {
	1: {
		src: "/images/perakim/bereshit-1-creation.webp",
		avifSrcSet: [640, 960, 1280, 1600]
			.map(
				(width) =>
					`/images/perakim/bereshit-1-creation-${width}.avif ${width}w`,
			)
			.join(", "),
		socialSrc: "/images/perakim/bereshit-1-creation-social.jpg",
		alt: "איור פרשני לבראשית א: אור מעל המים, יבשה וצמחייה, מאורות, עופות ודגים",
		caption:
			"איור פרשני לבראשית א — אור, מים, יבשה, צמחייה ובעלי חיים בסיפור הבריאה.",
		summary:
			"בראשית א מתאר את בריאת העולם: אור וחושך, שמים וים, יבשה וצמחייה, מאורות, בעלי חיים ובריאת האדם.",
	},
};

export function getPerekIllustration(
	perekId: number,
): PerekIllustration | undefined {
	return illustrations[perekId];
}
