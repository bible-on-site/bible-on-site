// components/ClientWrapper.tsx
"use client";

import React, { useState } from "react";

import ReadModeToggler from "./ReadModeToggler";
import Sefer from "./Sefer";
import { PerekObj } from "@/data/perek-dto";

const ClientWrapper = (props: { perekObj: PerekObj; toggled: boolean }) => {
  const toggled = props.toggled;
  const [everToggled, setEverToggled] = useState(false);
  const [currentlyToggled, setCurrentlyToggled] = useState(false);

  const handleToggle = (toggled: boolean) => {
    if (!everToggled && toggled) {
      setEverToggled(true);
    }
    setCurrentlyToggled(toggled);
  };
  if (toggled) {
    handleToggle(true);
  }

  return (
    <>
      <ReadModeToggler toggled={toggled} onToggle={handleToggle} />
      <div
        className={`${
          currentlyToggled ? "opacity-1" : "opacity-0"
        } transition-opacity duration-300 absolute z-[7] top-[72px] w-full h-[calc(100vh-72px)] bg-white`}
      >
        {everToggled && <Sefer perekObj={props.perekObj} />}
      </div>
    </>
  );
};
export default ClientWrapper;
