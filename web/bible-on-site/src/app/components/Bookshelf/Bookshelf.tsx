"use client";

import { useEffect, useState } from "react";
import { sefarim } from "@/data/db/sefarim";
import { isTreiAsar } from "@/data/sefer-colors";
import styles from "./bookshelf.module.scss";

// Constants for layout
const BOOK_WIDTH = 2;
const BOOK_DEPTH = 11;
const BOOK_HEIGHT = 15;
const BOOK_START_Y = 3;
const BOOK_START_Z = 2;
const HELEK_GAP = 2; // Space between heleks (in book widths)
const SQ_SIZE = 16; // Base unit size in pixels
const SHELF_DEPTH = 14;

// Breakpoint for switching between single and multi-shelf layout
const MULTI_SHELF_BREAKPOINT = 900;

export type BookshelfProps = {
	onSeferClick?: (seferName: string, perekFrom: number) => void;
};

// Color spectrum generation using HSL for natural gradients
// Wider hue ranges for more differentiation between sibling books
const HELEK_HUE_RANGES: Record<string, { start: number; end: number }> = {
	תורה: { start: 0, end: 45 }, // Reds to oranges
	נביאים: { start: 185, end: 240 }, // Cyans to blues (for ראשונים)
	"תרי עשר": { start: 240, end: 270 }, // Blues to purples (for תרי עשר)
	כתובים: { start: 75, end: 170 }, // Yellow-greens to teals
};

function generateSpectrumColor(
	helek: string,
	index: number,
	total: number,
): string {
	const range = HELEK_HUE_RANGES[helek] || { start: 0, end: 360 };
	const hue =
		range.start + ((range.end - range.start) * index) / (total - 1 || 1);
	return `hsl(${hue}, 70%, 35%)`;
}

function lightenColor(hslColor: string, amount: number): string {
	const match = hslColor.match(/hsl\(([^,]+),\s*([^,]+)%,\s*([^)]+)%\)/);
	if (!match) return hslColor;
	const [, h, s, l] = match;
	const newL = Math.min(100, Number.parseFloat(l) + amount);
	return `hsl(${h}, ${s}%, ${newL}%)`;
}

function darkenColor(hslColor: string, amount: number): string {
	return lightenColor(hslColor, -amount);
}

// Sefer type
type SeferInfo = {
	name: string;
	helek: string;
	displayName: string;
	perekFrom: number;
};

// All 35 sefarim displayed individually
const bookshelfSefarim: SeferInfo[] = sefarim.map((sefer) => ({
	name: sefer.name,
	helek: sefer.helek,
	displayName: sefer.name,
	perekFrom: sefer.perekFrom,
}));

// Group sefarim by helek and sub-groups
const helekGroups = {
	תורה: bookshelfSefarim.filter((s) => s.helek === "תורה"),
	// Split Neviim into ראשונים+גדולים and תרי עשר
	neviimRishonim: bookshelfSefarim.filter(
		(s) => s.helek === "נביאים" && !isTreiAsar(s.name),
	),
	treiAsar: bookshelfSefarim.filter(
		(s) => s.helek === "נביאים" && isTreiAsar(s.name),
	),
	כתובים: bookshelfSefarim.filter((s) => s.helek === "כתובים"),
};

// All Neviim together (for single shelf mode)
const allNeviim = bookshelfSefarim.filter((s) => s.helek === "נביאים");

// Assign colors to each sefer based on position in their group
const seferColors = new Map<string, string>();

// Torah colors
helekGroups.תורה.forEach((sefer, index) => {
	seferColors.set(
		sefer.name,
		generateSpectrumColor("תורה", index, helekGroups.תורה.length),
	);
});

// Neviim Rishonim colors
helekGroups.neviimRishonim.forEach((sefer, index) => {
	seferColors.set(
		sefer.name,
		generateSpectrumColor("נביאים", index, helekGroups.neviimRishonim.length),
	);
});

// Trei Asar colors
helekGroups.treiAsar.forEach((sefer, index) => {
	seferColors.set(
		sefer.name,
		generateSpectrumColor("תרי עשר", index, helekGroups.treiAsar.length),
	);
});

// Ketuvim colors
helekGroups.כתובים.forEach((sefer, index) => {
	seferColors.set(
		sefer.name,
		generateSpectrumColor("כתובים", index, helekGroups.כתובים.length),
	);
});

// Calculate book positions for a list of sefarim
function calculatePositionsForSefarim(
	sefarimList: SeferInfo[],
	startX = 2,
): { positions: Array<{ sefer: SeferInfo; x: number }>; totalWidth: number } {
	const positions: Array<{ sefer: SeferInfo; x: number }> = [];
	let currentX = startX;

	// Reverse for RTL display
	const reversed = [...sefarimList].reverse();
	for (const sefer of reversed) {
		positions.push({ sefer, x: currentX });
		currentX += BOOK_WIDTH;
	}

	return { positions, totalWidth: currentX + 2 };
}

