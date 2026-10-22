import type { Metadata } from "next";
import { Suspense } from "react";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { getCurrentDate } from "@/util/date";
import {
	constructTsetAwareHDate,
	hebcalDateToNumber,
} from "@/util/hebdates-util";
import { LearningCalendar } from "./components/LearningCalendar";

export const metadata: Metadata = {
	title: `לוח לימוד יומי | ${SITE_NAME}`,
	description:
		'לוח לימוד יומי של תנ"ך על הפרק - לוח שנה עברי עם הפרק היומי במחזורי 929, בעבר ובעתיד',
	alternates: { canonical: "/לוח" },
};

// The viewed month defaults to "now" and the grid marks live today, so the
// page renders per request rather than from a build-time snapshot.
export const dynamic = "force-dynamic";

export default function LearningCalendarPage() {
	const today = constructTsetAwareHDate(getCurrentDate());
	return (
		<Suspense>
			<LearningCalendar
				initialYear={today.year}
				initialMonth={today.getUniformMonth()}
				todayDateNumber={hebcalDateToNumber(today)}
			/>
		</Suspense>
	);
}
