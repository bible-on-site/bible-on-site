/**
 * Minimal well-formed-XML element reader for machine-generated reports
 * (#2085): OpenCover templates/reports, xUnit TRX and JUnit results.
 *
 * Dependency-free by design — the devops toolchain must run this in CI steps
 * where only Node is installed. Handles elements, attributes (single or
 * double quoted), self-closing tags, comments, processing instructions,
 * DOCTYPE and CDATA. Namespaces are preserved verbatim in `name`; readers
 * match on `localName` so a default `xmlns` never has to be registered.
 *
 * Malformed input throws `XmlParseError` with the byte offset — coverage
 * evidence is generated output, so a parse failure means a truncated or
 * corrupted artifact and must fail loudly rather than parse "most of it".
 */
export interface XmlElement {
	/** Tag name as written, including any `ns:` prefix. */
	name: string;
	attrs: Record<string, string>;
	children: XmlElement[];
	/** Concatenated entity-decoded text and CDATA content of this element. */
	text: string;
}

export class XmlParseError extends Error {
	readonly offset: number;

	constructor(message: string, offset: number) {
		super(`${message} (offset ${offset})`);
		this.name = "XmlParseError";
		this.offset = offset;
	}
}

const NAME_END = new Set([" ", "\t", "\r", "\n", "/", ">", "="]);
const WS = new Set([" ", "\t", "\r", "\n"]);

function decodeEntities(value: string, offset: number): string {
	if (!value.includes("&")) return value;
	let out = "";
	let i = 0;
	while (i < value.length) {
		const amp = value.indexOf("&", i);
		if (amp === -1) return out + value.slice(i);
		out += value.slice(i, amp);
		const semi = value.indexOf(";", amp + 1);
		if (semi === -1 || semi - amp > 10) {
			throw new XmlParseError(`Unterminated entity reference`, offset + amp);
		}
		const body = value.slice(amp + 1, semi);
		if (body === "amp") out += "&";
		else if (body === "lt") out += "<";
		else if (body === "gt") out += ">";
		else if (body === "quot") out += '"';
		else if (body === "apos") out += "'";
		else if (body.startsWith("#x") || body.startsWith("#X")) {
			const code = Number.parseInt(body.slice(2), 16);
			if (Number.isNaN(code)) {
				throw new XmlParseError(`Invalid entity &${body};`, offset + amp);
			}
			out += String.fromCodePoint(code);
		} else if (body.startsWith("#")) {
			const code = Number.parseInt(body.slice(1), 10);
			if (Number.isNaN(code)) {
				throw new XmlParseError(`Invalid entity &${body};`, offset + amp);
			}
			out += String.fromCodePoint(code);
		} else {
			throw new XmlParseError(`Unknown entity &${body};`, offset + amp);
		}
		i = semi + 1;
	}
	return out;
}

