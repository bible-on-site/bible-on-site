using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

public class FirebaseEmulatorEndpointTests
{
    // AVD's host-loopback alias — the device-side endpoint constant the
    // parser must accept verbatim; test data, not a routable address.
#pragma warning disable S1313 // Android emulator host loopback, test data only — never a routable address.
    private const string AvdLoopback = "10.0.2.2";
#pragma warning restore S1313

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Parse_ReturnsNull_WhenValueMissingOrBlank(string? value)
    {
        FirebaseEmulatorEndpoint.Parse(value).Should().BeNull();
    }

    [Fact]
    public void Parse_DefaultsBothPorts_WhenOnlyHostGiven()
    {
        FirebaseEmulatorEndpoint.Parse(AvdLoopback).Should().Be(
            new FirebaseEmulatorEndpoint.Endpoint(
                AvdLoopback,
                FirebaseEmulatorEndpoint.DefaultAuthPort,
                FirebaseEmulatorEndpoint.DefaultFirestorePort));
    }

    [Fact]
    public void Parse_ParsesExplicitPorts()
    {
        FirebaseEmulatorEndpoint.Parse(AvdLoopback + ":19099:18080").Should().Be(
            new FirebaseEmulatorEndpoint.Endpoint(AvdLoopback, 19099, 18080));
    }

    [Fact]
    public void Parse_AllowsSinglePortOverride()
    {
        FirebaseEmulatorEndpoint.Parse("localhost:9099").Should().Be(
            new FirebaseEmulatorEndpoint.Endpoint(
                "localhost",
                9099,
                FirebaseEmulatorEndpoint.DefaultFirestorePort));
    }

    [Fact]
    public void Parse_TrimsSurroundingWhitespace()
    {
        FirebaseEmulatorEndpoint.Parse("  " + AvdLoopback + ":9099:8080  ").Should().Be(
            new FirebaseEmulatorEndpoint.Endpoint(AvdLoopback, 9099, 8080));
    }

    [Theory]
    [InlineData("[::1]", "::1", 9099, 8080)]
    [InlineData("[::1]:9099:8080", "::1", 9099, 8080)]
    [InlineData("[2001:db8::1]:9999:8888", "2001:db8::1", 9999, 8888)]
    public void Parse_SupportsBracketedIpv6(string value, string host, int authPort, int firestorePort)
    {
        FirebaseEmulatorEndpoint.Parse(value).Should().Be(
            new FirebaseEmulatorEndpoint.Endpoint(host, authPort, firestorePort));
    }

    [Theory]
    // A bare IPv6 literal without brackets parses as host + garbage ports.
    [InlineData("::1")]
    // Host may not be empty, contain whitespace, or be a bare port.
    [InlineData(":9099")]
    [InlineData(":9099:8080")]
    [InlineData("my host:9099:8080")]
    // Unbracketed bracket content and dangling brackets are malformed.
    [InlineData("[::1")]
    [InlineData("[::1]junk:9099")]
    // Ports must be numeric and inside the TCP range.
    [InlineData(AvdLoopback + ":abc:8080")]
    [InlineData(AvdLoopback + ":9099:xyz")]
    [InlineData(AvdLoopback + ":0:8080")]
    [InlineData(AvdLoopback + ":9099:65536")]
    [InlineData(AvdLoopback + ":-1:8080")]
    // Extra segments and trailing separators are malformed.
    [InlineData(AvdLoopback + ":9099:8080:extra")]
    [InlineData(AvdLoopback + ":")]
    [InlineData(AvdLoopback + "::8080")]
    public void Parse_ReturnsNull_WhenValueMalformed(string value)
    {
        FirebaseEmulatorEndpoint.Parse(value).Should().BeNull();
    }

    [Fact]
    public void EnvironmentVariable_MatchesSuiteLaunchChannel()
    {
        FirebaseEmulatorEndpoint.EnvironmentVariable.Should().Be("BIBLE_FIREBASE_EMULATOR");
    }
}
