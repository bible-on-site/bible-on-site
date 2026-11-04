import Image from "next/image";
import styles from "./AppSection.module.css";
import { appPlatforms } from "./appPlatforms";
import { PushNotificationsToggle } from "./PushNotificationsToggle";

export function AppSection() {
	return (
		<section id="app" className={styles.appSection}>
			<header className={styles.appHeader}>
				<h2>יישֹוּמוֹן תנ&quot;ך על הפרק</h2>
				<h3>
					הורידו את האפליקציה של תנ&quot;ך על הפרק מחנות האפליקציות המתאימה
					למכשירכם
				</h3>
			</header>
			<section className={styles.appLinks}>
				{appPlatforms.map((platform) => {
					if (platform.href) {
						return (
							<a
								key={platform.id}
								href={platform.href}
								target="_blank"
								rel="noopener noreferrer"
								className={styles.appLink}
								title={platform.description}
							>
								<Image
									src={platform.icon}
									alt={platform.description}
									width={platform.iconWidth ?? 24}
									height={platform.iconHeight ?? 24}
								/>
								<span>{platform.name}</span>
							</a>
						);
					}

					return (
						<span
							key={platform.id}
							className={`${styles.appLink} ${styles.disabled}`}
							title={platform.description}
						>
							<Image
								src={platform.icon}
								alt={platform.description}
								width={platform.iconWidth ?? 24}
								height={platform.iconHeight ?? 24}
							/>
							<span>{platform.name}</span>
						</span>
					);
				})}
			</section>
			<PushNotificationsToggle />
		</section>
	);
}
