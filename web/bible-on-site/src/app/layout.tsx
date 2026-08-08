import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import Image from "next/image";
import Link from "next/link";
import {
	buildGraph,
	organizationNode,
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
	title: 'תנ"ך על הפרק',
	description:
		'לימוד יומי על הפרק. בתנ"ך על הפרק לומדים במקביל ללימוד של 929 - פרק ליום. הלימוד נעים, מעמיק ומחכים',
};

const siteJsonLd = buildGraph([organizationNode(), websiteNode()]);

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="he" dir="rtl">
			<head>
				<GoogleAnalytics />
				<JsonLd data={siteJsonLd} />
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable}`}>
				<nav className="top-nav">
					<Link href="/">
						<Image
							src="/images/logos/logo-white-letters-69.webp"
							alt='תנ"ך על הפרק'
							width={72}
							height={72}
						/>
					</Link>
				</nav>

				<NavBar />
				{children}
			</body>
		</html>
	);
}
