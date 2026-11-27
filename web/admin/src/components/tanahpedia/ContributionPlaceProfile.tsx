import { useState } from "react";
import {
	MAX_PLACE_OCCURRENCES,
	type PlaceProfileBase,
	type PlaceProfileChange,
	type PlaceWordOccurrence,
	placeOccurrenceKey,
} from "~/lib/tanahpedia/contribution-place-profile";
import {
	contributionCitation,
	type ReviewedChange,
} from "~/lib/tanahpedia/contributions";
import { toHebrewLetters } from "~/utils/hebrew";

const PAGE_SIZE = 40;
const entryFields = [
	["title", "כותרת הערך"],
	["uniqueName", "כתובת הערך"],
	["displayName", "שם המקום"],
] as const;
const pointFields = [
	["modernName", "שם האתר המזוהה"],
	["latitude", "קו רוחב"],
	["longitude", "קו אורך"],
	["citation", "מקור לזיהוי"],
	["coordinateCitation", "מקור לקואורדינטות"],
] as const;
const spanFields = [
	["perekId", "מזהה פרק"],
	["pasukNumber", "מספר פסוק"],
	["segmentStart", "קטע ראשון"],
	["segmentEnd", "קטע אחרון"],
] as const;
const emptyEntry = { title: "", uniqueName: "", displayName: "" };
const emptyPoint = {
	modernName: "",
	latitude: "",
	longitude: "",
	basis: "consensus",
	citation: "",
	coordinateCitation: "",
} as const;
const emptySpan = {
	perekId: "",
	pasukNumber: "",
	segmentStart: "",
	segmentEnd: "",
	text: "",
};
const basisLabels = {
	consensus: "זיהוי מוסכם",
	commentary: "זיהוי לפי פירוש",
};
const numberValue = (value: string) =>
	value === "" ? Number.NaN : Number(value);

type DraftSpan = typeof emptySpan & { key: string };
type DraftPoint = Omit<
	NonNullable<PlaceProfileChange["identification"]>,
	"latitude" | "longitude"
> & {
	latitude: string;
	longitude: string;
};
export type PlaceProfileDraft = {
	entry: PlaceProfileChange["entry"];
	occurrences: DraftSpan[];
	identification: DraftPoint | null;
	labels: Record<string, string>;
};

export function placeProfileDraft(
	profile?: PlaceProfileChange,
	labels: Record<string, string> = {},
): PlaceProfileDraft {
	const point = profile?.identification;
	return {
		entry: profile ? profile.entry : { ...emptyEntry },
		occurrences: (profile?.occurrences ?? []).map((span) => ({
			key: crypto.randomUUID(),
			perekId: String(span.perekId),
			pasukNumber: String(span.pasukNumber),
			segmentStart: String(span.segmentStart),
			segmentEnd: String(span.segmentEnd),
			text: span.text,
		})),
		identification: point
			? {
					...point,
					latitude: String(point.latitude),
					longitude: String(point.longitude),
				}
			: null,
		labels,
	};
}

function occurrenceValue(span: DraftSpan): PlaceWordOccurrence {
	return {
		perekId: numberValue(span.perekId),
		pasukNumber: numberValue(span.pasukNumber),
		segmentStart: numberValue(span.segmentStart),
		segmentEnd: numberValue(span.segmentEnd),
		text: span.text,
	};
}

export function placeProfileDraftValue(
	draft: PlaceProfileDraft,
): PlaceProfileChange {
	const point = draft.identification;
	return {
		entry: draft.entry,
		occurrences: draft.occurrences.map(occurrenceValue),
		identification: point
			? {
					...point,
					latitude: numberValue(point.latitude),
					longitude: numberValue(point.longitude),
				}
			: null,
	};
}

function occurrenceCitation(
	occurrence: PlaceWordOccurrence,
	labels: Record<string, string>,
) {
	const number = occurrence.pasukNumber;
	const verse =
		Number.isSafeInteger(number) && number >= 1 && number <= 176
			? toHebrewLetters(number)
			: "?";
	return (
		labels[placeOccurrenceKey(occurrence)] ??
		`פרק ${occurrence.perekId} פסוק ${verse}`
	);
}

function OccurrencePage({
	count,
	page,
	selectPage,
}: {
	count: number;
	page: number;
	selectPage: (page: number) => void;
}) {
	const pages = Math.ceil(count / PAGE_SIZE);
	if (pages <= 1) return null;
	return (
		<nav aria-label="עמודי מופעים" className="contribution-form-actions">
			<button
				type="button"
				className="contribution-button"
				disabled={page === 0}
				onClick={() => selectPage(page - 1)}
			>
				הקודם
			</button>
			<span aria-live="polite">
				{page + 1} מתוך {pages}
			</span>
			<button
				type="button"
				className="contribution-button"
				disabled={page === pages - 1}
				onClick={() => selectPage(page + 1)}
			>
				הבא
			</button>
		</nav>
	);
}

