import Image from "next/image";
import styles from "./AppSection.module.css";
import { appPlatforms } from "./appPlatforms";

export function AppSection() {
	return (
		<section id="app" className={styles.appSection}>
			<header className={styles.appHeader}>
				<h1>יישֹוּמוֹן תנ&quot;ך על הפרק</h1>
				<h2>
					הורידו את האפליקציה של תנ&quot;ך על הפרק מחנות האפליקציות המתאימה
					למכשירכם
				</h2>
			</header>
			<section className={styles.appLinks}>
				{appPlatforms.map((platform) => {
					const ribbonClass =
						platform.ribbon === "building"
							? styles.ribbonBuilding
							: styles.ribbonComingSoon;

					if (platform.href) {
						return (
							<a
								key={platform.id}
								href={platform.href}
								target="_blank"
								rel="noopener noreferrer"
								className={`${styles.appLink} ${ribbonClass}`}
								title={platform.description}
							>
								<Image
									src={platform.icon}
									alt={platform.description}
									width={24}
									height={24}
								/>
								<span>{platform.name}</span>
							</a>
						);
					}

					return (
						<span
							key={platform.id}
							className={`${styles.appLink} ${styles.disabled} ${ribbonClass}`}
							title={platform.description}
						>
							<Image
								src={platform.icon}
								alt={platform.description}
								width={24}
								height={24}
							/>
							<span>{platform.name}</span>
						</span>
					);
				})}
			</section>
		</section>
	);
}
