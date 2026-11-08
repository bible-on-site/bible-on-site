/** Shared catalogue/snapshot fixtures for the article-linking tests (#3103). */
import type { TargetCatalogue } from "~/lib/article-linking/catalogue";
import type { ArticleLinkSnapshot } from "~/lib/article-linking/types";

export const catalogue: TargetCatalogue = {
	perakim: [
		{
			id: 1,
			seferName: "בראשית",
			additionalLetter: null,
			perekInContext: 1,
			pasukCount: 31,
		},
		{
			id: 18,
			seferName: "בראשית",
			additionalLetter: null,
			perekInContext: 18,
			pasukCount: 33,
		},
		{
			id: 510,
			seferName: "שמואל",
			additionalLetter: "א",
			perekInContext: 5,
			pasukCount: 44,
		},
		{
			id: 605,
			seferName: "שמואל",
			additionalLetter: "ב",
			perekInContext: 5,
			pasukCount: 25,
		},
		{
			id: 730,
			seferName: "תהילים",
			additionalLetter: null,
			perekInContext: 119,
			pasukCount: 176,
		},
		{
			id: 800,
			seferName: "עזרא",
			additionalLetter: "ע",
			perekInContext: 7,
			pasukCount: 28,
		},
		{
			id: 810,
			seferName: "עזרא",
			additionalLetter: "נ",
			perekInContext: 3,
			pasukCount: 22,
		},
	],
	authors: [{ id: 2, name: "הרב קוק" }],
	dedications: [{ id: 5, subject: "לעילוי נשמת אבי" }],
};

export const snapshot: ArticleLinkSnapshot = {
	perekId: 1,
	authorId: 2,
	coverageVerified: true,
	coveringSources: [
		{ perekId: 1, pasuk: 1 },
		{ perekId: 1, pasuk: 2 },
	],
	dedicationIds: [],
};
