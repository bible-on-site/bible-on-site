"use client";

import { toLetters } from "gematry";
import Link from "next/link";
import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import styles from "./qa-widget.module.css";

type SearchScope = "perek" | "sefer" | "all";

interface QaAnswerSource {
	type: string;
	name: string;
	author: string;
	perekId: number;
	articleId?: number;
	perushSlug?: string;
	pasuk?: number;
	noteIdx?: number;
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

function isBookView(): boolean {
	return document.documentElement.dataset.bookView != null;
}

function buildCitationHref(source: QaAnswerSource): string {
	if (source.type === "article" && source.articleId != null) {
		return `/929/${source.perekId}/${source.articleId}`;
	}
	if (source.type === "perush" && source.perushSlug) {
		const base = `/929/${source.perekId}/${encodeURIComponent(source.perushSlug)}`;
		if (source.pasuk != null && source.noteIdx != null) {
			return `${base}#note-${toLetters(source.pasuk)}-${source.noteIdx + 1}`;
		}
		return base;
	}
	return `/929/${source.perekId}`;
}

function citationLabel(source: QaAnswerSource): string {
	const kind = SOURCE_LABELS[source.type] ?? source.type;
	if (source.type === "perush" && source.pasuk != null) {
		return `${kind}: ${source.name} — פסוק ${toLetters(source.pasuk)}`;
	}
	return `${kind}: ${source.name} — ${source.author}`;
}

function QaWidgetContent({ perekId, seferPerekIds }: QaWidgetProps) {
	const [open, setOpen] = useState(false);
	const [question, setQuestion] = useState("");
	const [loading, setLoading] = useState(false);
	const [response, setResponse] = useState<QaAskResponse | null>(null);
	const [scope, setScope] = useState<SearchScope>("perek");
	const [inBookView, setInBookView] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	useEffect(() => {
		const check = () => setInBookView(isBookView());
		check();
		const obs = new MutationObserver(check);
		obs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-book-view"],
		});
		return () => obs.disconnect();
	}, []);

	// Listen for toolbar toggle event from the Sefer toolbar button
	useEffect(() => {
		const handler = () => setOpen((v) => !v);
		document.addEventListener("qa-widget-toggle", handler);
		return () => document.removeEventListener("qa-widget-toggle", handler);
	}, []);

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

	const handleCitationClick = useCallback(
		(source: QaAnswerSource) => {
			if (inBookView) {
				document.dispatchEvent(
					new CustomEvent("qa-navigate-sefer", { detail: source }),
				);
				setOpen(false);
			}
		},
		[inBookView],
	);

	const hasResults =
		response && !response.noAnswer && response.answers.length > 0;

	return (
		<>
			{/* Floating action button — hidden in sefer view (toolbar button used instead) */}
			{!inBookView && (
				<button
					type="button"
					className={styles.fab}
					onClick={() => setOpen((v) => !v)}
					aria-label={open ? "סגור חיפוש" : "שאלה על הפרק"}
					data-flipbook-no-flip
				>
					{open ? "✕" : "?"}
				</button>
			)}

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
							חיפוש במפרשים ובמאמרים
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
											<footer
												className={styles.cardFooter}
											>
												{inBookView ? (
													<button
														type="button"
														className={
															styles.citation
														}
														onClick={() =>
															handleCitationClick(
																a.source,
															)
														}
													>
														{citationLabel(
															a.source,
														)}
													</button>
												) : (
													<Link
														href={buildCitationHref(
															a.source,
														)}
														target="_blank"
														className={
															styles.citation
														}
													>
														{citationLabel(
															a.source,
														)}
													</Link>
												)}
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

/**
 * Renders the QA widget via a React portal on document.body so that
 * fixed-position elements escape all ancestor stacking contexts.
 */
export function QaWidget(props: QaWidgetProps) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return null;
	return createPortal(<QaWidgetContent {...props} />, document.body);
}
