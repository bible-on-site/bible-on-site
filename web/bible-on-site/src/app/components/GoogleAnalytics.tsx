import Script from "next/script";
import { isProduction } from "@/util/environment";

const GA_MEASUREMENT_ID = "G-2CHER7MM85";

export function GoogleAnalytics() {
	if (!isProduction()) {
		return null;
	}

	return (
		<>
			<Script
				src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
				strategy="afterInteractive"
			/>
			<Script id="google-analytics" strategy="afterInteractive">
				{`
					(function() {
						var ua = navigator.userAgent || '';
						if (/bot|crawl|spider|slurp|Bytespider|GPTBot|ClaudeBot|CCBot|Amazonbot|Diffbot|PetalBot|AhrefsBot|SemrushBot|DotBot|MJ12bot|BLEXBot|YandexBot|Sogou|Applebot|Googlebot|bingbot|PerplexityBot|FacebookBot|anthropic|TikTokSpider|Baiduspider|MegaIndex/i.test(ua)) {
							return;
						}
						function initGA() {
							window.dataLayer = window.dataLayer || [];
							function gtag(){dataLayer.push(arguments);}
							gtag('js', new Date());
							gtag('config', '${GA_MEASUREMENT_ID}');
						}
						import('https://openfpcdn.io/botd/v2').then(function(Botd) {
							return Botd.load();
						}).then(function(botd) {
							return botd.detect();
						}).then(function(result) {
							if (!result.bot) { initGA(); }
						}).catch(function() {
							initGA();
						});
					})();
				`}
			</Script>
		</>
	);
}