// Calculate positions for all books on single shelf (RTL order with gaps)
function calculateAllBooksPositions(): {
	positions: Array<{ sefer: SeferInfo; x: number }>;
	totalWidth: number;
} {
	const positions: Array<{ sefer: SeferInfo; x: number }> = [];
	let currentX = 2;

	// Ketuvim first (leftmost) - reversed within
	for (const sefer of [...helekGroups.כתובים].reverse()) {
		positions.push({ sefer, x: currentX });
		currentX += BOOK_WIDTH;
	}
	currentX += HELEK_GAP;

	// Neviim (middle) - all together, reversed within
	for (const sefer of [...allNeviim].reverse()) {
		positions.push({ sefer, x: currentX });
		currentX += BOOK_WIDTH;
	}
	currentX += HELEK_GAP;

	// Torah last (rightmost) - reversed within
	for (const sefer of [...helekGroups.תורה].reverse()) {
		positions.push({ sefer, x: currentX });
		currentX += BOOK_WIDTH;
	}

	return { positions, totalWidth: currentX + 2 };
}

type BookBlockProps = {
	sefer: SeferInfo;
	x: number;
	onClick?: () => void;
};

function BookBlock({ sefer, x, onClick }: BookBlockProps) {
	const baseColor = seferColors.get(sefer.name) || "hsl(0, 0%, 50%)";
	const spineColor = darkenColor(baseColor, 8);

	const blockStyle = {
		transform: `translate3d(${SQ_SIZE * (x - 1)}px, ${SQ_SIZE * (-BOOK_START_Y - (BOOK_DEPTH - 1))}px, ${SQ_SIZE * BOOK_START_Z + SQ_SIZE * (BOOK_HEIGHT - 1)}px)`,
		display: "block",
	};

	const coverStyle = { backgroundColor: baseColor };
	const spineStyle = { backgroundColor: spineColor };
	const pageEdgeStyle = {
		backgroundColor: "#fff",
		backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 21%, #aaa 21%, #aaa 25%, transparent 25%, transparent 46%, #aaa 46%, #aaa 50%, transparent 50%)`,
		backgroundSize: `${SQ_SIZE}px ${SQ_SIZE}px`,
	};

	const topBottomStyle = {
		width: `${SQ_SIZE * BOOK_WIDTH}px`,
		height: `${SQ_SIZE * BOOK_DEPTH}px`,
	};

	const frontBackStyle = {
		width: `${SQ_SIZE * BOOK_WIDTH}px`,
		height: `${SQ_SIZE * BOOK_HEIGHT}px`,
	};

	const leftRightStyle = {
		width: `${SQ_SIZE * BOOK_DEPTH}px`,
		height: `${SQ_SIZE * BOOK_HEIGHT}px`,
	};

	return (
		<button
			type="button"
			className={`${styles.block} ${styles.book}`}
			style={blockStyle}
			onClick={onClick}
		>
			<div className={styles.blockInner}>
				<div
					className={styles.back}
					style={{ ...frontBackStyle, ...pageEdgeStyle }}
				/>
				<div
					className={styles.bottom}
					style={{
						...topBottomStyle,
						...pageEdgeStyle,
						transform: `rotateX(-90deg) translateY(-${SQ_SIZE * (BOOK_DEPTH - 1)}px) translateZ(${SQ_SIZE * BOOK_HEIGHT}px)`,
					}}
				/>
				<div
					className={styles.front}
					style={{
						...spineStyle,
						...frontBackStyle,
						transform: `translateZ(${SQ_SIZE * (BOOK_DEPTH - 1)}px)`,
					}}
				>
					<div className={styles.spineText}>{sefer.displayName}</div>
				</div>
				<div
					className={styles.left}
					style={{ ...coverStyle, ...leftRightStyle }}
				>
					<div className={styles.coverContent}>
						<div className={styles.coverTitle}>{sefer.displayName}</div>
						<div className={styles.coverSubtitle}>מקראות גדולות</div>
					</div>
				</div>
				<div
					className={styles.right}
					style={{
						...coverStyle,
						...leftRightStyle,
						transform: `rotateY(-270deg) translate3d(${SQ_SIZE}px, 0, ${SQ_SIZE * (BOOK_WIDTH - BOOK_DEPTH)}px)`,
					}}
				/>
				<div
					className={styles.top}
					style={{
						...topBottomStyle,
						...pageEdgeStyle,
						transform: `rotateX(-90deg) translateY(-${SQ_SIZE * (BOOK_DEPTH - 1)}px)`,
					}}
				/>
			</div>
		</button>
	);
}

type ShelfFloorProps = {
	width: number;
	label?: string;
};

