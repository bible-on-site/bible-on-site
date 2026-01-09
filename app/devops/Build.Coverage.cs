using System.Collections.Generic;
using System.Linq;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    AbsolutePath CoverageDirectory => RootDirectory / ".coverage";
    AbsolutePath UnitCoverageDirectory => CoverageDirectory / "unit";
    AbsolutePath IntegrationCoverageDirectory => CoverageDirectory / "integration";
    AbsolutePath MergedCoverageDirectory => CoverageDirectory / "merged";
    AbsolutePath RunSettingsFile => RootDirectory / "coverlet.runsettings";

    /// <summary>
    /// Runs tests with coverage and converts the result to LCOV format.
    /// </summary>
    void RunTestsWithCoverage(AbsolutePath outputDirectory, string filter, string description)
    {
        outputDirectory.CreateOrCleanDirectory();

        DotNetTest(s => s
            .SetProjectFile(TestProject)
            .SetConfiguration(Configuration)
            .SetFilter(filter)
            .EnableNoRestore()
            .EnableNoBuild()
            .SetResultsDirectory(outputDirectory)
            .SetSettingsFile(RunSettingsFile)
            .SetDataCollector("XPlat Code Coverage"));

        // Find the Cobertura XML and convert to LCOV
        var coverageFiles = outputDirectory.GlobFiles("**/coverage.cobertura.xml");
        if (coverageFiles.Count == 0)
        {
            Serilog.Log.Warning($"No {description} coverage file was generated");
            return;
        }

        var coberturaFile = coverageFiles.First();
        DotNetTasks.DotNet($"tool run reportgenerator " +
            $"-reports:\"{coberturaFile}\" " +
            $"-targetdir:\"{outputDirectory}\" " +
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
        .Executes(() => RunTestsWithCoverage(UnitCoverageDirectory, "Category!=Integration", "Unit"));

    Target CoverageIntegration => _ => _
        .Description("Run integration tests with coverage (outputs LCOV, requires API server)")
        .DependsOn(CompileTests)
        .Executes(() => RunTestsWithCoverage(IntegrationCoverageDirectory, "Category=Integration", "Integration"));

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
                $"-targetdir:\"{MergedCoverageDirectory}\" " +
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
}
