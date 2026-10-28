/**
 * The human-traffic gate inlined by {@link GoogleAnalytics} (issue #2736).
 *
 * Exported as a module so unit and e2e tests execute the exact script text
 * that ships to production instead of a hand-maintained copy.
 *
 * The ~90 KiB gtag/js payload is injected only after the existing
 * human-traffic decision (UA filter + BotD) permits it, so traffic rejected
 * as automated never downloads it. Consent defaults and the queued gtag
 * events match the standard Google snippet: `dataLayer` is populated first,
 * then the library drains the queue when it arrives.
 */
export const GA_GATE_SCRIPT = `
(function() {
	var ua = navigator.userAgent || '';
	if (/bot|crawl|spider|slurp|Bytespider|GPTBot|ClaudeBot|CCBot|Amazonbot|Diffbot|PetalBot|AhrefsBot|SemrushBot|DotBot|MJ12bot|BLEXBot|YandexBot|Sogou|Applebot|Googlebot|bingbot|PerplexityBot|FacebookBot|anthropic|TikTokSpider|Baiduspider|MegaIndex/i.test(ua)) {
		return;
	}
	function initGA() {
		window.dataLayer = window.dataLayer || [];
		function gtag(){dataLayer.push(arguments);}
		var el = document.createElement('script');
		el.async = true;
		el.src = 'https://www.googletagmanager.com/gtag/js?id=G-2CHER7MM85';
		document.head.appendChild(el);
		gtag('js', new Date());
		gtag('consent', 'default', {ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied'});
		gtag('config', 'G-2CHER7MM85', {allow_google_signals: false, allow_ad_personalization_signals: false});
	}
	import('https://openfpcdn.io/botd/v2').then(function(Botd) {
		return Botd.load({ monitoring: false });
	}).then(function(botd) {
		return botd.detect();
	}).then(function(result) {
		if (!result.bot) { initGA(); }
	}).catch(function() {
		initGA();
	});
})();
`;
