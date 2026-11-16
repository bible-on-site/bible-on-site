import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type {
	ContributionAgentProvider,
	ContributionAgentSummary,
} from "~/lib/tanahpedia/contribution-agents";
import { CONTRIBUTION_UI } from "~/lib/tanahpedia/contributions";
import {
	getContributionAgents,
	installContributionAgent,
	updateContributionAgent,
} from "~/server/tanahpedia/contributions";

const AGENTS_QUERY = ["contributions", "agents"];
const providerName = (provider: ContributionAgentProvider) =>
	provider === "local_llm" ? CONTRIBUTION_UI.localLlm : CONTRIBUTION_UI.awsLlm;
const draftOf = (agent: ContributionAgentSummary) => ({
	name: agent.name,
	model: agent.model ?? "",
	enabled: agent.enabled,
	version: agent.version,
});

function AgentCard({
	agent,
	changed,
}: {
	agent: ContributionAgentSummary;
	changed: (agent: ContributionAgentSummary) => void;
}) {
	const [draft, setDraft] = useState(() => draftOf(agent));
	const stale = draft.version !== agent.version;
	const update = useMutation({
		mutationFn: (action: "upgrade" | "configure") =>
			updateContributionAgent({
				data: {
					id: agent.id,
					version: draft.version,
					action,
					...(action === "configure"
						? {
								name: draft.name.trim(),
								model: draft.model.trim() || null,
								enabled: draft.enabled,
							}
						: {}),
				},
			}),
		onSuccess: (updated, action) => {
			setDraft((current) =>
				action === "configure"
					? draftOf(updated)
					: { ...current, version: updated.version },
			);
			changed(updated);
		},
	});
	return (
		<article
			className="contribution-card contribution-agent-card"
			aria-label={agent.name}
		>
			<div className="contribution-card-body">
				<h2>{agent.name}</h2>
				<p className="contribution-muted">
					{providerName(agent.provider)} · {agent.enabled ? "פעיל" : "מושבת"}
				</p>
				<dl className="contribution-agent-facts">
					<dt>גרסת הוראות וכלים</dt>
					<dd>
						<bdi>{agent.installedVersion}</bdi>
					</dd>
					<dt>הגרסה הזמינה</dt>
					<dd>
						<bdi>{agent.latestVersion}</bdi>
					</dd>
					<dt>חיבור אחרון</dt>
					<dd>
						{agent.lastSeenAt ? (
							<time dateTime={agent.lastSeenAt}>
								{new Date(agent.lastSeenAt).toLocaleString("he-IL")}
							</time>
						) : (
							"טרם התחבר"
						)}
					</dd>
					{agent.runtimeVersion && (
						<>
							<dt>גרסת העובד</dt>
							<dd>
								<bdi>{agent.runtimeVersion}</bdi>
							</dd>
						</>
					)}
				</dl>
				{agent.updateAvailable ? (
					<button
						className="contribution-button primary"
						type="button"
						disabled={update.isPending || stale}
						onClick={() => update.mutate("upgrade")}
					>
						עדכון הוראות וכלים
					</button>
				) : (
					<p className="contribution-muted">ההוראות והכלים מעודכנים</p>
				)}
				<form
					className="contribution-form"
					aria-label={`הגדרות ${agent.name}`}
					onSubmit={(event) => {
						event.preventDefault();
						update.mutate("configure");
					}}
				>
					<label>
						שם הסוכן
						<input
							className="contribution-input"
							required
							disabled={update.isPending}
							maxLength={120}
							value={draft.name}
							onChange={(event) =>
								setDraft({ ...draft, name: event.target.value })
							}
						/>
					</label>
					<label>
						מודל
						<input
							className="contribution-input"
							dir="ltr"
							disabled={update.isPending}
							maxLength={255}
							value={draft.model}
							onChange={(event) =>
								setDraft({ ...draft, model: event.target.value })
							}
							placeholder="ברירת המחדל של סביבת ההרצה"
						/>
					</label>
					<label>
						<span>
							<input
								type="checkbox"
								disabled={update.isPending}
								checked={draft.enabled}
								onChange={(event) =>
									setDraft({ ...draft, enabled: event.target.checked })
								}
							/>{" "}
							סוכן פעיל
						</span>
					</label>
					{stale && (
						<div
							role="status"
							className="contribution-agent-response needs_input"
						>
							<p>ההגדרות עודכנו מאז פתיחת הטופס. הטיוטה שלך נשמרה.</p>
							<button
								type="button"
								className="contribution-button"
								onClick={() => setDraft(draftOf(agent))}
							>
								טעינת ההגדרות העדכניות
							</button>
						</div>
					)}
					<button
						className="contribution-button"
						disabled={update.isPending || stale}
						type="submit"
					>
						{update.isPending ? "מעדכן..." : "שמירת הגדרות הסוכן"}
					</button>
				</form>
				{update.error && (
					<p className="contribution-error" role="alert">
						{update.error.message}
					</p>
				)}
				{update.isSuccess && <p role="status">הגדרת הסוכן עודכנה</p>}
			</div>
		</article>
	);
}

