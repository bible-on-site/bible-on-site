import {
	CHANGE_LABELS,
	type ChangeState,
	changedFields,
	contributionCitation,
	FIELD_LABELS,
	type ReviewedChange,
} from "~/lib/tanahpedia/contributions";
import { ENTITY_TYPE_LABELS } from "~/lib/tanahpedia/labels";

const VALUE_LABELS: Record<string, Record<string, string>> = {
	entityType: ENTITY_TYPE_LABELS,
	relationshipType: {
		BIOLOGICAL: "ביולוגי",
		ADOPTIVE: "אימוץ",
		STEP: "חורג",
		FOSTER: "אומנה",
	},
	parentRole: { FATHER: "אב", MOTHER: "אם" },
	unionType: {
		MARRIAGE: "נישואין",
		PILEGESH: "פילגשות",
		FORBIDDEN_WITH_GENTILE: "קשר עם נוכרית",
		BANNED_INCEST: "גילוי עריות",
		BETROTHAL: "אירוסין",
	},
	endReason: { DEATH: "פטירה", DIVORCE: "גירושין" },
};

function shown(
	value: unknown,
	labels: Record<string, string>,
	field?: string,
): string {
	if (value == null || value === "") return "-";
	if (field === "sourceCitation" || field === "personSourceCitation")
		return contributionCitation(String(value));
	const key = String(value);
	const values =
		field && Object.hasOwn(VALUE_LABELS, field)
			? VALUE_LABELS[field]
			: undefined;
	return (
		(Object.hasOwn(labels, key) ? labels[key] : undefined) ??
		(values && Object.hasOwn(values, key) ? values[key] : undefined) ??
		key
	);
}

function Relationship({
	state,
	change,
	removed,
}: {
	state: ChangeState;
	change: ReviewedChange;
	removed: boolean;
}) {
	const names =
		change.kind === "parent_child"
			? [state.parentId, state.childId]
			: [state.person1Id, state.person2Id];
	return (
		<figure
			className={`contribution-relationship ${removed ? "removed" : "added"}`}
			aria-label={removed ? "הקשר הקודם" : "הקשר המוצע"}
		>
			<span>{shown(names[0], change.labels)}</span>
			<span className="contribution-connector" aria-hidden="true">
				{change.kind === "parent_child" ? "↓" : "↔"}
			</span>
			<span>{shown(names[1], change.labels)}</span>
			<small>
				{shown(
					state.relationshipType ?? state.unionType,
					change.labels,
					state.relationshipType ? "relationshipType" : "unionType",
				)}
			</small>
		</figure>
	);
}

