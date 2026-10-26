import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { READER_SETTINGS_BOOTSTRAP } from "@/lib/reader-settings";
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

/* istanbul ignore next */
const geistSans = localFont({
	src: "./fonts/GeistVF.woff",
	variable: "--font-geist-sans",
});
/* istanbul ignore next */
const geistMono = localFont({
	src: "./fonts/GeistMonoVF.woff",
	variable: "--font-geist-mono",
});

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
				<AhrefsAnalytics />
				<GoogleAnalytics />
				<JsonLd data={siteJsonLd} />
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable}`}>
				<TopNav />

				<NavBar />
				{children}
			</body>
		</html>
	);
}
