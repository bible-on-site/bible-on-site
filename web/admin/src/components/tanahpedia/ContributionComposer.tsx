import { useId, useState } from "react";
import {
	type Assignee,
	CHANGE_LABELS,
	type ChangeInput,
	type Contribution,
	type Evidence,
	FIELD_LABELS,
	validateChanges,
} from "~/lib/tanahpedia/contributions";
import { ENTITY_TYPE_LABELS } from "~/lib/tanahpedia/labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "~/lib/tanahpedia/schema-registry";

export interface ContributionCatalogue {
	people: { id: string; name: string }[];
	places: { id: string; name: string }[];
	entities: { id: string; name: string; entityType: string }[];
	targets: {
		kind: string;
		id: string;
		label: string;
		after: Record<string, string | number | null>;
	}[];
}

export function AssigneePicker({
	value,
	onChange,
	disabled = false,
}: {
	value: Assignee;
	onChange: (assignee: Assignee) => void;
	disabled?: boolean;
}) {
	return (
		<div className="contribution-source-fields">
			<label>
				אחראי
				<select
					className="contribution-input"
					aria-label="אחראי"
					value={value.kind}
					disabled={disabled}
					onChange={(event) => {
						const kind = event.target.value as Assignee["kind"];
						onChange(kind === "human" ? { kind, id: "", name: "" } : { kind });
					}}
				>
					<option value="unassigned">ללא שיוך</option>
					<option value="human">עורך אנושי</option>
					<option value="aws_llm">AWS LLM</option>
					<option value="local_llm">Local LLM</option>
				</select>
			</label>
			{value.kind === "human" && (
				<label>
					שם משתמש
					<input
						className="contribution-input"
						aria-label="שם משתמש אחראי"
						value={value.name}
						required
						maxLength={120}
						disabled={disabled}
						onChange={(event) =>
							onChange({
								kind: "human",
								id: event.target.value,
								name: event.target.value,
							})
						}
						placeholder="לדוגמה doradsoft"
					/>
				</label>
			)}
		</div>
	);
}

type DraftChange = {
	key: string;
	kind: ChangeInput["kind"];
	targetId: string;
	deleting: boolean;
	fields: Record<string, string>;
};
const NUMBERS = new Set([
	"latitude",
	"longitude",
	"birthOrder",
	"unionOrder",
	"startDate",
	"endDate",
]);
const DEFAULTS: Record<ChangeInput["kind"], Record<string, string>> = {
	parent_child: {
		parentId: "",
		childId: "",
		relationshipType: "BIOLOGICAL",
		parentRole: "FATHER",
		sourceCitation: "",
		birthOrder: "",
		altGroupId: "",
	},
	union: {
		person1Id: "",
		person2Id: "",
		unionType: "MARRIAGE",
		unionOrder: "",
		startDate: "",
		endDate: "",
		endReason: "",
		sourceCitation: "",
		personSourceCitation: "",
		altGroupId: "",
	},
	place: {
		placeId: "",
		modernName: "",
		latitude: "",
		longitude: "",
		altGroupId: "",
	},
	metadata: { displayName: "" },
	entry: { title: "", uniqueName: "", entityType: "PERSON", displayName: "" },
};
const OPTIONS: Record<string, string[]> = {
	relationshipType: ["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"],
	parentRole: ["FATHER", "MOTHER"],
	unionType: [
		"MARRIAGE",
		"PILEGESH",
		"FORBIDDEN_WITH_GENTILE",
		"BANNED_INCEST",
		"BETROTHAL",
	],
	endReason: ["", "DEATH", "DIVORCE"],
	entityType: ADMIN_CREATABLE_ENTITY_TYPES,
};
const OPTION_LABELS: Record<string, string> = {
	BIOLOGICAL: "ביולוגי",
	ADOPTIVE: "אימוץ",
	STEP: "חורג",
	FOSTER: "אומנה",
	FATHER: "אב",
	MOTHER: "אם",
	MARRIAGE: "נישואין",
	PILEGESH: "פילגש",
	FORBIDDEN_WITH_GENTILE: "קשר עם נכרי",
	BANNED_INCEST: "עריות",
	BETROTHAL: "אירוסין",
	DEATH: "פטירה",
	DIVORCE: "גירושין",
	...ENTITY_TYPE_LABELS,
};

