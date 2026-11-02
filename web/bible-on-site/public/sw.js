// Service worker for the daily perek push notifications (#1096). It only
// renders pushes and routes clicks; it has no fetch handler, so it never
// affects page loading or caching.

const DEFAULT_TITLE = 'תנ"ך על הפרק';

function sameOriginUrl(value) {
	try {
		const url = new URL(value || "/", self.location.origin);
		return url.origin === self.location.origin
			? url.href
			: self.location.origin;
	} catch {
		return self.location.origin;
	}
}

self.addEventListener("push", (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		data = { body: event.data.text() };
	}
	event.waitUntil(
		self.registration.showNotification(data.title || DEFAULT_TITLE, {
			body: data.body || "",
			icon: "/images/logos/logo192.webp",
			lang: "he",
			dir: "rtl",
			tag: data.tag,
			data: { url: sameOriginUrl(data.url) },
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = sameOriginUrl(event.notification.data?.url);
	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((windows) => {
				const open = windows.find((client) => client.url === url);
				return open ? open.focus() : self.clients.openWindow(url);
			}),
	);
});
