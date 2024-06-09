import Link from "next/link";
import styles from "./navbar.module.css";
import Image from "next/image";

export const NavBar = () => {
  return (
    <div className={styles.hamburgerMenu}>
      <input type="checkbox" className={styles.menuToggle} id="menu-toggle" />
      <label className={styles.menuBtn} htmlFor="menu-toggle">
        <span className={styles.menuIcon}></span>
      </label>

      <label className={styles.overlay} htmlFor="menu-toggle"></label>

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
        <li className={styles.menuItem}>
          <Image src="/icons/book.svg" alt="על הפרק" width={16} height={16} />
          <Link href="./929">
            <span>על הפרק</span>
          </Link>
        </li>
        <li className={styles.menuItem}>
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
            src="/icons/google-play.svg"
            alt="ישומון"
            width={16}
            height={16}
          />
          <Link href="/app">
            <span>יישומון</span>
          </Link>
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
      </ul>
    </div>
  );
};

export default NavBar;
