import { defineHandler, HTTPError } from "nitro/h3";

// Keep cache control on the error so it takes precedence over Nitro's
// immutable build-asset route rule.
export default defineHandler(() => {
	throw new HTTPError({
		status: 404,
		headers: { "Cache-Control": "no-store" },
	});
});