function Coordinates({ change }: { change: ReviewedChange }) {
	const before = change.before,
		after = change.after;
	const points = [
		{ state: before, label: "לפני", color: "#cf222e" },
		{ state: after, label: "אחרי", color: "#1a7f37" },
	].filter(
		(point) =>
			typeof point.state?.latitude === "number" &&
			typeof point.state.longitude === "number",
	);
	if (!points.length) return null;
	// Fit the proposal, so a small coordinate correction remains visible rather
	// than overlapping two pins on a world-sized plot. Axes retain real values.
	const latitudes = points.map((point) => Number(point.state?.latitude));
	const longitudes = points.map((point) => Number(point.state?.longitude));
	const latSpan = Math.max(
		Math.max(...latitudes) - Math.min(...latitudes),
		0.002,
	);
	const lonSpan = Math.max(
		Math.max(...longitudes) - Math.min(...longitudes),
		0.002,
	);
	const south = Math.max(-90, Math.min(...latitudes) - latSpan / 4),
		north = Math.min(90, Math.max(...latitudes) + latSpan / 4);
	const west = Math.max(-180, Math.min(...longitudes) - lonSpan / 4),
		east = Math.min(180, Math.max(...longitudes) + lonSpan / 4);
	const x = (longitude: number) =>
		40 + ((longitude - west) / (east - west)) * 280;
	const y = (latitude: number) =>
		150 - ((latitude - south) / (north - south)) * 120;
	return (
		<figure className="contribution-coordinate-preview">
			<svg
				viewBox="0 0 360 180"
				role="img"
				aria-label="השוואת קואורדינטות על מפת קווי רוחב ואורך"
			>
				<title>מיקום קודם ומיקום מוצע</title>
				<rect width="360" height="180" fill="#f0f6fc" rx="8" />
				{[60, 120, 180, 240, 300].map((x) => (
					<path key={`x${x}`} d={`M${x},0V180`} stroke="#d0d7de" />
				))}
				{[30, 60, 90, 120, 150].map((y) => (
					<path key={`y${y}`} d={`M0,${y}H360`} stroke="#d0d7de" />
				))}
				{points.map(({ state, color, label }) => (
					<g key={label}>
						<circle
							cx={x(Number(state?.longitude))}
							cy={y(Number(state?.latitude))}
							r={label === "לפני" ? 7 : 4}
							fill={color}
							stroke="white"
							strokeWidth="2"
						/>
						<text
							x={x(Number(state?.longitude))}
							y={y(Number(state?.latitude)) + (label === "לפני" ? -12 : 18)}
							textAnchor="middle"
							fontSize="10"
							fill={color}
						>
							{label}
						</text>
					</g>
				))}
				<text x="40" y="174" fontSize="9" fill="#59636e">
					{west.toFixed(4)}°E
				</text>
				<text x="320" y="174" textAnchor="end" fontSize="9" fill="#59636e">
					{east.toFixed(4)}°E
				</text>
				<text x="5" y="20" fontSize="9" fill="#59636e">
					{north.toFixed(4)}°N
				</text>
				<text x="5" y="158" fontSize="9" fill="#59636e">
					{south.toFixed(4)}°N
				</text>
			</svg>
			<figcaption>השוואת קואורדינטות (קווי רוחב ואורך)</figcaption>
			{points.map(({ state, label }) => (
				<a
					key={label}
					href={`https://www.openstreetmap.org/?mlat=${state?.latitude}&mlon=${state?.longitude}#map=13/${state?.latitude}/${state?.longitude}`}
					target="_blank"
					rel="noreferrer"
				>
					{label}:{" "}
					<bdi>
						{String(state?.latitude)}, {String(state?.longitude)}
					</bdi>{" "}
					↗
				</a>
			))}
		</figure>
	);
}

export function ContributionDiff({ changes }: { changes: ReviewedChange[] }) {
	return (
		<div className="contribution-diffs">
			{changes.map((change, index) => (
				<article
					className="contribution-diff"
					key={`${change.kind}:${change.targetId}`}
				>
					<header>
						<strong>
							{index + 1}. {CHANGE_LABELS[change.kind]}
						</strong>
						<span>
							{change.before === null
								? "יצירה"
								: change.after === null
									? "מחיקה"
									: "עדכון"}
						</span>
					</header>
					{["parent_child", "union"].includes(change.kind) && (
						<div className="contribution-relationship-comparison">
							{change.before && (
								<Relationship state={change.before} change={change} removed />
							)}
							{change.after && (
								<Relationship
									state={change.after}
									change={change}
									removed={false}
								/>
							)}
						</div>
					)}
					{change.kind === "place" && <Coordinates change={change} />}
					{Boolean(change.personNames?.length) && (
						<p className="contribution-diff-note">
							שם האיש הראשי יעודכן גם ברשימת האישים:{" "}
							{change.personNames?.map((name) => name.name).join(", ")} ←{" "}
							{String(change.after?.displayName ?? "")}
						</p>
					)}
					<div className="contribution-diff-table-wrap">
						<table>
							<thead>
								<tr>
									<th scope="col">שדה</th>
									<th scope="col">לפני</th>
									<th scope="col">אחרי</th>
								</tr>
							</thead>
							<tbody>
								{changedFields(change).map((field) => (
									<tr key={field}>
										<th scope="row">{FIELD_LABELS[field] ?? field}</th>
										<td className="removed">
											<span aria-hidden="true">− </span>
											<bdi>
												{shown(change.before?.[field], change.labels, field)}
											</bdi>
										</td>
										<td className="added">
											<span aria-hidden="true">+ </span>
											<bdi>
												{shown(change.after?.[field], change.labels, field)}
											</bdi>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{change.kind === "entry" && (
						<p className="contribution-diff-note">
							הערך ייווצר עם מטא-נתונים וגוף ריק. טקסט הערך נכתב בנפרד על ידי
							עורך.
						</p>
					)}
				</article>
			))}
		</div>
	);
}