export function ContributionAgents() {
	const queryClient = useQueryClient();
	const agents = useQuery({
		queryKey: AGENTS_QUERY,
		queryFn: () => getContributionAgents(),
		staleTime: 0,
	});
	const [name, setName] = useState("");
	const [provider, setProvider] =
		useState<ContributionAgentProvider>("local_llm");
	const [model, setModel] = useState("qwen3:8b");
	const changed = (agent: ContributionAgentSummary) => {
		queryClient.setQueryData<ContributionAgentSummary[]>(
			AGENTS_QUERY,
			(previous = []) => [
				...previous.filter((entry) => entry.id !== agent.id),
				agent,
			],
		);
		void queryClient.invalidateQueries({ queryKey: AGENTS_QUERY });
	};
	const install = useMutation({
		mutationFn: () =>
			installContributionAgent({
				data: {
					name: name.trim(),
					provider,
					model: model.trim() || null,
					enabled: true,
				},
			}),
		onSuccess: (agent) => {
			changed(agent);
			setName("");
		},
	});
	return (
		<div className="contributions">
			<nav className="contribution-nav" aria-label="תורי עבודה וסוכנים">
				<Link to="/" search={{ tab: "issues" }}>
					Issues
				</Link>
				<Link to="/" search={{ tab: "prs" }}>
					Pull requests
				</Link>
				<Link to="/contribution-agents" aria-current="page">
					סוכנים
				</Link>
			</nav>
			<div className="contribution-heading">
				<div>
					<h1>ניהול סוכנים</h1>
					<p>התקנה ועדכון של הגדרות סוכנים בסביבות הרצה קיימות.</p>
				</div>
				<button
					className="contribution-button"
					type="button"
					disabled={agents.isFetching}
					onClick={() => void agents.refetch()}
				>
					רענון מצב
				</button>
			</div>
			<p className="contribution-muted">
				שיוך פנייה או PR לסוכן מפעיל עבודה אוטומטית. העובד המקומי משתמש בחיבור
				AWS SSO הקיים בתחנת העבודה; כאן נרשמים ההוראות, הכלים והמודל.
			</p>
			{agents.isPending && <p role="status">טוען סוכנים...</p>}
			{agents.error && (
				<p role="alert" className="contribution-error">
					{agents.error.message}
				</p>
			)}
			{agents.data?.length === 0 && (
				<p role="status">
					עדיין לא נרשמו סוכנים. אפשר להתקין הגדרה לסביבת הרצה קיימת.
				</p>
			)}
			<div className="contribution-agent-grid">
				{agents.data?.map((agent) => (
					<AgentCard key={agent.id} agent={agent} changed={changed} />
				))}
			</div>
			<section className="contribution-card contribution-card-body">
				<h2>התקנת הגדרת סוכן</h2>
				<p className="contribution-muted">
					בחרו את סביבת ההרצה הקיימת ואת המודל שיטפל בפניות ובהערות.
				</p>
				<form
					className="contribution-form"
					aria-label="התקנת הגדרת סוכן"
					onSubmit={(event) => {
						event.preventDefault();
						install.mutate();
					}}
				>
					<label>
						שם הסוכן
						<input
							className="contribution-input"
							required
							disabled={install.isPending}
							maxLength={120}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<label>
						סביבת הרצה
						<select
							className="contribution-input"
							disabled={install.isPending}
							value={provider}
							onChange={(event) => {
								const next = event.target.value as ContributionAgentProvider;
								setProvider(next);
								setModel(next === "local_llm" ? "qwen3:8b" : "");
							}}
						>
							<option value="local_llm">
								{CONTRIBUTION_UI.localLlm} - עובד בתחנת העבודה
							</option>
							<option value="aws_llm">{CONTRIBUTION_UI.awsLlm}</option>
						</select>
					</label>
					<label>
						מודל
						<input
							className="contribution-input"
							dir="ltr"
							disabled={install.isPending}
							maxLength={255}
							value={model}
							onChange={(event) => setModel(event.target.value)}
							placeholder="ברירת המחדל של סביבת ההרצה"
						/>
					</label>
					<button
						className="contribution-button primary"
						type="submit"
						disabled={install.isPending}
					>
						{install.isPending ? "מתקין הגדרה..." : "התקנת הגדרה"}
					</button>
				</form>
				{install.error && (
					<p className="contribution-error" role="alert">
						{install.error.message}
					</p>
				)}
				{install.isSuccess && (
					<p role="status">הגדרת הסוכן הותקנה ומוכנה לשיוך</p>
				)}
			</section>
		</div>
	);
}
