import { describe, expect, it } from "vitest";
import {
	type ApprovalArticle,
	bulletinApprovalSql,
	planBulletinApprovals,
} from "~/server/bulletin-approval-plan";

const article: ApprovalArticle = {
	id: 1,
	name: "מאמר",
	content: "<p>תוכן כתוב</p>",
	distributable: 0,
};

describe("owner-authorized article approval plan", () => {
	it("leaves full-lesson playback captions unapproved without excluding explanatory prose alongside a recording", () => {
		const caption =
			'<p>להאזנה לשיעור המלא</p><audio src="lesson.opus"></audio>';
		const plan = planBulletinApprovals([
			{ ...article, name: "שיעור", content: caption },
			{
				...article,
				id: 2,
				name: "שיעור",
				content:
					'<p>להאזנה לשיעור המלא</p><audio src="lesson.opus"></audio><p>הסבר כתוב על הפרק.</p>',
			},
		]);
		expect(plan.written).toBe(1);
		expect(plan.excluded).toBe(1);
		expect(plan.changes.map((change) => change.id)).toEqual([2]);
	});
	it("approves written articles, revokes media-only approvals and leaves matching flags alone", () => {
		const plan = planBulletinApprovals([
			article,
			{ ...article, id: 2, distributable: true },
			{
				...article,
				id: 3,
				content: '<h1>שיעור</h1><audio src="lesson.opus"></audio>',
				distributable: 1,
			},
			{ ...article, id: 4, content: null },
		]);
		expect(plan.written).toBe(2);
		expect(plan.excluded).toBe(2);
		expect(
			plan.changes.map(({ id, before, after }) => ({ id, before, after })),
		).toEqual([
			{ id: 1, before: 0, after: 1 },
			{ id: 3, before: 1, after: 0 },
		]);
		expect(plan.changes[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
	});
	it("binds approvals to both the title and original body and never puts either into SQL", () => {
		const plan = planBulletinApprovals([
			{ ...article, name: "כותרת '); DROP TABLE tanah_article; --" },
		]);
		const renamed = planBulletinApprovals([{ ...article, name: "כותרת אחרת" }]);
		expect(plan.changes[0].sourceHash).not.toBe(renamed.changes[0].sourceHash);
		const forward = bulletinApprovalSql(plan.changes);
		const reverse = bulletinApprovalSql(plan.changes, true);
		expect(forward).toContain(`(1,0,1,'${plan.changes[0].sourceHash}')`);
		expect(reverse).toContain(`(1,1,0,'${plan.changes[0].sourceHash}')`);
		expect(forward).not.toContain("DROP TABLE tanah_article");
		expect(forward).not.toContain(article.content);
		expect(forward).toContain("SET a.distributable=p.next_flag");
	});
	it("revokes an approved null-body entry with a rollback bound to the empty body hash", () => {
		const plan = planBulletinApprovals([
			{ ...article, content: null, distributable: 1 },
		]);
		const empty = planBulletinApprovals([
			{ ...article, content: "", distributable: 1 },
		]);
		expect(plan).toMatchObject({
			written: 0,
			excluded: 1,
			changes: [{ id: article.id, before: 1, after: 0 }],
		});
		expect(plan.changes[0].sourceHash).toBe(empty.changes[0].sourceHash);
		expect(bulletinApprovalSql(plan.changes, true)).toContain(
			`(1,0,1,'${plan.changes[0].sourceHash}')`,
		);
	});
	it.each([
		{ id: 0 },
		{ id: 8_388_608 },
		{ id: 1.5 },
		{ id: "1 OR 1" },
		{ name: null },
		{ content: 4 },
		{ distributable: 2 },
	])(
		"rejects an invalid snapshot before generating executable SQL: %j",
		(patch) => {
			expect(() =>
				planBulletinApprovals([{ ...article, ...patch } as ApprovalArticle]),
			).toThrow("Invalid article approval snapshot");
		},
	);
	it("rejects duplicate snapshot IDs", () => {
		expect(() => planBulletinApprovals([article, article])).toThrow(
			"Invalid article approval snapshot",
		);
	});
	it("returns no changes for an empty snapshot and refuses an empty SQL operation", () => {
		expect(planBulletinApprovals([])).toEqual({
			written: 0,
			excluded: 0,
			changes: [],
		});
		expect(() => bulletinApprovalSql([])).toThrow(
			"No article approval changes",
		);
	});
	it.each([
		{ id: -1 },
		{ before: 2 },
		{ after: 2 },
		{ after: 0 },
		{ sourceHash: "'); UPDATE tanah_article SET content='bad" },
	])("rejects an unsafe or inconsistent SQL plan: %j", (patch) => {
		const plan = planBulletinApprovals([article]);
		expect(() =>
			bulletinApprovalSql([{ ...plan.changes[0], ...patch }]),
		).toThrow("Invalid article approval change");
	});
	it("rejects duplicate IDs in an externally supplied SQL plan", () => {
		const plan = planBulletinApprovals([article]);
		expect(() =>
			bulletinApprovalSql([...plan.changes, ...plan.changes]),
		).toThrow("Invalid article approval change");
	});
});
