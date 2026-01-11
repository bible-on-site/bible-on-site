/**
 * Abstract base class for all deployers.
 * Provides common logging and deployment lifecycle pattern.
 */
export abstract class DeployerBase {
	constructor(protected readonly moduleName: string) {}

	/**
	 * Main deployment entry point. Executes the deployment lifecycle:
	 * 1. deployPreConditions - verify deployment can proceed
	 * 2. coreDeploy - perform the actual deployment
	 * 3. deployPostConditions - verify deployment succeeded
	 */
	async deploy(): Promise<void> {
		this.info(`Deploying ${this.moduleName}...`);
		await this.deployPreConditions();
		await this.coreDeploy();
		await this.deployPostConditions();
		this.info(`Deployment of ${this.moduleName} completed successfully.`);
	}

	/**
	 * Override to add precondition checks before deployment.
	 * Throw an error to abort deployment.
	 */
	protected async deployPreConditions(): Promise<void> {
		// Default: no preconditions
	}

	/**
	 * Core deployment logic - must be implemented by subclasses.
	 */
	protected abstract coreDeploy(): Promise<void>;

	/**
	 * Override to add postcondition checks after deployment.
	 * Throw an error if deployment verification fails.
	 */
	protected async deployPostConditions(): Promise<void> {
		// Default: no postconditions
	}

	protected info(message: string): void {
		console.info(`[${this.moduleName}] ${message}`);
	}

	protected warn(message: string): void {
		console.warn(`[${this.moduleName}] ${message}`);
	}

	protected error(message: string): void {
		console.error(`[${this.moduleName}] ${message}`);
	}
}
