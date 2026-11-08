import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";

export const metadata: Metadata = pageMetadata({
	title: SITE_NAME,
	description: SITE_DESCRIPTION,
	canonical: "/",
});

export { default } from "./[section]/page";
