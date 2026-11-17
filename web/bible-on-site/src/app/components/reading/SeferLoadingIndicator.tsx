import seferStyles from "@/app/929/[number]/components/sefer-composite.module.css";

export function SeferLoadingIndicator() {
	return (
		<output
			className={seferStyles.loadingContainer}
			aria-label="טוען תצוגת ספר..."
		>
			<div className={seferStyles.loadingSpinner} />
		</output>
	);
}
