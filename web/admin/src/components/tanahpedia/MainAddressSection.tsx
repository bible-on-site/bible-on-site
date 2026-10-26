import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	pediaNameFromInput,
	pediaPublicUrl,
} from "~/lib/tanahpedia/pedia-names";
import { checkPediaName } from "~/server/tanahpedia/aliases";

interface MainAddressSectionProps {
	/** The entry being edited, or null for a not-yet-saved entry. */
	entryId: string | null;
	/** The committed unique_name ("" for a new entry) — rename detection base. */
	savedUniqueName: string;
	value: string;
	onValueChange: (value: string) => void;
	websiteBase: string;
	/** Rename flow: whether to keep the old address as an alias to this entry. */
	keepOldAsAlias: boolean;
	onKeepOldAsAliasChange: (keep: boolean) => void;
}

const STATUS_DEBOUNCE_MS = 300;

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(t);
	}, [value, delayMs]);
	return debounced;
}

/**
 * The entry's main public address: the unique_name that determines the
 * `/pedia/<name>` path. Part of the entry draft — committed only by "שמור
 * עכשיו" — but explains itself, previews the complete URL, offers copy/open
 * actions, validates collisions/reserved routes live, and makes a rename an
 * explicit choice with inbound-link preservation.
 */
export function MainAddressSection({
	entryId,
	savedUniqueName,
	value,
	onValueChange,
	websiteBase,
	keepOldAsAlias,
	onKeepOldAsAliasChange,
}: MainAddressSectionProps) {
	const parsedName = pediaNameFromInput(value);
	const debouncedName = useDebouncedValue(parsedName, STATUS_DEBOUNCE_MS);
	const [copied, setCopied] = useState(false);

	const previewName = parsedName || savedUniqueName;
	const previewUrl = previewName
		? pediaPublicUrl(websiteBase, previewName)
		: null;

	const { data: status } = useQuery({
		queryKey: ["pedia-name-status", debouncedName, entryId],
		queryFn: () =>
			checkPediaName({ data: { name: debouncedName, forEntryId: entryId } }),
		enabled: debouncedName.length > 0,
		staleTime: 10_000,
	});

	const renaming =
		savedUniqueName.length > 0 &&
		parsedName.length > 0 &&
		parsedName !== savedUniqueName;

	// While renaming, the old name still resolves to this entry — its status
	// tells us whether keeping it as an alias is even needed/possible.
	const { data: oldNameStatus } = useQuery({
		queryKey: ["pedia-name-status-old", savedUniqueName, entryId],
		queryFn: () =>
			checkPediaName({
				data: { name: savedUniqueName, forEntryId: entryId },
			}),
		enabled: renaming,
		staleTime: 10_000,
	});

	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);

	const otherOldTargets =
		oldNameStatus?.kind === "self-main" || oldNameStatus?.kind === "canonical"
			? oldNameStatus.aliasTargets.filter((t) => t.entryId !== entryId)
			: [];
	const selfOldTarget =
		oldNameStatus?.kind === "self-main" || oldNameStatus?.kind === "canonical"
			? oldNameStatus.aliasTargets.some((t) => t.entryId === entryId)
			: false;

	return (
		<section
			aria-labelledby="main-address-heading"
			className="rounded-xl border border-blue-100 bg-blue-50/40 p-5 space-y-4"
		>
			<div>
				<h3
					id="main-address-heading"
					className="text-base font-semibold text-gray-900"
				>
					כתובת ראשית
				</h3>
				<p className="mt-1 text-sm text-gray-600 leading-relaxed">
					הכותרת היא טקסט התצוגה של הערך בלבד. השם הייחודי קובע את המקטע האחרון
					של הכתובת הציבורית — הוא מה שמופיע בקישור. אפשר להקליד רק את השם או
					להדביק כתובת מלאה מהאתר; המערכת תיקח את המקטע האחרון. מזהה הערך הפנימי
					אינו חלק מהכתובת.
				</p>
			</div>

			<div>
				<label
					htmlFor="unique_name"
					className="block text-sm font-semibold text-gray-700 mb-2"
				>
					שם ייחודי <span className="text-red-500">*</span>
				</label>
				<input
					id="unique_name"
					type="text"
					value={value}
					onChange={(e) => onValueChange(e.target.value)}
					onBlur={() => {
						const parsed = pediaNameFromInput(value);
						if (parsed !== value) onValueChange(parsed);
					}}
					className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
					placeholder="למשל: משה-רבנו"
					dir="auto"
				/>
				<p className="mt-1 text-xs text-gray-500">
					הקלד שם (אותיות, ספרות, רווחים ומקפים) או הדבק כתובת קיימת — למשל: משה
					רבנו, משה-רבנו.
				</p>
			</div>

			{previewUrl && (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm text-gray-600">הכתובת תהיה:</span>
					<a
						href={previewUrl}
						target="_blank"
						rel="noreferrer"
						dir="ltr"
						className="text-sm font-mono text-blue-700 hover:underline break-all"
					>
						{previewUrl}
					</a>
					<button
						type="button"
						onClick={() => {
							void navigator.clipboard
								?.writeText(previewUrl)
								.then(() => setCopied(true))
								.catch(() => setCopied(false));
						}}
						className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
					>
						{copied ? "הועתק!" : "העתק קישור"}
					</button>
					<a
						href={previewUrl}
						target="_blank"
						rel="noreferrer"
						className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
					>
						פתח תצוגה
					</a>
				</div>
			)}

			{status?.kind === "invalid" && (
				<p className="text-sm text-red-700">{status.reason}</p>
			)}
			{status?.kind === "reserved" && (
				<p className="text-sm text-red-700">
					השם «{status.name}» שמור לנתיב הקטגוריה «{status.categoryLabel}» — הדף
					הציבורי שלו תמיד יציג את הקטגוריה. בחר שם אחר.
				</p>
			)}
			{status?.kind === "canonical" && (
				<p className="text-sm text-red-700">
					השם «{status.name}» תפוס על ידי הערך «{status.entry.title}» — הכתובת
					הראשית של ערך תמיד גוברת. בחר שם אחר.
				</p>
			)}
			{status?.kind === "alias" && (
				<div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
					השם «{status.name}» משמש היום ככתובת נוספת של{" "}
					{status.targets.map((t) => `«${t.title}»`).join(", ")}. הפיכתו לכתובת
					הראשית של ערך זה תקפה את ההפניות האלה — הן יישארו רשומות אך יוצלו על
					ידי הכתובת הראשית.
				</div>
			)}
			{status?.kind === "free" && renaming === false && parsedName && (
				<p className="text-sm text-green-700">הכתובת פנויה.</p>
			)}

			{renaming && (
				<div className="rounded-lg border border-blue-200 bg-white p-4 space-y-3">
					<p className="text-sm font-medium text-gray-800">
						שינוי כתובת:{" "}
						<span dir="ltr" className="font-mono text-gray-600">
							/pedia/{encodeURIComponent(savedUniqueName)}
						</span>{" "}
						←{" "}
						<span dir="ltr" className="font-mono text-blue-700">
							/pedia/{encodeURIComponent(parsedName)}
						</span>
					</p>

					{otherOldTargets.length > 0 ? (
						<p className="text-sm text-amber-800">
							השם «{savedUniqueName}» משותף גם עם{" "}
							{otherOldTargets.map((t) => `«${t.title}»`).join(", ")} — לאחר
							השינוי הכתובת הישנה תוביל אליהם בלבד. כדי לשמור גם ערך זה כיעד של
							השם המשותף, הוסף אותו במקטע «כתובות נוספות» לאחר השמירה יחד עם
							תווית מבדנת.
						</p>
					) : selfOldTarget ? (
						<p className="text-sm text-gray-600">
							הכתובת הקודמת כבר רשומה כשם חלופי של ערך זה — קישורים אליה ימשיכו
							לעבוד אוטומטית.
						</p>
					) : (
						<label className="flex items-start gap-2 text-sm text-gray-800">
							<input
								type="checkbox"
								checked={keepOldAsAlias}
								onChange={(e) => onKeepOldAsAliasChange(e.target.checked)}
								className="mt-1"
							/>
							<span>
								שמור את הכתובת הקודמת כשם חלופי שמפנה לערך זה — מומלץ, כך
								קישורים קיימים ממשיכים לעבוד.
							</span>
						</label>
					)}
				</div>
			)}
		</section>
	);
}
