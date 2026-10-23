// Annotates deliberate generic-catch failure boundaries with the dual
// convention: `//NOSONAR` (Codacy/Qodana) + `#pragma warning disable/restore`
// (SonarAnalyzer.Roslyn, which does not honor //NOSONAR).
const { readFileSync, writeFileSync } = require("node:fs");

const SITES = {
	"app\\BibleOnSite\\App.xaml.cs": {
		11: "init failure is logged then rethrown",
		32: "window-creation failure is logged then rethrown",
	},
	"app\\BibleOnSite\\Config\\AppConfig.cs": { 107: "packaged-config probe degrades to a null fallback" },
	"app\\BibleOnSite\\Controls\\FloatingSearchBar.Filters.cs": { 150: "commentary-pack probe: any failure counts as unavailable" },
	"app\\BibleOnSite\\Controls\\FloatingSearchBar.xaml.cs": {
		73: "pack watcher attach is best-effort; a host without packs keeps static availability",
		173: "search-init failure surfaces as a user-facing error message",
		256: "user-triggered search failure is logged; status refresh continues",
		286: "keyboard dismissal is best-effort",
		643: "recent-searches load degrades to an empty list",
		656: "recent-search persistence is best-effort",
	},
	"app\\BibleOnSite\\Controls\\HtmlView.cs": { 70: "commentary-cell load failure swaps in fallback text" },
	"app\\BibleOnSite\\Controls\\TanahpediaPlacesMap.cs": { 100: "map-link launcher failure must not break interception" },
	"app\\BibleOnSite\\Controls\\TanahpediaSearchPanel.xaml.cs": { 270: null, 297: null },
	"app\\BibleOnSite\\Controls\\ViewportTextView.cs": {
		141: "commentary accessibility section exposure is best-effort diagnostics",
		233: "commentary accessibility measurement is best-effort diagnostics",
	},
	"app\\BibleOnSite\\Helpers\\ExitConfirmation.cs": { 66: "exit-prompt failure falls through to normal exit" },
	"app\\BibleOnSite\\Helpers\\HtmlAttributedStringFactory.cs": {
		76: "attributed-string parse failure falls back to plain text",
	},
	"app\\BibleOnSite\\MainPage.xaml.cs": { 47: "starter-data load failure proceeds offline" },
	"app\\BibleOnSite\\Pages\\ContactPage.xaml.cs": {
		16: "external launcher failure is log-only",
		28: "external launcher failure is log-only",
		41: "external launcher failure is log-only",
	},
	"app\\BibleOnSite\\Pages\\LoadingPage.xaml.cs": { 53: "parallel-load fault observation is deliberate, then rethrown" },
	"app\\BibleOnSite\\MauiProgram.cs": { 134: "Firebase init failure disables analytics, not the app" },
	"app\\BibleOnSite\\Pages\\ArticleDetailPage.xaml.cs": { 108: "article load failure surfaces as ErrorMessage" },
	"app\\BibleOnSite\\Pages\\MasoraPage.PerushimPanel.cs": {
		94: null,
		109: "settings navigation failure is log-only",
	},
	"app\\BibleOnSite\\Pages\\MasoraPage.xaml.cs": {
		260: "unit load failure surfaces as a user alert",
		508: "articles-count badge degrades to hidden",
		537: "articles-button styling failure is log-only",
		581: "article navigation failure is log-only",
	},
	"app\\BibleOnSite\\Pages\\ParashaPage.PerushimPanel.cs": { 94: null },
	"app\\BibleOnSite\\Pages\\ParashaPage.Search.cs": { 286: "search-result navigation failure alerts the user" },
	"app\\BibleOnSite\\Pages\\ParashaPage.WindowsBack.cs": { 95: "reader Back navigation failure is log-only" },
	"app\\BibleOnSite\\Pages\\PerekPage.Search.cs": { 305: "search-result navigation failure alerts the user" },
	"app\\BibleOnSite\\Pages\\PerekPage.WindowsBack.cs": { 95: "reader Back navigation failure is log-only" },
	"app\\BibleOnSite\\Pages\\ParashaPage.Recitation.cs": {
		82: "recitation-pack init is best-effort; availability simply stays off",
		418: "focused-commentary refresh is best-effort",
		733: "playback failure shows the user alert unless the request was canceled",
	},
	"app\\BibleOnSite\\Pages\\ParashaPage.Selection.cs": { 357: "haptic feedback is best-effort" },
	"app\\BibleOnSite\\Pages\\ParashaPage.xaml.cs": {
		457: "on-appearing refresh is best-effort",
		894: "articles-count badge degrades to hidden",
		925: "articles-button styling failure is log-only",
		969: "article navigation failure is log-only",
	},
	"app\\BibleOnSite\\Pages\\PerekPage.Recitation.cs": {
		66: "recitation-pack init is best-effort; availability simply stays off",
		388: "focused-commentary refresh is best-effort",
		589: "playback failure shows the user alert unless the request was canceled",
	},
	"app\\BibleOnSite\\Pages\\PerekPage.xaml.cs": {
		722: "on-appearing refresh is best-effort",
		844: "articles-count badge degrades to hidden",
		1288: "haptic feedback is best-effort",
		1617: "articles-view transition must not crash the reader",
		1651: "articles-view transition must not crash the reader",
		1704: "flip animation falls back to a visibility swap",
		1746: "articles list degrades to empty",
		1833: null,
		1688: "perek-view styling failure is log-only",
		1864: "settings navigation failure is log-only",
	},
	"app\\BibleOnSite\\Pages\\TanahpediaEntryPage.xaml.cs": { 124: "occurrence navigation failure alerts the user" },
	"app\\BibleOnSite\\Platforms\\Windows\\Handlers\\HtmlViewHandler.cs": { 114: "HTML render failure falls back to plain text" },
	"app\\BibleOnSite\\Services\\AccessibilityStatement.cs": { 18: null },
	"app\\BibleOnSite\\Services\\ArticleService.cs": {
		83: "remote article fetch degrades to an empty list",
		143: "remote article fetch degrades to null",
		199: "remote author fetch degrades to an empty list",
	},
	"app\\BibleOnSite\\Services\\AnalyticsService.cs": {
		50: "analytics event failure must never crash the reader",
		72: "analytics event failure must never crash the reader",
	},
	"app\\BibleOnSite\\Services\\MpegRecitationAudioDecoder.cs": { 32: "JS reset failure marks the decoder uninitialized so the next use retries" },
	"app\\BibleOnSite\\Services\\NetworkService.cs": { 77: "connectivity-refresh failure is log-only" },
	"app\\BibleOnSite\\Services\\PadDeliveryService.cs": {
		79: "optional-payload absence is diagnostic output, not fatal",
		253: "pack-location probe: any failure counts as unavailable",
		355: "pack fetch failure is surfaced via LastAndroidPadError and a false result",
		393: "diagnostics collection: pack-location failure becomes a report line",
		434: "diagnostics collection: installer-source failure becomes a report line",
		545: "asset-path lookup failure counts as unavailable",
		614: "delivery fetch failure is surfaced via LastIosDeliveryError and a false result",
		805: "payload save failure returns a false result",
		830: "download cancel is best-effort",
		851: "diagnostics collection: cached-file info failure becomes a report line",
		867: "diagnostics collection: Info.plist probe failure becomes a report line",
		880: "diagnostics collection: app-group probe failure becomes a report line",
		917: "diagnostics collection: local-status probe failure becomes a report line",
		927: "diagnostics collection: availability probe failure becomes a report line",
		938: "diagnostics collection: store-pack list failure becomes a report line",
		950: "diagnostics collection: disk-space probe failure becomes a report line",
	},
	"app\\BibleOnSite\\Services\\PerushimNotesService.cs": {
		193: "diagnostics collection: any failure becomes a report line",
		200: "diagnostics collection: any failure becomes a report line",
		242: "diagnostics collection: any failure becomes a report line",
		521: "validation failure rejects the pack generation",
		805: "PAD check/upgrade is best-effort",
		880: "pack copy failure degrades to not-copied",
		933: "package copy failure degrades to not-copied",
	},
	"app\\BibleOnSite\\Services\\PreferencesService.cs": { 617: "corrupt bookmarks JSON resets to an empty set" },
	"app\\BibleOnSite\\Services\\StarterService.cs": {
		228: "starter API failure falls back to local cache",
		243: "cache load failure proceeds offline without articles",
		267: "background refresh failure is log-only",
		285: "cache save is best-effort",
	},
	"app\\BibleOnSite\\ViewModels\\ArticlesViewModel.cs": {
		243: "author search failure surfaces as a user message",
		329: "articles load failure surfaces as a user message",
	},
	"app\\BibleOnSite\\ViewModels\\AuthorsViewModel.cs": { 109: "authors load failure surfaces as a user message" },
	"app\\BibleOnSite\\ViewModels\\ExtensionPacksViewModel.cs": { 90: null, 120: null },
	"app\\BibleOnSite\\ViewModels\\LearningCalendarViewModel.cs": { 167: "calendar load failure surfaces as ErrorMessage" },
	"app\\BibleOnSite\\ViewModels\\PerekViewModel.cs": {
		508: "a superseded load attempt's late failure is log-only",
		1142: "carousel preload is best-effort",
		1191: "navigation failure alerts the user",
		1208: "navigation failure alerts the user",
		1233: "log export failure alerts the user",
	},
	"app\\BibleOnSite\\ViewModels\\PreferencesViewModel.cs": { 184: null, 186: null },
	"app\\BibleOnSite\\ViewModels\\RecitationPacksViewModel.cs": {
		157: null, 213: null, 249: null,
		335: "multi-source download failure collapses to one retriable status",
	},
	"app\\BibleOnSite\\ViewModels\\SearchViewModel.cs": {
		144: "availability probe: any failure counts as unavailable",
		161: "availability probe: any failure counts as unavailable",
		658: "remote article search degrades to an availability note",
		708: "remote pedia search degrades to an availability note",
	},
	"app\\BibleOnSite\\ViewModels\\SupportPreferencesViewModel.cs": { 53: null },
	"app\\BibleOnSite\\ViewModels\\TanahpediaEntityTypeViewModel.cs": {
		118: "homepage load degrades; entities still render",
		133: "place-marker load drops the map, not the page",
		145: "category load failure surfaces as ErrorMessage",
	},
	"app\\BibleOnSite\\ViewModels\\TanahpediaEntryViewModel.cs": {
		199: "entry load failure surfaces as ErrorMessage",
		285: "family-section load is best-effort",
		297: "place-marker load is best-effort",
		356: "occurrences mapping failure drops the table, not the page",
	},
	"app\\BibleOnSite\\ViewModels\\TanahpediaSearchViewModel.cs": { 231: null },
	"app\\BibleOnSite\\ViewModels\\TanahpediaViewModel.cs": { 97: "landing load failure surfaces as ErrorMessage" },
	"app\\devops\\Build.Run.cs": {
		74: "API probe: any failure counts as not-running",
		88: "TCP probe: any failure counts as closed",
		209: "env-file load failure warns and continues with defaults",
		415: "adb package probe: any failure counts as not-installed",
		575: "adb device probe: any failure counts as no-device",
		623: "adb id probe: any failure counts as absent",
		674: "avd probe: any failure counts as none",
		754: "adb push probe: any failure counts as failed",
	},
};