export function ContributionPlaceProfileFields({
	value,
	targetId,
	places,
	onChange,
}: {
	value: PlaceProfileDraft;
	targetId: string;
	places: readonly { id: string; name: string; hasEntry?: number }[];
	onChange: (value: PlaceProfileDraft, targetId: string) => void;
}) {
	const [page, setPage] = useState(0);
	const [newSpanKey, setNewSpanKey] = useState("");
	const lastPage = Math.max(
		0,
		Math.ceil(value.occurrences.length / PAGE_SIZE) - 1,
	);
	const currentPage = Math.min(page, lastPage);
	const start = currentPage * PAGE_SIZE;
	const { entry, identification } = value;
	const update = (fields: Partial<PlaceProfileDraft>) =>
		onChange({ ...value, ...fields }, targetId);
	return (
		<>
			<label>
				יעד ההצעה
				<select
					className="contribution-input"
					value={entry ? "new" : "existing"}
					onChange={(event) =>
						onChange(
							{
								...value,
								entry: event.target.value === "new" ? { ...emptyEntry } : null,
							},
							"",
						)
					}
				>
					<option value="new">ערך חדש ללא גוף</option>
					<option value="existing">מקום קיים</option>
				</select>
			</label>
			{entry ? (
				<div className="contribution-form-grid">
					{entryFields.map(([field, label]) => (
						<label key={field}>
							{label}
							<input
								className="contribution-input"
								required
								maxLength={255}
								value={entry[field]}
								onChange={(event) =>
									update({ entry: { ...entry, [field]: event.target.value } })
								}
							/>
						</label>
					))}
				</div>
			) : (
				<label>
					מקום קיים
					<select
						className="contribution-input"
						required
						value={targetId}
						onChange={(event) => onChange(value, event.target.value)}
					>
						<option value="">בחירת מקום</option>
						{targetId && !places.some((place) => place.id === targetId) && (
							<option value={targetId}>{value.labels.place ?? targetId}</option>
						)}
						{places.map((place) => (
							<option key={place.id} value={place.id}>
								{place.name}
								{place.hasEntry === 0 ? " (ללא ערך לקישור)" : ""}
							</option>
						))}
					</select>
				</label>
			)}
			<fieldset className="contribution-fieldset">
				<legend>מופעים במקרא ({value.occurrences.length})</legend>
				<p className="contribution-muted">
					כל מופע מקשר מילה או צירוף מדויק. מספור הקטעים בפסוק מתחיל ב-0.
				</p>
				{value.occurrences
					.slice(start, start + PAGE_SIZE)
					.map((span, offset) => {
						const index = start + offset;
						const occurrence = occurrenceValue(span);
						const edit = (field: keyof typeof emptySpan, content: string) =>
							update({
								occurrences: value.occurrences.map((item, i) =>
									i === index ? { ...item, [field]: content } : item,
								),
							});
						return (
							<details
								key={span.key}
								className="contribution-card contribution-card-body"
								open={span.key === newSpanKey || undefined}
							>
								<summary>
									{index + 1}. {span.text || "מופע חדש"}
									{span.perekId &&
										` - ${occurrenceCitation(occurrence, value.labels)}`}
								</summary>
								<div className="contribution-form-grid">
									{spanFields.map(([field, label]) => (
										<label key={field}>
											{label}
											<input
												className="contribution-input"
												required
												min={field.startsWith("segment") ? 0 : 1}
												type="number"
												step={1}
												value={span[field]}
												onChange={(event) => edit(field, event.target.value)}
											/>
										</label>
									))}
									<label>
										מילה או צירוף מהמקרא
										<input
											className="contribution-input"
											required
											maxLength={500}
											value={span.text}
											onChange={(event) => edit("text", event.target.value)}
										/>
									</label>
								</div>
								<button
									type="button"
									className="contribution-button danger"
									onClick={() =>
										update({
											occurrences: value.occurrences.filter(
												(_, i) => i !== index,
											),
										})
									}
								>
									הסרת מופע {index + 1}
								</button>
							</details>
						);
					})}
				<OccurrencePage
					count={value.occurrences.length}
					page={currentPage}
					selectPage={setPage}
				/>
				<button
					type="button"
					className="contribution-button"
					disabled={value.occurrences.length >= MAX_PLACE_OCCURRENCES}
					onClick={() => {
						const key = crypto.randomUUID();
						update({
							occurrences: [...value.occurrences, { ...emptySpan, key }],
						});
						setNewSpanKey(key);
						setPage(Math.floor(value.occurrences.length / PAGE_SIZE));
					}}
				>
					+ הוספת מופע
				</button>
			</fieldset>
			<fieldset className="contribution-fieldset">
				<legend>זיהוי וקואורדינטות</legend>
				<label>
					<span>
						<input
							type="checkbox"
							checked={Boolean(identification)}
							onChange={(event) =>
								update({
									identification: event.target.checked
										? { ...emptyPoint }
										: null,
								})
							}
						/>{" "}
						הצעת זיהוי עם נקודה במפה
					</span>
				</label>
				{identification && (
					<div className="contribution-form-grid">
						<label>
							בסיס הזיהוי
							<select
								className="contribution-input"
								value={identification.basis}
								onChange={(event) =>
									update({
										identification: {
											...identification,
											basis:
												event.target.value === "commentary"
													? "commentary"
													: "consensus",
										},
									})
								}
							>
								{Object.entries(basisLabels).map(([basis, label]) => (
									<option key={basis} value={basis}>
										{label}
									</option>
								))}
							</select>
						</label>
						{pointFields.map(([field, label]) => {
							const coordinate = field === "latitude" || field === "longitude";
							const bound = field === "latitude" ? 90 : 180;
							return (
								<label key={field}>
									{label}
									<input
										className="contribution-input"
										required
										maxLength={field === "modernName" ? 255 : 500}
										type={coordinate ? "number" : "text"}
										step={coordinate ? "any" : undefined}
										min={coordinate ? -bound : undefined}
										max={coordinate ? bound : undefined}
										value={identification[field]}
										onChange={(event) =>
											update({
												identification: {
													...identification,
													[field]: event.target.value,
												},
											})
										}
									/>
								</label>
							);
						})}
					</div>
				)}
			</fieldset>
		</>
	);
}

