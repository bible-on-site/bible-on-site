import { Link } from "@tanstack/react-router";
import type {
	ContributionAgentResponse,
	ContributionAgentSummary,
} from "~/lib/tanahpedia/contribution-agents";
import type {
	Contribution,
	ContributionEvent,
	ContributionGeneration,
} from "~/lib/tanahpedia/contributions";
import type { ContributionHomeSearch } from "./ContributionWorkspace";

export { latestContributionAgentResponses as latestAgentResponses } from "~/lib/tanahpedia/contribution-agent-responses";

export function isAgentAssigned(item: Contribution): boolean {
	return item.assignee.kind === "local_llm" || item.assignee.kind === "aws_llm";
}

const STATUS: Record<ContributionGeneration["status"], string> = {
	queued: "העבודה נמצאת בתור",
	running: "הסוכן מטפל בדיון",
	completed: "הסוכן סיים את העבודה",
	needs_input: "הסוכן ממתין להבהרה",
	failed: "עבודת הסוכן נכשלה",
	cancelled: "עבודת הסוכן בוטלה",
};
const TRIGGER: Record<
	NonNullable<ContributionGeneration["trigger"]>,
	string
> = {
	assignment: "שיוך לסוכן",
	comment: "תגובה חדשה",
	edit: "עריכת הדיון",
	reopen: "פתיחת הדיון מחדש",
	manual: "הפעלה נוספת",
};

export function AgentWorkStatus({
	item,
	agents = [],
	showProposals = true,
	discussionSearch,
}: {
	item: Contribution;
	agents?: ContributionAgentSummary[];
	showProposals?: boolean;
	discussionSearch?: ContributionHomeSearch;
}) {
	const job = item.generation;
	if (!job) return null;
	const expired =
		job.status === "running" &&
		!(Date.parse(job.leaseExpiresAt ?? "") > Date.now());
	const agent = agents.find((candidate) => candidate.id === job.agentId);
	return (
		<section
			className="contribution-card contribution-card-body contribution-agent-work"
			aria-label="פעילות הסוכן"
		>
			<strong role="status">
				{expired ? "ממתין לעובד זמין להמשך הטיפול" : STATUS[job.status]}
			</strong>
			{job.status === "queued" && (
				<p className="contribution-muted">
					{(job.provider ??
						(item.assignee.kind === "aws_llm" ? "aws_llm" : "local_llm")) ===
					"local_llm"
						? "הבקשה תישאר בתור עד שהעובד בתחנת העבודה יתחבר."
						: "הסוכן יקבל את הפנייה או ההצעה, השינויים והדיון המלא."}
				</p>
			)}
			<p className="contribution-muted">
				{agent?.name ?? (job.provider === "aws_llm" ? "AWS LLM" : "Local LLM")}
				{job.model && (
					<>
						{" "}
						· <bdi>{job.model}</bdi>
					</>
				)}
				{job.bundleVersion && (
					<>
						{" "}
						· הוראות וכלים <bdi>{job.bundleVersion}</bdi>
					</>
				)}
			</p>
			{job.worker && (
				<p className="contribution-muted">
					עובד: <bdi>{job.worker}</bdi>
				</p>
			)}
			{job.trigger && (
				<p className="contribution-muted">
					הופעל בעקבות {TRIGGER[job.trigger]}
				</p>
			)}
			{Boolean(job.triggerEventIds?.length) && (
				<p className="contribution-agent-links">
					הקשר לעבודה:{" "}
					{job.triggerEventIds?.map((id, index) => {
						const hash = `contribution-event-${encodeURIComponent(id)}`;
						const label = `אירוע ${index + 1}`;
						return discussionSearch ? (
							<Link
								className="contribution-link"
								key={id}
								to="/"
								search={discussionSearch}
								hash={hash}
							>
								{label}
							</Link>
						) : (
							<a className="contribution-link" key={id} href={`#${hash}`}>
								{label}
							</a>
						);
					})}
				</p>
			)}
			{job.result && (
				<div>
					<p>{job.result.summary}</p>
					{job.result.pendingCommentIds.length > 0 && (
						<p>
							נדרשת הבהרה עבור {job.result.pendingCommentIds.length} תגובות.
						</p>
					)}
					{job.result.changed && item.kind === "pr" && (
						<p className="contribution-muted">
							ההצעה עודכנה לגרסה {job.result.revision}. נדרשת סקירה לפי כללי
							האישור.
						</p>
					)}
				</div>
			)}
			{job.error && (
				<p className="contribution-error" role="alert">
					{job.error}
				</p>
			)}
			{showProposals &&
				job.prIds.map((id, index) => (
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

export function AgentCommentResponse({
	response,
	pending,
}: {
	response?: ContributionAgentResponse;
	pending: boolean;
}) {
	if (!response) {
		return pending ? (
			<p className="contribution-muted">ממתין להתייחסות הסוכן</p>
		) : null;
	}
	return (
		<div className={`contribution-agent-response ${response.status}`}>
			<strong>
				{response.status === "addressed" ? "הסוכן התייחס להערה" : "נדרשת הבהרה"}
			</strong>
			<p>{response.body}</p>
		</div>
	);
}

export function AgentResponseLinks({ event }: { event: ContributionEvent }) {
	if (event.kind !== "agent_response" || !event.responses?.length) return null;
	return (
		<ul className="contribution-agent-links">
			{event.responses.map((response) => (
				<li key={response.commentId}>
					<a
						className="contribution-link"
						href={`#contribution-event-${encodeURIComponent(response.commentId)}`}
					>
						{response.status === "addressed"
							? "התייחסות להערה"
							: "בקשת הבהרה להערה"}
					</a>
				</li>
			))}
		</ul>
	);
}
