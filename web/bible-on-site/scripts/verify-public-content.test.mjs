import assert from "node:assert/strict";
import { test } from "node:test";
import { links, verifyPublicContent } from "./verify-public-content.mjs";

const healthy = {
	"/api/health/ready": '{"status":"ready","content":{"authorCount":2}}',
	"/929/authors":
		'<a href="/929/authors/one">One</a><a href="/929/authors/two">Two</a>',
	"/929/1": '<a href="/929/1/4">Article</a>',
	"/929/authors/one": '<a href="/929/1/4">Article</a>',
	"/929/1/4": "<h1>Public article</h1>",
};
const fetchFrom = (pages) => async (url) =>
	new Response(pages[url.pathname], {
		status: pages[url.pathname] === undefined ? 404 : 200,
	});

test("healthy rendered content passes", async () => {
	assert.deepEqual(
		await verifyPublicContent("https://example.test", {
			fetchPage: fetchFrom(healthy),
		}),
		{ authors: 2, perekId: 1, articles: 1 },
	);
});
test("HTTP 200 plus green readiness cannot hide an empty authors page", async () => {
	await assert.rejects(
		verifyPublicContent("https://example.test", {
			fetchPage: fetchFrom({ ...healthy, "/929/authors": "<h1>Authors</h1>" }),
		}),
		/rendered 0/,
	);
});
test("empty chapter articles fail independently of author availability", async () => {
	await assert.rejects(
		verifyPublicContent("https://example.test", {
			fetchPage: fetchFrom({ ...healthy, "/929/1": "<h1>Chapter</h1>" }),
		}),
		/articles, rendered 0/,
	);
});
test("database baseline catches partial content loss", async () => {
	await assert.rejects(
		verifyPublicContent("https://example.test", {
			fetchPage: fetchFrom(healthy),
			baseline: { authorCount: 2, perekId: 1, articleCount: 3 },
		}),
		/expected at least 3/,
	);
});
test("a missing article detail fails", async () => {
	await assert.rejects(
		verifyPublicContent("https://example.test", {
			fetchPage: fetchFrom({ ...healthy, "/929/1/4": undefined }),
		}),
		/HTTP 404/,
	);
});
test("serialized RSC link data does not count as rendered content", () => {
	assert.deepEqual(
		links(
			"<script>const data = '<a href=\"/929/1/4\">';</script>",
			/^\/929\/1\/\d+$/,
		),
		[],
	);
});
test("script blocks accept case, whitespace, and attributes in closing tags", () => {
	assert.deepEqual(
		links(
			"<SCRIPT>const data = '<a href=\"/929/1/4\">';</SCRIPT\t\n bar>" +
				'<a href="/929/1/5">Rendered</a>',
			/^\/929\/1\/\d+$/,
		),
		["/929/1/5"],
	);
});
test("comments and inert template content do not count as rendered links", () => {
	assert.deepEqual(
		links(
			'<template><a href="/929/1/4">Inert</a></template>' +
				'<!-- <a href="/929/1/4">Comment</a> -->' +
				"<a href='/929/1/5'>Rendered</a>",
			/^\/929\/1\/\d+$/,
		),
		["/929/1/5"],
	);
});
test("article titles can contain nested markup", async () => {
	await verifyPublicContent("https://example.test", {
		fetchPage: fetchFrom({
			...healthy,
			"/929/1/4": "<h1><span>Public article</span></h1>",
		}),
	});
});
