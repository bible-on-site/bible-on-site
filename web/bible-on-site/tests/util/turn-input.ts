import { setTimeout as delay } from "node:timers/promises";
import type { CDPSession, Page } from "@playwright/test";

export type TurnGesture = "drag" | "toolbar";

export interface TurnInputPoint {
	x: number;
	y: number;
	width: number;
}

/** Read the fixed viewport's input coordinates before timing starts. */
export async function prepareTurnInput(page: Page, gesture: TurnGesture) {
	return page.evaluate((kind): TurnInputPoint => {
		if (kind === "toolbar") {
			const box = document
				.querySelector("button.flipbook-toolbar-next")
				?.getBoundingClientRect();
			if (!box?.width || !box.height) throw new Error("No visible next button");
			return {
				x: box.x + box.width / 2,
				y: box.y + box.height / 2,
				width: box.width,
			};
		}
		const box = Array.from(
			document.querySelectorAll(".he-book .page.current-page"),
		)
			.map((element) => element.getBoundingClientRect())
			.filter((rect) => rect.width > 40 && rect.height > 40)
			.sort((a, b) => a.x - b.x)[0];
		if (!box) throw new Error("No visible forward page");
		return { x: box.x + 10, y: box.y + box.height * 0.85, width: box.width };
	}, gesture);
}

/** Native input without actionability/layout reads between consecutive turns. */
export async function dispatchTurnInput(
	client: CDPSession,
	gesture: TurnGesture,
	point: TurnInputPoint,
) {
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: point.x,
		y: point.y,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: point.x,
		y: point.y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	if (gesture === "toolbar") {
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: point.x,
			y: point.y,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		return;
	}
	const inputs: Promise<unknown>[] = [];
	for (let step = 1; step <= 14; step++) {
		const motion = client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: point.x + (point.width * 1.4 * step) / 14,
			y: point.y - (point.width * 0.1 * step) / 14,
			buttons: 1,
		});
		if (step === 1) await motion;
		else inputs.push(motion);
		await delay(11);
	}
	inputs.push(
		client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: point.x + point.width * 1.4,
			y: point.y - point.width * 0.1,
			button: "left",
			buttons: 0,
			clickCount: 1,
		}),
	);
	await Promise.all(inputs);
}
