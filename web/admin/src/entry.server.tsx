/// <reference types="vinxi/types/server" />
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

export default createServerEntry({
	fetch(request) {
		return handler.fetch(request);
	},
});
