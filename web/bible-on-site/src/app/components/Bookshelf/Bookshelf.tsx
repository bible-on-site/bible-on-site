import styles from "./bookshelf.module.scss";

const blocks = 16;
const bookStart = 6;
const titles = [
	"The Color Chucknorris",
	"The Phisherman and His Wife",
	"The Little Browser Engine That Couldn’t",
	"The DOM-Tree",
	"Sliding Into Auto-DMs",
	"Copying and Pasting from Stack Overflow",
	"WordPress Updates Breaking Stuff",
	"Waiting for Internet Explorer to Die",
	"Copypaste Customer Support",
	"Catchy Clickbait Titles and Buzzwords",
	"Spamming with Scrapebox",
];
const blockIndices = Array.from({ length: blocks }, (_, index) => index + 1);

export type BookshelfProps = {
	onSeferClick?: (seferName: string, perekFrom: number) => void;
};

function BookBlock({ blockIndex }: { blockIndex: number }) {
	const isBook =
		blockIndex >= bookStart && blockIndex < bookStart + titles.length;

	if (!isBook) {
		return (
			<div
				className={`${styles.block} ${styles[`b${blockIndex}`]}`}
				key={blockIndex}
			>
				<div className={styles.blockInner}>
					<div className={styles.back} />
					<div className={styles.bottom} />
					<div className={styles.front} />
					<div className={styles.left} />
					<div className={styles.right} />
					<div className={styles.top} />
				</div>
			</div>
		);
	}

	const bookId = blockIndex - bookStart;
	const title = titles[bookId];

	return (
		<div
			className={`${styles.block} ${styles.book} ${styles[`b${blockIndex}`]}`}
			key={blockIndex}
		>
			<div className={styles.blockInner}>
				<div className={styles.back} />
				<div className={styles.bottom} />
				<div className={styles.front}>
					<div className={styles.spine}>{title}</div>
				</div>
				<div className={styles.left} />
				<div className={styles.right} data-title={title} />
				<div className={styles.top} />
			</div>
		</div>
	);
}

export function Bookshelf(_props: BookshelfProps) {
	return (
		<div className={styles.root}>
			<form className={styles.container}>
				<div className={styles.surface}>
					{blockIndices.map((blockIndex) => (
						<BookBlock key={blockIndex} blockIndex={blockIndex} />
					))}
				</div>
			</form>
		</div>
	);
}

export default Bookshelf;