let changed = 0;
for (const [file, lines] of Object.entries(SITES)) {
	const src = readFileSync(file, "utf8").split("\n");
	const wanted = new Set(Object.keys(lines).map(Number));
	// Process bottom-up so insertions don't shift pending line numbers.
	for (const ln of [...wanted].sort((a, b) => b - a)) {
		// Locate the generic catch clause at/near the recorded line.
		// Drift tolerance covers pragma lines added by earlier runs.
		const GENERIC = /\bcatch\s*(\((System\.)?Exception\b[^)]*\))?\s*(\{|$|when\b|\/\/)/;
		let idx = -1;
		for (let d = 0; d <= 40 && idx < 0; d++) {
			for (const cand of [ln - 1 + d, ln - 1 - d]) {
				if (cand >= 0 && cand < src.length && GENERIC.test(src[cand])) idx = cand;
			}
		}
		if (idx < 0) throw new Error(`no catch near ${file}:${ln}`);
		// Already annotated by a previous run: pragma disable within 3 lines above.
		const above = src.slice(Math.max(0, idx - 3), idx).join("\n");
		if (/#pragma warning disable S2221/.test(above)) continue;
		const catchLine = src[idx];
		const indent = catchLine.match(/^\s*/)[0];
		const reason = lines[ln];
		let newCatch = catchLine;
		if (!/NOSONAR/.test(newCatch)) {
			if (!reason) throw new Error(`missing reason for ${file}:${ln}`);
			newCatch = `${newCatch.trimEnd()} //NOSONAR — ${reason}.`;
		}
		const pragmaReason = reason ?? "see the //NOSONAR note";
		const disable = `${indent}#pragma warning disable S2221 // Deliberate failure boundary: ${pragmaReason}`;
		const singleLine = /\{\s*.*\}\s*(\/\/.*)?$/.test(newCatch) && /\}/.test(newCatch);
		const restore = `${singleLine ? indent : `${indent}    `}#pragma warning restore S2221`;
		if (singleLine) {
			src.splice(idx, 1, disable, newCatch, restore);
		} else {
			// Find the line holding the catch body's opening '{'.
			let brace = idx;
			while (brace < src.length && !src[brace].includes("{")) brace++;
			src.splice(brace + 1, 0, restore);
			src.splice(idx, 1, disable, newCatch);
		}
		changed++;
	}
	writeFileSync(file, src.join("\n"));
}
console.log(`annotated ${changed} catch clauses`);