/** Parses the document and returns its root element. */
export function parseXml(source: string): XmlElement {
	const n = source.length;
	const stack: XmlElement[] = [];
	let root: XmlElement | null = null;
	let i = 0;

	const fail = (message: string, offset = i): never => {
		throw new XmlParseError(message, offset);
	};

	while (i < n) {
		if (source[i] !== "<") {
			const next = source.indexOf("<", i);
			const end = next === -1 ? n : next;
			if (stack.length === 0) {
				if (source.slice(i, end).trim() !== "") {
					fail("Text outside the root element", i);
				}
			} else {
				stack[stack.length - 1].text += decodeEntities(source.slice(i, end), i);
			}
			i = end;
			continue;
		}
		if (source.startsWith("<!--", i)) {
			const end = source.indexOf("-->", i + 4);
			if (end === -1) fail("Unterminated comment", i);
			i = end + 3;
			continue;
		}
		if (source.startsWith("<![CDATA[", i)) {
			const end = source.indexOf("]]>", i + 9);
			if (end === -1) fail("Unterminated CDATA section", i);
			if (stack.length === 0) fail("CDATA outside the root element", i);
			stack[stack.length - 1].text += source.slice(i + 9, end);
			i = end + 3;
			continue;
		}
		if (source.startsWith("<?", i)) {
			const end = source.indexOf("?>", i + 2);
			if (end === -1) fail("Unterminated processing instruction", i);
			i = end + 2;
			continue;
		}
		if (source.startsWith("<!", i)) {
			// DOCTYPE and other declarations — skip to the closing `>`.
			const end = source.indexOf(">", i + 2);
			if (end === -1) fail("Unterminated declaration", i);
			i = end + 1;
			continue;
		}
		if (source[i + 1] === "/") {
			let j = i + 2;
			while (j < n && !NAME_END.has(source[j])) j++;
			const name = source.slice(i + 2, j);
			while (j < n && WS.has(source[j])) j++;
			if (source[j] !== ">") fail("Malformed closing tag", i);
			const open = stack.pop();
			if (open === undefined || open.name !== name) {
				fail(`Closing </${name}> without matching open`, i);
			}
			i = j + 1;
			continue;
		}
		// Opening tag.
		let j = i + 1;
		while (j < n && !NAME_END.has(source[j]) && !WS.has(source[j])) j++;
		const name = source.slice(i + 1, j);
		if (name.length === 0) fail("Empty tag name", i);
		const element: XmlElement = { name, attrs: {}, children: [], text: "" };
		let selfClose = false;
		let closed = false;
		while (j < n) {
			while (j < n && WS.has(source[j])) j++;
			if (source.startsWith("/>", j)) {
				selfClose = true;
				closed = true;
				j += 2;
				break;
			}
			if (source[j] === ">") {
				closed = true;
				j++;
				break;
			}
			const attrStart = j;
			while (j < n && !NAME_END.has(source[j]) && !WS.has(source[j])) j++;
			const attrName = source.slice(attrStart, j);
			while (j < n && WS.has(source[j])) j++;
			if (source[j] === "=") {
				j++;
				while (j < n && WS.has(source[j])) j++;
				const quote = source[j];
				if (quote !== '"' && quote !== "'") {
					fail(`Attribute ${attrName} is not quoted`, i);
				}
				const valueEnd = source.indexOf(quote, j + 1);
				if (valueEnd === -1) fail(`Unterminated attribute ${attrName}`, i);
				element.attrs[attrName] = decodeEntities(
					source.slice(j + 1, valueEnd),
					j + 1,
				);
				j = valueEnd + 1;
			} else {
				element.attrs[attrName] = "";
			}
			if (j >= n) fail("Unterminated tag", i);
		}
		if (!closed) fail("Unterminated tag", i);
		if (stack.length === 0) {
			if (root !== null) fail("Multiple root elements", i);
			root = element;
		} else {
			stack[stack.length - 1].children.push(element);
		}
		if (!selfClose) stack.push(element);
		i = j;
	}
	if (stack.length !== 0) {
		fail(`Unclosed element <${stack[stack.length - 1].name}>`, n);
	}
	return root ?? fail("Document has no root element", n);
}

/** `ns:Name` → `Name`; plain names pass through. */
export function localName(name: string): string {
	const colon = name.lastIndexOf(":");
	return colon === -1 ? name : name.slice(colon + 1);
}

/** First direct child with the given local name, or `null`. */
export function child(element: XmlElement, name: string): XmlElement | null {
	for (const candidate of element.children) {
		if (localName(candidate.name) === name) return candidate;
	}
	return null;
}

/** All direct children with the given local name. */
export function children(element: XmlElement, name: string): XmlElement[] {
	return element.children.filter((candidate) => localName(candidate.name) === name);
}

/** All descendant elements with the given local name (document order). */
export function descendants(element: XmlElement, name: string): XmlElement[] {
	const out: XmlElement[] = [];
	const walk = (current: XmlElement) => {
		for (const candidate of current.children) {
			if (localName(candidate.name) === name) out.push(candidate);
			walk(candidate);
		}
	};
	walk(element);
	return out;
}
