import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AutoSaveIndicator } from "../../components/AutoSaveIndicator";

describe("AutoSaveIndicator", () => {
	it("shows saving state", () => {
		render(
			<AutoSaveIndicator isSaving={true} lastSaved={null} hasChanges={false} />,
		);

		expect(screen.getByText("⏳ שומר...")).toBeInTheDocument();
	});

	it("shows unsaved changes state", () => {
		render(
			<AutoSaveIndicator isSaving={false} lastSaved={null} hasChanges={true} />,
		);

		expect(screen.getByText("יש שינויים שלא נשמרו")).toBeInTheDocument();
	});

	it("shows last saved time", () => {
		const lastSaved = new Date("2026-01-25T10:30:00");
		render(
			<AutoSaveIndicator
				isSaving={false}
				lastSaved={lastSaved}
				hasChanges={false}
			/>,
		);

		expect(screen.getByText(/✓ נשמר ב-/)).toBeInTheDocument();
	});

	it("shows nothing when no state", () => {
		const { container } = render(
			<AutoSaveIndicator
				isSaving={false}
				lastSaved={null}
				hasChanges={false}
			/>,
		);

		expect(container.querySelector(".text-blue-600")).toBeNull();
		expect(container.querySelector(".text-yellow-600")).toBeNull();
		expect(container.querySelector(".text-green-600")).toBeNull();
	});
});
