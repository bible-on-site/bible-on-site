import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: HomePage,
});

function HomePage() {
	return (
		<div className="space-y-8">
			<div className="text-center">
				<h1 className="text-3xl font-bold text-gray-900 mb-4">
					ברוכים הבאים למערכת הניהול
				</h1>
				<p className="text-gray-600">בחר באחת מהאפשרויות הבאות:</p>
			</div>

			<div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
				<Link
					to="/articles"
					className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200"
				>
					<div className="flex items-center gap-4">
						<span className="text-4xl">📝</span>
						<div>
							<h2 className="text-xl font-semibold text-gray-900">
								ניהול מאמרים
							</h2>
							<p className="text-gray-600 text-sm">
								צפייה, עריכה ויצירת מאמרים חדשים לפי פרקים
							</p>
						</div>
					</div>
				</Link>

				<Link
					to="/rabbis"
					className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200"
				>
					<div className="flex items-center gap-4">
						<span className="text-4xl">👤</span>
						<div>
							<h2 className="text-xl font-semibold text-gray-900">
								ניהול רבנים
							</h2>
							<p className="text-gray-600 text-sm">
								ניהול פרטי רבנים ותמונות (מאוחסנות ב-S3)
							</p>
						</div>
					</div>
				</Link>
			</div>

			<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-w-2xl mx-auto">
				<h3 className="font-semibold text-yellow-800 mb-2">💡 טיפים</h3>
				<ul className="text-yellow-700 text-sm space-y-1 list-disc list-inside">
					<li>שינויים נשמרים אוטומטית לאחר 2 שניות ללא פעילות</li>
					<li>ניתן לנווט למאמרים לפי מספר פרק</li>
					<li>שינויים במאמרים מעדכנים אוטומטית את האתר הראשי</li>
				</ul>
			</div>
		</div>
	);
}
