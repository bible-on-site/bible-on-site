using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Xml.Linq;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tooling;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    AbsolutePath CoverageDirectory => RootDirectory / ".coverage";
    AbsolutePath UnitCoverageDirectory => CoverageDirectory / "unit";
    AbsolutePath IntegrationCoverageDirectory => CoverageDirectory / "integration";
    AbsolutePath MergedCoverageDirectory => CoverageDirectory / "merged";
    AbsolutePath TestResultsDirectory => TestProject.Parent / "TestResults";

    /// <summary>
    /// Runs tests with coverage and converts the result to LCOV format.
    /// </summary>
    void RunTestsWithCoverage(AbsolutePath outputDirectory, string traitFilter, string description)
    {
        outputDirectory.CreateOrCleanDirectory();
        TestResultsDirectory.CreateOrCleanDirectory();

        // coverlet.MTP cannot instrument the test assembly (it is the MTP controller
        // process, coverlet#1911), so coverage runs through coverlet.console which
        // instruments on disk before spawning the test app.
        var testBinaryDirectory = TestProject.Parent / "bin" / Configuration / "net10.0";
        var resultsRelative = Path.GetRelativePath(RootDirectory, outputDirectory);
        ProcessTasks.StartProcess(DotNetPath,
                $"tool run coverlet \"{testBinaryDirectory}\" --target dotnet" +
                $" --targetargs \"\\\"{testBinaryDirectory / "BibleOnSite.Tests.dll"}\\\" {traitFilter}" +
                $" --results-directory {resultsRelative}" +
                " --report-xunit-junit --report-xunit-junit-filename test-results.xml\"" +
                $" --output \"{outputDirectory / "coverage.cobertura.xml"}\" --format cobertura" +
                " --include \"[BibleOnSite.Tests]*\"" +
                // coverlet.console treats each option value literally (no comma
                // splitting), so filters repeat the flag per pattern.
                " --exclude \"[xunit.*]*\" --exclude \"[FluentAssertions]*\"" +
                " --exclude \"[Moq]*\" --exclude \"[coverlet.*]*\" --exclude \"[Microsoft.*]*\"" +
                " --exclude-by-attribute Obsolete --exclude-by-attribute GeneratedCodeAttribute" +
                " --exclude-by-attribute CompilerGeneratedAttribute --exclude-by-attribute ExcludeFromCodeCoverageAttribute" +
                " --exclude-by-file \"**/obj/**\" --exclude-by-file \"**/bin/**\" --exclude-by-file \"**/.nuget/**\"" +
                " --include-test-assembly --skipautoprops",
                RootDirectory)
            .AssertZeroExitCode();

        var junitFile = outputDirectory / "test-results.xml";
        if (junitFile.FileExists())
        {
            junitFile.Copy(TestResultsDirectory / "test-results.xml", ExistsPolicy.FileOverwrite);
        }

        // Find the Cobertura XML and convert to LCOV
        var coverageFiles = outputDirectory.GlobFiles("coverage.cobertura*.xml");
        if (coverageFiles.Count == 0)
        {
            Serilog.Log.Warning($"No {description} coverage file was generated");
            return;
        }

        var coberturaFile = coverageFiles.First();
        DotNetTasks.DotNet($"tool run reportgenerator " +
            $"-reports:{coberturaFile} " +
            $"-targetdir:{outputDirectory} " +
            $"-reporttypes:lcov",
            workingDirectory: RootDirectory);

        var lcovFile = outputDirectory / "lcov.info";
        if (lcovFile.FileExists())
        {
            Serilog.Log.Information($"{description} coverage: {lcovFile}");
        }
        else
        {
            Serilog.Log.Warning($"{description} LCOV file was not generated");
        }
    }

    Target CoverageUnit => _ => _
        .Description("Run unit tests with coverage (outputs LCOV)")
        .DependsOn(CompileTests)
        .Executes(() => RunTestsWithCoverage(UnitCoverageDirectory, "--filter-not-trait Category=Integration", "Unit"));

    Target CoverageIntegration => _ => _
        .Description("Run integration tests with coverage (outputs LCOV, requires API server)")
        .DependsOn(CompileTests)
        .Executes(() => RunTestsWithCoverage(IntegrationCoverageDirectory, "--filter-trait Category=Integration", "Integration"));

    Target CoverageMerge => _ => _
        .Description("Merge unit and integration LCOV reports")
        .Executes(() =>
        {
            MergedCoverageDirectory.CreateOrCleanDirectory();

            var unitLcov = UnitCoverageDirectory / "lcov.info";
            var integrationLcov = IntegrationCoverageDirectory / "lcov.info";
            var mergedLcov = MergedCoverageDirectory / "lcov.info";

            var lcovFiles = new List<AbsolutePath>();
            if (unitLcov.FileExists()) lcovFiles.Add(unitLcov);
            if (integrationLcov.FileExists()) lcovFiles.Add(integrationLcov);

            if (lcovFiles.Count == 0)
            {
                Serilog.Log.Warning("No LCOV files found to merge");
                return;
            }

            if (lcovFiles.Count == 1)
            {
                // Just copy the single file
                lcovFiles.First().Copy(mergedLcov, ExistsPolicy.FileOverwrite);
                Serilog.Log.Information($"Coverage report (single): {mergedLcov}");
                return;
            }

            // Merge multiple LCOV files using ReportGenerator
            DotNetTasks.DotNet($"tool run reportgenerator " +
                $"-reports:{string.Join(";", lcovFiles)} " +
                $"-targetdir:{MergedCoverageDirectory} " +
                $"-reporttypes:lcov",
                workingDirectory: RootDirectory);

            if (mergedLcov.FileExists())
            {
                Serilog.Log.Information($"Merged coverage report: {mergedLcov}");
            }
            else
            {
                Serilog.Log.Warning("Merged LCOV file was not generated");
            }
        });

    Target CoverageAll => _ => _
        .Description("Run all tests with coverage and merge LCOV reports")
        .DependsOn(CoverageUnit, CoverageIntegration)
        .Triggers(CoverageMerge);

    // Windows FlaUI dumps land under E2E_ARTIFACTS (default: the app's
    // .artifacts/e2e directory); the Windows template is pulled from the app
    // build's obj output, same as the mobile legs.
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

    /// <summary>
    /// The mobile legs publish the template beside the dumps; Windows local
    /// runs have no publish step, so fall back to the newest template the app
    /// build left under obj.
    /// </summary>
    AbsolutePath ResolveE2ECoverageTemplate(AbsolutePath coverageApp)
    {
        var published = coverageApp / "template.opencover.xml";
        if (published.FileExists())
        {
            return published;
        }
        var candidates = SourceDirectory.GlobFiles("**/e2e-coverage/template.opencover.xml");
        if (candidates.Count == 0)
        {
            throw new FileNotFoundException(
                "OpenCover template missing - the app was not built with coverage instrumentation enabled.",
                published);
        }
        candidates.OrderByDescending(t => File.GetLastWriteTimeUtc(t)).First()
            .Copy(published, ExistsPolicy.FileOverwrite);
        return published;
    }

    void ApplyE2ECoverageLayer(AbsolutePath dumpsDirectory, AbsolutePath coverageApp, string platform)
    {
        var templatePath = ResolveE2ECoverageTemplate(coverageApp);

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
