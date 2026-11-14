import {
	CONTRIBUTION_RECORDS,
	type ContributionField,
	isContributionRecordKind,
} from "~/lib/tanahpedia/contribution-records";
import {
	SOURCE_TARGET_LABELS,
	SOURCE_TARGETS,
} from "~/lib/tanahpedia/contribution-specials";
import type { ChangeInput } from "~/lib/tanahpedia/contributions";
import type { ContributionCatalogue } from "./ContributionComposer";

export const RECORD_OPTION_LABELS: Record<string, string> = {
	ADDITIONAL: "שם נוסף",
	NICKNAME: "כינוי",
	MALE: "זכר",
	FEMALE: "נקבה",
	UNKNOWN: "לא ידוע",
	BEHEMA: "בהמה",
	CHAYA: "חיה",
	OF: "עוף",
	SHERETZ: "שרץ",
	TAHOR: "טהור",
	TAMEH: "טמא",
};
export const HEBREW_MONTHS = [
	"לא ידוע",
	"תשרי",
	"חשוון",
	"כסלו",
	"טבת",
	"שבט",
	"אדר",
	"ניסן",
	"אייר",
	"סיוון",
	"תמוז",
	"אב",
	"אלול",
	"אדר א",
	"אדר ב",
];
export function recordFieldValue(
	kind: ChangeInput["kind"],
	key: string,
	value: string,
): unknown {
	if (kind === "alias_mapping" && key === "targets")
		return (
			JSON.parse(value || "[]") as { entryId: string; label: string }[]
		).map(({ entryId, label }) => ({ entryId, label }));
	if (isContributionRecordKind(kind)) {
		const f = CONTRIBUTION_RECORDS[kind].fields[key];
		if (f?.type === "boolean") return value === "true";
		if (f && (f.type === "integer" || f.type === "date" || f.numericReference))
			return value === "" ? null : Number(value);
	}
	if (
		kind === "source_reference" &&
		["perekId", "pasukNumber", "perushId"].includes(key)
	)
		return value === "" ? null : Number(value);
	return value;
}
export function draftField(value: unknown): string {
	return value == null
		? ""
		: Array.isArray(value)
			? JSON.stringify(value)
			: String(value);
}
export function HebrewDateField({
	label,
	value,
	onChange,
	allowFuture,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	allowFuture?: boolean;
}) {
	const n = Number(value) || 0,
		year = Math.floor(Math.max(0, n) / 10000),
		month = Math.floor(Math.max(0, n) / 100) % 100,
		day = Math.max(0, n) % 100;
	const change = (y: number, m: number, d: number) =>
		onChange(String(y * 10000 + m * 100 + d));
	return (
		<fieldset className="contribution-fieldset">
			<legend>{label}</legend>
			<div className="contribution-form-grid">
				<label>
					שנה
					<input
						className="contribution-input"
						aria-label={`שנה - ${label}`}
						type="number"
						min="0"
						max="9999"
						value={value === "" ? "" : year}
						onChange={(e) => change(Number(e.target.value), month, day)}
					/>
				</label>
				<label>
					חודש
					<select
						className="contribution-input"
						aria-label={`חודש - ${label}`}
						value={month}
						onChange={(e) =>
							change(
								year,
								Number(e.target.value),
								Number(e.target.value) === 0 ? 0 : day,
							)
						}
					>
						{HEBREW_MONTHS.map((name, index) => (
							<option key={name} value={index}>
								{name}
							</option>
						))}
					</select>
				</label>
				<label>
					יום
					<input
						className="contribution-input"
						aria-label={`יום - ${label}`}
						type="number"
						min="0"
						max="30"
						value={day}
						onChange={(e) => change(year, month, Number(e.target.value))}
					/>
				</label>
			</div>
			<small>0 מציין רכיב לא ידוע.</small>
			<button
				className="contribution-button"
				type="button"
				onClick={() => onChange("")}
			>
				ניקוי תאריך
			</button>
			{allowFuture && (
				<label>
					<input
						type="checkbox"
						checked={n === -1}
						onChange={(e) => onChange(e.target.checked ? "-1" : "0")}
					/>
					טרם נפטר
				</label>
			)}
		</fieldset>
	);
}
function ReferenceField({
	label,
	value,
	choices,
	onChange,
	required = false,
}: {
	label: string;
	value: string;
	choices: { id: string | number; name: string }[];
	onChange: (value: string) => void;
	required?: boolean;
}) {
	return (
		<label>
			{label}
			<select
				className="contribution-input"
				aria-label={label}
				required={required}
				value={value}
				onChange={(e) => onChange(e.target.value)}
			>
				<option value="">בחירה</option>
				{choices.map((row) => (
					<option key={row.id} value={row.id}>
						{row.name}
					</option>
				))}
			</select>
		</label>
	);
}
function AliasFields({
	fields,
	update,
	catalogue,
}: {
	fields: Record<string, string>;
	update: (key: string, value: string) => void;
	catalogue: ContributionCatalogue;
}) {
	const targets = JSON.parse(fields.targets || "[]") as {
		entryId: string;
		label: string;
		key?: string;
	}[];
	const change = (index: number, key: string, value: string) =>
		update(
			"targets",
			JSON.stringify(
				targets.map((t, i) => (i === index ? { ...t, [key]: value } : t)),
			),
		);
	return (
		<>
			<label>
				כינוי
				<input
					className="contribution-input"
					aria-label="כינוי"
					required
					maxLength={255}
					value={fields.name}
					onChange={(e) => update("name", e.target.value)}
				/>
			</label>
			{targets.map((target, index) => (
				<fieldset
					key={target.key ?? target.entryId}
					className="contribution-fieldset"
				>
					<legend>יעד {index + 1}</legend>
					<ReferenceField
						label={`ערך יעד ${index + 1}`}
						required
						value={target.entryId}
						choices={catalogue.references?.entry ?? []}
						onChange={(v) => change(index, "entryId", v)}
					/>
					<label>
						תווית מבדילה
						<input
							className="contribution-input"
							aria-label={`תווית יעד ${index + 1}`}
							required={targets.length > 1}
							maxLength={255}
							value={target.label}
							onChange={(e) => change(index, "label", e.target.value)}
						/>
					</label>
					<button
						type="button"
						className="contribution-button"
						onClick={() =>
							update(
								"targets",
								JSON.stringify(targets.filter((_, i) => i !== index)),
							)
						}
					>
						הסרת יעד {index + 1}
					</button>
				</fieldset>
			))}
			<button
				type="button"
				className="contribution-button"
				disabled={targets.length >= 40}
				onClick={() =>
					update(
						"targets",
						JSON.stringify([
							...targets,
							{ entryId: "", label: "", key: crypto.randomUUID() },
						]),
					)
				}
			>
				הוספת יעד לכינוי
			</button>
			<p className="contribution-muted">
				יעד אחד יוצר כינוי. כמה יעדים יוצרים דף פירושונים עם תווית לכל יעד.
			</p>
		</>
	);
}

