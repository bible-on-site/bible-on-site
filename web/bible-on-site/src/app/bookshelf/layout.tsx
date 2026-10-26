import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import "./layout.css";

export const metadata: Metadata = pageMetadata({
	title: `ספרי התנ"ך | ${SITE_NAME}`,
	description: 'מדף ספרי התנ"ך - בחירת ספר לקריאה ולימוד הפרק היומי.',
	canonical: "/bookshelf",
});

export default function BookshelfLayout({ children }: { children: ReactNode }) {
	return <div className="bookshelf-layout">{children}</div>;
}
