import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import {
	CONTRIBUTION_API_VERSION,
	contributionApiVersion,
	migrationBlocked,
} from "~/lib/tanahpedia/contribution-api";
import {
	type Assignee,
	assigneeLabel,
	CHANGE_LABELS,
	CONTRIBUTION_UI,
	type Contribution,
	type ContributionListRequest,
	type ContributionRevisionSnapshot,
	type Contributor,
	contributionCitation,
	reviewStatus,
} from "~/lib/tanahpedia/contributions";
import {
	createContributionItem,
	editContributionItem,
	generateIssuePrs,
	getContribution,
	getContributionCatalogue,
	getContributionLlmStatus,
	getContributionSession,
	getContributions,
	mergeContributionItem,
	recoverContributionItem,
	updateContributionItem,
} from "~/server/tanahpedia/contributions";
import {
	AssigneePicker,
	type ComposeContribution,
	ContributionComposer,
} from "./ContributionComposer";
import { ContributionDiff } from "./ContributionDiff";

export interface ContributionSearch {
	id?: string;
	issueId?: string;
	q?: string;
	state?: "open" | "closed" | "all";
	assignee?: string;
}
export function validateContributionSearch(
	search: Record<string, unknown>,
): ContributionSearch {
	const id = (value: unknown) =>
		typeof value === "string" &&
		(value === "new" || /^[0-9a-f-]{36}$/i.test(value))
			? value
			: undefined;
	return {
		id: id(search.id),
		issueId: id(search.issueId),
		q: typeof search.q === "string" ? search.q.slice(0, 500) : undefined,
		state:
			search.state === "closed" || search.state === "all"
				? search.state
				: "open",
		assignee:
			typeof search.assignee === "string" &&
			["unassigned", "human", "aws_llm", "local_llm"].includes(search.assignee)
				? search.assignee
				: undefined,
	};
}

export function WorkflowIcon({
	kind = "issue",
	state = "open",
}: {
	kind?: "issue" | "pr";
	state?: string;
}) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 20 20"
			fill="none"
			aria-hidden="true"
			style={{
				color:
					state === "incompatible"
						? "#59636e"
						: state === "open"
							? "#1a7f37"
							: "#8250df",
				flexShrink: 0,
			}}
		>
			{kind === "issue" ? (
				<>
					<circle
						cx="10"
						cy="10"
						r="7"
						stroke="currentColor"
						strokeWidth="1.7"
					/>
					<circle cx="10" cy="10" r="2" fill="currentColor" />
				</>
			) : (
				<>
					<circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
					<circle
						cx="5"
						cy="16"
						r="2"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
					<circle
						cx="15"
						cy="16"
						r="2"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
					<path
						d="M5 6v8m10 0V8a4 4 0 0 0-4-4H9m0 0 2-2M9 4l2 2"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
				</>
			)}
		</svg>
	);
}

const EVENT_LABELS: Record<string, string> = {
	created: "פתח את הדיון",
	edited: "עדכן את ההצעה",
	comment: "הגיב",
	assigned: "שינה שיוך",
	approved: "אישר את השינויים",
	changes_requested: "ביקש שינויים",
	closed: "סגר את הדיון",
	reopened: "פתח מחדש",
	merged: "מיזג את ההצעה",
	generated: "יצר הצעות שינוי",
	generation_queued: "שלח לעובד מקומי",
};
const REVIEW_LABELS = {
	exempt: "הגרסה נכתבה בידי doradsoft - אין צורך בסקירה נוספת",
	approved: "doradsoft אישר את הגרסה הנוכחית",
	required: "נדרש אישור מ-doradsoft",
	changes_requested: "doradsoft ביקש שינויים",
};

