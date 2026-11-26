import { useId, useState } from "react";
import {
	CHANGE_LABELS,
	CONTRIBUTION_ISSUE_SCOPE_KINDS,
	type IssueScope,
} from "~/lib/tanahpedia/contributions";
import type { ContributionCatalogue } from "./ContributionComposer";

export function ContributionIssueScopeFields({
	value,
	onChange,
	catalogue,
	disabled,
}: {
	value: IssueScope | undefined;
	onChange: (scope: IssueScope | undefined) => void;
	catalogue: ContributionCatalogue;
	disabled: boolean;
}) {
	const id = useId();
	const [open, setOpen] = useState(Boolean(value));
	const targets = catalogue.targets.filter(
		(target) => target.kind === value?.kind,
	);
	const selected = targets.find((target) => target.id === value?.targetId);
	return (
		<details
			className="contribution-card contribution-card-body"
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary>הכוונה לסוכן (רשות)</summary>
			<div className="contribution-source-fields">
				<p className="contribution-muted">
					אפשר לבחור סוג שינוי ויעד קיים. בעת מימוש הפנייה, הסוכן יוכל להציע
					שינויים רק בתחום שנבחר. אפשר גם להשאיר את הפנייה חופשית.
				</p>
				<div className="contribution-source-fields">
					<label htmlFor={`${id}-kind`}>סוג השינוי המבוקש</label>
					<select
						id={`${id}-kind`}
						className="contribution-input"
						value={value?.kind ?? ""}
						disabled={disabled}
						onChange={(event) =>
							onChange(
								event.target.value
									? { kind: event.target.value as IssueScope["kind"] }
									: undefined,
							)
						}
					>
						<option value="">ללא הגבלה</option>
						{Array.from(CONTRIBUTION_ISSUE_SCOPE_KINDS).map((kind) => (
							<option key={kind} value={kind}>
								{CHANGE_LABELS[kind]}
							</option>
						))}
					</select>
				</div>
				{value?.kind === "place_profile" && (
					<p className="contribution-muted">
						לכל מקום ייפתח PR נפרד עם המופעים המדויקים שלו במקרא.
					</p>
				)}
				{value && value.kind !== "entry" && value.kind !== "place_profile" && (
					<div className="contribution-source-fields">
						<label htmlFor={`${id}-target`}>
							{value.kind === "article_links"
								? "מספר מאמר (רשות)"
								: "יעד השינוי (רשות)"}
						</label>
						<input
							id={`${id}-target`}
							className="contribution-input"
							list={`${id}-targets`}
							value={value.targetId ?? ""}
							inputMode={value.kind === "article_links" ? "numeric" : "text"}
							maxLength={200}
							disabled={disabled}
							placeholder={
								value.kind === "article_links"
									? "מספר המאמר"
									: "בחירת רשומה קיימת או הזנת המזהה שלה"
							}
							onChange={(event) =>
								onChange({
									kind: value.kind,
									...(event.target.value
										? { targetId: event.target.value }
										: {}),
								})
							}
						/>
						<datalist id={`${id}-targets`}>
							{targets.map((target) => (
								<option key={target.id} value={target.id}>
									{target.label}
								</option>
							))}
						</datalist>
						{selected && (
							<span className="contribution-muted">{selected.label}</span>
						)}
					</div>
				)}
			</div>
		</details>
	);
}

export function ContributionIssueScopeSummary({
	scope,
}: {
	scope?: IssueScope;
}) {
	if (!scope) return null;
	return (
		<section aria-label="תחום הפנייה" className="contribution-source">
			<strong>סוג השינוי המבוקש: {CHANGE_LABELS[scope.kind]}</strong>
			{scope.targetId && (
				<p>
					{scope.kind === "article_links" ? "מאמר" : "יעד"}{" "}
					<bdi>{scope.targetId}</bdi>
				</p>
			)}
		</section>
	);
}