function newChange(kind: ChangeInput["kind"] = "parent_child"): DraftChange {
	return {
		key: crypto.randomUUID(),
		kind,
		targetId: "",
		deleting: false,
		fields: { ...DEFAULTS[kind] },
	};
}

function fromReviewed(change: Contribution["changes"][number]): DraftChange {
	return {
		key: crypto.randomUUID(),
		kind: change.kind,
		targetId: change.targetId,
		deleting: change.after === null,
		fields: Object.fromEntries(
			Object.entries(change.after ?? change.before ?? {}).map(
				([key, value]) => [key, value == null ? "" : String(value)],
			),
		),
	};
}

function ChangeFields({
	value,
	onChange,
	catalogue,
}: {
	value: DraftChange;
	onChange: (value: DraftChange) => void;
	catalogue: ContributionCatalogue;
}) {
	const targets = catalogue.targets.filter(
		(target) => target.kind === value.kind,
	);
	return (
		<div className="contribution-change-fields">
			<label>
				סוג שינוי
				<select
					className="contribution-input"
					value={value.kind}
					onChange={(event) =>
						onChange(newChange(event.target.value as ChangeInput["kind"]))
					}
				>
					{Object.entries(CHANGE_LABELS).map(([key, label]) => (
						<option key={key} value={key}>
							{label}
						</option>
					))}
				</select>
			</label>
			{!["metadata", "entry"].includes(value.kind) && (
				<>
					<label>
						קשר או זיהוי קיים
						<select
							className="contribution-input"
							value={value.targetId}
							onChange={(event) => {
								const target = targets.find(
									(item) => item.id === event.target.value,
								);
								onChange(
									target
										? {
												...value,
												targetId: target.id,
												fields: Object.fromEntries(
													Object.entries(target.after).map(([key, item]) => [
														key,
														item == null ? "" : String(item),
													]),
												),
											}
										: { ...newChange(value.kind), key: value.key },
								);
							}}
						>
							<option value="">יצירת קשר או זיהוי חדש</option>
							{targets.map((target) => (
								<option key={target.id} value={target.id}>
									{target.label}
								</option>
							))}
						</select>
					</label>
					{value.targetId && (
						<label>
							<span>
								<input
									type="checkbox"
									checked={value.deleting}
									onChange={(event) =>
										onChange({ ...value, deleting: event.target.checked })
									}
								/>{" "}
								מחיקת הקשר או הזיהוי
							</span>
						</label>
					)}
				</>
			)}
			{value.kind === "metadata" && (
				<label>
					יישות
					<select
						className="contribution-input"
						required
						value={value.targetId}
						onChange={(event) =>
							onChange({ ...value, targetId: event.target.value })
						}
					>
						<option value="">בחירת יישות</option>
						{catalogue.entities.map((entity) => (
							<option key={entity.id} value={entity.id}>
								{entity.name} (
								{ENTITY_TYPE_LABELS[
									entity.entityType as keyof typeof ENTITY_TYPE_LABELS
								] ?? entity.entityType}
								)
							</option>
						))}
					</select>
				</label>
			)}
			{!value.deleting && (
				<div className="contribution-form-grid">
					{Object.entries(value.fields).map(([field, current]) => {
						const choices = [
							"parentId",
							"childId",
							"person1Id",
							"person2Id",
						].includes(field)
							? catalogue.people
							: field === "placeId"
								? catalogue.places
								: null;
						const update = (next: string) =>
							onChange({
								...value,
								fields: { ...value.fields, [field]: next },
							});
						return (
							<label key={field} htmlFor={`${value.key}-${field}`}>
								{FIELD_LABELS[field] ?? field}
								{choices ? (
									<select
										id={`${value.key}-${field}`}
										className="contribution-input"
										required
										value={current}
										onChange={(event) => update(event.target.value)}
									>
										<option value="">בחירה</option>
										{choices.map((choice) => (
											<option key={choice.id} value={choice.id}>
												{choice.name}
											</option>
										))}
									</select>
								) : OPTIONS[field] ? (
									<select
										id={`${value.key}-${field}`}
										className="contribution-input"
										value={current}
										onChange={(event) => update(event.target.value)}
									>
										{OPTIONS[field].map((option) => (
											<option key={option} value={option}>
												{OPTION_LABELS[option] ?? (option || "ללא")}
											</option>
										))}
									</select>
								) : (
									<input
										id={`${value.key}-${field}`}
										className="contribution-input"
										value={current}
										type={NUMBERS.has(field) ? "number" : "text"}
										step={
											["latitude", "longitude"].includes(field) ? "any" : "1"
										}
										maxLength={
											field === "sourceCitation" ||
											field === "personSourceCitation"
												? 400
												: 255
										}
										required={["displayName", "title", "uniqueName"].includes(
											field,
										)}
										onChange={(event) => update(event.target.value)}
									/>
								)}
							</label>
						);
					})}
				</div>
			)}
			{value.kind === "entry" && (
				<p className="contribution-muted">
					הערך ייווצר ללא טקסט חופשי, עם יישות מקושרת לפי הסוג שנבחר.
				</p>
			)}
		</div>
	);
}