function ShelfFloor({ width, label }: ShelfFloorProps) {
	const shelfColor = "#441e12";

	const blockStyle = {
		transform: `translate3d(${SQ_SIZE * (2 - 1)}px, ${SQ_SIZE * (-1 - (SHELF_DEPTH - 1))}px, ${SQ_SIZE * 1}px)`,
		display: "block",
	};

	const faceStyle = { backgroundColor: shelfColor };

	const topBottomStyle = {
		width: `${SQ_SIZE * width}px`,
		height: `${SQ_SIZE * SHELF_DEPTH}px`,
	};

	const frontBackStyle = {
		width: `${SQ_SIZE * width}px`,
		height: `${SQ_SIZE * 1}px`,
	};

	const leftRightStyle = {
		width: `${SQ_SIZE * SHELF_DEPTH}px`,
		height: `${SQ_SIZE * 1}px`,
	};

	return (
		<div className={styles.block} style={blockStyle}>
			<div className={styles.blockInner}>
				<div
					className={styles.back}
					style={{ ...faceStyle, ...frontBackStyle }}
				/>
				<div
					className={styles.bottom}
					style={{
						...faceStyle,
						...topBottomStyle,
						transform: `rotateX(-90deg) translateY(-${SQ_SIZE * (SHELF_DEPTH - 1)}px) translateZ(${SQ_SIZE * 1}px)`,
					}}
				/>
				<div
					className={styles.front}
					style={{
						...faceStyle,
						...frontBackStyle,
						transform: `translateZ(${SQ_SIZE * (SHELF_DEPTH - 1)}px)`,
					}}
				>
					{label && <div className={styles.shelfLabel}>{label}</div>}
				</div>
				<div
					className={styles.left}
					style={{ ...faceStyle, ...leftRightStyle }}
				/>
				<div
					className={styles.right}
					style={{
						...faceStyle,
						...leftRightStyle,
						transform: `rotateY(-270deg) translate3d(${SQ_SIZE}px, 0, ${SQ_SIZE * (width - SHELF_DEPTH)}px)`,
					}}
				/>
				<div
					className={styles.top}
					style={{
						...faceStyle,
						...topBottomStyle,
						transform: `rotateX(-90deg) translateY(-${SQ_SIZE * (SHELF_DEPTH - 1)}px)`,
					}}
				/>
			</div>
		</div>
	);
}

type SingleShelfProps = {
	positions: Array<{ sefer: SeferInfo; x: number }>;
	shelfWidth: number;
	onSeferClick?: (seferName: string, perekFrom: number) => void;
	label?: string;
};

function SingleShelf({
	positions,
	shelfWidth,
	onSeferClick,
	label,
}: SingleShelfProps) {
	return (
		<div className={styles.shelfWrapper}>
			<div className={styles.container}>
				<div
					className={styles.surface}
					style={{ width: `${SQ_SIZE * shelfWidth}px` }}
				>
					<ShelfFloor width={shelfWidth} label={label} />
					{positions.map(({ sefer, x }) => (
						<BookBlock
							key={sefer.name}
							sefer={sefer}
							x={x}
							onClick={() => onSeferClick?.(sefer.name, sefer.perekFrom)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

// Hook to detect window width
function useWindowWidth(): number {
	const [width, setWidth] = useState(
		typeof window !== "undefined" ? window.innerWidth : 1200,
	);

	useEffect(() => {
		const handleResize = () => setWidth(window.innerWidth);
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	return width;
}

export function Bookshelf({ onSeferClick }: BookshelfProps) {
	const windowWidth = useWindowWidth();
	const useMultiShelf = windowWidth < MULTI_SHELF_BREAKPOINT;

	if (useMultiShelf) {
		// Four separate shelves (RTL order: Torah on top)
		const torahData = calculatePositionsForSefarim(helekGroups.תורה);
		const neviimRishonimData = calculatePositionsForSefarim(
			helekGroups.neviimRishonim,
		);
		const treiAsarData = calculatePositionsForSefarim(helekGroups.treiAsar);
		const ketuvimData = calculatePositionsForSefarim(helekGroups.כתובים);

		return (
			<div className={styles.root}>
				<div className={styles.multiShelfContainer}>
					<SingleShelf
						positions={torahData.positions}
						shelfWidth={torahData.totalWidth}
						onSeferClick={onSeferClick}
						label="תורה"
					/>
					<SingleShelf
						positions={neviimRishonimData.positions}
						shelfWidth={neviimRishonimData.totalWidth}
						onSeferClick={onSeferClick}
						label="נביאים: ראשונים + גדולים"
					/>
					<SingleShelf
						positions={treiAsarData.positions}
						shelfWidth={treiAsarData.totalWidth}
						onSeferClick={onSeferClick}
						label="נביאים (המשך): תרי עשר"
					/>
					<SingleShelf
						positions={ketuvimData.positions}
						shelfWidth={ketuvimData.totalWidth}
						onSeferClick={onSeferClick}
						label="כתובים"
					/>
				</div>
			</div>
		);
	}

	// Single shelf with all books
	const allBooksData = calculateAllBooksPositions();

	return (
		<div className={styles.root}>
			<SingleShelf
				positions={allBooksData.positions}
				shelfWidth={allBooksData.totalWidth}
				onSeferClick={onSeferClick}
			/>
		</div>
	);
}

export default Bookshelf;
