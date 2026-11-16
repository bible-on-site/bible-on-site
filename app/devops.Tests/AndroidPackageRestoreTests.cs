using System.Runtime.InteropServices;
using System.Text.Json;
using Nuke.Common.Tools.DotNet;
using Xunit;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

public sealed class AndroidPackageRestoreTests
{
    [Theory]
    [InlineData("Release", true)]
    [InlineData("Debug", false)]
    public void RestoreAcquiresTheRuntimeToolsRequiredByThePublishConfiguration(string configuration, bool readyToRun)
    {
        var directory = Directory.CreateDirectory(Path.Join(Path.GetTempPath(), "android-package-restore-" + Guid.NewGuid().ToString("N")));
        try
        {
            var project = Path.Join(directory.FullName, "Fixture.csproj");
            // A workload-independent SDK project isolates the restore/publish
            // contract. Android CoreCLR has this same Release-only R2R default.
            File.WriteAllText(project, """
                <Project Sdk="Microsoft.NET.Sdk">
                  <PropertyGroup>
                    <TargetFramework>net11.0</TargetFramework>
                    <OutputType>Exe</OutputType>
                    <PublishReadyToRun Condition="'$(Configuration)' == 'Release'">true</PublishReadyToRun>
                  </PropertyGroup>
                </Project>
                """);
            File.WriteAllText(Path.Join(directory.FullName, "Program.cs"), "System.Console.WriteLine(\"package fixture\");");
            var runtime = RuntimeInformation.RuntimeIdentifier;
            var settings = Build.AndroidPackageRestoreSettings(project, configuration)
                .SetProperty("TargetFramework", "net11.0")
                .SetProperty("RuntimeIdentifiers", runtime)
                .SetRuntime(runtime);
            DotNetRestore(settings);

            using var assets = JsonDocument.Parse(File.ReadAllText(Path.Join(directory.FullName, "obj", "project.assets.json")));
            var framework = assets.RootElement.GetProperty("project").GetProperty("frameworks").GetProperty("net11.0");
            var hasCrossgen = framework.TryGetProperty("downloadDependencies", out var downloads) &&
                downloads.EnumerateArray().Any(package => package.GetProperty("name").GetString()!
                    .StartsWith("Microsoft.NETCore.App.Crossgen2.", StringComparison.OrdinalIgnoreCase));
            Assert.Equal(readyToRun, hasCrossgen);

            // --no-restore reproduces the production boundary: a missing
            // Crossgen2 tool package must fail here rather than be downloaded.
            DotNetPublish(s => s
                .SetProject(project)
                .SetFramework("net11.0")
                .SetRuntime(runtime)
                .SetConfiguration(configuration)
                .EnableNoRestore());
            Assert.True(File.Exists(Path.Join(directory.FullName, "bin", configuration, "net11.0", runtime, "publish", "Fixture.dll")));
        }
        finally
        {
            Assert.Equal(Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar), directory.Parent!.FullName);
            Assert.StartsWith("android-package-restore-", directory.Name);
            directory.Delete(recursive: true);
        }
    }
}
