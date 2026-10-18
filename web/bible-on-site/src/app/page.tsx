import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/seo/jsonld";

export const metadata: Metadata = {
	title: `${SITE_NAME} - קריאה ולימוד תנ"ך יומי`,
	alternates: { canonical: "/" },
};

export { default } from "./[section]/page";
