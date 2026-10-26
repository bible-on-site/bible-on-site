/**
 * @jest-environment node
 */

import { getCalendarArtifactBounds } from "@/lib/download/calendar-artifacts";
import {
	CALENDAR_PDF_MANIFEST_OBJECT,
	type CalendarPdfManifest,
	calendarPdfArchivedManifestObject,
	sha256Bytes,
} from "@/lib/download/calendar-pdf-plan";
import {
	type ArtifactObjectStore,
	publishCalendarPdfArtifacts,
} from "@/lib/download/calendar-pdf-publish";

/** The archive key a publish of `manifest` would write (content-addressed). */
function archiveKeyFor(manifest: CalendarPdfManifest): string {
	return calendarPdfArchivedManifestObject(
		manifest.fingerprint,
		sha256Bytes(new TextEncoder().encode(`${JSON.stringify(manifest)}\n`)),
	);
}

interface StoredObject {
	body: Uint8Array;
	contentType?: string;
	contentDisposition?: string;
	cacheControl?: string;
	metadata?: Record<string, string>;
}

function fakeStore(initial: Record<string, Uint8Array> = {}) {
	const objects = new Map<string, StoredObject>();
	for (const [key, body] of Object.entries(initial)) {
		objects.set(key, { body });
	}
	const putOrder: string[] = [];
	const store: ArtifactObjectStore = {
		async head(key) {
			const obj = objects.get(key);
			return obj ? { contentLength: obj.body.byteLength } : null;
		},
		async put(key, body, options) {
			objects.set(key, {
				body,
				contentType: options.contentType,
				contentDisposition: options.contentDisposition,
				cacheControl: options.cacheControl,
				metadata: options.metadata,
			});
			putOrder.push(key);
		},
		async get(key) {
			return objects.get(key)?.body ?? null;
		},
	};
	return { store, objects, putOrder };
}

function manifestWith(artifacts: CalendarPdfManifest["artifacts"]) {
	return {
		version: 1 as const,
		fingerprint: "fp1",
		generatedAt: "2026-01-01T00:00:00.000Z",
		bounds: getCalendarArtifactBounds(),
		artifacts,
	};
}

const ARTIFACT = (sha: string, bytes = 3, filename = "f.pdf") => ({
	object: `generated/calendar-pdf/objects/${sha}.pdf`,
	sha256: sha,
	bytes,
	filename,
});

const objectBody = (bytes: number) => new Uint8Array(bytes).fill(1);

