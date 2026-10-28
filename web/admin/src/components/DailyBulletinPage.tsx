import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { BulletinTelegramControls } from "~/components/BulletinTelegramControls";
import type {
	BulletinEmailState,
	EmailAudience,
	EmailAudienceSettings,
	EmailJobSummary,
} from "~/lib/bulletin-email";
import { todayInJerusalem } from "~/lib/daily-bulletin";
import {
	getDailyBulletinEmail,
	queueDailyBulletinEmail,
	setDailyBulletinEmailAudience,
} from "~/server/bulletin-email";
import {
	getDailyBulletin,
	prepareDailyBulletin,
} from "~/server/daily-bulletins";

const CHANNEL_NAMES: Record<string, string> = {
	email: 'דוא"ל',
	telegram: "טלגרם",
	whatsapp: "ווטסאפ",
};
const STATUS_NAMES: Record<string, string> = {
	pending: "טרם נשלח",
	sending: "בשליחה",
	sent: "נשלח",
	failed: "השליחה נכשלה",
	uncertain: "נדרשת בדיקה",
};
const EMAIL_STATUS_NAMES: Record<string, string> = {
	queued: "ממתין בתור",
	sending: "בשליחה",
	accepted: "התקבל ב-SES",
	delivered: "נמסר לשרת הדואר",
	failed: "נכשל",
	uncertain: "נדרשת בדיקה",
	suppressed: "השליחה נחסמה",
};
const ACTIVE_EMAIL_STATUSES = new Set(["queued", "sending", "accepted"]);
const NEW_TEST_STATUSES = new Set(["delivered", "failed", "suppressed"]);
type QueueRequest = {
	date: string;
	requestKey: string;
	audience: EmailAudience;
	revision: number;
};

