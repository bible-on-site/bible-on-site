"use client";
import React, {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import Image from "next/image";

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
    <label
      ref={toggleRef}
      className="z-10 inline-flex items-center fixed top-2.5 left-2.5"
    >
      <input
        className="peer hidden"
        id="toggle"
        type="checkbox"
        checked={toggled}
        onChange={handleChange}
      />
      <div className="relative w-[110px] h-[50px] bg-white peer-checked:bg-green-200 rounded-full after:absolute after:content-[''] after:w-[40px] after:h-[40px] after:bg-gradient-to-r from-sky-500 to-sky-400 peer-checked:after:bg-opacity-50 peer-checked:after:bg-zinc-900 after:rounded-full after:top-[5px] after:left-[65px] active:after:w-[50px] active:after:translate-x-[-10px] peer-checked:after:left-[5px] peer-checked:after:translate-x-[0] shadow-sm duration-300 after:duration-300 after:shadow-md"></div>
      <Image
        className="peer-checked:opacity-60 absolute w-6 h-6 left-[13px]"
        src="/icons/open-book.svg"
        alt="תצוגה בסיסית"
        width={16}
        height={16}
      />
      <Image
        className="opacity-60 peer-checked:opacity-70 peer-checked:fill-white absolute w-6 h-6 right-[13px]"
        src="/icons/note.svg"
        alt="תצוגת ספר"
        width={16}
        height={16}
      />
    </label>
  );
});

export default ReadModeToggler;
