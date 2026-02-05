"use client";

import { sefarim } from "@/data/db/sefarim";
import { getSeferColor } from "@/data/sefer-colors";
import styles from "./bookshelf.module.scss";

// Constants for layout
const BOOK_WIDTH = 2;
const BOOK_DEPTH = 11;
const BOOK_HEIGHT = 15;
const BOOK_START_Y = 3;
const BOOK_START_Z = 2;
const HELEK_GAP = 2; // Space between heleks (in book widths)

export type BookshelfProps = {
	onSeferClick?: (seferName: string, perekFrom: number) => void;
};

// All 35 sefarim displayed individually
const bookshelfSefarim = sefarim.map((sefer) => ({
	name: sefer.name,
	helek: sefer.helek,
	displayName: sefer.name,
	perekFrom: sefer.perekFrom,
}));

// Group sefarim by helek
const helekGroups = {
	תורה: bookshelfSefarim.filter((s) => s.helek === "תורה"),
	נביאים: bookshelfSefarim.filter((s) => s.helek === "נביאים"),
	כתובים: bookshelfSefarim.filter((s) => s.helek === "כתובים"),
};

// Calculate positions with gaps between heleks
function calculateBookPositions() {
	const positions: Array<{
		sefer: (typeof bookshelfSefarim)[0];
		x: number;
	}> = [];

	let currentX = 2; // Start position

	// Torah
	for (const sefer of helekGroups.תורה) {
		positions.push({ sefer, x: currentX });
		currentX += BOOK_WIDTH;
	}

	currentX += HELEK_GAP; // Gap after Torah

	// Neviim
	for (const sefer of helekGroups.נביאים) {
		positions.push({ sefer, x: currentX });
		currentX += BOOK_WIDTH;
	}

	currentX += HELEK_GAP; // Gap after Neviim

	// Ketuvim
	for (const sefer of helekGroups.כתובים) {
		positions.push({ sefer, x: currentX });
		currentX += BOOK_WIDTH;
	}

	return { positions, totalWidth: currentX + 2 };
}

const { positions: bookPositions, totalWidth } = calculateBookPositions();

// Shelf floor dimensions
const SHELF_WIDTH = totalWidth;
const SHELF_DEPTH = 14;

type BookBlockProps = {
	sefer: (typeof bookshelfSefarim)[0];
	x: number;
	onClick?: () => void;
};

function BookBlock({ sefer, x, onClick }: BookBlockProps) {
	const color = getSeferColor(sefer.name);
	const sqSize = 16; // Match SCSS $sqSize

	const blockStyle = {
		transform: `translate3d(${sqSize * (x - 1)}px, ${sqSize * (-BOOK_START_Y - (BOOK_DEPTH - 1))}px, ${sqSize * BOOK_START_Z + sqSize * (BOOK_HEIGHT - 1)}px)`,
		display: "block",
	};

	const faceStyle = { backgroundColor: color };
	const pageStyle = {
		backgroundColor: "#fff",
		backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 21%, #aaa 21%, #aaa 25%, transparent 25%, transparent 46%, #aaa 46%, #aaa 50%, transparent 50%)`,
		backgroundSize: `${sqSize}px ${sqSize}px`,
	};

	const topBottomStyle = {
		width: `${sqSize * BOOK_WIDTH}px`,
		height: `${sqSize * BOOK_DEPTH}px`,
	};

	const frontBackStyle = {
		width: `${sqSize * BOOK_WIDTH}px`,
		height: `${sqSize * BOOK_HEIGHT}px`,
	};

	const leftRightStyle = {
		width: `${sqSize * BOOK_DEPTH}px`,
		height: `${sqSize * BOOK_HEIGHT}px`,
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
					style={{
						...faceStyle,
						...frontBackStyle,
						...pageStyle,
					}}
				/>
				<div
					className={styles.bottom}
					style={{
						...topBottomStyle,
						...pageStyle,
						transform: `rotateX(-90deg) translateY(-${sqSize * (BOOK_DEPTH - 1)}px) translateZ(${sqSize * BOOK_HEIGHT}px)`,
					}}
				/>
				<div
					className={styles.front}
					style={{
						...faceStyle,
						...frontBackStyle,
						transform: `translateZ(${sqSize * (BOOK_DEPTH - 1)}px)`,
					}}
				>
					<div className={styles.spine}>{sefer.displayName}</div>
				</div>
				<div
					className={styles.left}
					style={{ ...faceStyle, ...leftRightStyle }}
				/>
				<div
					className={styles.right}
					style={{
						...leftRightStyle,
						backgroundColor: "#fff",
						transform: `rotateY(-270deg) translate3d(${sqSize}px, 0, ${sqSize * (BOOK_WIDTH - BOOK_DEPTH)}px)`,
					}}
					data-title={sefer.displayName}
				/>
				<div
					className={styles.top}
					style={{
						...topBottomStyle,
						...pageStyle,
						transform: `rotateX(-90deg) translateY(-${sqSize * (BOOK_DEPTH - 1)}px)`,
					}}
				/>
			</div>
		</button>
	);
}

function ShelfFloor() {
	const sqSize = 16;
	const shelfColor = "#441e12";

	const blockStyle = {
		transform: `translate3d(${sqSize * (2 - 1)}px, ${sqSize * (-1 - (SHELF_DEPTH - 1))}px, ${sqSize * 1 + sqSize * (1 - 1)}px)`,
		display: "block",
	};

	const faceStyle = { backgroundColor: shelfColor };

	const topBottomStyle = {
		width: `${sqSize * SHELF_WIDTH}px`,
		height: `${sqSize * SHELF_DEPTH}px`,
	};

	const frontBackStyle = {
		width: `${sqSize * SHELF_WIDTH}px`,
		height: `${sqSize * 1}px`,
	};

	const leftRightStyle = {
		width: `${sqSize * SHELF_DEPTH}px`,
		height: `${sqSize * 1}px`,
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
						transform: `rotateX(-90deg) translateY(-${sqSize * (SHELF_DEPTH - 1)}px) translateZ(${sqSize * 1}px)`,
					}}
				/>
				<div
					className={styles.front}
					style={{
						...faceStyle,
						...frontBackStyle,
						transform: `translateZ(${sqSize * (SHELF_DEPTH - 1)}px)`,
					}}
				/>
				<div
					className={styles.left}
					style={{ ...faceStyle, ...leftRightStyle }}
				/>
				<div
					className={styles.right}
					style={{
						...faceStyle,
						...leftRightStyle,
						transform: `rotateY(-270deg) translate3d(${sqSize}px, 0, ${sqSize * (SHELF_WIDTH - SHELF_DEPTH)}px)`,
					}}
				/>
				<div
					className={styles.top}
					style={{
						...faceStyle,
						...topBottomStyle,
						transform: `rotateX(-90deg) translateY(-${sqSize * (SHELF_DEPTH - 1)}px)`,
					}}
				/>
			</div>
		</div>
	);
}

export function Bookshelf({ onSeferClick }: BookshelfProps) {
	const sqSize = 16;

	return (
		<div className={styles.root}>
			<div className={styles.container}>
				<div
					className={styles.surface}
					style={{
						width: `${sqSize * totalWidth}px`,
					}}
				>
					<ShelfFloor />
					{bookPositions.map(({ sefer, x }) => (
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

export default Bookshelf;
