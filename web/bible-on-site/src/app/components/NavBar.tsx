"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import packageJson from "../../../package.json";
import { appPlatforms } from "./appPlatforms";
import styles from "./navbar.module.css";

export const NavBar = () => {
	const [open, setOpen] = useState(false);
	const pathname = usePathname();
	const [lastPathname, setLastPathname] = useState(pathname);
	const triggerRef = useRef<HTMLButtonElement>(null);

	if (pathname !== lastPathname) {
		setLastPathname(pathname);
		setOpen(false);
	}

	const closeAndFocusTrigger = () => {
		setOpen(false);
		triggerRef.current?.focus();
	};

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				triggerRef.current?.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

	return (
		<div className={`${styles.hamburgerMenu} ${open ? styles.open : ""}`}>
			<button
				ref={triggerRef}
				type="button"
				className={styles.menuBtn}
				aria-label="תפריט ראשי"
				aria-expanded={open}
				aria-controls="main-menu"
				onClick={() => setOpen(!open)}
			>
				<span className={styles.menuIcon} />
			</button>

			<div
				className={styles.overlay}
				aria-hidden="true"
				onClick={closeAndFocusTrigger}
			/>

			{/* Same-page links don't change the pathname, so close on any link click too. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: delegated link clicks; Enter on a link fires click too */}
			<nav
				id="main-menu"
				aria-label="תפריט ראשי"
				className={styles.menuBox}
				inert={!open}
				onClick={(event) => {
					if ((event.target as Element).closest("a")) setOpen(false);
				}}
			>
				<header className={styles.sidebarTopBar}>
					<Link href="/">
						<Image
							src="/images/logos/logo192.webp"
							alt="עמוד ראשי"
							width={72}
							height={72}
						/>
					</Link>
				</header>
				<ul className={styles.menuList}>
					<li className={`${styles.menuItem} ${styles.ribbonBuilding}`}>
						<Image src="/icons/book.svg" alt="" width={16} height={16} />
						<Link href="/929">
							<span>על הפרק</span>
						</Link>
					</li>
					<li className={styles.menuItem}>
						<Image src="/icons/rabbi.svg" alt="" width={16} height={16} />
						<Link href="/929/authors">
							<span>הרבנים</span>
						</Link>
					</li>
					<li className={`${styles.menuItem} ${styles.ribbonComingSoon}`}>
						<Image src="/icons/book.svg" alt="" width={16} height={16} />
						<Link href="/pedia">
							<span>תנכפדיה</span>
						</Link>
					</li>
					<li className={`${styles.menuItem} ${styles.ribbonComingSoon}`}>
						<Image
							src="/icons/daily-bulletin.svg"
							alt=""
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
									alt=""
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
						<Image src="/icons/handshake.svg" alt="" width={16} height={16} />
						<Link href="/tos">
							<span>תנאי שימוש</span>
						</Link>
					</li>
					<li className={styles.menuItem}>
						<Image src="/icons/smartphone.svg" alt="" width={16} height={16} />
						<Link href="/app">
							<span>יישומון</span>
						</Link>
						<ul>
							{appPlatforms.map((platform) => (
								<li
									key={platform.id}
									className={styles.menuItem}
									title={platform.description}
								>
									<Image src={platform.icon} alt="" width={16} height={16} />
									<a
										href={platform.href ?? undefined}
										target="_blank"
										rel="noopener noreferrer"
									>
										<span>{platform.name}</span>
									</a>
								</li>
							))}
						</ul>
					</li>
					<li className={styles.menuItem}>
						<Image src="/icons/contact.svg" alt="" width={16} height={16} />
						<Link href="/contact">
							<span>צור קשר</span>
						</Link>
					</li>
					<li className={styles.menuItem}>
						<Image src="/icons/donation.svg" alt="" width={16} height={16} />
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
			</nav>
		</div>
	);
};

export default NavBar;
