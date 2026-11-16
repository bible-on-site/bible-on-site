using System.Diagnostics;
using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Configuration;

namespace BibleOnSite.Tests.MobileE2E;

internal sealed record VerifiedIosApp(string DeviceId, string AppPath, string Nonce, string BundleSha256)
{
    internal void VerifyIdentity(MobileTestConfiguration configuration)
    {
        if (configuration.Platform != MobilePlatform.IOS || DeviceId != configuration.DeviceId ||
            AppPath != configuration.AppPath || !Guid.TryParseExact(Nonce, "N", out _) ||
            BundleSha256.Length != 64 || BundleSha256.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new InvalidOperationException("Verified iOS installation does not belong to this session's app/device.");
        }
    }
}

internal static class IosAppInstallation
{
    internal static VerifiedIosApp Prepare(MobileTestConfiguration configuration, TimeSpan budget)
    {
        var started = Stopwatch.StartNew();
        var nonce = Guid.NewGuid().ToString("N");
        var start = new ProcessStartInfo(configuration.NodeExecutable
            ?? throw new InvalidOperationException("npm test must supply the current Node executable for iOS preparation."))
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (var argument in new[] {
            Path.Combine(AppContext.BaseDirectory, "ios-install.mjs"), configuration.AppPath,
            configuration.DeviceId, nonce, configuration.KeepAppForReview ? "keep" : "reset",
            DateTimeOffset.UtcNow.Add(budget).ToUnixTimeMilliseconds().ToString(System.Globalization.CultureInfo.InvariantCulture)
        })
        {
            start.ArgumentList.Add(argument);
        }
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start iOS preparation.");
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = process.StandardError.ReadToEndAsync();
        var remaining = budget - started.Elapsed;
        if (remaining <= TimeSpan.Zero)
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
            throw new TimeoutException("Starting iOS preparation exhausted the existing 300 second session deadline.");
        }
        using var deadline = new CancellationTokenSource(remaining);
        try
        {
            process.WaitForExitAsync(deadline.Token).GetAwaiter().GetResult();
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
            throw new TimeoutException("iOS preparation exhausted the existing 300 second session deadline.");
        }
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"iOS preparation failed before driver creation: {errors.GetAwaiter().GetResult()}");
        }
        var json = output.GetAwaiter().GetResult();
        var proof = ParseReceipt(json, configuration, nonce);
        File.AppendAllText(Path.Combine(configuration.ArtifactDirectory, "ios-installations.jsonl"), json.TrimEnd() + "\n");
        return proof;
    }

    internal static VerifiedIosApp ParseReceipt(string json, MobileTestConfiguration configuration, string nonce)
    {
        using var document = JsonDocument.Parse(json);
        var receipt = document.RootElement;
        if (receipt.GetProperty("kind").GetString() != "ios-verified-install/1" ||
            receipt.GetProperty("nonce").GetString() != nonce ||
            receipt.GetProperty("bundleId").GetString() != "com.tanah.daily929" ||
            receipt.GetProperty("keepData").GetBoolean() != configuration.KeepAppForReview)
        {
            throw new InvalidOperationException("iOS installation receipt is stale or belongs to another operation.");
        }
        var proof = new VerifiedIosApp(receipt.GetProperty("udid").GetString() ?? "",
            receipt.GetProperty("appPath").GetString() ?? "", nonce,
            receipt.GetProperty("bundleSha256").GetString() ?? "");
        proof.VerifyIdentity(configuration);
        return proof;
    }
}