export interface ComposeContribution {
	kind: "issue" | "pr";
	title: string;
	description: string;
	assignee: Assignee;
	evidence: Evidence[];
	changes: ChangeInput[];
	issueId: string | null;
	closeIssue: boolean;
}

export function ContributionComposer({
	kind,
	initial,
	linkedIssue,
	catalogue,
	busy,
	onSubmit,
	onCancel,
}: {
	kind: "issue" | "pr";
	initial?: Contribution;
	linkedIssue?: Contribution;
	catalogue: ContributionCatalogue;
	busy: boolean;
	onSubmit: (value: ComposeContribution) => Promise<void>;
	onCancel: () => void;
}) {
	const formId = useId();
	const [title, setTitle] = useState(
		initial?.title ?? linkedIssue?.title ?? "",
	);
	const [description, setDescription] = useState(initial?.description ?? "");
	const [assignee, setAssignee] = useState<Assignee>(
		initial?.assignee ?? { kind: "unassigned" },
	);
	const [evidence, setEvidence] = useState<(Evidence & { key: string })[]>(() =>
		(initial?.evidence ?? linkedIssue?.evidence ?? []).map((source) => ({
			...source,
			key: crypto.randomUUID(),
		})),
	);
	const [changes, setChanges] = useState<DraftChange[]>(
		() => initial?.changes.map(fromReviewed) ?? [newChange()],
	);
	const [closeIssue, setCloseIssue] = useState(initial?.closeIssue ?? true);
	const [error, setError] = useState("");
	return (
		<form
			className="contribution-form"
			aria-label={kind === "issue" ? "טופס פנייה" : "טופס הצעת שינוי"}
			onSubmit={async (event) => {
				event.preventDefault();
				setError("");
				try {
					const inputs =
						kind === "pr"
							? validateChanges(
									changes.map((change) => ({
										kind: change.kind,
										targetId: change.targetId || undefined,
										after: change.deleting
											? null
											: Object.fromEntries(
													Object.entries(change.fields).map(([key, value]) => [
														key,
														NUMBERS.has(key)
															? value === ""
																? null
																: Number(value)
															: value,
													]),
												),
									})),
								)
							: [];
					await onSubmit({
						kind,
						title,
						description,
						assignee,
						evidence: evidence.map(({ key: _key, ...source }) => source),
						changes: inputs,
						issueId: initial?.issueId ?? linkedIssue?.id ?? null,
						closeIssue,
					});
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : "השמירה נכשלה");
				}
			}}
		>
			{error && (
				<div className="contribution-error" role="alert">
					{error}
				</div>
			)}
			<label htmlFor={`${formId}-title`}>
				כותרת
				<input
					id={`${formId}-title`}
					className="contribution-input"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					required
					maxLength={255}
					placeholder="תיאור קצר וממוקד"
				/>
			</label>
			<label htmlFor={`${formId}-description`}>
				תיאור
				<textarea
					id={`${formId}-description`}
					className="contribution-input"
					rows={6}
					value={description}
					onChange={(event) => setDescription(event.target.value)}
					required
					maxLength={20000}
					placeholder={
						kind === "issue"
							? "מה חסר או דורש תיקון? מה ידוע ומה עדיין לא ברור?"
							: "מה משתנה, מדוע, וכיצד המקורות תומכים בשינוי?"
					}
				/>
			</label>
			<AssigneePicker value={assignee} onChange={setAssignee} disabled={busy} />
			<fieldset className="contribution-fieldset">
				<legend>ראיות ומקורות</legend>
				<div className="contribution-source-fields">
					{evidence.map((source, index) => (
						<fieldset key={source.key} className="contribution-fieldset">
							<legend>מקור {index + 1}</legend>
							<div className="contribution-source-fields">
								{(
									[
										["citation", "הפניה למקור"],
										["url", "קישור למקור (אופציונלי)"],
										["quote", "ציטוט רלוונטי"],
										["note", "מה המקור מוכיח?"],
									] as const
								).map(([key, label]) => (
									<label key={key} htmlFor={`${source.key}-${key}`}>
										{label}
										{key === "quote" || key === "note" ? (
											<textarea
												id={`${source.key}-${key}`}
												className="contribution-input"
												value={source[key] ?? ""}
												onChange={(event) =>
													setEvidence(
														evidence.map((item) =>
															item.key === source.key
																? { ...item, [key]: event.target.value }
																: item,
														),
													)
												}
											/>
										) : (
											<input
												id={`${source.key}-${key}`}
												className="contribution-input"
												type={key === "url" ? "url" : "text"}
												required={key === "citation"}
												value={source[key] ?? ""}
												onChange={(event) =>
													setEvidence(
														evidence.map((item) =>
															item.key === source.key
																? { ...item, [key]: event.target.value }
																: item,
														),
													)
												}
											/>
										)}
									</label>
								))}
								<button
									className="contribution-button danger"
									type="button"
									onClick={() =>
										setEvidence(
											evidence.filter((item) => item.key !== source.key),
										)
									}
								>
									הסרת מקור {index + 1}
								</button>
							</div>
						</fieldset>
					))}
					<button
						className="contribution-button"
						type="button"
						disabled={evidence.length >= 30}
						onClick={() =>
							setEvidence([
								...evidence,
								{
									key: crypto.randomUUID(),
									citation: "",
									quote: "",
									note: "",
									url: null,
								},
							])
						}
					>
						+ הוספת מקור
					</button>
					{kind === "pr" && (
						<p className="contribution-muted">
							לכל PR נדרש לפחות מקור אחד. הוספת מקור אינה מאמתת אותו אוטומטית.
						</p>
					)}
				</div>
			</fieldset>
			{kind === "pr" && (
				<fieldset className="contribution-fieldset">
					<legend>שינויים מוצעים</legend>
					<div className="contribution-change-fields">
						{changes.map((change, index) => (
							<fieldset className="contribution-fieldset" key={change.key}>
								<legend>שינוי {index + 1}</legend>
								<ChangeFields
									value={change}
									catalogue={catalogue}
									onChange={(next) =>
										setChanges(
											changes.map((item) =>
												item.key === change.key
													? { ...next, key: change.key }
													: item,
											),
										)
									}
								/>
								<button
									type="button"
									className="contribution-button danger"
									disabled={changes.length === 1}
									onClick={() =>
										setChanges(
											changes.filter((item) => item.key !== change.key),
										)
									}
								>
									הסרת שינוי
								</button>
							</fieldset>
						))}
						<button
							className="contribution-button"
							type="button"
							disabled={changes.length >= 40}
							onClick={() => setChanges([...changes, newChange()])}
						>
							+ הוספת שינוי
						</button>
					</div>
				</fieldset>
			)}
			{kind === "pr" && (linkedIssue || initial?.issueId) && (
				<label>
					<span>
						<input
							type="checkbox"
							checked={closeIssue}
							onChange={(event) => setCloseIssue(event.target.checked)}
						/>{" "}
						סגירת הפנייה המקושרת לאחר מיזוג
					</span>
				</label>
			)}
			<div className="contribution-form-actions">
				<button
					type="button"
					className="contribution-button"
					disabled={busy}
					onClick={onCancel}
				>
					ביטול
				</button>
				<button
					type="submit"
					className="contribution-button primary"
					disabled={busy}
				>
					{busy
						? "שומר..."
						: initial
							? "שמירת עדכון"
							: kind === "issue"
								? "פתיחת פנייה"
								: "פתיחת PR"}
				</button>
			</div>
		</form>
	);
}
