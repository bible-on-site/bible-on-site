import styles from "./skeleton.module.css";

interface SkeletonProps {
	/** line: text row · rect: block/card · round: circle or pill */
	variant?: "line" | "rect" | "round";
	width?: string;
	height?: string;
	className?: string;
}

/** Decorative placeholder block shown while content-shaped data loads. */
export function Skeleton({
	variant = "line",
	width,
	height,
	className,
}: SkeletonProps) {
	return (
		<span
			aria-hidden="true"
			data-skeleton={variant}
			className={
				className ? `${styles.skeleton} ${className}` : styles.skeleton
			}
			style={{ inlineSize: width, blockSize: height }}
		/>
	);
}

/** Screen-reader-only loading text that accompanies decorative skeletons. */
export function SkeletonLabel({ children }: { children: string }) {
	return <span className={styles.label}>{children}</span>;
}
