import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import {
	archiveBusy,
	setArchiveBusy,
	useArchiveBusy,
} from "~/lib/archive-busy";

function Status() {
	return <output>{useArchiveBusy() ? "busy" : "idle"}</output>;
}

afterEach(() => act(() => setArchiveBusy(false)));

it("renders an idle server snapshot even while a browser operation is busy", () => {
	setArchiveBusy(true);
	expect(archiveBusy()).toBe(true);
	expect(renderToString(<Status />)).toBe("<output>idle</output>");
});

it("updates mounted subscribers and lets them unsubscribe", () => {
	const view = render(<Status />);
	expect(screen.getByRole("status")).toHaveTextContent("idle");
	act(() => setArchiveBusy(true));
	expect(screen.getByRole("status")).toHaveTextContent("busy");
	act(() => setArchiveBusy(true));
	expect(archiveBusy()).toBe(true);
	view.unmount();
	act(() => setArchiveBusy(false));
	expect(archiveBusy()).toBe(false);
});
