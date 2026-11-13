import Link from "next/link";
import { BreadcrumbDropdown } from "@/app/929/[number]/components/BreadcrumbDropdown";
import styles from "@/app/929/[number]/components/breadcrumb.module.css";
import { MOADIM_ROOT, type MoedSummary, moedHref } from "@/lib/moadim";

/**
 * מועדים breadcrumb (#3266) — the shared breadcrumb shell with the
 * moed's own hierarchy: home → מועדים על הפרק → current moed, where the
 * current node is the sibling picker across the published catalogue.
 * A moed spans sefarim, so no fake sefer level is introduced.
 */
export function MoedBreadcrumb({
	moed,
	siblings,
}: {
	moed: MoedSummary;
	siblings: MoedSummary[];
}) {
	return (
		<nav
			data-testid={`moed-breadcrumb-${moed.slug}`}
			className={styles.grid}
			aria-label="Breadcrumb"
		>
			<div className={styles.container}>
				<ol className={styles.breadcrumb}>
					<li>
						<Link href="/">תנ"ך על הפרק</Link>
					</li>
					<li>
						<Link href={MOADIM_ROOT}>מועדים על הפרק</Link>
					</li>
					<BreadcrumbDropdown
						label={moed.name}
						ariaLabel={`המועד הנוכחי: ${moed.name}. לחץ לבחירת מועד אחר`}
						isCurrentPage
						dropClassName={styles["perek-grid"]}
					>
						<ul className={`${styles.list} ${styles.pl0}`}>
							{siblings.map((sibling) => (
								<li key={sibling.id}>
									<Link
										href={moedHref(sibling.slug)}
										aria-current={
											sibling.slug === moed.slug ? "page" : undefined
										}
									>
										{sibling.name}
									</Link>
								</li>
							))}
						</ul>
					</BreadcrumbDropdown>
				</ol>
			</div>
		</nav>
	);
}
