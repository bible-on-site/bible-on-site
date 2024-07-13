// This function is to generate a debug port
// Currently it is hardcoded to 9220 but it can be changed to any number
// Currently it is being used in order to start (playwright) tests in a known port in order to later connect to that port and pull coverage data
export function getDebugPort() {
	return 9220;
}
// TODO: think if name is representative enough
export function getRouterDebugPort() {
	return getDebugPort() + 1;
}
