import type { Metadata } from "next";
import { Suspense } from "react";
import { calendarPdfManifestUrl } from "@/lib/download/calendar-pdf-manifest";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import { LiveLearningCalendar } from "./components/LiveLearningCalendar";

export const metadata: Metadata = pageMetadata({
	title: `לוח לימוד יומי | ${SITE_NAME}`,
	description:
		'לוח לימוד יומי של תנ"ך על הפרק - לוח שנה עברי עם הפרק היומי במחזורי 929, בעבר ובעתיד',
	canonical: "/לוח",
});

// The shell is static; the browser owns the Jerusalem/nightfall-aware date.
export const dynamic = "force-static";

export default function LearningCalendarPage() {
	return (
		<Suspense>
			<LiveLearningCalendar pdfManifestUrl={calendarPdfManifestUrl()} />
		</Suspense>
	);
}
