import { createServerFn } from "@tanstack/react-start";
import {
	type ExternalReferenceSource,
	isExternalReferenceSource,
} from "~/lib/tanahpedia/external-references";
import {
	removeEntityExternalReference,
	setEntityExternalReference,
} from "./external-references.server";

/**
 * Typed external-identifier write/unlink operations for linked Tanahpedia
 * entities (#3330). This module stays free of plain server exports so the
 * client bundle keeps only the createServerFn RPC stubs — the same
 * convention as structural.ts.
 */

function validatedSource(value: unknown): ExternalReferenceSource {
	if (!isExternalReferenceSource(value)) {
		throw new Error("מקור לא נתמך");
	}
	return value;
}

export const upsertEntityExternalReference = createServerFn({
	method: "POST",
})
	.validator(
		(data: {
			entityId: string;
			source: string;
			url: string;
			expectedUrl?: string | null;
		}) => data,
	)
	.handler(async ({ data }) => {
		const result = await setEntityExternalReference({
			entityId: data.entityId,
			source: validatedSource(data.source),
			url: data.url,
			expectedUrl: data.expectedUrl ?? null,
		});
		return { success: true as const, url: result.url };
	});

export const deleteEntityExternalReference = createServerFn({
	method: "POST",
})
	.validator(
		(data: { entityId: string; source: string; expectedUrl?: string | null }) =>
			data,
	)
	.handler(async ({ data }) => {
		await removeEntityExternalReference({
			entityId: data.entityId,
			source: validatedSource(data.source),
			expectedUrl: data.expectedUrl ?? null,
		});
		return { success: true as const };
	});
