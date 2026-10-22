import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { todayInJerusalem } from "~/lib/daily-bulletin";
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

export function DailyBulletinPage() {
	const [date, setDate] = useState(todayInJerusalem);
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
						disabled={prepare.isPending}
						onChange={(e) => {
							setDate(e.target.value);
							prepare.reset();
						}}
						className="rounded-lg border border-gray-300 px-4 py-2"
					/>
				</label>
				<button
					type="submit"
					disabled={prepare.isPending || bulletin.isLoading || !date || !!saved}
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
