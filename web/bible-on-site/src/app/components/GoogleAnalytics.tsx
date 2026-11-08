import Script from "next/script";
import { isProduction } from "@/util/environment";
import { GA_GATE_SCRIPT } from "./google-analytics-gate";

/**
 * Ordinary service statistics. Advertising features remain disabled.
 *
 * The external gtag/js library is injected dynamically only after the
 * human-traffic decision inside {@link GA_GATE_SCRIPT} permits it, so
 * automated traffic never pays the ~90 KiB download (issue #2736).
 */
export function GoogleAnalytics() {
	if (!isProduction()) return null;

	return (
		<Script id="google-analytics" strategy="afterInteractive">
			{GA_GATE_SCRIPT}
		</Script>
	);
}
