import type { BulletinRequest } from "./bulletin-client";

export function invokeBulletinBinary(_request: BulletinRequest): never {
	throw new Error("The local bulletin binary is unavailable in production");
}
