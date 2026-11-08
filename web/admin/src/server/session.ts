import { createServerFn } from "@tanstack/react-start";
import { resolveEditorIdentity } from "./editor-identity";

/**
 * The authenticated editor's stable account identity (the Cognito `sub`) —
 * see ./editor-identity for the resolution rules. This module exposes only
 * server-function exports so the client build gets RPC stubs, never the
 * server-only cookie/auth imports.
 */
export const getEditorIdentity = createServerFn({ method: "GET" }).handler(
	resolveEditorIdentity,
);
