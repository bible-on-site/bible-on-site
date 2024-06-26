"use client";
import React, {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import Image from "next/image";
import styles from "./read-mode-toggler.module.css";

const ReadModeToggler = forwardRef(function ReadModeToggler(
  props: { toggled: boolean; onToggle?: (toggled: boolean) => void },
  ref
) {
  const [toggled, setToggled] = useState(props.toggled);
  const toggleRef = useRef<HTMLLabelElement>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = event.target.checked;
    setToggled(isChecked);
    if (props.onToggle) {
      props.onToggle(isChecked);
    }
  };

  useEffect(() => {
    setToggled(props.toggled);
  }, [props.toggled]);

  return (
    <label ref={toggleRef} className={styles.label}>
      <input
        className={styles.input}
        id="toggle"
        type="checkbox"
        checked={toggled}
        onChange={handleChange}
      />
      <div className={styles.toggleDiv}></div>
      <Image
        className={styles.bookIcon}
        src="/icons/open-book.svg"
        alt="תצוגה בסיסית"
        width={16}
        height={16}
      />
      <Image
        className={styles.noteIcon}
        src="/icons/note.svg"
        alt="תצוגת ספר"
        width={16}
        height={16}
      />
    </label>
  );
});

export default ReadModeToggler;
