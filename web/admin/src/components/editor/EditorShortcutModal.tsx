import { useMemo, useState } from "react";
import {
	SHORTCUT_EXTRAS_JSON_EXAMPLE,
	SHORTCUT_SECTIONS,
} from "./adminEditorShortcuts";

interface EditorShortcutModalProps {
	open: boolean;
	onClose: () => void;
	extrasDraft: string;
	onExtrasDraftChange: (v: string) => void;
	onSaveExtras: () => void;
}

export function EditorShortcutModal({
	open,
	onClose,
	extrasDraft,
	onExtrasDraftChange,
	onSaveExtras,
}: EditorShortcutModalProps) {
	const [query, setQuery] = useState("");

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return SHORTCUT_SECTIONS;
		return SHORTCUT_SECTIONS.map((sec) => ({
			...sec,
			rows: sec.rows.filter(
				(r) =>
					r.action.toLowerCase().includes(q) ||
					r.keys.toLowerCase().includes(q) ||
					(r.tags?.toLowerCase().includes(q) ?? false),
			),
		})).filter((sec) => sec.rows.length > 0);
	}, [query]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="shortcut-help-title"
		>
			<div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
				<div className="p-4 border-b border-gray-200 space-y-3 shrink-0">
					<div className="flex justify-between items-start gap-2">
						<h2
							id="shortcut-help-title"
							className="text-lg font-bold text-gray-900"
						>
							קיצורי מקלדת
						</h2>
						<button
							type="button"
							onClick={onClose}
							className="text-gray-500 hover:text-gray-800 text-sm px-2"
						>
							✕
						</button>
					</div>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="חיפוש לפי פעולה או מקשים…"
						className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
						dir="rtl"
					/>
					<p className="text-xs text-gray-500">
						במק/Meta מופיע כ־Ctrl בטבלה; בפועל השתמש ב־⌘ במק.
					</p>
				</div>

				<div className="overflow-y-auto flex-1 p-4 space-y-6">
					{filtered.map((sec) => (
						<section key={sec.title}>
							<h3 className="text-sm font-bold text-gray-800 mb-2 border-b border-gray-100 pb-1">
								{sec.title}
							</h3>
							<ul className="space-y-2">
								{sec.rows.map((row) => (
									<li
										key={`${sec.title}-${row.keys}-${row.action}`}
										className="flex flex-wrap gap-x-3 gap-y-1 text-sm"
									>
										<kbd className="font-mono text-xs bg-gray-100 px-2 py-1 rounded border border-gray-200 shrink-0">
											{row.keys}
										</kbd>
										<span className="text-gray-800">{row.action}</span>
									</li>
								))}
							</ul>
						</section>
					))}
					{filtered.length === 0 && (
						<p className="text-sm text-gray-500 text-center py-4">
							אין תוצאות לחיפוש
						</p>
					)}

					<details className="border border-gray-200 rounded-lg p-3 bg-gray-50">
						<summary className="cursor-pointer text-sm font-semibold text-gray-800">
							מתקדם: קיצורים נוספים (JSON)
						</summary>
						<p className="text-xs text-gray-600 mt-2 mb-1">
							מפתח = צירוף TipTap (למשל <code className="bg-white px-1">Mod-Shift-k</code>
							), ערך = פקודה:
						</p>
						<p className="text-xs text-gray-500 mb-2 font-mono break-all">
							link | bold | italic | bulletList | orderedList | heading:1 … heading:6
						</p>
						<pre className="text-xs bg-white p-2 rounded mb-2 overflow-x-auto border">
							{SHORTCUT_EXTRAS_JSON_EXAMPLE}
						</pre>
						<textarea
							value={extrasDraft}
							onChange={(e) => onExtrasDraftChange(e.target.value)}
							className="w-full min-h-[88px] border border-gray-300 rounded-lg p-2 font-mono text-xs"
							dir="ltr"
							spellCheck={false}
							aria-label="קיצורים מותאמים JSON"
						/>
					</details>
				</div>

				<div className="flex justify-end gap-2 p-4 border-t border-gray-200 shrink-0 bg-white">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
					>
						סגור
					</button>
					<button
						type="button"
						onClick={onSaveExtras}
						className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
					>
						שמור JSON והחל עורך
					</button>
				</div>
			</div>
		</div>
	);
}
