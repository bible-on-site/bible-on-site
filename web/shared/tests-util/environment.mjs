/**
 * @param {undefined | null | string | number} value
 * @param {{ defaultValue: boolean }} options
 * @returns {boolean}
 */
function flagToBool(value, options) {
	if (value === undefined || value === null || value === "") {
		return options.defaultValue;
	}
	return value === 1 || value === "1";
}
export const shouldMeasureCov = flagToBool(process.env.MEASURE_COV, {
	defaultValue: false,
});

export const isCI = !!process.env.CI;

export const isCopilot = !!process.env.VSCODE_AGENT_FOLDER;