describe("publishCalendarPdfArtifacts", () => {
	it("uploads objects before the manifest and verifies each one", async () => {
		const { store, putOrder } = fakeStore();
		const manifest = manifestWith({
			"month:578512": ARTIFACT(
				"a".repeat(64),
				3,
				"learning-calendar-578512.pdf",
			),
			"cycle:4": ARTIFACT("b".repeat(64), 4, "learning-calendar-cycle-4.pdf"),
		});
		const report = await publishCalendarPdfArtifacts({
			store,
			manifest,
			readObject: async (sha) => objectBody(sha === "a".repeat(64) ? 3 : 4),
		});
		expect(report.uploaded).toBe(2);
		expect(report.verified).toBe(2);
		expect(report.manifestUpdated).toBe(true);
		// Objects land strictly before the manifest write.
		const manifestIndex = putOrder.indexOf(CALENDAR_PDF_MANIFEST_OBJECT);
		expect(manifestIndex).toBeGreaterThan(-1);
		const objectKeys = putOrder
			.slice(0, manifestIndex)
			.filter((key) => key.startsWith("generated/calendar-pdf/objects/"));
		expect(objectKeys).toHaveLength(2);
		for (const key of objectKeys) {
			expect(key).toMatch(/objects\/[a-f0-9]{64}\.pdf$/);
		}
		// The archived manifest is also written before the live one.
		expect(putOrder.indexOf(archiveKeyFor(manifest))).toBeLessThan(
			manifestIndex,
		);
	});

	it("sets download semantics on artifact objects", async () => {
		const { store, objects } = fakeStore();
		const sha = "c".repeat(64);
		const manifest = manifestWith({
			"month:578512": ARTIFACT(sha, 3, "learning-calendar-578512.pdf"),
		});
		await publishCalendarPdfArtifacts({
			store,
			manifest,
			readObject: async () => objectBody(3),
		});
		const obj = objects.get(`generated/calendar-pdf/objects/${sha}.pdf`);
		expect(obj?.contentType).toBe("application/pdf");
		expect(obj?.contentDisposition).toBe(
			'attachment; filename="learning-calendar-578512.pdf"',
		);
		expect(obj?.cacheControl).toContain("immutable");
		expect(obj?.metadata?.sha256).toBe(sha);
	});

	it("skips re-uploading objects already served at the right size", async () => {
		const sha = "d".repeat(64);
		const key = `generated/calendar-pdf/objects/${sha}.pdf`;
		const { store, objects, putOrder } = fakeStore({
			[key]: objectBody(3),
		});
		const manifest = manifestWith({
			"month:578512": ARTIFACT(sha, 3, "f.pdf"),
		});
		const report = await publishCalendarPdfArtifacts({
			store,
			manifest,
			readObject: async () => {
				throw new Error("must not re-read present objects");
			},
		});
		expect(report.alreadyPresent).toBe(1);
		expect(report.uploaded).toBe(0);
		expect(putOrder).not.toContain(key);
		expect(objects.get(key)?.body.byteLength).toBe(3);
	});

	it("re-uploads an object that exists at the wrong size", async () => {
		const sha = "9".repeat(64);
		const key = `generated/calendar-pdf/objects/${sha}.pdf`;
		const { store, objects } = fakeStore({ [key]: objectBody(99) });
		const manifest = manifestWith({
			"month:578512": ARTIFACT(sha, 3, "f.pdf"),
		});
		const report = await publishCalendarPdfArtifacts({
			store,
			manifest,
			readObject: async () => objectBody(3),
		});
		expect(report.uploaded).toBe(1);
		expect(report.alreadyPresent).toBe(0);
		expect(objects.get(key)?.body.byteLength).toBe(3);
	});

	it("throws when an uploaded object is not served afterwards", async () => {
		const sha = "8".repeat(64);
		const { store } = fakeStore();
		const lying: ArtifactObjectStore = {
			...store,
			// head always reports nothing — simulates a write that never lands
			async head() {
				return null;
			},
		};
		const manifest = manifestWith({
			"month:578512": ARTIFACT(sha, 3, "f.pdf"),
		});
		await expect(
			publishCalendarPdfArtifacts({
				store: lying,
				manifest,
				readObject: async () => objectBody(3),
			}),
		).rejects.toThrow("is not served after upload");
	});

	it("replaces the live manifest when artifacts changed under the same fingerprint", async () => {
		const sha = "7".repeat(64);
		const manifest = manifestWith({
			"month:578512": ARTIFACT(sha, 3, "f.pdf"),
		});
		// Same fingerprint, different artifact map → manifest must flip.
		const stale = manifestWith({
			"month:578512": ARTIFACT("6".repeat(64), 5, "old.pdf"),
		});
		const { store, objects } = fakeStore({
			[CALENDAR_PDF_MANIFEST_OBJECT]: new TextEncoder().encode(
				JSON.stringify(stale),
			),
		});
		const report = await publishCalendarPdfArtifacts({
			store,
			manifest,
			readObject: async () => objectBody(3),
		});
		expect(report.manifestUpdated).toBe(true);
		const live = new TextDecoder().decode(
			objects.get(CALENDAR_PDF_MANIFEST_OBJECT)?.body ?? new Uint8Array(),
		);
		expect(JSON.parse(live).artifacts["month:578512"].sha256).toBe(sha);
	});

	it("does not rewrite an identical live manifest", async () => {
		const sha = "e".repeat(64);
		const manifest = manifestWith({
			"month:578512": ARTIFACT(sha, 3, "f.pdf"),
		});
		const { store, putOrder } = fakeStore({
			[`generated/calendar-pdf/objects/${sha}.pdf`]: objectBody(3),
			[CALENDAR_PDF_MANIFEST_OBJECT]: new TextEncoder().encode(
				`${JSON.stringify(manifest)}\n`,
			),
		});
		const report = await publishCalendarPdfArtifacts({
			store,
			manifest,
			readObject: async () => objectBody(3),
		});
		expect(report.manifestUpdated).toBe(false);
		expect(putOrder).not.toContain(CALENDAR_PDF_MANIFEST_OBJECT);
	});

	it("never flips the manifest when an object upload fails", async () => {
		const { store, putOrder } = fakeStore();
		const manifest = manifestWith({
			"month:578512": ARTIFACT("f".repeat(64), 3, "f.pdf"),
		});
		const failing: ArtifactObjectStore = {
			...store,
			async put() {
				throw new Error("upload boom");
			},
		};
		await expect(
			publishCalendarPdfArtifacts({
				store: failing,
				manifest,
				readObject: async () => objectBody(3),
			}),
		).rejects.toThrow("upload boom");
		expect(putOrder).not.toContain(CALENDAR_PDF_MANIFEST_OBJECT);
	});
});
