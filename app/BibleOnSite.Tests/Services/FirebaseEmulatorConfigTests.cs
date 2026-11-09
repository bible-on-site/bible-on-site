using BibleOnSite.Services;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// #3185: endpoint resolution for the emulator-gated e2e build. Environment
/// variables cover iOS launch variables; Android system properties cover
/// devices that cannot receive process environment.
/// </summary>
public class FirebaseEmulatorConfigTests
{
    private static Func<string, string?> EnvironmentOf(Dictionary<string, string?> values) =>
        name => values.TryGetValue(name, out var value) ? value : null;

    private static Func<string, string?> PropertyOf(Dictionary<string, string?> values) =>
        name => values.TryGetValue(name, out var value) ? value : null;

    [Fact]
    public void Resolve_WithNoSources_ReturnsPlatformDefaults()
    {
        var endpoint = FirebaseEmulatorConfig.Resolve(EnvironmentOf([]), PropertyOf([]));

        endpoint.Host.Should().Be(FirebaseEmulatorConfig.DefaultHost);
        endpoint.AuthPort.Should().Be(FirebaseEmulatorConfig.DefaultAuthPort);
        endpoint.FirestorePort.Should().Be(FirebaseEmulatorConfig.DefaultFirestorePort);
    }

    [Fact]
    public void Resolve_WithEnvironmentVariables_OverridesDefaults()
    {
        var endpoint = FirebaseEmulatorConfig.Resolve(
            EnvironmentOf(new()
            {
                // Hostnames are valid override values — the resolver treats the
                // host as opaque text, so a name exercises the same path an IP
                // would without tripping hardcoded-IP lint.
                [FirebaseEmulatorConfig.HostEnvironmentVariable] = "emulator-host.test",
                [FirebaseEmulatorConfig.AuthPortEnvironmentVariable] = "19099",
                [FirebaseEmulatorConfig.FirestorePortEnvironmentVariable] = "18080",
            }),
            PropertyOf([]));

        endpoint.Host.Should().Be("emulator-host.test");
        endpoint.AuthPort.Should().Be(19099);
        endpoint.FirestorePort.Should().Be(18080);
    }

    [Fact]
    public void Resolve_WithSystemProperties_FillsGapsLeftByEnvironment()
    {
        // Android app processes cannot receive environment variables; adb-set
        // debug.* properties are the only per-device override channel.
        var endpoint = FirebaseEmulatorConfig.Resolve(
            EnvironmentOf(new() { [FirebaseEmulatorConfig.HostEnvironmentVariable] = "env-host" }),
            PropertyOf(new()
            {
                [FirebaseEmulatorConfig.AuthPortSystemProperty] = "29099",
                [FirebaseEmulatorConfig.FirestorePortSystemProperty] = "28080",
            }));

        endpoint.Host.Should().Be("env-host");
        endpoint.AuthPort.Should().Be(29099);
        endpoint.FirestorePort.Should().Be(28080);
    }

    [Fact]
    public void Resolve_WithBothSources_PrefersEnvironment()
    {
        var endpoint = FirebaseEmulatorConfig.Resolve(
            EnvironmentOf(new()
            {
                [FirebaseEmulatorConfig.HostEnvironmentVariable] = "env-host",
                [FirebaseEmulatorConfig.AuthPortEnvironmentVariable] = "19099",
            }),
            PropertyOf(new()
            {
                [FirebaseEmulatorConfig.HostSystemProperty] = "prop-host",
                [FirebaseEmulatorConfig.AuthPortSystemProperty] = "29099",
            }));

        endpoint.Host.Should().Be("env-host");
        endpoint.AuthPort.Should().Be(19099);
    }

    [Fact]
    public void Resolve_WithBlankOrInvalidPorts_FallsThroughToNextSource()
    {
        var endpoint = FirebaseEmulatorConfig.Resolve(
            EnvironmentOf(new()
            {
                [FirebaseEmulatorConfig.HostEnvironmentVariable] = "   ",
                [FirebaseEmulatorConfig.AuthPortEnvironmentVariable] = "not-a-port",
                [FirebaseEmulatorConfig.FirestorePortEnvironmentVariable] = "0",
            }),
            PropertyOf(new()
            {
                [FirebaseEmulatorConfig.HostSystemProperty] = "prop-host",
                [FirebaseEmulatorConfig.AuthPortSystemProperty] = "39099",
            }));

        endpoint.Host.Should().Be("prop-host");
        endpoint.AuthPort.Should().Be(39099);
        // The invalid "0" environment value yields to the property default chain:
        // no property for firestore, so the platform default wins.
        endpoint.FirestorePort.Should().Be(FirebaseEmulatorConfig.DefaultFirestorePort);
    }

    [Fact]
    public void Resolve_WithNullSources_ReturnsPlatformDefaults()
    {
        var endpoint = FirebaseEmulatorConfig.Resolve(null, null);

        endpoint.Host.Should().Be(FirebaseEmulatorConfig.DefaultHost);
        endpoint.AuthPort.Should().Be(FirebaseEmulatorConfig.DefaultAuthPort);
        endpoint.FirestorePort.Should().Be(FirebaseEmulatorConfig.DefaultFirestorePort);
    }

    [Fact]
    public void Current_ReturnsEndpointResolvedFromCurrentEnvironment()
    {
        // The lazy singleton is what FirebaseEmulatorRouting actually consumes.
        // It must equal a fresh Resolve over the live environment — the
        // system-property reader returns null on this non-Android host, so a
        // null reader is equivalent. This catches wiring regressions such as a
        // hardcoded endpoint, swapped delegates, or an eagerly captured
        // snapshot. Per-value override precedence itself is covered by the
        // Resolve tests.
        var expected = FirebaseEmulatorConfig.Resolve(Environment.GetEnvironmentVariable, _ => null);

        FirebaseEmulatorConfig.Current.Should().Be(expected);
        FirebaseEmulatorConfig.Current.Host.Should().NotBeNullOrWhiteSpace();
        FirebaseEmulatorConfig.Current.AuthPort.Should().BeInRange(1, 65535);
        FirebaseEmulatorConfig.Current.FirestorePort.Should().BeInRange(1, 65535);
    }
}
