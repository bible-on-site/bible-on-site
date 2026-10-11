using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Xml.Linq;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    // Windows FlaUI dumps land under E2E_ARTIFACTS (default app/.artifacts/e2e);
    // the Windows template lives in the app's obj output, like mobile.
    AbsolutePath WindowsE2EArtifactsDirectory => AbsolutePath.Create(
        Environment.GetEnvironmentVariable("E2E_ARTIFACTS")
        ?? (RootDirectory / ".artifacts" / "e2e").ToString());

    /// <summary>
    /// Applies per-test coverage dumps collected from the instrumented app
    /// process (#1232) onto the AltCover OpenCover template produced by the
    /// same build, then converts the result to LCOV for the merged app report.
    /// </summary>
    Target CoverageMobileE2E => _ => _
        .Description("Apply app-process coverage dumps to the OpenCover template and emit LCOV")
        .Executes(() => ApplyE2ECoverageLayer(
            MobileE2EArtifactsDirectory / "app-coverage",
            MobileE2EArtifactsDirectory / "coverage-app",
            MobilePlatform.ToLowerInvariant()));

    /// <summary>Same pipeline for the Windows/FlaUI fixture dumps (local runs).</summary>
    Target CoverageE2EWindows => _ => _
        .Description("Apply Windows E2E coverage dumps to the OpenCover template and emit LCOV")
        .Executes(() => ApplyE2ECoverageLayer(
            WindowsE2EArtifactsDirectory / "app-coverage",
            WindowsE2EArtifactsDirectory / "coverage-app",
            "windows"));

    void ApplyE2ECoverageLayer(AbsolutePath dumpsDirectory, AbsolutePath coverageApp, string platform)
    {
        var templatePath = coverageApp / "template.opencover.xml";
        if (!templatePath.FileExists())
        {
            // Windows local runs have no publish step; pull the template
            // straight from the app build's obj output instead.
            var candidates = SourceDirectory.GlobFiles("**/e2e-coverage/template.opencover.xml");
            if (candidates.Count > 0)
            {
                candidates.OrderByDescending(t => File.GetLastWriteTimeUtc(t)).First()
                    .Copy(templatePath, ExistsPolicy.FileOverwrite);
            }
        }
        if (!templatePath.FileExists())
        {
            throw new FileNotFoundException(
                "OpenCover template missing - the app was not built with coverage instrumentation enabled.",
                templatePath);
        }

        var manifestPath = coverageApp / "coverage-manifest.json";
        var buildManifest = manifestPath.FileExists()
            ? JsonDocument.Parse(File.ReadAllText(manifestPath)).RootElement
            : (JsonElement?)null;

        var dumpFiles = dumpsDirectory.DirectoryExists()
            ? dumpsDirectory.GlobFiles("*.json").ToList()
            : new List<AbsolutePath>();
        var errorFiles = dumpsDirectory.DirectoryExists()
            ? dumpsDirectory.GlobFiles("*.coverage-error.txt").ToList()
            : new List<AbsolutePath>();
        if (dumpFiles.Count == 0)
        {
            // Every attempted dump failed: the endpoint or instrumentation
            // is broken, so an all-zero layer would silently underreport.
            if (errorFiles.Count > 0)
            {
                throw new InvalidOperationException(
                    $"All {errorFiles.Count} app coverage dumps failed to collect; " +
                    "the instrumented app's endpoint is unreachable. " +
                    $"See *.coverage-error.txt under {dumpsDirectory}.");
            }
            // A fully skipped suite produces no dumps legitimately; the
            // report still publishes so the merge sees an honest all-zero
            // layer.
            Serilog.Log.Warning(
                $"No app coverage dumps under {dumpsDirectory}; " +
                "emitting an all-zero report.");
        }

        var document = XDocument.Load(templatePath);
        var modules = document.Root?.Element("Modules")?.Elements("Module").ToList()
            ?? throw new InvalidDataException($"{templatePath} has no Modules element.");
        var applied = E2ECoverageApply.ApplyDumps(modules,
            dumpFiles.Select(f => (Name: (string)f, Json: File.ReadAllText(f))).ToList(),
            out var stats, m => Serilog.Log.Warning(m));

        var appliedPath = coverageApp / "coverage.opencover.xml";
        E2ECoverageApply.UpdateModuleSummaries(modules);
        document.Save(appliedPath);

        // LCOV for the cross-module merge; the applied OpenCover stays for
        // diagnostics and the per-test dumps keep their own directory.
        DotNetTasks.DotNet("tool restore", workingDirectory: RootDirectory);
        DotNetTasks.DotNet(
            $"tool run reportgenerator -reports:{appliedPath} " +
            $"-targetdir:{coverageApp} -reporttypes:lcov",
            workingDirectory: RootDirectory);
        var lcovPath = coverageApp / "lcov.info";
        if (!lcovPath.FileExists())
        {
            throw new InvalidOperationException($"ReportGenerator did not produce {lcovPath}");
        }

        var reportManifest = new Dictionary<string, object?>
        {
            ["kind"] = "app-e2e-coverage/1",
            ["platform"] = platform,
            ["sourceSha"] = buildManifest?.GetPropertyOrDefault("sourceSha") ?? "",
            ["configuration"] = "Debug",
            ["collector"] = "altcover-instrumented-app",
            ["collectorVersion"] = buildManifest?.GetPropertyOrDefault("collectorVersion") ?? "",
            ["dumpFiles"] = dumpFiles.Count,
            ["dumpErrors"] = errorFiles.Count,
            ["incompatibleDumps"] = stats.IncompatibleDumps,
            ["unknownPointIds"] = stats.UnknownPointIds,
            ["sequencePointsVisited"] = stats.SequencePointsVisited,
            ["branchPointsVisited"] = stats.BranchPointsVisited,
            ["complete"] = errorFiles.Count == 0 && stats.IncompatibleDumps == 0,
            ["appliedUtc"] = DateTime.UtcNow.ToString("o")
        };
        File.WriteAllText(coverageApp / "coverage-report-manifest.json",
            JsonSerializer.Serialize(reportManifest, new JsonSerializerOptions { WriteIndented = true }));
        Serilog.Log.Information(
            $"App E2E coverage ({platform}): {applied} visits applied across " +
            $"{dumpFiles.Count} dump(s); LCOV: {lcovPath}; " +
            $"errors={errorFiles.Count} incompatible={stats.IncompatibleDumps} unknownPoints={stats.UnknownPointIds}");
    }
}

static class JsonElementExtensions
{
    internal static string? GetPropertyOrDefault(this JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) ? value.GetString() : null;
}
