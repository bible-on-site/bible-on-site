import styles from "./navbar.module.css";

export const NavBar = () => {
  return (
    <div className={styles.hamburgerMenu}>
      <input type="checkbox" className={styles.menuToggle} id="menu-toggle" />
      <label className={styles.menuBtn} htmlFor="menu-toggle">
        <span className={styles.menuIcon}></span>
      </label>

      <div className={styles.overlay}></div>

      <ul className={styles.menuBox}>
        <li>
          <a className={styles.menuItem} href="#">
            Home
          </a>
        </li>
        <li>
          <a className={styles.menuItem} href="#">
            About
          </a>
        </li>
        <li>
          <a className={styles.menuItem} href="#">
            Team
          </a>
        </li>
        <li>
          <a className={styles.menuItem} href="#">
            Contact
          </a>
        </li>
        <li>
          <a className={styles.menuItem} href="#">
            Twitter
          </a>
        </li>
      </ul>
    </div>
  );
};

export default NavBar;
