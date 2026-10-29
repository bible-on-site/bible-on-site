import type { Metadata } from "next";
import "./globals.css";

import { READER_SETTINGS_BOOTSTRAP } from "@/lib/reader-settings";
import { SITE_A11Y_BOOTSTRAP } from "@/lib/site-a11y-settings";
import {
	buildGraph,
	organizationNode,
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_ORIGIN,
	websiteNode,
} from "@/lib/seo/jsonld";
import { siteOpenGraph } from "@/lib/seo/opengraph";
import { AhrefsAnalytics } from "./components/AhrefsAnalytics";
import { GoogleAnalytics } from "./components/GoogleAnalytics";
import { JsonLd } from "./components/JsonLd";
import { NavBar } from "./components/NavBar";
import { TopNav } from "./components/TopNav";

export const metadata: Metadata = {
	metadataBase: new URL(SITE_ORIGIN),
	title: SITE_NAME,
	applicationName: SITE_NAME,
	description: SITE_DESCRIPTION,
	openGraph: siteOpenGraph({
		title: SITE_NAME,
		description: SITE_DESCRIPTION,
		canonical: "/",
	}),
};

const siteJsonLd = buildGraph([organizationNode(), websiteNode()]);

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang="he"
			dir="rtl"
			data-scroll-behavior="smooth"
			/* The root layout's inline bootstrap applies stored reader settings
			   (CSS vars) to <html> before first paint — suppress the resulting
			   hydration-mismatch warning on this element's attributes. */
			suppressHydrationWarning
		>
			<head>
				<link rel="privacy-policy" href="/#privacyPolicy" />
				{/* Run on the initial document so client-side chapter navigation
				    inherits saved settings too, before the reader's first paint. */}
				<script>{READER_SETTINGS_BOOTSTRAP}</script>
				{/* Site-wide accessibility preferences (contrast/links) — same
				    pre-paint contract for the root data attributes (#2767). */}
				<script>{SITE_A11Y_BOOTSTRAP}</script>
				<AhrefsAnalytics />
				<GoogleAnalytics />
				<JsonLd data={siteJsonLd} />
			</head>
			<body>
				<TopNav />

				<NavBar />
				{children}
			</body>
		</html>
	);
}
