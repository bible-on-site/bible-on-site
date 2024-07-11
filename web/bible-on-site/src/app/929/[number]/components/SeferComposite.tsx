'use client';
import React, { useState, useEffect } from 'react';

import type { PerekObj } from '@/data/perek-dto';
import ReadModeToggler from './ReadModeToggler';
import Sefer from './Sefer';

const ClientWrapper = (props: { perekObj: PerekObj; toggled: boolean }) => {
	const { toggled } = props;
	const [everToggled, setEverToggled] = useState(false);
	const [currentlyToggled, setCurrentlyToggled] = useState(false);
	const [display, setDisplay] = useState('none');
	const handleToggle = (toggled: boolean, immediately = false) => {
		console.log(
			`handleToggle(toggled: ${toggled}, immediately: ${immediately})`,
		);
		if (!everToggled && toggled) {
			setEverToggled(true);
		}
		if (toggled) {
			setDisplay('initial');
			setCurrentlyToggled(true);
		} else {
			if (immediately) {
				setDisplay('none');
			} else {
				setTimeout(() => setDisplay('none'), 300);
			}
			setCurrentlyToggled(false);
		}
	};

	useEffect(() => {
		console.log(everToggled);
		if (everToggled) return;
		const IMMEDIATELY = true;
		handleToggle(toggled, IMMEDIATELY);
	}, [toggled, handleToggle, everToggled]);

	return (
		<>
			<ReadModeToggler toggled={toggled} onToggle={handleToggle} />
			<div
				style={{ display }}
				className={`${
					currentlyToggled ? 'opacity-1' : 'opacity-0'
				} transition-opacity duration-300 absolute z-[7] top-[72px] w-full h-[calc(100vh-72px)] bg-white`}
			>
				{/* TODO: figure out how to not affecting INP when toggling (some sort of async rendering?)) */}
				{everToggled && <Sefer perekObj={props.perekObj} />}
			</div>
		</>
	);
};

export default ClientWrapper;