export function ContributionPlaceProfileDiff({
	change,
}: {
	change: ReviewedChange;
}) {
	const [page, setPage] = useState(0);
	const before = change.before as unknown as PlaceProfileBase | null;
	const after = change.after as unknown as PlaceProfileChange | null;
	if (!after) return null;
	const existing = new Set(before?.occurrences.map(placeOccurrenceKey));
	const added = after.occurrences.filter(
		(occurrence) => !existing.has(placeOccurrenceKey(occurrence)),
	);
	const unchanged = after.occurrences.length - added.length;
	const currentPage = Math.min(
		page,
		Math.max(0, Math.ceil(added.length / PAGE_SIZE) - 1),
	);
	const start = currentPage * PAGE_SIZE;
	const point = after.identification;
	const storedPoint = before?.identification;
	return (
		<>
			{after.entry ? (
				<section className="contribution-diff-note" aria-label="ערך חדש">
					<h4>ערך חדש ללא גוף</h4>
					<dl>
						{entryFields.map(([field, label]) => (
							<div key={field}>
								<dt>{label}</dt>
								<dd>
									<bdi>{after.entry?.[field]}</bdi>
								</dd>
							</div>
						))}
					</dl>
				</section>
			) : (
				<p className="contribution-diff-note">
					מקום קיים: <bdi>{change.labels.place ?? change.targetId}</bdi>
					{Boolean(before?.entryAddresses?.length) && (
						<>
							{" "}
							· <bdi>{before?.entryAddresses.join(", ")}</bdi>
						</>
					)}
				</p>
			)}
			<section
				className="contribution-diff-note"
				aria-label="קישורי מילים במקרא"
			>
				<h4>קישורי מילים במקרא</h4>
				<p>
					{added.length} להוספה · {unchanged} כבר קיימים
				</p>
				{added.length > 0 && (
					<div className="contribution-diff-table-wrap">
						<table>
							<thead>
								<tr>
									<th scope="col">מקור</th>
									<th scope="col">מילה או צירוף</th>
									<th scope="col">קטעים בפסוק</th>
								</tr>
							</thead>
							<tbody>
								{added.slice(start, start + PAGE_SIZE).map((occurrence) => (
									<tr key={placeOccurrenceKey(occurrence)}>
										<th scope="row">
											{occurrenceCitation(occurrence, change.labels)}
										</th>
										<td className="added">
											<bdi>{occurrence.text}</bdi>
										</td>
										<td>
											<bdi>
												{occurrence.segmentStart}
												{occurrence.segmentStart !== occurrence.segmentEnd &&
													`-${occurrence.segmentEnd}`}
											</bdi>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<OccurrencePage
					count={added.length}
					page={currentPage}
					selectPage={setPage}
				/>
			</section>
			{point && (
				<section
					className="contribution-diff-note"
					aria-label="זיהוי וקואורדינטות"
				>
					<h4>{storedPoint ? "זיהוי שכבר קיים" : "זיהוי מוצע"}</h4>
					<dl>
						<div>
							<dt>האתר המזוהה</dt>
							<dd>{point.modernName}</dd>
						</div>
						<div>
							<dt>בסיס הזיהוי</dt>
							<dd>{basisLabels[point.basis]}</dd>
						</div>
						<div>
							<dt>מקור לזיהוי</dt>
							<dd>
								{contributionCitation(point.citation)}
								{storedPoint &&
									!storedPoint.citations.includes(point.citation) && (
										<span className="added"> · מקור להוספה</span>
									)}
							</dd>
						</div>
						<div>
							<dt>קואורדינטות</dt>
							<dd>
								<bdi>
									{point.latitude}, {point.longitude}
								</bdi>
							</dd>
						</div>
						<div>
							<dt>מקור לקואורדינטות</dt>
							<dd>
								{contributionCitation(point.coordinateCitation)}
								{storedPoint &&
									!storedPoint.citations.includes(point.coordinateCitation) && (
										<span className="added"> · מקור להוספה</span>
									)}
							</dd>
						</div>
					</dl>
				</section>
			)}
		</>
	);
}
