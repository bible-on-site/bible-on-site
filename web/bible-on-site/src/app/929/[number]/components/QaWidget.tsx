"use client";

import Link from "next/link";
import { useState, useCallback, useRef, useEffect } from "react";
import styles from "./qa-widget.module.css";

type SearchScope = "perek" | "sefer" | "all";

interface QaAnswerSource {
	type: string;
	name: string;
	author: string;
	perekId: number;
	articleId?: number;
	perushSlug?: string;
}

interface QaAnswer {
	text: string;
	confidence: number;
	source: QaAnswerSource;
}

interface QaAskResponse {
	answers: QaAnswer[];
	noAnswer: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
	article: "מאמר",
	perush: "פירוש",
};

interface QaWidgetProps {
	perekId: number;
	seferPerekIds: number[];
}

function buildCitationHref(source: QaAnswerSource): string {
	if (source.type === "article" && source.articleId != null) {
		return `/929/${source.perekId}/${source.articleId}`;
	}
	if (source.type === "perush" && source.perushSlug) {
		return `/929/${source.perekId}/${encodeURIComponent(source.perushSlug)}`;
	}
	return `/929/${source.perekId}`;
}

function citationLabel(source: QaAnswerSource): string {
	const kind = SOURCE_LABELS[source.type] ?? source.type;
	return `${kind}: ${source.name} — ${source.author}`;
}

export function QaWidget({ perekId, seferPerekIds }: QaWidgetProps) {
	const [open, setOpen] = useState(false);
	const [question, setQuestion] = useState("");
	const [loading, setLoading] = useState(false);
	const [response, setResponse] = useState<QaAskResponse | null>(null);
	const [scope, setScope] = useState<SearchScope>("perek");
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	const handleAsk = useCallback(async () => {
		const q = question.trim();
		if (!q) return;
		setLoading(true);
		setResponse(null);

		const payload: Record<string, unknown> = { question: q };
		if (scope === "perek") {
			payload.perekIds = [perekId];
		} else if (scope === "sefer") {
			payload.perekIds = seferPerekIds;
		}

		try {
			const res = await fetch("/api/qa/ask", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const data: QaAskResponse = await res.json();
			setResponse(data);
		} catch {
			setResponse({ answers: [], noAnswer: true });
		} finally {
			setLoading(false);
		}
	}, [question, perekId, seferPerekIds, scope]);

	const hasResults =
		response && !response.noAnswer && response.answers.length > 0;

	return (
		<>
			{/* Floating action button */}
			<button
				type="button"
				className={styles.fab}
				onClick={() => setOpen((v) => !v)}
				aria-label={open ? "סגור חיפוש" : "שאלה על הפרק"}
				data-flipbook-no-flip
			>
				{open ? "✕" : "?"}
			</button>

			{/* Backdrop */}
			{open && (
				<button
					type="button"
					className={styles.backdrop}
					onClick={() => setOpen(false)}
					aria-label="סגור"
					data-flipbook-no-flip
				/>
			)}

			{/* Slide-in panel */}
			{open && (
				<aside
					ref={panelRef}
					className={styles.panel}
					data-flipbook-no-flip
				>
					<header className={styles.panelHeader}>
						<h2 className={styles.panelTitle}>שאלה על הפרק</h2>
						<p className={styles.panelSubtitle}>
							חיפוש במפרשים (מלבי&quot;ם, אור החיים) ובמאמרים
						</p>
					</header>

					<fieldset className={styles.scopeGroup} disabled={loading}>
						<legend className={styles.srOnly}>טווח חיפוש</legend>
						{(
							[
								["perek", "בפרק זה"],
								["sefer", "בספר זה"],
								["all", 'בכל התנ"ך'],
							] as [SearchScope, string][]
						).map(([value, label]) => (
							<label key={value} className={styles.scopeLabel}>
								<input
									type="radio"
									name="qa-scope"
									className={styles.scopeRadio}
									value={value}
									checked={scope === value}
									onChange={() => setScope(value)}
								/>
								<span className={styles.scopeText}>
									{label}
								</span>
							</label>
						))}
					</fieldset>

					<div className={styles.form}>
						<input
							type="text"
							className={styles.input}
							placeholder="הקלד שאלה בעברית..."
							value={question}
							onChange={(e) => setQuestion(e.target.value)}
							onKeyDown={(e) =>
								e.key === "Enter" && handleAsk()
							}
							aria-label="שאלה על הפרק"
							disabled={loading}
						/>
						<button
							type="button"
							className={styles.sendBtn}
							onClick={handleAsk}
							disabled={loading || !question.trim()}
						>
							{loading ? "..." : "›"}
						</button>
					</div>

					{response && (
						<div className={styles.results}>
							{!hasResults ? (
								<p className={styles.noAnswer}>
									לא נמצאו תשובות מתאימות.
								</p>
							) : (
								<ul className={styles.list}>
									{response.answers.map((a) => (
										<li
											key={`${a.source.type}-${a.source.perekId}-${a.source.name}-${a.text.slice(0, 40)}`}
											className={styles.card}
										>
											<p className={styles.text}>
												{a.text}
											</p>
											<footer className={styles.cardFooter}>
												<Link
													href={buildCitationHref(
														a.source,
													)}
													className={
														styles.citation
													}
													onClick={() =>
														setOpen(false)
													}
												>
													{citationLabel(a.source)}
												</Link>
												<span
													className={
														styles.confidence
													}
												>
													{a.confidence.toFixed(2)}
												</span>
											</footer>
										</li>
									))}
								</ul>
							)}
						</div>
					)}
				</aside>
			)}
		</>
	);
}
