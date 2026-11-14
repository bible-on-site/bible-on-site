using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

/// <summary>
/// Regression coverage for the backend's request-URI building (#3185).
/// <see cref="Uri"/> normalization appends a trailing slash to the emulator
/// root, and the first CI run 404'd every REST call because interpolated
/// paths then started with <c>//</c> — a shape the emulator routers never
/// match. These tests pin the single-slash contract at unit level so the
/// device legs are not the only place the bug can surface.
/// </summary>
[Trait("Category", "Unit")]
public class FirebaseEmulatorBackendTests
{
    private static readonly Uri EmulatorRoot = new("http://127.0.0.1:9099");

    [Fact]
    public void Combine_joins_an_absolute_path_with_a_single_slash()
    {
        var uri = FirebaseEmulatorBackend.Combine(
            EmulatorRoot, "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e-suite");

        Assert.Equal(
            "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e-suite",
            uri.AbsoluteUri);
    }

    [Fact]
    public void Combine_joins_a_relative_path_with_a_single_slash()
    {
        var uri = FirebaseEmulatorBackend.Combine(
            EmulatorRoot, "identitytoolkit.googleapis.com/v1/projects/p/accounts:batchGet");

        Assert.Equal(
            "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/p/accounts:batchGet",
            uri.AbsoluteUri);
    }

    [Fact]
    public void Combine_preserves_the_emulator_port()
    {
        var uri = FirebaseEmulatorBackend.Combine(
            new Uri("http://127.0.0.1:8080"), "/v1/projects/p/databases/(default)/documents/users");

        Assert.Equal(8080, uri.Port);
        Assert.DoesNotContain("//", uri.AbsolutePath);
    }
}
