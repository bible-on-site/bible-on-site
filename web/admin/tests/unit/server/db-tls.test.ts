import { X509Certificate } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { databaseConnectionOptions, databaseTls } from "~/server/db-tls.server";

afterEach(() => vi.unstubAllEnvs());
it("removes our SSL flag while preserving encoded credentials and driver options", () => {
	vi.stubEnv("NODE_ENV", "test");
	const config = databaseConnectionOptions(
		new URL(
			"mysql://u%40n:p%40ss@localhost/test?ssl-mode=DISABLED&connectionLimit=3",
		),
	);
	expect(config).toEqual({
		uri: "mysql://u%40n:p%40ss@localhost/test?connectionLimit=3",
		ssl: undefined,
	});
});
it("requires CA and hostname verification for remote databases even with a disabled flag", () => {
	vi.stubEnv("NODE_ENV", "test");
	const tls = databaseTls(
		new URL("mysql://user:fixture@db.example/test?ssl-mode=DISABLED"),
	);
	expect(tls).toMatchObject({ rejectUnauthorized: true, verifyIdentity: true });
	expect(tls?.ca.length).toBeGreaterThan(0);
});
it("never disables certificate verification in production", () => {
	vi.stubEnv("NODE_ENV", "production");
	expect(
		databaseTls(
			new URL("mysql://user:fixture@localhost/test?ssl-mode=DISABLED"),
		),
	).toMatchObject({ rejectUnauthorized: true, verifyIdentity: true });
});
it.each(["localhost", "127.0.0.1", "[::1]"])(
	"supports local development without a certificate at %s",
	(host) => {
		vi.stubEnv("NODE_ENV", "test");
		expect(
			databaseTls(new URL(`mysql://user:fixture@${host}/test`)),
		).toBeUndefined();
		expect(
			databaseTls(
				new URL(`mysql://user:fixture@${host}/test?ssl-mode=REQUIRED`),
			),
		).toMatchObject({ rejectUnauthorized: true, verifyIdentity: true });
	},
);

it("trusts only current self-signed RDS roots for this region", () => {
	const bundle =
		databaseTls(new URL("mysql://fixture@db.example/test"))?.ca || "";
	const roots =
		bundle.match(
			/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
		) || [];
	expect(roots.length).toBeGreaterThan(0);
	for (const root of roots) {
		const certificate = new X509Certificate(root);
		expect(certificate.ca).toBe(true);
		expect(certificate.subject).toBe(certificate.issuer);
		expect(certificate.subject).toContain("il-central-1");
		expect(certificate.verify(certificate.publicKey)).toBe(true);
		expect(Date.parse(certificate.validTo)).toBeGreaterThan(Date.now());
	}
});
