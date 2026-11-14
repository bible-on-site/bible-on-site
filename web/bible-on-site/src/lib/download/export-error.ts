/** Export failure whose message is safe and actionable to show the reader. */
export class ExportError extends Error {
	override name = "ExportError";
}