function date(value: string): string {
	return new Date(value).toLocaleString("he-IL", {
		timeZone: "Asia/Jerusalem",
		day: "numeric",
		month: "long",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function EvidenceList({ item }: { item: Pick<Contribution, "evidence"> }) {
	return (
		<section className="contribution-evidence" aria-label="ראיות ומקורות">
			<h3>
				ראיות ומקורות{" "}
				<span className="contribution-count">{item.evidence.length}</span>
			</h3>
			{item.evidence.length === 0 ? (
				<p className="contribution-muted">
					טרם נוספו מקורות. יש לצרף ראיות לפני יצירת PR באמצעות LLM.
				</p>
			) : (
				item.evidence.map((source) => (
					<article key={`${source.citation}:${source.quote}:${source.url}`}>
						<strong>{contributionCitation(source.citation)}</strong>
						{source.quote && <blockquote>{source.quote}</blockquote>}
						{source.note && <p>{source.note}</p>}
						{source.url && (
							<a href={source.url} target="_blank" rel="noreferrer">
								פתיחת המקור ↗
							</a>
						)}
					</article>
				))
			)}
		</section>
	);
}

function RevisionSnapshot({
	snapshot,
}: {
	snapshot: ContributionRevisionSnapshot;
}) {
	return (
		<details className="contribution-card contribution-card-body">
			<summary>
				הצגת גרסה {snapshot.revision} - {snapshot.author.name}
			</summary>
			<h3>{snapshot.title}</h3>
			<p className="contribution-description">{snapshot.description}</p>
			<EvidenceList item={snapshot} />
			<p>רצף הפעולות שנשמר בגרסה זו (API v{snapshot.apiVersion})</p>
			<pre className="contribution-raw-sequence" dir="ltr">
				{JSON.stringify(snapshot.changes, null, 2)}
			</pre>
		</details>
	);
}

function SequenceRecovery({
	item,
	refresh,
}: {
	item: Contribution;
	refresh: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [baseVersion, setBaseVersion] = useState(item.version);
	const [sequence, setSequence] = useState(() =>
		JSON.stringify(item.changes, null, 2),
	);
	const recovery = useMutation({
		mutationFn: () =>
			recoverContributionItem({
				data: {
					id: item.id,
					version: baseVersion,
					apiVersion: CONTRIBUTION_API_VERSION,
					sequence: JSON.parse(sequence),
				},
			}),
		onSuccess: refresh,
	});
	return (
		<section className="contribution-card contribution-card-body">
			<h3>רצף פעולות לשחזור ידני</h3>
			{!editing ? (
				<>
					<pre className="contribution-raw-sequence" dir="ltr">
						{JSON.stringify(item.changes, null, 2)}
					</pre>
					{item.state === "open" && (
						<button
							type="button"
							className="contribution-button"
							onClick={() => {
								setBaseVersion(item.version);
								setSequence(JSON.stringify(item.changes, null, 2));
								setEditing(true);
							}}
						>
							תיקון הרצף
						</button>
					)}
				</>
			) : (
				<form
					className="contribution-form"
					onSubmit={(event) => {
						event.preventDefault();
						recovery.mutate();
					}}
				>
					<label>
						רצף פעולות לשחזור
						<textarea
							className="contribution-input contribution-raw-sequence"
							dir="ltr"
							rows={18}
							value={sequence}
							onChange={(event) => setSequence(event.target.value)}
							required
							maxLength={200000}
						/>
					</label>
					<p>
						השמירה תבדוק את הרצף מול API v{CONTRIBUTION_API_VERSION}, תרענן את
						בסיס ההשוואה ותיצור גרסה ערוכה לאישור. הרצף הקודם נשמר.
					</p>
					{recovery.error && (
						<p className="contribution-error" role="alert">
							{recovery.error.message}
						</p>
					)}
					<button
						className="contribution-button primary"
						type="submit"
						disabled={recovery.isPending}
					>
						שמירת רצף מתוקן
					</button>
				</form>
			)}
		</section>
	);
}

function AssignmentForm({
	item,
	busy,
	act,
}: {
	item: Contribution;
	busy: boolean;
	act: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
}) {
	const [assignee, setAssignee] = useState<Assignee>(item.assignee);
	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();
				await act("assign", { assignee });
			}}
		>
			<AssigneePicker
				value={assignee}
				onChange={setAssignee}
				disabled={busy || item.state !== "open"}
			/>
			{item.state === "open" && (
				<button className="contribution-button" disabled={busy} type="submit">
					שמירת שיוך
				</button>
			)}
		</form>
	);
}

function LocalGenerationStatus({ item }: { item: Contribution }) {
	const job = item.generation;
	if (!job) return null;
	const disconnected =
		job.status === "running" &&
		!(Date.parse(job.leaseExpiresAt ?? "") > Date.now());
	const labels = {
		queued: "ממתין לעובד בתחנת העבודה",
		running: "המודל המקומי מכין הצעות",
		completed: "העובד המקומי יצר הצעות לסקירה",
		failed: "ההפקה המקומית נכשלה",
		cancelled: "בקשת ההפקה בוטלה",
	};
	return (
		<section
			className="contribution-card contribution-card-body"
			aria-label="התקדמות העובד המקומי"
		>
			<strong role="status">
				{disconnected
					? "העובד המקומי התנתק - ניתן לשלוח שוב"
					: labels[job.status]}
			</strong>
			{job.status === "queued" && (
				<p className="contribution-muted">
					הבקשה תישאר בתור עד שעובד מקומי יתחבר. לא מתבצעת הפקה בענן.
				</p>
			)}
			{job.worker && (
				<p>
					<bdi>{job.worker}</bdi>
					{job.model && (
						<>
							{" "}
							· <bdi>{job.model}</bdi>
						</>
					)}
				</p>
			)}
			{job.error && (
				<p className="contribution-error" role="alert">
					{job.error}
				</p>
			)}
			{job.prIds.map((id, index) => (
				<p key={id}>
					<Link
						className="contribution-link"
						to="/pull-requests"
						search={{ id }}
					>
						פתיחת הצעה {index + 1} לסקירה
					</Link>
				</p>
			))}
		</section>
	);
}

function Detail({
	item,
	all,
	actor,
	busy,
	act,
	edit,
	refresh,
}: {
	item: Contribution;
	all: Contribution[];
	actor?: Contributor;
	busy: boolean;
	act: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
	edit: () => void;
	refresh: () => void;
}) {
	const [tab, setTab] = useState("description"),
		[comment, setComment] = useState("");
	const status = reviewStatus(item);
	const incompatible = migrationBlocked(item);
	const localPending = Boolean(
		item.generation &&
			(item.generation.status === "queued" ||
				(item.generation.status === "running" &&
					Date.parse(item.generation.leaseExpiresAt ?? "") > Date.now())),
	);
	const llm = useQuery({
		queryKey: ["contributions", "llm-status"],
		queryFn: () => getContributionLlmStatus(),
		retry: false,
	});
	const generate = useMutation({
		mutationFn: () =>
			generateIssuePrs({ data: { id: item.id, version: item.version } }),
		onSuccess: refresh,
	});
	const linked = all.filter((other) => other.issueId === item.id);
	const linkedIssue = all.find((other) => other.id === item.issueId);
	const providerReady =
		item.assignee.kind === "local_llm"
			? true
			: item.assignee.kind === "aws_llm"
				? llm.data?.aws.enabled
				: false;
	return (
		<>
			<div className="contribution-heading">
				<div>
					<h1>
						{item.title}{" "}
						<span className="contribution-muted">#{item.number}</span>
					</h1>
					<div className="contribution-row-meta">
						<span
							className={`contribution-status ${incompatible ? "incompatible" : item.state}`}
						>
							{item.state === "merged"
								? "מוזג"
								: item.state === "closed"
									? "סגור"
									: "פתוח"}
						</span>
						<span>
							<bdi>{item.author.name}</bdi> פתח ב-{date(item.createdAt)}
						</span>
						{item.author.kind !== "human" && (
							<span className="contribution-type">
								{item.author.kind === "local_llm" ? "Local LLM" : "AWS LLM"}
							</span>
						)}
						<span>גרסה {item.revision}</span>
						{incompatible && (
							<span className="contribution-muted" lang="en">
								{CONTRIBUTION_UI.migrationFailed}
							</span>
						)}
					</div>
				</div>
				{item.state === "open" && (
					<button
						className="contribution-button"
						type="button"
						onClick={edit}
						disabled={busy || incompatible}
					>
						עריכה
					</button>
				)}
			</div>
			{incompatible && (
				<section className="contribution-migration-notice" role="status">
					<strong lang="en">{CONTRIBUTION_UI.migrationFailed}</strong>
					<p>
						ההצעה נשארת פתוחה. התצוגה החזותית והמיזוג אינם זמינים עד לשחזור
						הרצף. האישורים נשמרו.
					</p>
					<p dir="ltr">
						API v{contributionApiVersion(item)} → v
						{item.apiMigration?.to ?? CONTRIBUTION_API_VERSION}
					</p>
					{item.apiMigration?.error && (
						<p dir="ltr">{item.apiMigration.error}</p>
					)}
				</section>
			)}
			<div className="contribution-tabs" role="tablist" aria-label="תוכן הדיון">
				<button
					role="tab"
					aria-selected={tab === "description"}
					aria-controls="contribution-description"
					id="description-tab"
					type="button"
					onClick={() => setTab("description")}
				>
					תיאור ודיון{" "}
					<span className="contribution-count">
						{item.events.filter((event) => event.kind === "comment").length}
					</span>
				</button>
				{item.kind === "pr" && (
					<button
						role="tab"
						aria-selected={tab === "changes"}
						aria-controls="contribution-changes"
						id="changes-tab"
						type="button"
						onClick={() => setTab("changes")}
					>
						שינויים{" "}
						<span className="contribution-count">{item.changes.length}</span>
					</button>
				)}
			</div>
			<div className="contribution-layout">
				<div>
					{tab === "changes" ? (
						<div
							id="contribution-changes"
							role="tabpanel"
							aria-labelledby="changes-tab"
						>
							{incompatible ? (
								<SequenceRecovery item={item} refresh={refresh} />
							) : item.changes.length === 0 ? (
								<p className="contribution-card contribution-card-body">
									השדרוג הסיר פעולות שאינן נדרשות עוד. מיזוג יסגור את ההצעה ללא
									שינוי בתוכן.
								</p>
							) : (
								<ContributionDiff changes={item.changes} />
							)}
						</div>
					) : (
						<div
							id="contribution-description"
							role="tabpanel"
							aria-labelledby="description-tab"
						>
							<article className="contribution-card">
								<header className="contribution-card-header">
									<strong>
										<bdi>{item.author.name}</bdi>
									</strong>{" "}
									תיאר את {item.kind === "issue" ? "הפנייה" : "השינוי"}
								</header>
								<div className="contribution-card-body">
									<p>{item.description}</p>
									<EvidenceList item={item} />
								</div>
							</article>
							{item.revisionHistory?.map((snapshot) => (
								<RevisionSnapshot
									key={`${snapshot.revision}:${snapshot.version}`}
									snapshot={snapshot}
								/>
							))}
							<section
								className="contribution-timeline"
								aria-label="היסטוריית הדיון"
							>
								{item.events.map((event) => (
									<article className="contribution-event" key={event.id}>
										<div>
											<strong>
												<bdi>{event.actor.name}</bdi>
											</strong>{" "}
											{EVENT_LABELS[event.kind]}
											<time dateTime={event.at}>{date(event.at)}</time>
											{["approved", "changes_requested"].includes(event.kind) &&
												event.revision !== item.revision && (
													<span className="contribution-muted">
														{" "}
														(אישור של גרסה קודמת)
													</span>
												)}
										</div>
										{event.body && <p>{event.body}</p>}
										{event.snapshot && (
											<RevisionSnapshot snapshot={event.snapshot} />
										)}
									</article>
								))}
							</section>
							<form
								className="contribution-card"
								onSubmit={async (event) => {
									event.preventDefault();
									const submitted = comment;
									if (await act("comment", { body: submitted }))
										setComment((current) =>
											current === submitted ? "" : current,
										);
								}}
							>
								<div className="contribution-card-body contribution-form">
									<label>
										הוספת תגובה
										<textarea
											className="contribution-input"
											required
											value={comment}
											maxLength={10000}
											onChange={(event) => setComment(event.target.value)}
											placeholder="הוספת הקשר, שאלה או משוב"
										/>
									</label>
									<div className="contribution-form-actions">
										<button
											className="contribution-button primary"
											disabled={busy || !comment.trim()}
											type="submit"
										>
											שליחת תגובה
										</button>
									</div>
								</div>
							</form>
						</div>
					)}
					{item.kind === "pr" && (
						<section
							className={`contribution-merge ${!incompatible && ["approved", "exempt"].includes(status) ? "ready" : ""}`}
						>
							<h3>
								{item.state === "merged"
									? "ההצעה מוזגה בהצלחה"
									: REVIEW_LABELS[status]}
							</h3>
							<p>
								{item.state === "merged"
									? "השינויים והיסטוריית המיזוג נשמרו במסד הנתונים."
									: "במיזוג ייבדק שהנתונים עדיין תואמים להשוואה. כל השינויים יוחלו יחד, או שלא יוחל אף שינוי."}
							</p>
							{item.state === "open" && (
								<div className="contribution-form-actions">
									{actor?.isDoradsoft && status !== "exempt" && (
										<>
											<button
												className="contribution-button"
												disabled={busy}
												type="button"
												onClick={() =>
													void act("request_changes", { body: comment })
												}
											>
												בקשת שינויים
											</button>
											<button
												className="contribution-button"
												disabled={busy || status === "approved"}
												type="button"
												onClick={() => void act("approve", { body: comment })}
											>
												אישור השינויים
											</button>
										</>
									)}
									<button
										className="contribution-button primary"
										type="button"
										disabled={
											busy ||
											incompatible ||
											!["approved", "exempt"].includes(status)
										}
										onClick={() => void act("merge")}
									>
										{busy ? "מעדכן..." : "מיזוג PR"}
									</button>
								</div>
							)}
						</section>
					)}
					{Boolean(item.apiMigrationHistory?.length) && (
						<details className="contribution-card contribution-card-body">
							<summary>היסטוריית שדרוגי API</summary>
							{item.apiMigrationHistory?.map((migration) => (
								<article key={migration.id}>
									<p dir="ltr">
										v{migration.from} → v{migration.to} · {migration.status} ·{" "}
										{date(migration.at)}
									</p>
									{migration.error && <p dir="ltr">{migration.error}</p>}
									<pre className="contribution-raw-sequence" dir="ltr">
										{migration.sequence}
									</pre>
								</article>
							))}
						</details>
					)}
					{generate.error && (
						<div className="contribution-error" role="alert">
							{generate.error.message}
						</div>
					)}
					{item.kind === "issue" && <LocalGenerationStatus item={item} />}
					{generate.data && (
						<div role="status" className="contribution-card-body">
							נוצרו {generate.data.length} הצעות שינוי. כל אחת ממתינה לאישור
							doradsoft.
						</div>
					)}
				</div>
				<aside className="contribution-sidebar">
					<section>
						<h3>אחראי</h3>
						<AssignmentForm
							key={JSON.stringify(item.assignee)}
							item={item}
							busy={busy}
							act={act}
						/>
					</section>
					{item.kind === "pr" && (
						<section>
							<h3>סקירה נדרשת</h3>
							<p>
								<bdi>{CONTRIBUTION_UI.reviewer}</bdi>
							</p>
							<p className="contribution-muted">{REVIEW_LABELS[status]}</p>
							{item.provenance && (
								<p className="contribution-muted">
									נוצר על ידי {item.provenance.provider}:{" "}
									<bdi>{item.provenance.model}</bdi>
								</p>
							)}
						</section>
					)}
					{item.kind === "issue" && item.state === "open" && (
						<section>
							<h3>פתרון הפנייה</h3>
							<Link
								to="/pull-requests"
								search={{ id: "new", issueId: item.id }}
								className="contribution-button"
							>
								פתיחת PR ידנית
							</Link>
							{["local_llm", "aws_llm"].includes(item.assignee.kind) && (
								<>
									<button
										type="button"
										className="contribution-button primary"
										disabled={
											busy ||
											generate.isPending ||
											localPending ||
											!providerReady ||
											item.evidence.length === 0
										}
										onClick={() =>
											item.assignee.kind === "local_llm"
												? void act("queue_generation")
												: generate.mutate()
										}
									>
										{item.assignee.kind === "local_llm"
											? localPending
												? "העובד המקומי מטפל בפנייה"
												: "שליחה לעובד מקומי"
											: generate.isPending
												? "מכין הצעות..."
												: `יצירת PRs עם ${assigneeLabel(item.assignee)}`}
									</button>
									{!providerReady && (
										<p className="contribution-muted">
											הספק שנבחר עדיין לא מוגדר בשרת.
										</p>
									)}
									{item.evidence.length === 0 && (
										<p className="contribution-muted">
											נדרש לצרף מקור לפני יצירה.
										</p>
									)}
								</>
							)}
						</section>
					)}
					{(linkedIssue || linked.length > 0) && (
						<section>
							<h3>דיונים מקושרים</h3>
							{linkedIssue && (
								<Link
									className="contribution-link"
									to="/issues"
									search={{ id: linkedIssue.id }}
								>
									#{linkedIssue.number} {linkedIssue.title}
								</Link>
							)}
							{linked.map((pr) => (
								<p key={pr.id}>
									<Link
										className="contribution-link"
										to="/pull-requests"
										search={{ id: pr.id }}
									>
										#{pr.number} {pr.title}
									</Link>
								</p>
							))}
						</section>
					)}
					{item.state !== "merged" && (
						<section>
							<button
								type="button"
								className="contribution-button"
								disabled={busy}
								onClick={() =>
									void act(item.state === "open" ? "close" : "reopen")
								}
							>
								{item.state === "open" ? "סגירה ללא מיזוג" : "פתיחה מחדש"}
							</button>
						</section>
					)}
				</aside>
			</div>
		</>
	);
}

export function ContributionWorkspace({ kind }: { kind: "issue" | "pr" }) {
	const search = useSearch({ strict: false }) as ContributionSearch;
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [editingItem, setEditingItem] = useState<Contribution | null>(null);
	const editing = editingItem?.id === search.id ? editingItem : null;
	const [actionError, setActionError] = useState("");
	const path = kind === "issue" ? "/issues" : "/pull-requests";
	const filters: ContributionListRequest =
		search.id && search.id !== "new"
			? { relatedTo: search.id }
			: {
					kind,
					state: search.state ?? "open",
					q: search.q,
					assignee: search.assignee as ContributionListRequest["assignee"],
				};
	const list = useInfiniteQuery({
		queryKey: ["contributions", "list", filters],
		queryFn: ({ pageParam }) =>
			getContributions({
				data: { ...filters, ...(pageParam ? { before: pageParam } : {}) },
			}),
		initialPageParam: null as number | null,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		staleTime: 0,
	});
	const session = useQuery({
		queryKey: ["contributions", "session"],
		queryFn: () => getContributionSession(),
		staleTime: 0,
	});
	const detail = useQuery({
		queryKey: ["contribution", search.id],
		queryFn: () => getContribution({ data: search.id as string }),
		enabled: Boolean(search.id && search.id !== "new"),
		staleTime: 0,
		refetchInterval: (query) =>
			["queued", "running"].includes(query.state.data?.generation?.status ?? "")
				? 2000
				: false,
	});
	const catalogue = useQuery({
		queryKey: ["contributions", "catalogue"],
		queryFn: () => getContributionCatalogue(),
		enabled: search.id === "new" || Boolean(editing),
	});
	const issue = useQuery({
		queryKey: ["contribution", search.issueId],
		queryFn: () => getContribution({ data: search.issueId as string }),
		enabled: Boolean(search.issueId),
	});
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: ["contributions"] });
		void queryClient.invalidateQueries({ queryKey: ["contribution"] });
	};
	const mutation = useMutation({
		mutationFn: async ({
			action,
			extra = {},
		}: {
			action: string;
			extra?: Record<string, unknown>;
		}) => {
			const item = detail.data;
			if (!item) throw new Error("Item not loaded");
			const data = { id: item.id, version: item.version, action, ...extra };
			return action === "merge"
				? mergeContributionItem({ data })
				: updateContributionItem({ data });
		},
		onSuccess: refresh,
	});
	const act = async (action: string, extra?: Record<string, unknown>) => {
		setActionError("");
		try {
			await mutation.mutateAsync({ action, extra });
			return true;
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "העדכון נכשל");
			return false;
		}
	};
	const save = useMutation({
		mutationFn: async (data: ComposeContribution) =>
			editing
				? editContributionItem({
						data: { ...data, id: editing.id, version: editing.version },
					})
				: createContributionItem({ data }),
		onSuccess: async (item) => {
			setEditingItem(null);
			refresh();
			await navigate({
				to: item.kind === "issue" ? "/issues" : "/pull-requests",
				search: { id: item.id },
			});
		},
	});
	const all = list.data?.pages.flatMap((page) => page.items) ?? [];
	const filtered = all;
	const counts = list.data?.pages[0]?.counts ?? {
		issues: 0,
		prs: 0,
		open: 0,
		closed: 0,
		all: 0,
	};
	const item = detail.data;
	return (
		<div className="contributions">
			<div className="contribution-nav">
				<Link
					to="/issues"
					search={{}}
					aria-current={kind === "issue" ? "page" : undefined}
				>
					<WorkflowIcon /> Issues{" "}
					<span className="contribution-count">{counts.issues}</span>
				</Link>
				<Link
					to="/pull-requests"
					search={{}}
					aria-current={kind === "pr" ? "page" : undefined}
				>
					<WorkflowIcon kind="pr" /> Pull requests{" "}
					<span className="contribution-count">{counts.prs}</span>
				</Link>
			</div>
			{(list.error ||
				detail.error ||
				catalogue.error ||
				session.error ||
				actionError) && (
				<div className="contribution-error" role="alert">
					{actionError ||
						(list.error ?? detail.error ?? catalogue.error ?? session.error)
							?.message}
					<button
						type="button"
						className="contribution-button"
						onClick={refresh}
					>
						ניסיון נוסף
					</button>
				</div>
			)}
			{search.id && (
				<Link
					className="contribution-link"
					to={path}
					search={{}}
					onClick={() => setEditingItem(null)}
				>
					→ חזרה לרשימה
				</Link>
			)}
			{search.id === "new" || editing ? (
				<>
					<div className="contribution-heading">
						<div>
							<h1>
								{editing
									? "עריכת הדיון"
									: kind === "issue"
										? "פנייה חדשה"
										: "הצעת שינוי חדשה"}
							</h1>
							<p>
								{kind === "issue"
									? "תיאור הבעיה, המקורות והאחראי לטיפול"
									: "שינוי מובנה עם ראיות, להשוואה ולסקירה לפני מיזוג"}
							</p>
						</div>
					</div>
					{catalogue.data ? (
						<div className="contribution-card">
							<div className="contribution-card-body">
								<ContributionComposer
									key={editing ? editing.id : `new:${kind}`}
									kind={kind}
									initial={editing ?? undefined}
									linkedIssue={issue.data}
									catalogue={catalogue.data}
									busy={save.isPending}
									onSubmit={async (value) => {
										await save.mutateAsync(value);
									}}
									onCancel={() => {
										setEditingItem(null);
										if (!editing) void navigate({ to: path, search: {} });
									}}
								/>
							</div>
						</div>
					) : (
						<p role="status">טוען נתונים לטופס...</p>
					)}
				</>
			) : search.id ? (
				item ? (
					<Detail
						key={item.id}
						item={item}
						all={all}
						actor={session.data}
						busy={mutation.isPending}
						act={act}
						edit={() => setEditingItem(item)}
						refresh={refresh}
					/>
				) : (
					<p role="status">טוען דיון...</p>
				)
			) : (
				<>
					<div className="contribution-heading">
						<div>
							<h1>{kind === "issue" ? "פניות" : "הצעות שינוי"}</h1>
							<p>
								{kind === "issue"
									? "מה צריך לחקור, לתקן או להוסיף לתנכפדיה"
									: "סקירה, ראיות ומיזוג של שינויים מובנים בתנכפדיה"}
							</p>
						</div>
						<Link
							className="contribution-button primary"
							to={path}
							search={{ id: "new" }}
						>
							{kind === "issue" ? "+ פנייה חדשה" : "+ PR חדש"}
						</Link>
					</div>
					<div className="contribution-filters">
						<input
							className="contribution-input"
							aria-label="חיפוש דיונים"
							placeholder="חיפוש לפי כותרת, מספר או אחראי..."
							value={search.q ?? ""}
							onChange={(event) =>
								void navigate({
									to: path,
									search: { ...search, q: event.target.value || undefined },
									replace: true,
								})
							}
						/>
						<select
							className="contribution-input"
							aria-label="סינון לפי אחראי"
							value={search.assignee ?? ""}
							onChange={(event) =>
								void navigate({
									to: path,
									search: {
										...search,
										assignee: event.target.value || undefined,
									},
								})
							}
						>
							<option value="">כל האחראים</option>
							<option value="unassigned">ללא שיוך</option>
							<option value="human">עורך אנושי</option>
							<option value="aws_llm">{CONTRIBUTION_UI.awsLlm}</option>
							<option value="local_llm">{CONTRIBUTION_UI.localLlm}</option>
						</select>
					</div>
					<div className="contribution-list">
						<div className="contribution-list-head">
							{(
								[
									["open", "פתוחים"],
									["closed", "סגורים"],
									["all", "הכול"],
								] as const
							).map(([state, label]) => (
								<button
									type="button"
									key={state}
									aria-pressed={(search.state ?? "open") === state}
									onClick={() =>
										void navigate({ to: path, search: { ...search, state } })
									}
								>
									{label}{" "}
									<span className="contribution-count">{counts[state]}</span>
								</button>
							))}
						</div>
						{list.isPending ? (
							<div className="contribution-empty" role="status">
								טוען דיונים...
							</div>
						) : filtered.length === 0 ? (
							<div className="contribution-empty">
								<WorkflowIcon kind={kind} />
								<h2>
									{search.q || search.assignee
										? "לא נמצאו דיונים מתאימים"
										: kind === "issue"
											? "מקום לשאלות ולרעיונות הבאים"
											: "השינוי הבא מתחיל כאן"}
								</h2>
								<p>
									{kind === "issue"
										? "פתחו פנייה עם הקשר ומקורות, ושייכו אותה לעורך או למודל."
										: "הצעות עם מקורות והשוואה ברורה נבדקות כאן לפני החלה."}
								</p>
							</div>
						) : (
							filtered.map((row) => (
								<article
									className={`contribution-row ${migrationBlocked(row) ? "incompatible" : ""}`}
									key={row.id}
								>
									<WorkflowIcon
										kind={kind}
										state={migrationBlocked(row) ? "incompatible" : row.state}
									/>
									<div className="contribution-row-content">
										<Link
											className="contribution-row-title"
											to={path}
											search={{ id: row.id }}
										>
											{row.title}
										</Link>
										<div className="contribution-row-meta">
											<span>#{row.number}</span>
											<span>
												נפתח על ידי <bdi>{row.author.name}</bdi>
											</span>
											<time dateTime={row.createdAt}>
												{date(row.createdAt)}
											</time>
											{migrationBlocked(row) ? (
												<span lang="en">{CONTRIBUTION_UI.migrationFailed}</span>
											) : (
												[
													...new Set(row.changes.map((change) => change.kind)),
												].map((type) => (
													<span className="contribution-type" key={type}>
														{CHANGE_LABELS[type]}
													</span>
												))
											)}
											{row.kind === "pr" && (
												<span>{REVIEW_LABELS[reviewStatus(row)]}</span>
											)}
										</div>
									</div>
									<span className="contribution-muted">
										{assigneeLabel(row.assignee)}
									</span>
								</article>
							))
						)}
					</div>
				</>
			)}
			{list.hasNextPage && search.id !== "new" && !editing && (
				<button
					type="button"
					className="contribution-button"
					disabled={list.isFetchingNextPage}
					onClick={() => void list.fetchNextPage()}
				>
					{list.isFetchingNextPage
						? "טוען דיונים נוספים..."
						: "טעינת דיונים נוספים"}
				</button>
			)}
		</div>
	);
}
