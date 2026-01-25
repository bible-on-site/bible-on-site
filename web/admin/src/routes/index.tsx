import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: HomePage,
});

function HomePage() {
	return (
		<div className="space-y-10">
			{/* Hero section */}
			<div className="text-center py-8">
				<h1 className="text-4xl font-bold text-gray-900 mb-4">
					ברוכים הבאים למערכת הניהול
				</h1>
				<p className="text-lg text-gray-600 max-w-md mx-auto">
					ניהול תוכן עבור אתר תנ"ך על הפרק - מאמרים, רבנים ועוד
				</p>
			</div>

			{/* Main navigation cards */}
			<div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
				<Link
					to="/articles"
					className="group block p-8 bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-200 hover:border-blue-300"
				>
					<div className="flex items-start gap-5">
						<div className="p-4 bg-blue-100 rounded-xl group-hover:bg-blue-200 transition-colors">
							<span className="text-4xl">📝</span>
						</div>
						<div className="flex-1">
							<h2 className="text-xl font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
								ניהול מאמרים
							</h2>
							<p className="text-gray-600 leading-relaxed">
								צפייה, עריכה ויצירת מאמרים חדשים לפי פרקים. כולל עורך טקסט עשיר
								ושמירה אוטומטית.
							</p>
						</div>
					</div>
				</Link>

				<Link
					to="/rabbis"
					className="group block p-8 bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-200 hover:border-green-300"
				>
					<div className="flex items-start gap-5">
						<div className="p-4 bg-green-100 rounded-xl group-hover:bg-green-200 transition-colors">
							<span className="text-4xl">👤</span>
						</div>
						<div className="flex-1">
							<h2 className="text-xl font-semibold text-gray-900 mb-2 group-hover:text-green-600 transition-colors">
								ניהול רבנים
							</h2>
							<p className="text-gray-600 leading-relaxed">
								ניהול פרטי רבנים ותמונות. התמונות מאוחסנות בענן (S3) עם העלאה
								ישירה.
							</p>
						</div>
					</div>
				</Link>
			</div>

			{/* Tips section */}
			<div className="bg-linear-to-r from-amber-50 to-yellow-50 border border-yellow-200 rounded-xl p-6 max-w-3xl mx-auto">
				<h3 className="font-semibold text-amber-800 mb-4 flex items-center gap-2">
					<span className="text-xl">💡</span>
					טיפים לעבודה יעילה
				</h3>
				<ul className="text-amber-700 space-y-3">
					<li className="flex items-start gap-3">
						<span className="text-green-500 mt-1">✓</span>
						<span>
							<strong>שמירה אוטומטית</strong> - שינויים נשמרים אוטומטית לאחר 2
							שניות ללא פעילות
						</span>
					</li>
					<li className="flex items-start gap-3">
						<span className="text-green-500 mt-1">✓</span>
						<span>
							<strong>ניווט מהיר</strong> - ניתן לנווט למאמרים לפי מספר פרק (1-929)
						</span>
					</li>
					<li className="flex items-start gap-3">
						<span className="text-green-500 mt-1">✓</span>
						<span>
							<strong>עדכון מיידי</strong> - שינויים מעדכנים אוטומטית את האתר
							הראשי
						</span>
					</li>
				</ul>
			</div>
		</div>
	);
}
