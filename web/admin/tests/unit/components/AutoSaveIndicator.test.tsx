import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AutoSaveIndicator } from "~/components/AutoSaveIndicator";

describe("AutoSaveIndicator", () => {
	it("shows the server commit in flight", () => {
		render(
			<AutoSaveIndicator isSaving={true} lastSaved={null} hasChanges={false} />,
		);

		expect(screen.getByText("⏳ שומר בשרת...")).toBeInTheDocument();
	});

	it("shows uncommitted edits while a local draft protects them", () => {
		render(
			<AutoSaveIndicator
				isSaving={false}
				lastSaved={null}
				hasChanges={true}
				lastDraftAt={new Date("2026-01-25T10:30:00")}
			/>,
		);

		expect(screen.getByText("יש שינויים שלא נשמרו בשרת")).toBeInTheDocument();
		expect(screen.getByText(/טיוטה נשמרה במכשיר זה/)).toBeInTheDocument();
	});

	it("shows the last server commit time", () => {
		const lastSaved = new Date("2026-01-25T10:30:00");
		render(
			<AutoSaveIndicator
				isSaving={false}
				lastSaved={lastSaved}
				hasChanges={false}
			/>,
		);

		expect(screen.getByText(/✓ נשמר בשרת ב-/)).toBeInTheDocument();
	});

	it("shows the persistent save failure", () => {
		render(
			<AutoSaveIndicator
				isSaving={false}
				lastSaved={null}
				hasChanges={true}
				saveFailed={true}
			/>,
		);

		expect(screen.getByText("השמירה לשרת נכשלה")).toBeInTheDocument();
	});

	it("shows the local draft failure instead of the draft timestamp", () => {
		render(
			<AutoSaveIndicator
				isSaving={false}
				lastSaved={null}
				hasChanges={true}
				lastDraftAt={new Date("2026-01-25T10:30:00")}
				draftFailed={true}
			/>,
		);

		expect(screen.getByText("הטיוטה המקומית נכשלה")).toBeInTheDocument();
		expect(screen.queryByText(/טיוטה נשמרה במכשיר זה/)).not.toBeInTheDocument();
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