export function DailyBulletinPage() {
	const [date, setDate] = useState(todayInJerusalem);
	const [telegramBusy, setTelegramBusy] = useState(false);
	const [requestedAudience, setRequestedAudience] =
		useState<EmailAudience | null>(null);
	const [confirmReal, setConfirmReal] = useState(false);
	const [newTestForJob, setNewTestForJob] = useState<string | null>(null);
	const attemptKeys = useRef(new Map<string, string>());
	const queryClient = useQueryClient();
	const bulletin = useQuery({
		queryKey: ["daily-bulletin", date],
		queryFn: () => getDailyBulletin({ data: date }),
		enabled: date.length === 10,
	});
	const prepare = useMutation({
		mutationFn: (value: string) => prepareDailyBulletin({ data: value }),
		onSuccess: (saved) =>
			queryClient.setQueryData(["daily-bulletin", saved.input.date], saved),
	});
	const saved = bulletin.data;
	const email = useQuery({
		queryKey: ["bulletin-email", date],
		queryFn: () => getDailyBulletinEmail({ data: date }),
		enabled: !!saved,
		retry: false,
		refetchInterval: (query) =>
			ACTIVE_EMAIL_STATUSES.has(query.state.data?.job?.status ?? "")
				? 5000
				: false,
	});
	const queueEmail = useMutation({
		mutationFn: (value: QueueRequest) =>
			queueDailyBulletinEmail({ data: value }),
		retry: false,
		onSuccess: (job: EmailJobSummary, value) => {
			setNewTestForJob(null);
			queryClient.setQueryData<BulletinEmailState>(
				["bulletin-email", value.date],
				(previous) => (previous ? { ...previous, job } : previous),
			);
		},
		onError: (_error, value) =>
			queryClient.invalidateQueries({
				queryKey: ["bulletin-email", value.date],
			}),
	});
	const changeAudience = useMutation({
		mutationFn: (value: EmailAudienceSettings & { confirmReal: boolean }) =>
			setDailyBulletinEmailAudience({ data: value }),
		retry: false,
		onSuccess: async (settings: EmailAudienceSettings) => {
			setRequestedAudience(null);
			setConfirmReal(false);
			setNewTestForJob(null);
			queueEmail.reset();
			queryClient.setQueriesData<BulletinEmailState>(
				{ queryKey: ["bulletin-email"] },
				(previous) => (previous ? { ...previous, settings } : previous),
			);
			await queryClient.invalidateQueries({ queryKey: ["bulletin-email"] });
		},
		onError: () =>
			queryClient.invalidateQueries({ queryKey: ["bulletin-email"] }),
	});
	const emailBusy =
		prepare.isPending || queueEmail.isPending || changeAudience.isPending;
	const busy = emailBusy || telegramBusy;
	const state = email.data;
	const settings = state?.settings;
	const selectedAudience = requestedAudience ?? settings?.audience ?? "test";
	const modeUnsaved = !!settings && selectedAudience !== settings.audience;
	const job = state?.job;
	const freshTest = settings?.audience === "test" && job?.id === newTestForJob;
	const realAvailable =
		!!state?.readiness.canUseReal && state.realRecipients > 0;
	const sendBlocked =
		busy ||
		email.isFetching ||
		!!email.error ||
		modeUnsaved ||
		!state?.readiness.configured ||
		!state.readiness.canSend ||
		(settings?.audience === "real" && !realAvailable) ||
		(!!job &&
			(job.status === "uncertain" ||
				ACTIVE_EMAIL_STATUSES.has(job.status) ||
				(job.audience === settings?.audience && !freshTest)));
	const attemptScope = `${date}:${settings?.audience}:${settings?.revision}`;
	const sendEmail = () => {
		if (sendBlocked || !settings) return;
		const requestKey =
			attemptKeys.current.get(attemptScope) ?? crypto.randomUUID();
		attemptKeys.current.set(attemptScope, requestKey);
		queueEmail.mutate({
			date,
			requestKey,
			audience: settings.audience,
			revision: settings.revision,
		});
	};
	return (
		<div className="space-y-6">
			<header>
				<h1 className="text-3xl font-bold text-gray-900">עלון יומי</h1>
				<p className="mt-2 text-gray-600">
					בחרו תאריך כדי להכין עלון ולבדוק את תצוגת הדוא"ל והקובץ להורדה.
				</p>
			</header>
			<form
				className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-6"
				onSubmit={(e) => {
					e.preventDefault();
					if (busy || bulletin.isLoading || !date || saved) return;
					prepare.mutate(date);
				}}
			>
				<label
					className="flex flex-col gap-2 font-semibold"
					htmlFor="bulletin-date"
				>
					תאריך העלון
					<input
						id="bulletin-date"
						type="date"
						required
						value={date}
						disabled={busy}
						onChange={(e) => {
							if (busy) return;
							setDate(e.target.value);
							prepare.reset();
							queueEmail.reset();
							changeAudience.reset();
							setRequestedAudience(null);
							setConfirmReal(false);
							setNewTestForJob(null);
						}}
						className="rounded-lg border border-gray-300 px-4 py-2"
					/>
				</label>
				<button
					type="submit"
					disabled={busy || bulletin.isLoading || !date || !!saved}
					className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
				>
					{prepare.isPending
						? "מכין עלון..."
						: saved
							? "העלון הוכן"
							: "הכנת עלון"}
				</button>
				{saved && (
					<a
						className="rounded-lg border border-blue-600 px-5 py-2 text-blue-700"
						href={`data:application/pdf;base64,${saved.pdfBase64}`}
						download={saved.filename}
					>
						הורדת PDF
					</a>
				)}
			</form>
			{(bulletin.error || prepare.error) && (
				<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
					{(prepare.error || bulletin.error)?.message}
				</p>
			)}
			{bulletin.isLoading && <p role="status">טוען עלון...</p>}
			{saved && (
				<>
					<section className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
						<h2 className="text-xl font-semibold">
							{saved.source} - {saved.input.hebrewDate}
						</h2>
						<p>
							{saved.input.article
								? `מאמר: ${saved.input.article.title} / ${saved.input.article.author}`
								: "לא נמצא מאמר מאושר לפרק זה."}
						</p>
						<Link
							to="/articles/perek/$perekId"
							params={{ perekId: String(saved.input.perekId) }}
							className="text-blue-700 underline"
						>
							ניהול מאמרי הפרק
						</Link>
						<p className="text-sm text-gray-600">
							תוכן העלון נשמר. פתיחה חוזרת מציגה את אותו העלון.
						</p>
						<ul className="flex flex-wrap gap-5">
							{saved.delivery.map((delivery) => (
								<li key={delivery.channel}>
									{CHANNEL_NAMES[delivery.channel]}:{" "}
									{STATUS_NAMES[delivery.status] || delivery.status}
								</li>
							))}
						</ul>
					</section>
					<section
						aria-labelledby="email-title"
						className="space-y-3 rounded-xl border border-gray-200 bg-white p-6"
					>
						<h2 id="email-title" className="text-xl font-semibold">
							שליחת העלון בדוא"ל
						</h2>
						{email.isLoading && <p role="status">טוען הגדרות שליחה...</p>}
						{state && settings && (
							<>
								<p className="font-semibold">
									{settings.audience === "test"
										? "מצב ניסיון - שליחה לנמעני הניסיון בלבד"
										: "מצב מנויים - שליחה לרשימת המנויים"}
								</p>
								<div>
									<p className="font-semibold">נמעני ניסיון:</p>
									<ul className="mt-1 space-y-1 text-right" dir="ltr">
										{state.testRecipients.map((recipient) => (
											<li key={recipient}>{recipient}</li>
										))}
									</ul>
								</div>
								<p>
									מנויים מאושרים: {state.realRecipients}. כתובות שטרם אומתו:{" "}
									{state.unverifiedRecipients}.
								</p>
								<div className="flex flex-wrap items-end gap-3">
									<label
										className="flex flex-col gap-2 font-semibold"
										htmlFor="email-audience"
									>
										קהל השליחה
										<select
											id="email-audience"
											value={selectedAudience}
											disabled={busy || email.isFetching || !!email.error}
											className="rounded-lg border border-gray-300 px-4 py-2"
											onChange={(event) => {
												if (busy) return;
												setRequestedAudience(
													event.target.value as EmailAudience,
												);
												setConfirmReal(false);
												changeAudience.reset();
											}}
										>
											<option value="test">ניסיון בלבד</option>
											<option value="real" disabled={!realAvailable}>
												רשימת המנויים
											</option>
										</select>
									</label>
									<button
										type="button"
										className="rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50"
										disabled={
											busy ||
											email.isFetching ||
											!!email.error ||
											!modeUnsaved ||
											(selectedAudience === "real" &&
												(!realAvailable || !confirmReal))
										}
										onClick={() => {
											if (
												busy ||
												!modeUnsaved ||
												(selectedAudience === "real" &&
													(!realAvailable || !confirmReal))
											)
												return;
											changeAudience.mutate({
												audience: selectedAudience,
												revision: settings.revision,
												confirmReal,
											});
										}}
									>
										{changeAudience.isPending
											? "שומר קהל..."
											: "שמירת קהל השליחה"}
									</button>
								</div>
								{modeUnsaved && selectedAudience === "real" && (
									<label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900">
										<input
											type="checkbox"
											checked={confirmReal}
											disabled={busy}
											onChange={(event) => setConfirmReal(event.target.checked)}
										/>
										אני מאשר מעבר לשליחה לרשימת המנויים. השליחה הבאה תיועד
										למנויים המאושרים.
									</label>
								)}
								{modeUnsaved && <p>יש לשמור את קהל השליחה לפני שליחת העלון.</p>}
								{!realAvailable && (
									<p className="text-sm text-gray-600">
										שליחה למנויים זמינה לאחר השלמת ההגדרות ואישור נמענים.
									</p>
								)}
								{state.readiness.blockers.length > 0 && (
									<div
										role="alert"
										className="rounded-lg bg-amber-50 p-3 text-amber-900"
									>
										<p className="font-semibold">נדרש לפני שליחה:</p>
										<ul className="list-inside list-disc">
											{state.readiness.blockers.map((blocker) => (
												<li key={blocker}>{blocker}</li>
											))}
										</ul>
									</div>
								)}
							</>
						)}
						{(email.error || queueEmail.error || changeAudience.error) && (
							<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
								{
									(queueEmail.error || changeAudience.error || email.error)
										?.message
								}
							</p>
						)}
						{job && (
							<div className="space-y-2 rounded-lg bg-gray-50 p-3">
								<p role="status" className="font-semibold">
									{job.audience === "test" ? "ניסיון" : "משלוח למנויים"}:{" "}
									{EMAIL_STATUS_NAMES[job.status]}
								</p>
								<p className="text-sm text-gray-600">
									מספר משלוח: <bdi>{job.id}</bdi> | נוצר:{" "}
									{new Date(job.createdAt).toLocaleString("he-IL", {
										timeZone: "Asia/Jerusalem",
									})}
								</p>
								<ul className="flex flex-wrap gap-4">
									{Object.entries(job.counts).map(([status, count]) => (
										<li key={status}>
											{EMAIL_STATUS_NAMES[status] || status}: {count}
										</li>
									))}
								</ul>
								<p className="text-sm text-gray-600">
									קבלה ב-SES מאשרת שההודעות התקבלו לשליחה. מסירה מאשרת קבלה בשרת
									הדואר של הנמען.
								</p>
							</div>
						)}
						{job?.status === "uncertain" && (
							<p role="status" className="text-amber-800">
								תוצאת השליחה אינה ודאית. יש לבדוק את יומן השליחה ואירועי SES
								לפני פעולה נוספת.
							</p>
						)}
						{settings?.audience === "test" &&
							job?.audience === "test" &&
							NEW_TEST_STATUSES.has(job.status) &&
							!freshTest && (
								<button
									type="button"
									disabled={busy || email.isFetching || modeUnsaved}
									onClick={() => {
										if (busy) return;
										attemptKeys.current.set(attemptScope, crypto.randomUUID());
										setNewTestForJob(job.id);
										queueEmail.reset();
									}}
									className="rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50"
								>
									ניסיון חדש
								</button>
							)}
						<button
							type="button"
							disabled={sendBlocked}
							onClick={sendEmail}
							className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
						>
							{queueEmail.isPending
								? "מוסיף לתור..."
								: settings?.audience === "real"
									? "שליחת העלון למנויים"
									: "שליחת ניסיון בלבד"}
						</button>
					</section>
					<BulletinTelegramControls
						date={date}
						disabled={emailBusy}
						onBusyChange={setTelegramBusy}
					/>
					<section className="rounded-xl border border-gray-200 bg-white p-4">
						<h2 className="mb-3 text-xl font-semibold">תצוגת דוא"ל</h2>
						<iframe
							title="תצוגת העלון היומי"
							sandbox=""
							srcDoc={saved.emailHtml}
							className="h-[800px] w-full rounded-lg border border-gray-200"
						/>
					</section>
				</>
			)}
		</div>
	);
}
