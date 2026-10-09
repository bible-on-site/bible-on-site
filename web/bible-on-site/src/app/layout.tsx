import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import Image from "next/image";
import Link from "next/link";
import { READER_SETTINGS_BOOTSTRAP } from "@/lib/reader-settings";
import {
	buildGraph,
	organizationNode,
	SITE_NAME,
	SITE_ORIGIN,
	websiteNode,
} from "@/lib/seo/jsonld";
import { GoogleAnalytics } from "./components/GoogleAnalytics";
import { JsonLd } from "./components/JsonLd";
import { NavBar } from "./components/NavBar";

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
	description:
		'לימוד יומי על הפרק. בתנ"ך על הפרק לומדים במקביל ללימוד של 929 - פרק ליום. הלימוד נעים, מעמיק ומחכים',
	openGraph: {
		siteName: SITE_NAME,
		locale: "he_IL",
	},
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
				{/* Run on the initial document so client-side chapter navigation
				    inherits saved settings too, before the reader's first paint. */}
				<script>{READER_SETTINGS_BOOTSTRAP}</script>
				<GoogleAnalytics />
				<JsonLd data={siteJsonLd} />
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable}`}>
				<nav className="top-nav">
					<Link href="/">
						<Image
							src="/images/logos/logo-white-letters-69.webp"
							alt='תנ"ך על הפרק'
							loading="eager"
							width={69}
							height={50}
							style={{ width: 72, height: "auto" }}
						/>
					</Link>
				</nav>

				<NavBar />
				{children}
			</body>
		</html>
	);
}
