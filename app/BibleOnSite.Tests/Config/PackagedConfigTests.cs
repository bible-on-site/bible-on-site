using System.Text;
using BibleOnSite.Config;
using BibleOnSite.Tests.Support;
using Microsoft.Maui.Devices;

namespace BibleOnSite.Tests.Config;

[CollectionDefinition("App configuration", DisableParallelization = true)]
public class AppConfigurationCollection;

[Collection("App configuration")]
public class PackagedConfigTests
{
    [Theory]
    [InlineData("  https://build.example.test/graphql\n", "https://build.example.test/graphql")]
    [InlineData(" \n", null)]
    public async Task Initialize_ReadsAndCachesPackagedOverride(string content, string? expected)
    {
        var previousApiUrl = Environment.GetEnvironmentVariable("API_URL");
        Environment.SetEnvironmentVariable("API_URL", null);
        try
        {
            await using var storage = new TestStorage();
            storage.PackageFiles["api-config.txt"] = Encoding.UTF8.GetBytes(content);
            var device = new Mock<IDeviceInfo>();
            device.SetupGet(d => d.DeviceType).Returns(DeviceType.Physical);
            var config = new AppConfig(storage.FileSystem.Object, device.Object);
            await config.InitializeAsync();
            await config.InitializeAsync();
            config.GetApiUrl().Should().Be(expected ?? config.ApiUrl);
            storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync("api-config.txt"), Times.Once);
        }
        finally
        {
            Environment.SetEnvironmentVariable("API_URL", previousApiUrl);
        }
    }

    [Theory]
    [InlineData("  pk.build-token\n", "pk.build-token")]
    [InlineData(" \n", null)]
    public async Task GetMapboxAccessToken_ReadsAndCachesPackagedToken(string content, string? expected)
    {
        var previousToken = Environment.GetEnvironmentVariable("MAPBOX_ACCESS_TOKEN");
        Environment.SetEnvironmentVariable("MAPBOX_ACCESS_TOKEN", null);
        try
        {
            await using var storage = new TestStorage();
            storage.PackageFiles["mapbox-token.txt"] = Encoding.UTF8.GetBytes(content);
            var device = new Mock<IDeviceInfo>();
            var config = new AppConfig(storage.FileSystem.Object, device.Object);
            (await config.GetMapboxAccessTokenAsync()).Should().Be(expected);
            (await config.GetMapboxAccessTokenAsync()).Should().Be(expected);
            storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync("mapbox-token.txt"), Times.Once);
        }
        finally
        {
            Environment.SetEnvironmentVariable("MAPBOX_ACCESS_TOKEN", previousToken);
        }
    }

    [Fact]
    public async Task GetMapboxAccessToken_MissingAsset_ReturnsNull()
    {
        var previousToken = Environment.GetEnvironmentVariable("MAPBOX_ACCESS_TOKEN");
        Environment.SetEnvironmentVariable("MAPBOX_ACCESS_TOKEN", null);
        try
        {
            await using var storage = new TestStorage();
            var device = new Mock<IDeviceInfo>();
            var config = new AppConfig(storage.FileSystem.Object, device.Object);
            (await config.GetMapboxAccessTokenAsync()).Should().BeNull();
        }
        finally
        {
            Environment.SetEnvironmentVariable("MAPBOX_ACCESS_TOKEN", previousToken);
        }
    }

    [Fact]
    public async Task GetMapboxAccessToken_EnvOverrideWinsOverPackaged()
    {
        var previousToken = Environment.GetEnvironmentVariable("MAPBOX_ACCESS_TOKEN");
        Environment.SetEnvironmentVariable("MAPBOX_ACCESS_TOKEN", "pk.env-token");
        try
        {
            await using var storage = new TestStorage();
            storage.PackageFiles["mapbox-token.txt"] = Encoding.UTF8.GetBytes("pk.packaged-token");
            var device = new Mock<IDeviceInfo>();
            var config = new AppConfig(storage.FileSystem.Object, device.Object);
            (await config.GetMapboxAccessTokenAsync()).Should().Be("pk.env-token");
            storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync("mapbox-token.txt"), Times.Never);
        }
        finally
        {
            Environment.SetEnvironmentVariable("MAPBOX_ACCESS_TOKEN", previousToken);
        }
    }

    // --- API signing credential (#3066) ---

    [Theory]
    [InlineData("k1:secret", "k1", "secret")]
    [InlineData("  k2:sec:with:colons  ", "k2", "sec:with:colons")]
    [InlineData("no-colon", null, null)]
    [InlineData(":empty-id", null, null)]
    [InlineData("empty-secret:", null, null)]
    [InlineData("   ", null, null)]
    [InlineData(null, null, null)]
    public void SigningCredential_Parse_RequiresIdAndSecret(string? raw, string? id, string? secret)
    {
        var credential = ApiSigningCredential.Parse(raw);
        if (id is null)
        {
            credential.Should().BeNull();
        }
        else
        {
            credential.Should().NotBeNull();
            credential!.KeyId.Should().Be(id);
            Encoding.UTF8.GetString(credential.Secret).Should().Be(secret);
        }
    }

    [Fact]
    public async Task GetApiSigningCredential_ReadsAndCachesPackagedPair()
    {
        var previous = Environment.GetEnvironmentVariable("API_SIGNING_KEY");
        Environment.SetEnvironmentVariable("API_SIGNING_KEY", null);
        try
        {
            await using var storage = new TestStorage();
            storage.PackageFiles["api-signing-key.txt"] = Encoding.UTF8.GetBytes(" k1:packaged-secret\n");
            var device = new Mock<IDeviceInfo>();
            var config = new AppConfig(storage.FileSystem.Object, device.Object);
            var credential = await config.GetApiSigningCredentialAsync();
            credential!.KeyId.Should().Be("k1");
            Encoding.UTF8.GetString(credential.Secret).Should().Be("packaged-secret");
            await config.GetApiSigningCredentialAsync();
            storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync("api-signing-key.txt"), Times.Once);
        }
        finally
        {
            Environment.SetEnvironmentVariable("API_SIGNING_KEY", previous);
        }
    }

    [Fact]
    public async Task GetApiSigningCredential_MissingAsset_AndEnvOverride()
    {
        var previous = Environment.GetEnvironmentVariable("API_SIGNING_KEY");
        try
        {
            Environment.SetEnvironmentVariable("API_SIGNING_KEY", null);
            await using var storage = new TestStorage();
            var device = new Mock<IDeviceInfo>();
            var config = new AppConfig(storage.FileSystem.Object, device.Object);
            (await config.GetApiSigningCredentialAsync()).Should().BeNull();

            Environment.SetEnvironmentVariable("API_SIGNING_KEY", "env-k:env-secret");
            var credential = await config.GetApiSigningCredentialAsync();
            credential!.KeyId.Should().Be("env-k");
            Encoding.UTF8.GetString(credential.Secret).Should().Be("env-secret");
            storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync("api-signing-key.txt"), Times.Once);
        }
        finally
        {
            Environment.SetEnvironmentVariable("API_SIGNING_KEY", previous);
        }
    }
}
