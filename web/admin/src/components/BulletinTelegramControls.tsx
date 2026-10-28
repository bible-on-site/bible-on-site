import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
	BulletinTelegramState,
	TelegramAudience,
	TelegramAudienceChange,
	TelegramQueueRequest,
} from "~/lib/bulletin-telegram";
import {
	getDailyBulletinTelegram,
	queueDailyBulletinTelegram,
	setDailyBulletinTelegramAudience,
} from "~/server/bulletin-telegram";

const STATUS_NAMES = {
	queued: "ממתין בתור",
	sending: "בשליחה",
	sent: "פורסם בערוץ",
	failed: "השליחה נכשלה",
	uncertain: "נדרשת בדיקה",
	suppressed: "השליחה נחסמה",
};
const ACTIVE = new Set(["queued", "sending"]);
const NEW_TEST = new Set(["sent", "failed", "suppressed"]);

export function BulletinTelegramControls({
	date,
	disabled = false,
	onBusyChange,
}: {
	date: string;
	disabled?: boolean;
	onBusyChange?: (busy: boolean) => void;
}) {
	const client = useQueryClient();
	const [requestedAudience, setRequestedAudience] =
		useState<TelegramAudience | null>(null);
	const [confirmReal, setConfirmReal] = useState(false);
	const [newTestForJob, setNewTestForJob] = useState<string | null>(null);
	const attempts = useRef(new Map<string, string>());
	const previousDate = useRef(date);
	const telegram = useQuery({
		queryKey: ["bulletin-telegram", date],
		queryFn: () => getDailyBulletinTelegram({ data: date }),
		retry: false,
		refetchInterval: (query) =>
			ACTIVE.has(query.state.data?.job?.status ?? "") ? 5000 : false,
	});
	const queue = useMutation({
		mutationFn: (data: TelegramQueueRequest) =>
			queueDailyBulletinTelegram({ data }),
		retry: false,
		onSuccess: (job, request) => {
			setNewTestForJob(null);
			client.setQueryData<BulletinTelegramState>(
				["bulletin-telegram", request.date],
				(previous) => (previous ? { ...previous, job } : previous),
			);
		},
		onError: (_error, request) =>
			client.invalidateQueries({
				queryKey: ["bulletin-telegram", request.date],
			}),
	});
	const changeAudience = useMutation({
		mutationFn: (data: TelegramAudienceChange) =>
			setDailyBulletinTelegramAudience({ data }),
		retry: false,
		onSuccess: async (settings) => {
			setRequestedAudience(null);
			setConfirmReal(false);
			setNewTestForJob(null);
			queue.reset();
			client.setQueriesData<BulletinTelegramState>(
				{ queryKey: ["bulletin-telegram"] },
				(previous) =>
					previous
						? {
								...previous,
								settings,
								job:
									previous.settings.audience === settings.audience
										? previous.job
										: null,
							}
						: previous,
			);
			await client.invalidateQueries({ queryKey: ["bulletin-telegram"] });
		},
		onError: () =>
			client.invalidateQueries({ queryKey: ["bulletin-telegram"] }),
	});
	const { reset: resetQueue } = queue;
	const { reset: resetAudience } = changeAudience;
	useEffect(() => {
		// A date change clears local feedback, while cached jobs and attempt keys
		// remain tied to their original date and persisted settings revision.
		if (previousDate.current === date) return;
		previousDate.current = date;
		resetQueue();
		resetAudience();
		setRequestedAudience(null);
		setConfirmReal(false);
		setNewTestForJob(null);
	}, [date, resetQueue, resetAudience]);
	const mutationPending = queue.isPending || changeAudience.isPending;
	useEffect(() => {
		onBusyChange?.(mutationPending);
		return () => onBusyChange?.(false);
	}, [mutationPending, onBusyChange]);
	const state = telegram.data;
	const settings = state?.settings;
	const job = state?.job;
	useEffect(() => {
		if (job?.status === "sent" && job.audience === "real" && job.date === date)
			void client.invalidateQueries({ queryKey: ["daily-bulletin", date] });
	}, [client, date, job]);
	const selected = requestedAudience ?? settings?.audience ?? "test";
	const unsavedMode = !!settings && selected !== settings.audience;
	const busy = disabled || mutationPending;
	const unresolved =
		!!job && (ACTIVE.has(job.status) || job.status === "uncertain");
	const modeBlocked =
		busy || telegram.isFetching || !!telegram.error || unresolved;
	const realAvailable = !!state?.readiness.canUseReal && !!state.realTarget;
	const freshTest = settings?.audience === "test" && job?.id === newTestForJob;
	const sendBlocked =
		modeBlocked ||
		unsavedMode ||
		!state?.readiness.configured ||
		!state.readiness.canSend ||
		(settings?.audience === "real" && !realAvailable) ||
		(!!job && !freshTest);
	const attemptScope = `${date}:${settings?.audience}:${settings?.revision}`;
	const saveMode = () => {
		if (
			modeBlocked ||
			!settings ||
			!unsavedMode ||
			(selected === "real" && (!realAvailable || !confirmReal))
		)
			return;
		changeAudience.mutate({
			audience: selected,
			expectedRevision: settings.revision,
			confirmReal,
		});
	};
	const send = () => {
		if (sendBlocked || !settings) return;
		const requestKey =
			attempts.current.get(attemptScope) ?? crypto.randomUUID();
		attempts.current.set(attemptScope, requestKey);
		queue.mutate({
			date,
			requestKey,
			expectedAudience: settings.audience,
			expectedRevision: settings.revision,
		});
	};
	return (
		<section
			aria-labelledby="telegram-title"
			className="space-y-3 rounded-xl border border-gray-200 bg-white p-6"
		>
			<h2 id="telegram-title" className="text-xl font-semibold">
				שליחת העלון בטלגרם
			</h2>
			{telegram.isLoading && <p role="status">טוען הגדרות טלגרם...</p>}
			{state && settings && (
				<>
					<p className="font-semibold">
						{settings.audience === "test"
							? "מצב ניסיון - הערוץ הפרטי בלבד"
							: "מצב פרסום בערוץ הציבורי"}
					</p>
					<p>
						ערוץ ניסיון פרטי:{" "}
						<strong>{state.testTarget?.title ?? "טרם הוגדר"}</strong>
					</p>
					<p>
						ערוץ ציבורי:{" "}
						<strong>{state.realTarget?.title ?? "טרם הוגדר"}</strong>
						{state.realTarget?.username && (
							<>
								{" "}
								<bdi dir="ltr">
									@{state.realTarget.username.replace(/^@/, "")}
								</bdi>
							</>
						)}
					</p>
					<p className="text-sm text-gray-600">
						מצב הטלגרם נשמר בנפרד ממצב הדוא"ל. הניסיון מפרסם רק בערוץ הפרטי
						שהוגדר.
					</p>
					<div className="flex flex-wrap items-end gap-3">
						<label
							className="flex flex-col gap-2 font-semibold"
							htmlFor="telegram-audience"
						>
							יעד השליחה בטלגרם
							<select
								id="telegram-audience"
								value={selected}
								disabled={modeBlocked}
								className="rounded-lg border border-gray-300 px-4 py-2"
								onChange={(event) => {
									if (modeBlocked) return;
									setRequestedAudience(event.target.value as TelegramAudience);
									setConfirmReal(false);
									changeAudience.reset();
								}}
							>
								<option value="test">ערוץ ניסיון פרטי</option>
								<option value="real" disabled={!realAvailable}>
									הערוץ הציבורי
								</option>
							</select>
						</label>
						<button
							type="button"
							onClick={saveMode}
							disabled={
								modeBlocked ||
								!unsavedMode ||
								(selected === "real" && (!realAvailable || !confirmReal))
							}
							className="rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50"
						>
							{changeAudience.isPending ? "שומר יעד..." : "שמירת יעד הטלגרם"}
						</button>
					</div>
					{unsavedMode && selected === "real" && (
						<label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900">
							<input
								type="checkbox"
								checked={confirmReal}
								disabled={modeBlocked}
								onChange={(event) => setConfirmReal(event.target.checked)}
							/>
							אני מאשר מעבר לפרסום בערוץ הציבורי בטלגרם. הפרסום הבא יהיה גלוי
							למנויי הערוץ.
						</label>
					)}
					{unsavedMode && <p>יש לשמור את יעד הטלגרם לפני שליחת העלון.</p>}
					{!realAvailable && (
						<p className="text-sm text-gray-600">
							פרסום ציבורי זמין לאחר הגדרה ואימות של הערוץ הציבורי.
						</p>
					)}
					{state.readiness.blockers.length > 0 && (
						<div
							role="alert"
							className="rounded-lg bg-amber-50 p-3 text-amber-900"
						>
							<p className="font-semibold">נדרש לפני שליחה בטלגרם:</p>
							<ul className="list-inside list-disc">
								{state.readiness.blockers.map((blocker) => (
									<li key={blocker}>{blocker}</li>
								))}
							</ul>
						</div>
					)}
				</>
			)}
			{(telegram.error || queue.error || changeAudience.error) && (
				<div
					role="alert"
					className="space-y-2 rounded-lg bg-red-50 p-3 text-red-800"
				>
					<p>
						{changeAudience.error
							? "שינוי יעד הטלגרם לא נשמר. יש לרענן את מצב השליחה לפני פעולה נוספת."
							: queue.error
								? "לא התקבלה תשובת שליחה תקינה. יש לבדוק את מצב השליחה לפני ניסיון נוסף."
								: "לא ניתן לטעון את מצב הטלגרם כעת."}
					</p>
					<button
						type="button"
						disabled={busy || telegram.isFetching}
						onClick={() => void telegram.refetch()}
						className="underline"
					>
						רענון מצב הטלגרם
					</button>
				</div>
			)}
			{job && (
				<div className="space-y-2 rounded-lg bg-gray-50 p-3">
					<p role="status" className="font-semibold">
						{job.audience === "test" ? "ניסיון בטלגרם" : "פרסום ציבורי"}:{" "}
						{STATUS_NAMES[job.status]}
					</p>
					<p className="break-words text-sm text-gray-600">
						מספר משלוח: <bdi>{job.id}</bdi> | נוצר:{" "}
						{new Date(job.createdAt).toLocaleString("he-IL", {
							timeZone: "Asia/Jerusalem",
						})}
					</p>
					{job.sentAt && (
						<p className="text-sm text-gray-600">
							פורסם:{" "}
							{new Date(job.sentAt).toLocaleString("he-IL", {
								timeZone: "Asia/Jerusalem",
							})}
						</p>
					)}
					{job.error && <p>{job.error}</p>}
					<p className="text-sm text-gray-600">
						פרסום מאשר שטלגרם קיבל את הקובץ לערוץ. הוא אינו אישור קריאה של
						המנויים.
					</p>
				</div>
			)}
			{job?.status === "uncertain" && (
				<p role="status" className="text-amber-800">
					תוצאת הפרסום אינה ודאית. יש לבדוק את הערוץ ואת יומן השליחה לפני פעולה
					נוספת. שליחה חוזרת חסומה.
				</p>
			)}
			{settings?.audience === "test" &&
				job?.audience === "test" &&
				NEW_TEST.has(job.status) &&
				!freshTest && (
					<button
						type="button"
						disabled={modeBlocked || unsavedMode}
						className="rounded-lg border border-blue-600 px-4 py-2 text-blue-700 disabled:opacity-50"
						onClick={() => {
							if (modeBlocked || unsavedMode) return;
							attempts.current.set(attemptScope, crypto.randomUUID());
							setNewTestForJob(job.id);
							queue.reset();
						}}
					>
						ניסיון טלגרם חדש
					</button>
				)}
			<button
				type="button"
				disabled={sendBlocked}
				onClick={send}
				className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
			>
				{queue.isPending
					? "מוסיף לתור הטלגרם..."
					: settings?.audience === "real"
						? "פרסום העלון בערוץ הציבורי"
						: "שליחת ניסיון בטלגרם"}
			</button>
		</section>
	);
}
