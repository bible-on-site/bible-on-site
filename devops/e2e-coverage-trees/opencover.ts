/**
 * OpenCover/AltCover report model (#2085).
 *
 * The AltCover instrumentation pass emits an OpenCover *template* at build
 * time (`coverage-app/template.opencover.xml`): per `Module@hash` it lists
 * `File` entries (`uid` → build-machine path) and, under each `Class/Method`,
 * the `SequencePoint` (`uspid`, `fileid`, `sl..el`) and `BranchPoint`
 * (`uspid`, `fileid`, `sl`) coordinates keyed by the ids the in-app recorder
 * reports. After `CoverageMobileE2E` applies the per-test dumps, the same
 * document gains real `vc` hit counts — the applied report
 * (`coverage.opencover.xml`).
 *
 * Point-key contract shared with `E2ECoverageApply.cs` and the recorder:
 *   - visit key < 0            → BranchPoint with `uspid = key & 0x7fffffff`
 *   - visit key = SequencePoint uspid → that sequence point
 *   - visit key = Method `MetadataToken` (0x06xxxxxx) → method-entry visit
 */
import { child, children, descendants, type XmlElement } from "./xml.ts";

export interface SequencePointModel {
	uspid: number;
	fileId: string;
	sl: number;
	sc: number;
	el: number;
	ec: number;
	vc: number;
}

export interface BranchPointModel {
	uspid: number;
	fileId: string;
	sl: number;
	vc: number;
}

export interface MethodModel {
	className: string;
	name: string;
	/** `MetadataToken` text, e.g. `0x0600001A`; `null` when absent. */
	token: string | null;
	/** `MetadataToken` parsed as the recorder's visit key, when numeric. */
	tokenKey: number | null;
	fileRef: string | null;
	visited: boolean;
	sequencePoints: SequencePointModel[];
	branchPoints: BranchPointModel[];
}

export interface ModuleModel {
	/** Module hash the recorder stamps into every Visit call. */
	hash: string;
	name: string;
	/** `File@uid` → `File@fullPath` (build-machine path). */
	files: Map<string, string>;
	methods: MethodModel[];
}

export interface OpenCoverModel {
	modules: ModuleModel[];
}

const int = (value: string | undefined): number | null => {
	if (value === undefined || value.trim() === "") return null;
	// Number() also reads the `0x`-prefixed MetadataToken hex AltCover emits.
	const parsed = Number(value);
	return Number.isNaN(parsed) ? null : parsed;
};

const textOf = (element: XmlElement | null): string | null =>
	element === null ? null : element.text.trim();

function parseMethod(className: string, element: XmlElement): MethodModel {
	const tokenText = textOf(child(element, "MetadataToken"));
	const tokenKey = tokenText === null ? null : int(tokenText);
	const sequencePoints = children(child(element, "SequencePoints") ?? element, "SequencePoint")
		.map((point) => ({
			uspid: int(point.attrs.uspid),
			fileId: point.attrs.fileid ?? point.attrs.fileId ?? "",
			sl: int(point.attrs.sl),
			sc: int(point.attrs.sc),
			el: int(point.attrs.el),
			ec: int(point.attrs.ec),
			vc: int(point.attrs.vc) ?? 0,
		}))
		.filter(
			(point): point is SequencePointModel =>
				point.uspid !== null && point.sl !== null && point.el !== null,
		);
	const branchPoints = children(child(element, "BranchPoints") ?? element, "BranchPoint")
		.map((point) => ({
			uspid: int(point.attrs.uspid),
			fileId: point.attrs.fileid ?? point.attrs.fileId ?? "",
			sl: int(point.attrs.sl) ?? 0,
			vc: int(point.attrs.vc) ?? 0,
		}))
		.filter((point): point is BranchPointModel => point.uspid !== null);
	return {
		className,
		name: textOf(child(element, "Name")) ?? "",
		token: tokenText,
		tokenKey,
		fileRef: child(element, "FileRef")?.attrs.uid ?? null,
		visited: element.attrs.visited === "true",
		sequencePoints,
		branchPoints,
	};
}

/** Parses an OpenCover document (template or applied report). */
export function parseOpenCover(root: XmlElement): OpenCoverModel {
	const modulesElement = child(root, "Modules");
	if (modulesElement === null) {
		throw new Error("OpenCover document has no Modules element");
	}
	const modules: ModuleModel[] = [];
	for (const moduleElement of children(modulesElement, "Module")) {
		const hash = moduleElement.attrs.hash ?? "";
		const files = new Map<string, string>();
		for (const file of descendants(moduleElement, "File")) {
			const uid = file.attrs.uid;
			if (uid !== undefined && file.attrs.fullPath !== undefined) {
				files.set(uid, file.attrs.fullPath);
			}
		}
		const methods: MethodModel[] = [];
		for (const classElement of descendants(moduleElement, "Class")) {
			const className = textOf(child(classElement, "FullName")) ?? "";
			for (const methodElement of descendants(classElement, "Method")) {
				methods.push(parseMethod(className, methodElement));
			}
		}
		modules.push({
			hash,
			name: textOf(child(moduleElement, "ModuleName")) ?? "",
			files,
			methods,
		});
	}
	return { modules };
}
