import { useEffect, useId, useRef, useState } from "react";
import { canonicalJson } from "~/lib/canonical-json";
import type {
	ArticleLinkCommand,
	ArticleLinkState,
} from "~/lib/tanahpedia/contribution-article-links";
import {
	contributionArticleId,
	projectArticleLinks,
	validateArticleLinkChange,
	validateArticleLinkState,
} from "~/lib/tanahpedia/contribution-article-links";
import {
	contributionCitation,
	type ReviewedChange,
} from "~/lib/tanahpedia/contributions";
import { toHebrewLetters } from "~/utils/hebrew";

type Reference = { id: string | number; name: string };
export interface ContributionArticlePreview {
	id: string;
	title: string;
	state: ArticleLinkState;
	labels: Record<string, string>;
	references: { dedication: Reference[]; moed: Reference[] };
	hasMore: { dedication: boolean; moed: boolean };
}
export type PreviewContributionArticle = (
	id: string,
) => Promise<ContributionArticlePreview>;

/** One title-search hit — enough context to tell same-name articles apart. */
export interface ContributionArticleTarget {
	id: string;
	title: string;
	perekLabel: string;
	authorName: string | null;
}
export type SearchContributionArticles = (
	query: string,
) => Promise<ContributionArticleTarget[]>;
/** Runs deterministic discovery for the chosen article; resolves ordinary PR ids. */
export type DiscoverContributionArticleLinks = (
	articleId: string,
) => Promise<string[]>;
const ARTICLE_SEARCH_DEBOUNCE_MS = 250;

const RELATIONSHIPS = {
	primaryPerek: "פרק ראשי",
	coveringSources: "כיסוי פסוקים",
	dedicationAssignments: "הקדשה",
	moadim: "מועדים",
};
const ACTIONS = {
	add: "הוספה",
	remove: "הסרה",
	replace: "החלפה",
	clear: "ניקוי מלא",
};
type Relationship = ArticleLinkCommand["relationshipKey"];

function newCommand(relationship: Relationship): ArticleLinkCommand {
	if (relationship === "primaryPerek")
		return {
			relationshipKey: relationship,
			action: "replace",
			target: { perekId: 0 },
		};
	if (relationship === "dedicationAssignments")
		return {
			relationshipKey: relationship,
			action: "add",
			target: { dedicationId: 0, expiresAt: null },
		};
	if (relationship === "moadim")
		return {
			relationshipKey: relationship,
			action: "add",
			target: { moedIds: [0] },
		};
	return {
		relationshipKey: relationship,
		action: "add",
		target: { pasukCoordinates: [{ perekId: 0, pasuk: 0 }] },
	};
}

function NumericReference({
	label,
	value,
	list,
	onChange,
}: {
	label: string;
	value: number;
	list: string;
	onChange: (value: number) => void;
}) {
	return (
		<label>
			{label}
			<input
				className="contribution-input"
				aria-label={label}
				type="number"
				min="1"
				step="1"
				required
				value={value || ""}
				list={list}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
		</label>
	);
}

function commandChildren(command: ArticleLinkCommand) {
	return {
		coordinates:
			command.relationshipKey === "coveringSources"
				? command.target.pasukCoordinates
				: [],
		moeds: command.relationshipKey === "moadim" ? command.target.moedIds : [],
	};
}
function commandIdentity(command: ArticleLinkCommand): {
	key: string;
	coordinates: string[];
	moeds: string[];
} {
	const children = commandChildren(command);
	return {
		key: crypto.randomUUID(),
		coordinates: children.coordinates.map(() => crypto.randomUUID()),
		moeds: children.moeds.map(() => crypto.randomUUID()),
	};
}
function childIdentities(keys: string[], previous: unknown[], next: unknown[]) {
	if (next.length < previous.length) {
		const difference = previous.findIndex(
			(item, index) =>
				canonicalJson(item) !== canonicalJson(next[index] ?? null),
		);
		return keys.filter(
			(_, index) =>
				index < difference ||
				index >= difference + previous.length - next.length,
		);
	}
	return [
		...keys,
		...Array.from({ length: next.length - previous.length }, () =>
			crypto.randomUUID(),
		),
	];
}

