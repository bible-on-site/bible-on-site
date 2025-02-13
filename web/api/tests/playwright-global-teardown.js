const globalTeardown = async (config) => {
	await fetch("http://127.0.0.1:3003/api/shutdown", {
		method: "POST",
	});
};

export default globalTeardown;
