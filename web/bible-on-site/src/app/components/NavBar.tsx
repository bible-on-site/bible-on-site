import Image from "next/image";
import Link from "next/link";
import packageJson from "../../../package.json";
import { appPlatforms } from "./appPlatforms";
import styles from "./navbar.module.css";

export const NavBar = () => {
	return (
		<div className={styles.hamburgerMenu}>
			<input type="checkbox" className={styles.menuToggle} id="menu-toggle" />
			<label className={styles.menuBtn} htmlFor="menu-toggle">
				<span className={styles.menuIcon} />
			</label>

			{/* biome-ignore lint/a11y/noLabelWithoutControl: this is a hack nonetheless. Maybe need to better implement and then lint error won't be relevant */}
			<label className={styles.overlay} htmlFor="menu-toggle" />

			<ul className={styles.menuBox}>
				<header className={styles.sidebarTopBar}>
					<Link href="./">
						<Image
							src="/images/logos/logo192.webp"
							alt="עמוד ראשי"
							width={72}
							height={72}
						/>
					</Link>
				</header>
				<li className={`${styles.menuItem} ${styles.ribbonBuilding}`}>
					<Image src="/icons/book.svg" alt="על הפרק" width={16} height={16} />
					<Link href="/929">
						<span>על הפרק</span>
					</Link>
				</li>
				<li className={`${styles.menuItem} ${styles.ribbonBuilding}`}>
					<Image src="/icons/rabbi.svg" alt="הרבנים" width={16} height={16} />
					<Link href="/authors">
						<span>הרבנים</span>
					</Link>
				</li>
				<li className={`${styles.menuItem} ${styles.ribbonComingSoon}`}>
					<Image
						src="/icons/daily-bulletin.svg"
						alt="עלון יומי"
						width={16}
						height={16}
					/>
					<Link href="/dailyBulletin">
						<span>עלון יומי</span>
					</Link>
					<ul>
						<li className={styles.menuItem}>
							<Image
								src="/icons/whatsapp.svg"
								alt="ווטסאפ"
								width={16}
								height={16}
							/>
							<Link href="/whatsappGroup">
								<span>קבוצת ווטסאפ</span>
							</Link>
						</li>
					</ul>
				</li>
				<li className={styles.menuItem}>
					<Image
						src="/icons/handshake.svg"
						alt="תנאי שימוש"
						width={16}
						height={16}
					/>
					<Link href="/tos">
						<span>תנאי שימוש</span>
					</Link>
				</li>
				<li className={styles.menuItem}>
					<Image
						src="/icons/smartphone.svg"
						alt="יישומון"
						width={16}
						height={16}
					/>
					<Link href="/app">
						<span>יישומון</span>
					</Link>
					<ul>
						{appPlatforms.map((platform) => {
							const ribbonClass =
								platform.ribbon === "building"
									? styles.ribbonBuilding
									: styles.ribbonComingSoon;

							return (
								<li
									key={platform.id}
									className={`${styles.menuItem} ${ribbonClass}`}
									title={platform.description}
								>
									<Image
										src={platform.icon}
										alt={platform.description}
										width={16}
										height={16}
									/>
									{platform.href ? (
										<a
											href={platform.href}
											target="_blank"
											rel="noopener noreferrer"
										>
											<span>{platform.name}</span>
										</a>
									) : (
										<span>{platform.name}</span>
									)}
								</li>
							);
						})}
					</ul>
				</li>
				<li className={styles.menuItem}>
					<Image
						src="/icons/contact.svg"
						alt="צור קשר"
						width={16}
						height={16}
					/>
					<Link href="/contact">
						<span>צור קשר</span>
					</Link>
				</li>
				<li className={styles.menuItem}>
					<Image
						src="/icons/donation.svg"
						alt="תרומות"
						width={16}
						height={16}
					/>
					<Link href="/donation">
						<span>תרומות</span>
					</Link>
				</li>
				<li
					className={styles.versionItem}
					style={
						{
							"--version-content": `"- ${packageJson.version} -"`,
						} as React.CSSProperties
					}
				/>
			</ul>
		</div>
	);
};

export default NavBar;