export function ContributionArticleLinkFields({
	targetId,
	commands: serialized,
	onTargetChange,
	onCommandsChange,
	references,
	previewArticle,
	searchArticles,
	discoverLinks,
	openPr,
}: {
	targetId: string;
	commands: string;
	onTargetChange: (id: string) => void;
	onCommandsChange: (commands: string) => void;
	references?: Record<string, Reference[]>;
	previewArticle?: PreviewContributionArticle;
	searchArticles?: SearchContributionArticles;
	discoverLinks?: DiscoverContributionArticleLinks;
	openPr?: (id: string) => unknown;
}) {
	const id = useId();
	// Draft values can be incomplete; strict shared validation runs on submit.
	const commands = JSON.parse(serialized) as ArticleLinkCommand[];
	const [identities, setIdentities] = useState(() =>
		commands.map(commandIdentity),
	);
	const request = useRef(0);
	const [preview, setPreview] = useState<ContributionArticlePreview | null>(
		null,
	);
	const [loading, setLoading] = useState(false);
	const [discovering, setDiscovering] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const current = preview?.id === targetId ? preview : null;
	const loadPreview = async (articleId: string) => {
		if (!previewArticle) return;
		const generation = ++request.current;
		setError("");
		setMessage("");
		setLoading(true);
		try {
			const result = await previewArticle(contributionArticleId(articleId));
			if (generation === request.current) setPreview(result);
		} catch (failure) {
			if (generation === request.current)
				setError(
					failure instanceof Error ? failure.message : "טעינת המאמר נכשלה",
				);
		} finally {
			if (generation === request.current) setLoading(false);
		}
	};
	const discover = async () => {
		/* istanbul ignore next -- the only caller is the button below, which
		   renders solely when both callbacks exist and is disabled while discovering */
		if (!discoverLinks || !openPr || discovering) return;
		request.current++;
		setLoading(false);
		setError("");
		setMessage("");
		setDiscovering(true);
		try {
			const ids = await discoverLinks(contributionArticleId(targetId));
			if (ids.length) await openPr(ids[0]);
			else
				setMessage(
					"לא נמצאו קישורים חדשים שניתן להציע למאמר זה. אפשר לפתוח פנייה ולשייך אותה לסוכן מקומי להמשך חקירה.",
				);
		} catch (failure) {
			setError(
				failure instanceof Error ? failure.message : "איתור הקישורים נכשל",
			);
		} finally {
			setDiscovering(false);
		}
	};
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<ContributionArticleTarget[] | null>(
		null,
	);
	const [searching, setSearching] = useState(false);
	const searchRequest = useRef(0);
	useEffect(() => {
		if (!searchArticles) return;
		const generation = ++searchRequest.current;
		const text = query.trim();
		if (!text) {
			setResults(null);
			setSearching(false);
			return;
		}
		setSearching(true);
		const timer = setTimeout(() => {
			setError("");
			searchArticles(text)
				.then((found) => {
					if (searchRequest.current === generation) setResults(found);
				})
				.catch((failure: unknown) => {
					if (searchRequest.current === generation) {
						setResults(null);
						setError(
							failure instanceof Error ? failure.message : "חיפוש המאמרים נכשל",
						);
					}
				})
				.finally(() => {
					if (searchRequest.current === generation) setSearching(false);
				});
		}, ARTICLE_SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, searchArticles]);
	const select = (result: ContributionArticleTarget) => {
		setResults(null);
		setQuery("");
		setMessage("");
		setError("");
		onTargetChange(result.id);
		void loadPreview(result.id);
	};
	// Draft numeric inputs may be incomplete. Submission uses the strict shared
	// validator; the JSON string is an internal form value, never a user editor.
	const update = (index: number, command: ArticleLinkCommand) => {
		const previous = commandChildren(commands[index]),
			next = commandChildren(command);
		setIdentities(
			identities.map((identity, position) =>
				position === index
					? {
							...identity,
							coordinates: childIdentities(
								identity.coordinates,
								previous.coordinates,
								next.coordinates,
							),
							moeds: childIdentities(
								identity.moeds,
								previous.moeds,
								next.moeds,
							),
						}
					: identity,
			),
		);
		onCommandsChange(
			JSON.stringify(
				commands.map((item, position) => (position === index ? command : item)),
			),
		);
	};
	const rows = commands.map((command, index) => ({
		command,
		identity: identities[index],
	}));
	const lists = {
		perek: references?.perek ?? [],
		dedication: current?.references.dedication ?? references?.dedication ?? [],
		moed: current?.references.moed ?? references?.moed ?? [],
	};
	return (
		<div className="contribution-source-fields">
			{searchArticles && (
				<div className="contribution-source-fields">
					<label>
						חיפוש מאמר לפי שם
						<input
							className="contribution-input"
							type="search"
							aria-label="חיפוש מאמר לפי שם"
							maxLength={120}
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setMessage("");
							}}
						/>
					</label>
					{searching && (
						<p className="contribution-muted" role="status">
							מחפש מאמרים...
						</p>
					)}
					{!searching && results && results.length === 0 && (
						<p className="contribution-muted">
							לא נמצאו מאמרים בשם הזה. אפשר לנסות ניסוח אחר או להזין מספר מאמר
							ידנית.
						</p>
					)}
					{!searching && results && results.length > 0 && (
						<ul
							className="contribution-article-results"
							aria-label="תוצאות חיפוש המאמרים"
						>
							{results.map((result) => (
								<li key={result.id}>
									<button
										type="button"
										className="contribution-button"
										onClick={() => select(result)}
									>
										{result.title}{" "}
										<span className="contribution-muted">
											{result.perekLabel} · מאמר {result.id}
											{result.authorName ? ` · ${result.authorName}` : ""}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
			<label>
				מספר מאמר
				<input
					className="contribution-input"
					aria-label="מספר מאמר"
					inputMode="numeric"
					required
					value={targetId}
					onChange={(event) => {
						request.current++;
						setLoading(false);
						setError("");
						setMessage("");
						onTargetChange(event.target.value);
					}}
				/>
			</label>
			<div className="contribution-form-actions">
				{previewArticle && (
					<button
						type="button"
						className="contribution-button"
						disabled={loading || discovering || !targetId}
						onClick={() => void loadPreview(targetId)}
					>
						{loading ? "טוען מאמר..." : "טעינת המאמר"}
					</button>
				)}
				{discoverLinks && openPr && (
					<button
						type="button"
						className="contribution-button"
						disabled={discovering || !targetId}
						onClick={() => void discover()}
					>
						{discovering ? "מאתר קישורים..." : "איתור קישורים ופתיחת PR"}
					</button>
				)}
			</div>
			{error && <p role="alert">{error}</p>}
			{message && <p role="status">{message}</p>}
			{current && (
				<section aria-label="המאמר שנבחר" className="contribution-diff-note">
					<a href={`/articles/${current.id}`} target="_blank" rel="noreferrer">
						{current.title}
					</a>
					<p>
						פרק ראשי נוכחי:{" "}
						{contributionCitation(
							current.labels[`perek:${current.state.perekId}`] ??
								String(current.state.perekId),
						)}
					</p>
				</section>
			)}
			<p className="contribution-muted">
				אפשר לשנות כמה קישורים לאותו מאמר. לכל מאמר פותחים PR נפרד.
				{discoverLinks &&
					" איתור אוטומטי מציע קישורים מציטוטים במאמר ופותח או מוצא PR רגיל עם מקורות והשוואה לסקירה."}
			</p>
			{Object.entries(lists).map(([kind, choices]) => (
				<datalist key={kind} id={`${id}-${kind}`}>
					{choices.map((choice) => (
						<option key={choice.id} value={choice.id}>
							{choice.name}
						</option>
					))}
				</datalist>
			))}
			{current && (current.hasMore.dedication || current.hasMore.moed) && (
				<p className="contribution-muted">
					הרשימות מציגות חלק מהאפשרויות. אפשר להזין גם מספר הקדשה או מועד קיים
					שאינו מופיע בהן.
				</p>
			)}
			{rows.map(({ command, identity }, index) => (
				<fieldset className="contribution-fieldset" key={identity.key}>
					<legend>קישור {index + 1}</legend>
					<div className="contribution-source-fields">
						<label>
							סוג קישור
							<select
								className="contribution-input"
								aria-label={`סוג קישור ${index + 1}`}
								value={command.relationshipKey}
								onChange={(event) =>
									update(index, newCommand(event.target.value as Relationship))
								}
							>
								{Object.entries(RELATIONSHIPS).map(([key, label]) => (
									<option key={key} value={key}>
										{label}
									</option>
								))}
							</select>
						</label>
						<label>
							פעולה
							<select
								className="contribution-input"
								aria-label={`פעולת קישור ${index + 1}`}
								value={command.action}
								onChange={(event) => {
									const action = event.target
										.value as ArticleLinkCommand["action"];
									if (command.relationshipKey === "primaryPerek") return;
									if (command.relationshipKey === "dedicationAssignments") {
										update(index, {
											...command,
											action: action as "add" | "remove" | "replace",
										});
										return;
									}
									if (command.relationshipKey === "coveringSources")
										update(index, {
											...command,
											action,
											target:
												action === "clear"
													? { pasukCoordinates: [] }
													: command.target,
										});
									else
										update(index, {
											...command,
											action,
											target:
												action === "clear" ? { moedIds: [] } : command.target,
										});
								}}
							>
								{Object.entries(ACTIONS)
									.filter(([action]) =>
										command.relationshipKey === "primaryPerek"
											? action === "replace"
											: command.relationshipKey === "dedicationAssignments"
												? action !== "clear"
												: true,
									)
									.map(([action, label]) => (
										<option key={action} value={action}>
											{label}
										</option>
									))}
							</select>
						</label>
						{command.relationshipKey === "primaryPerek" && (
							<NumericReference
								label={`פרק ראשי ${index + 1}`}
								value={command.target.perekId}
								list={`${id}-perek`}
								onChange={(perekId) =>
									update(index, { ...command, target: { perekId } })
								}
							/>
						)}
						{command.relationshipKey === "coveringSources" &&
							command.action !== "clear" && (
								<>
									{command.target.pasukCoordinates
										.map((coordinate, at) => ({
											coordinate,
											key: identity.coordinates[at],
										}))
										.map(({ coordinate, key }, position) => (
											<div className="contribution-form-grid" key={key}>
												<NumericReference
													label={`פרק בקישור ${index + 1} פסוק ${position + 1}`}
													value={coordinate.perekId}
													list={`${id}-perek`}
													onChange={(perekId) =>
														update(index, {
															...command,
															target: {
																...command.target,
																pasukCoordinates:
																	command.target.pasukCoordinates.map(
																		(item, at) =>
																			at === position
																				? { ...item, perekId }
																				: item,
																	),
															},
														})
													}
												/>
												<label>
													פסוק
													<input
														className="contribution-input"
														aria-label={`מספר פסוק בקישור ${index + 1} פסוק ${position + 1}`}
														type="number"
														min="1"
														step="1"
														required
														value={coordinate.pasuk || ""}
														onChange={(event) =>
															update(index, {
																...command,
																target: {
																	...command.target,
																	pasukCoordinates:
																		command.target.pasukCoordinates.map(
																			(item, at) =>
																				at === position
																					? {
																							...item,
																							pasuk: Number(event.target.value),
																						}
																					: item,
																		),
																},
															})
														}
													/>
												</label>
												<button
													type="button"
													className="contribution-button danger"
													aria-label={`הסרת פסוק ${position + 1} מקישור ${index + 1}`}
													onClick={() =>
														update(index, {
															...command,
															target: {
																...command.target,
																pasukCoordinates:
																	command.target.pasukCoordinates.filter(
																		(_, at) => at !== position,
																	),
															},
														})
													}
												>
													הסרת פסוק
												</button>
											</div>
										))}
									<button
										type="button"
										className="contribution-button"
										disabled={command.target.pasukCoordinates.length >= 1000}
										onClick={() =>
											update(index, {
												...command,
												target: {
													...command.target,
													pasukCoordinates: [
														...command.target.pasukCoordinates,
														{ perekId: 0, pasuk: 0 },
													],
												},
											})
										}
									>
										+ הוספת פסוק לקישור {index + 1}
									</button>
									<label>
										אימות הכיסוי
										<select
											className="contribution-input"
											aria-label={`אימות כיסוי ${index + 1}`}
											value={
												command.target.coverageVerified === undefined
													? "preserve"
													: String(command.target.coverageVerified)
											}
											onChange={(event) => {
												const { coverageVerified: _verification, ...target } =
													command.target;
												update(index, {
													...command,
													target: {
														...target,
														...(event.target.value === "preserve"
															? {}
															: {
																	coverageVerified:
																		event.target.value === "true",
																}),
													},
												});
											}}
										>
											<option value="preserve">ללא שינוי</option>
											<option value="true">מאומת</option>
											<option value="false">ללא אימות</option>
										</select>
									</label>
								</>
							)}
						{command.relationshipKey === "dedicationAssignments" && (
							<>
								<NumericReference
									label={`מספר הקדשה ${index + 1}`}
									value={command.target.dedicationId}
									list={`${id}-dedication`}
									onChange={(dedicationId) =>
										update(index, {
											...command,
											target: { ...command.target, dedicationId },
										})
									}
								/>
								{command.action !== "remove" && (
									<label>
										תוקף ההקדשה (UTC, אופציונלי)
										<input
											className="contribution-input"
											aria-label={`תוקף הקדשה ${index + 1}`}
											type="datetime-local"
											step="1"
											value={command.target.expiresAt?.replace(" ", "T") ?? ""}
											onChange={(event) => {
												const value = event.target.value;
												update(index, {
													...command,
													target: {
														...command.target,
														expiresAt: value
															? `${value.replace("T", " ")}${value.length === 16 ? ":00" : ""}`
															: null,
													},
												});
											}}
										/>
									</label>
								)}
							</>
						)}
						{command.relationshipKey === "moadim" &&
							command.action !== "clear" && (
								<>
									{command.target.moedIds
										.map((moedId, at) => ({ moedId, key: identity.moeds[at] }))
										.map(({ moedId, key }, position) => (
											<div className="contribution-form-grid" key={key}>
												<NumericReference
													label={`מספר מועד ${position + 1} בקישור ${index + 1}`}
													value={moedId}
													list={`${id}-moed`}
													onChange={(value) =>
														update(index, {
															...command,
															target: {
																moedIds: command.target.moedIds.map(
																	(item, at) =>
																		at === position ? value : item,
																),
															},
														})
													}
												/>
												<button
													type="button"
													className="contribution-button danger"
													aria-label={`הסרת מועד ${position + 1} מקישור ${index + 1}`}
													onClick={() =>
														update(index, {
															...command,
															target: {
																moedIds: command.target.moedIds.filter(
																	(_, at) => at !== position,
																),
															},
														})
													}
												>
													הסרת מועד
												</button>
											</div>
										))}
									<button
										type="button"
										className="contribution-button"
										disabled={command.target.moedIds.length >= 1000}
										onClick={() =>
											update(index, {
												...command,
												target: { moedIds: [...command.target.moedIds, 0] },
											})
										}
									>
										+ הוספת מועד לקישור {index + 1}
									</button>
								</>
							)}
						<button
							type="button"
							className="contribution-button danger"
							onClick={() => {
								setIdentities(
									identities.filter((_, position) => position !== index),
								);
								onCommandsChange(
									JSON.stringify(
										commands.filter((_, position) => position !== index),
									),
								);
							}}
						>
							הסרת קישור {index + 1}
						</button>
					</div>
				</fieldset>
			))}
			<button
				type="button"
				className="contribution-button"
				disabled={commands.length >= 40}
				onClick={() => {
					const command = newCommand("coveringSources");
					setIdentities([...identities, commandIdentity(command)]);
					onCommandsChange(JSON.stringify([...commands, command]));
				}}
			>
				+ הוספת קישור מוצע
			</button>
		</div>
	);
}

export function ContributionArticleLinkDiff({
	change,
}: {
	change: ReviewedChange;
}) {
	const before = validateArticleLinkState(change.before);
	const input = validateArticleLinkChange({
		kind: change.kind,
		targetId: change.targetId,
		after: change.after,
	});
	const after = projectArticleLinks(before, input.after);
	const chapter = (id: number) =>
		contributionCitation(change.labels[`perek:${id}`] ?? `פרק ${id}`);
	const targetLabel = (kind: "dedication" | "moed", id: number) =>
		change.labels[`${kind}:${id}`]
			? `${change.labels[`${kind}:${id}`]} (#${id})`
			: `${kind === "dedication" ? "הקדשה" : "מועד"} ${id}`;
	const values = (state: ArticleLinkState) => ({
		perekId: [{ key: state.perekId, label: chapter(state.perekId) }],
		coveringSources: state.coveringSources.map((coordinate) => ({
			key: `${coordinate.perekId}:${coordinate.pasuk}`,
			label: `${chapter(coordinate.perekId)} ${toHebrewLetters(coordinate.pasuk)}`,
		})),
		coverageVerified: [
			{
				key: "coverageVerified",
				label: state.coverageVerified ? "מאומת" : "ללא אימות",
			},
		],
		dedicationAssignments: state.dedicationAssignments.map((assignment) => ({
			key: assignment.dedicationId,
			label: `${targetLabel("dedication", assignment.dedicationId)}${assignment.expiresAt ? ` (עד ${assignment.expiresAt} UTC)` : ""}`,
		})),
		moedIds: state.moedIds.map((id) => ({
			key: id,
			label: targetLabel("moed", id),
		})),
	});
	const fields = {
		perekId: "פרק ראשי",
		coveringSources: "כיסוי פסוקים",
		coverageVerified: "אימות הכיסוי",
		dedicationAssignments: "הקדשות",
		moedIds: "מועדים",
	};
	const oldValues = values(before),
		newValues = values(after);
	return (
		<section aria-label="השוואת קישורי המאמר">
			<p className="contribution-diff-note">
				<a
					href={`/articles/${change.targetId}`}
					target="_blank"
					rel="noreferrer"
				>
					{change.labels[`article:${change.targetId}`] ??
						`מאמר ${change.targetId}`}
				</a>
			</p>
			<ol aria-label="פעולות הקישור המוצעות">
				{input.after.commands.map((command) => (
					<li key={canonicalJson(command)}>
						{RELATIONSHIPS[command.relationshipKey]} - {ACTIONS[command.action]}
					</li>
				))}
			</ol>
			<div className="contribution-diff-table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">קישור</th>
							<th scope="col">לפני</th>
							<th scope="col">אחרי</th>
						</tr>
					</thead>
					<tbody>
						{(Object.keys(fields) as (keyof typeof fields)[])
							.filter(
								(field) =>
									canonicalJson(before[field]) !== canonicalJson(after[field]),
							)
							.map((field) => (
								<tr key={field}>
									<th scope="row">{fields[field]}</th>
									{[
										{ items: oldValues[field], role: "removed" },
										{ items: newValues[field], role: "added" },
									].map(({ items, role }) => (
										<td key={role} className={role}>
											{items.length ? (
												<ul>
													{items.map((item) => (
														<li key={item.key}>{item.label}</li>
													))}
												</ul>
											) : (
												"-"
											)}
										</td>
									))}
								</tr>
							))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