function SourceFields({
	fields,
	update,
	catalogue,
}: {
	fields: Record<string, string>;
	update: (key: string, value: string) => void;
	catalogue: ContributionCatalogue;
}) {
	const kind = fields.targetKind;
	const choices =
		catalogue.references?.[kind] ??
		catalogue.targets
			.filter((t) => t.kind === kind)
			.map((t) => ({ id: t.id, name: t.label }));
	return (
		<>
			<label>
				סוג הטענה
				<select
					className="contribution-input"
					aria-label="סוג הטענה"
					value={kind}
					onChange={(e) => update("targetKind", e.target.value)}
				>
					{Object.keys(SOURCE_TARGETS).map((k) => (
						<option key={k} value={k}>
							{SOURCE_TARGET_LABELS[k]}
						</option>
					))}
				</select>
			</label>
			<ReferenceField
				label="הטענה או היישות"
				required
				value={fields.targetId}
				choices={choices}
				onChange={(v) => update("targetId", v)}
			/>
			<label>
				סוג מקור
				<select
					className="contribution-input"
					aria-label="סוג מקור"
					value={fields.sourceType}
					onChange={(e) => update("sourceType", e.target.value)}
				>
					<option value="tanah">מקרא</option>
					<option value="other">מקור אחר</option>
				</select>
			</label>
			{fields.sourceType === "tanah" ? (
				<>
					<ReferenceField
						label="פרק"
						required
						value={fields.perekId}
						choices={catalogue.references?.perek ?? []}
						onChange={(v) => update("perekId", v)}
					/>
					<label>
						פסוק
						<input
							className="contribution-input"
							aria-label="פסוק"
							type="number"
							min="1"
							max="176"
							value={fields.pasukNumber}
							onChange={(e) => update("pasukNumber", e.target.value)}
						/>
					</label>
					<ReferenceField
						label="פירוש"
						value={fields.perushId}
						choices={catalogue.references?.perush ?? []}
						onChange={(v) => update("perushId", v)}
					/>
				</>
			) : (
				<label>
					הפניה ביבליוגרפית
					<input
						className="contribution-input"
						aria-label="הפניה ביבליוגרפית"
						required
						maxLength={500}
						value={fields.sourceText}
						onChange={(e) => update("sourceText", e.target.value)}
					/>
				</label>
			)}
		</>
	);
}
export function ContributionRecordFields({
	kind,
	fields,
	onChange,
	catalogue,
}: {
	kind: ChangeInput["kind"];
	fields: Record<string, string>;
	onChange: (fields: Record<string, string>) => void;
	catalogue: ContributionCatalogue;
}) {
	const update = (key: string, value: string) =>
		onChange({
			...fields,
			[key]: value,
			...(key === "sourceType"
				? { perekId: "", pasukNumber: "", perushId: "", sourceText: "" }
				: {}),
			...(key === "targetKind" ? { targetId: "" } : {}),
		});
	if (kind === "alias_mapping")
		return (
			<AliasFields fields={fields} update={update} catalogue={catalogue} />
		);
	if (kind === "source_reference")
		return (
			<SourceFields fields={fields} update={update} catalogue={catalogue} />
		);
	if (!isContributionRecordKind(kind)) return null;
	return (
		<div className="contribution-form-grid">
			{Object.entries(CONTRIBUTION_RECORDS[kind].fields).map(([key, f]) => {
				const field: ContributionField = f,
					label = field.label,
					value = fields[key] ?? "";
				if (field.type === "date")
					return (
						<HebrewDateField
							key={key}
							label={label}
							value={value}
							onChange={(v) => update(key, v)}
							allowFuture={field.allowFuture}
						/>
					);
				if (field.type === "reference" && field.reference !== "alternative")
					return (
						<ReferenceField
							key={key}
							label={label}
							required={!field.nullable}
							value={value}
							choices={catalogue.references?.[field.reference ?? ""] ?? []}
							onChange={(v) => update(key, v)}
						/>
					);
				if (field.type === "enum" || field.type === "boolean")
					return (
						<label key={key}>
							{label}
							<select
								aria-label={label}
								className="contribution-input"
								value={value}
								onChange={(e) => update(key, e.target.value)}
							>
								{(field.type === "boolean"
									? ["true", "false"]
									: (field.options ?? [])
								).map((v) => (
									<option key={v} value={v}>
										{v === "true"
											? "טובה"
											: v === "false"
												? "פורענות"
												: (RECORD_OPTION_LABELS[v] ?? v)}
									</option>
								))}
							</select>
						</label>
					);
				return (
					<label key={key}>
						{label}
						<input
							className="contribution-input"
							aria-label={label}
							required={!field.nullable}
							type={field.type === "integer" ? "number" : "text"}
							min={field.min}
							max={field.max}
							maxLength={field.maxLength ?? 255}
							value={value}
							onChange={(e) => update(key, e.target.value)}
						/>
						{field.reference === "alternative" && (
							<button
								type="button"
								className="contribution-button"
								onClick={() => update(key, crypto.randomUUID())}
							>
								קבוצת דעות חדשה
							</button>
						)}
					</label>
				);
			})}
		</div>
	);
}
