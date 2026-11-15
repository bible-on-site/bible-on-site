using System.Diagnostics;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Xunit;

public sealed class E2eStartupInstrumentationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void PinnedInstrumenterRejectsRecorderReferencesButWeavesTheActualBclStartupBridge(bool directRecorderReference)
    {
        using var fixture = new InstrumentationFixture(directRecorderReference);
        fixture.Build();
        Assert.Equal(directRecorderReference, ReferencesRecorder(fixture.CompiledAssembly));

        var output = fixture.Instrument();
        var modules = XDocument.Load(fixture.Template).Descendants("Module").ToArray();
        if (directRecorderReference)
        {
            Assert.Contains("as it has already been instrumented", output);
            Assert.Empty(modules);
            return;
        }

        Assert.DoesNotContain("as it has already been instrumented", output);
        Assert.NotEmpty(Assert.Single(modules).Descendants("SequencePoint"));
        Assert.True(ReferencesRecorder(fixture.InstrumentedAssembly));
        using var result = JsonDocument.Parse(fixture.Run());
        Assert.True(result.RootElement.GetProperty("startup").GetProperty("ready").GetBoolean());
        Assert.Equal(InstrumentationFixture.LaunchId,
            result.RootElement.GetProperty("startup").GetProperty("launchId").GetString());
        var hits = Assert.Single(result.RootElement.GetProperty("snapshot").GetProperty("modules").EnumerateObject());
        Assert.Contains(hits.Value.EnumerateObject(), hit => hit.Value.GetInt64() > 0);
        E2eCoverageBuildValidation.Verify(fixture.InstrumentedAssembly, fixture.Template);
    }

    private static bool ReferencesRecorder(string path)
    {
        using var stream = File.OpenRead(path);
        using var assembly = new PEReader(stream);
        var metadata = assembly.GetMetadataReader();
        return metadata.AssemblyReferences.Any(reference =>
            metadata.GetString(metadata.GetAssemblyReference(reference).Name) == "AltCover.Recorder.g");
    }

    // Compile the actual app-side signal and actual signed recorder, then run
    // the pinned AltCover tool. No MAUI workload or shared build output is used.
    private sealed class InstrumentationFixture : IDisposable
    {
        internal const string LaunchId = "69d1b138-0aee-4f75-a1b4-103f58d6a5ef";
        private readonly DirectoryInfo _root = Directory.CreateDirectory(
            Path.Join(Path.GetTempPath(), "startup-instrumentation-" + Guid.NewGuid().ToString("N")));
        private readonly string _project;
        private readonly string _output;
        private readonly string _instrumented;
        private readonly string _version;
        internal string CompiledAssembly => Path.Join(_output, "StartupFixture.dll");
        internal string InstrumentedAssembly => Path.Join(_instrumented, "StartupFixture.dll");
        internal string Template => Path.Join(_root.FullName, "template.opencover.xml");

        internal InstrumentationFixture(bool directRecorderReference)
        {
            var appRoot = FindAppRoot();
            File.Copy(Path.Join(appRoot, "global.json"), Path.Join(_root.FullName, "global.json"));
            var recorder = Directory.CreateDirectory(Path.Join(_root.FullName, "Recorder"));
            foreach (var file in new[] { "BibleOnSite.E2eCoverage.csproj", "CoverageEndpoint.cs", "Recorder.cs", "VisitCounters.cs", "recorder.snk" })
            {
                File.Copy(Path.Join(appRoot, "BibleOnSite.E2eCoverage", file), Path.Join(recorder.FullName, file));
            }
            var app = Directory.CreateDirectory(Path.Join(_root.FullName, "App"));
            _project = Path.Join(app.FullName, "App.csproj");
            _output = Path.Join(app.FullName, "bin", "Debug", "net10.0");
            _instrumented = Path.Join(_root.FullName, "instrumented");
            _version = XDocument.Load(Path.Join(appRoot, "BibleOnSite", "BibleOnSite.csproj"))
                .Descendants("AltCoverVersion").Single().Value;
            new XDocument(new XElement("Project", new XAttribute("Sdk", "Microsoft.NET.Sdk"),
                new XElement("PropertyGroup", new XElement("TargetFramework", "net10.0"),
                    new XElement("OutputType", "Exe"), new XElement("AssemblyName", "StartupFixture")),
                new XElement("ItemGroup", new XElement("ProjectReference",
                    new XAttribute("Include", "../Recorder/BibleOnSite.E2eCoverage.csproj")),
                    new XElement("PackageReference", new XAttribute("Include", "altcover"),
                        new XAttribute("Version", _version), new XAttribute("ExcludeAssets", "all")))))
                .Save(_project);
            var page = File.ReadAllText(Path.Join(appRoot, "BibleOnSite", "Pages", "PerekPage.xaml.cs"));
            var bridge = Regex.Match(page, @"NotifyStartupSettled\(\);\s*#if E2E_COVERAGE(?<bridge>[\s\S]+?)#endif");
            Assert.True(bridge.Success, "The fixture must compile the real reader readiness bridge.");
            var signal = directRecorderReference
                ? "_ = AltCover.Recorder.Instance.Timer;"
                : bridge.Groups["bridge"].Value;
            File.WriteAllText(Path.Join(app.FullName, "Program.cs"), $$"""
                using System;
                using System.Reflection;
                using System.Text.Json;

                {{signal}}
                var recorder = Type.GetType("AltCover.Recorder.Instance, AltCover.Recorder.g", true)!;
                var startupType = recorder.Assembly.GetType("AltCover.Recorder.StartupState", true)!;
                var startup = Activator.CreateInstance(startupType, nonPublic: true)!;
                var status = (string)startupType.GetMethod("SnapshotJson", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(startup, null)!;
                var visits = (string)recorder.GetMethod("SnapshotJson")!.Invoke(null, null)!;
                using var statusJson = JsonDocument.Parse(status);
                using var visitsJson = JsonDocument.Parse(visits);
                Console.WriteLine(JsonSerializer.Serialize(new { startup = statusJson.RootElement, snapshot = visitsJson.RootElement }));
                """);
        }

        internal void Build() => Execute("build", _project, "--nologo", "--verbosity", "minimal");

        internal string Instrument()
        {
            var stage = Directory.CreateDirectory(Path.Join(_root.FullName, "stage"));
            File.Copy(CompiledAssembly, Path.Join(stage.FullName, "StartupFixture.dll"));
            File.Copy(Path.ChangeExtension(CompiledAssembly, ".pdb"), Path.Join(stage.FullName, "StartupFixture.pdb"));
            using var assets = JsonDocument.Parse(File.ReadAllText(Path.Join(Path.GetDirectoryName(_project)!, "obj", "project.assets.json")));
            var tool = assets.RootElement.GetProperty("packageFolders").EnumerateObject()
                .Select(folder => Path.Join(folder.Name, "altcover", _version, "tools", "net8.0", "AltCover.dll"))
                .Single(File.Exists);
            return Execute(tool, "-i", stage.FullName, "-o", _instrumented,
                "--localSource", "--visibleBranches", "-r", Template);
        }

        internal string Run()
        {
            // Match the app pipeline: use our signed recorder instead of the
            // generated recorder, while retaining the instrumented app's probes.
            foreach (var file in new[] { "AltCover.Recorder.g.dll", "StartupFixture.deps.json", "StartupFixture.runtimeconfig.json" })
            {
                File.Copy(Path.Join(_output, file), Path.Join(_instrumented, file), overwrite: true);
            }
            return Execute(InstrumentedAssembly);
        }

        private string Execute(params string[] arguments)
        {
            using var process = new Process();
            process.StartInfo = new ProcessStartInfo("dotnet")
            {
                WorkingDirectory = _root.FullName,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            process.StartInfo.Environment["BIBLE_E2E_LAUNCH_ID"] = LaunchId;
            foreach (var argument in arguments)
            {
                process.StartInfo.ArgumentList.Add(argument);
            }
            Assert.True(process.Start());
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(30000))
            {
                process.Kill(entireProcessTree: true);
                throw new TimeoutException("The isolated signed-recorder instrumentation fixture exceeded thirty seconds.");
            }
            var stdout = output.GetAwaiter().GetResult();
            var stderr = error.GetAwaiter().GetResult();
            Assert.True(process.ExitCode == 0, stdout + stderr);
            return stdout;
        }

        private static string FindAppRoot()
        {
            for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory != null; directory = directory.Parent)
            {
                if (File.Exists(Path.Join(directory.FullName, "BibleOnSite", "BibleOnSite.csproj")))
                {
                    return directory.FullName;
                }
            }
            throw new FileNotFoundException("The app project and signed recorder sources are required by the instrumentation fixture.");
        }

        public void Dispose()
        {
            Assert.StartsWith(Path.GetFullPath(Path.GetTempPath()), _root.FullName, StringComparison.OrdinalIgnoreCase);
            _root.Delete(recursive: true);
        }
    }
}
