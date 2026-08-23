import { useEffect, useMemo, useRef, useState } from "react";

export interface EntryLinkOption {
	id: string;
	title: string;
	uniqueName: string;
}

export type EntrySearch = (query: string) => Promise<EntryLinkOption[]>;

interface EntryLinkPickerProps {
	search: EntrySearch;
	onSelect: (entry: EntryLinkOption) => void;
	/** Marks the entry currently targeted by the link being edited. */
	selectedUniqueName?: string;
}

const DEBOUNCE_MS = 250;
const MAX_VISIBLE = 20;

export function EntryLinkPicker({
	search,
	onSelect,
	selectedUniqueName,
}: EntryLinkPickerProps) {
	const [query, setQuery] = useState("");
	const [options, setOptions] = useState<EntryLinkOption[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const requestId = useRef(0);

	useEffect(() => {
		const id = requestId.current + 1;
		requestId.current = id;
		setLoading(true);
		setError(false);
		const timer = setTimeout(() => {
			search(query)
				.then((result) => {
					if (requestId.current !== id) return;
					setOptions(result);
					setLoading(false);
				})
				.catch(() => {
					if (requestId.current !== id) return;
					setError(true);
					setLoading(false);
				});
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, search]);

	const visible = useMemo(() => options.slice(0, MAX_VISIBLE), [options]);

	return (
		<div className="w-full mt-2 border border-gray-200 rounded-lg bg-white p-2">
			<label className="block text-xs text-gray-600 mb-1" htmlFor="entry-search">
				חפש ערך בתנכפדיה
			</label>
			<input
				id="entry-search"
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="הקלד שם ערך…"
				className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
			/>

			{error && (
				<p className="text-xs text-red-700 mt-2">טעינת רשימת הערכים נכשלה.</p>
			)}
			{!error && loading && (
				<p className="text-xs text-gray-500 mt-2">טוען…</p>
			)}
			{!error && !loading && visible.length === 0 && (
				<p className="text-xs text-gray-500 mt-2">לא נמצאו ערכים.</p>
			)}

			{visible.length > 0 && (
				<ul className="mt-2 max-h-48 overflow-auto divide-y divide-gray-100">
					{visible.map((entry) => (
						<li key={entry.id}>
							<button
								type="button"
								onClick={() => onSelect(entry)}
								className={`w-full text-right px-2 py-1.5 text-sm hover:bg-blue-50 ${
									entry.uniqueName === selectedUniqueName
										? "bg-blue-50 font-medium"
										: ""
								}`}
							>
								<span>{entry.title}</span>
								<span className="text-xs text-gray-500 mr-2" dir="ltr">
									{entry.uniqueName}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
			{options.length > MAX_VISIBLE && (
				<p className="text-xs text-gray-500 mt-1">
					מוצגים {MAX_VISIBLE} מתוך {options.length} — הוסף תווים לחיפוש.
				</p>
			)}
		</div>
	);
}
