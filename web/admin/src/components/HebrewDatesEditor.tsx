import { useRef } from "react";
import type { HebrewDateAssignment } from "~/server/hebrew-dates";

interface HebrewDatesEditorProps {
	dates: HebrewDateAssignment[];
	onChange: (dates: HebrewDateAssignment[]) => void;
}

/** Uniform month numbering shared with the app, the API and the DB (#3098). */
const UNIFORM_MONTHS: { value: number; label: string; maxDay: number }[] = [
	{ value: 1, label: "תשרי", maxDay: 30 },
	{ value: 2, label: "חשוון", maxDay: 30 },
	{ value: 3, label: "כסלו", maxDay: 30 },
	{ value: 4, label: "טבת", maxDay: 29 },
	{ value: 5, label: "שבט", maxDay: 30 },
	{ value: 6, label: "אדר", maxDay: 29 },
	{ value: 7, label: "ניסן", maxDay: 30 },
	{ value: 8, label: "אייר", maxDay: 29 },
	{ value: 9, label: "סיוון", maxDay: 30 },
	{ value: 10, label: "תמוז", maxDay: 29 },
	{ value: 11, label: "אב", maxDay: 30 },
	{ value: 12, label: "אלול", maxDay: 29 },
	{ value: 13, label: "אדר א'", maxDay: 30 },
	{ value: 14, label: "אדר ב'", maxDay: 29 },
];

const maxDayFor = (month: number) =>
	UNIFORM_MONTHS.find((m) => m.value === month)?.maxDay ?? 30;

/**
 * Editor for the article's recurring Hebrew-date assignments (#3098): each
 * row is one month/day the article alone represents every Hebrew year on the
 * day's daily perek. At most one article may hold a date — the save rejects
 * conflicts server-side.
 */
export function HebrewDatesEditor({ dates, onChange }: HebrewDatesEditorProps) {
	// Rows carry no stable id — WeakMap keys keep identity per row object so
	// edits never reuse a DOM node for a different date pair.
	const rowKeys = useRef(new WeakMap<HebrewDateAssignment, string>());
	const nextKey = useRef(0);
	const keyOf = (row: HebrewDateAssignment) => {
		let key = rowKeys.current.get(row);
		if (!key) {
			key = `hd-${nextKey.current++}`;
			rowKeys.current.set(row, key);
		}
		return key;
	};

	const update = (index: number, patch: Partial<HebrewDateAssignment>) => {
		onChange(
			dates.map((row, i) => {
				if (i !== index) return row;
				const next = { ...row, ...patch };
				if (patch.hebrew_month !== undefined) {
					// Clamp the day to the newly chosen month's real maximum.
					next.hebrew_day = Math.min(
						next.hebrew_day,
						maxDayFor(next.hebrew_month),
					);
				}
				return next;
			}),
		);
	};

	return (
		<div>
			<span className="block text-sm font-semibold text-gray-700 mb-2">
				📅 שיוך לתאריך עברי (חוזר מדי שנה)
			</span>
			<p className="text-xs text-gray-500 mb-3">
				בכל תאריך משויך המאמר מוצג כמאמר היחיד של אותו יום על פרק היומי —
				באפליקציה, באתר ובעלון. ניתן לשייך תאריך אחד למאמר אחד בלבד.
			</p>
			{dates.length === 0 && (
				<p className="text-sm text-gray-400 mb-2">אין תאריכים משויכים</p>
			)}
			<ul className="space-y-2">
				{dates.map((row, index) => (
					<li key={keyOf(row)} className="flex items-center gap-2">
						<select
							value={row.hebrew_month}
							onChange={(e) =>
								update(index, { hebrew_month: Number(e.target.value) })
							}
							className="border border-gray-300 rounded-lg px-3 py-2"
						>
							{UNIFORM_MONTHS.map((month) => (
								<option key={month.value} value={month.value}>
									{month.label}
								</option>
							))}
						</select>
						<input
							type="number"
							min={1}
							max={maxDayFor(row.hebrew_month)}
							value={row.hebrew_day}
							onChange={(e) =>
								update(index, {
									hebrew_day: Number(e.target.value),
								})
							}
							className="w-20 border border-gray-300 rounded-lg px-3 py-2"
						/>
						<button
							type="button"
							onClick={() => onChange(dates.filter((_, i) => i !== index))}
							className="text-red-600 hover:text-red-800 px-2"
							title="הסר תאריך"
						>
							✕
						</button>
					</li>
				))}
			</ul>
			<button
				type="button"
				onClick={() => onChange([...dates, { hebrew_month: 1, hebrew_day: 1 }])}
				className="mt-2 text-sm text-blue-600 hover:text-blue-800"
			>
				+ הוסף תאריך
			</button>
		</div>
	);
}
