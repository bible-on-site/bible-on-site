using System.Diagnostics;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Xml.Linq;
using Xunit;

public sealed class E2eCoverageRestoreTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void PlainBuildRecompilesCoverageCodeAndRetainsFreshXamlOutput(bool editPlainSource)
    {
        using var fixture = new BuildFixture();
        fixture.Build(coverage: true);
        Assert.Contains("AltCover.Recorder.g", AssemblyReferences(fixture.OutputAssembly));
        Assert.True(File.Exists(fixture.Stamp));
        Assert.True(File.Exists(fixture.BackupAssembly));
        if (editPlainSource)
        {
            fixture.WriteProgram("plain-v2");
        }

        var output = fixture.Build(coverage: false);
        Assert.Contains("invalidated test outputs before compiling plain", output);
        Assert.DoesNotContain("AltCover.Recorder.g", AssemblyReferences(fixture.OutputAssembly));
        Assert.False(File.Exists(fixture.OutputRecorder));
        Assert.False(File.Exists(Path.ChangeExtension(fixture.OutputRecorder, ".pdb")));
        Assert.False(File.Exists(fixture.Stamp));
        Assert.False(File.Exists(fixture.BackupAssembly));
        Assert.False(File.Exists(Path.ChangeExtension(fixture.BackupAssembly, ".pdb")));
        Assert.Equal(File.ReadAllBytes(fixture.FreshXamlAssembly), File.ReadAllBytes(fixture.OutputAssembly));
        Assert.Equal(File.ReadAllBytes(Path.ChangeExtension(fixture.FreshXamlAssembly, ".pdb")),
            File.ReadAllBytes(Path.ChangeExtension(fixture.OutputAssembly, ".pdb")));
        Assert.Equal(editPlainSource ? "plain-v2" : "plain-v1", fixture.Run());

        var assemblyTime = File.GetLastWriteTimeUtc(fixture.OutputAssembly);
        var symbolsTime = File.GetLastWriteTimeUtc(Path.ChangeExtension(fixture.OutputAssembly, ".pdb"));
        var repeated = fixture.Build(coverage: false);
        Assert.DoesNotContain("invalidated test outputs", repeated);
        Assert.Equal(assemblyTime, File.GetLastWriteTimeUtc(fixture.OutputAssembly));
        Assert.Equal(symbolsTime, File.GetLastWriteTimeUtc(Path.ChangeExtension(fixture.OutputAssembly, ".pdb")));
        Assert.False(File.Exists(fixture.OutputRecorder));
        Assert.DoesNotContain("AltCover.Recorder.g", AssemblyReferences(fixture.OutputAssembly));
        Assert.Equal(editPlainSource ? "plain-v2" : "plain-v1", fixture.Run());
    }

    [Theory]
    [InlineData("DesignTimeBuild")]
    [InlineData("SkipCompilerExecution")]
    public void CompilerSkippedPassKeepsCoverageStampUntilARealPlainBuild(string skipProperty)
    {
        using var fixture = new BuildFixture();
        fixture.Build(coverage: true);
        var original = File.ReadAllBytes(fixture.OutputAssembly);
        fixture.InvokeRestore(skipProperty);
        Assert.True(File.Exists(fixture.Stamp));
        Assert.True(File.Exists(fixture.BackupAssembly));
        Assert.True(File.Exists(fixture.OutputRecorder));
        Assert.Equal(original, File.ReadAllBytes(fixture.OutputAssembly));
        Assert.Contains("AltCover.Recorder.g", AssemblyReferences(fixture.OutputAssembly));

        fixture.Build(coverage: false);
        Assert.False(File.Exists(fixture.Stamp));
        Assert.False(File.Exists(fixture.OutputRecorder));
        Assert.DoesNotContain("AltCover.Recorder.g", AssemblyReferences(fixture.OutputAssembly));
        Assert.Equal("plain-v1", fixture.Run());
    }

    private static string[] AssemblyReferences(string path)
    {
        using var stream = File.OpenRead(path);
        using var assembly = new PEReader(stream);
        var metadata = assembly.GetMetadataReader();
        return metadata.AssemblyReferences
            .Select(reference => metadata.GetString(metadata.GetAssemblyReference(reference).Name)).ToArray();
    }

    // Real SDK compilation exercises the actual cleanup target from the app
    // project without importing MAUI workloads. A tiny recorder call models
    // the dependency injected by IL weaving, which a plain rebuild must remove.
    private sealed class BuildFixture : IDisposable
    {
        private readonly DirectoryInfo _root = Directory.CreateDirectory(
            Path.Join(Path.GetTempPath(), "coverage-restore-" + Guid.NewGuid().ToString("N")));
        private readonly string _project;
        private readonly string _program;
        private readonly string _intermediate;
        internal string OutputAssembly { get; }
        internal string OutputRecorder => Path.Join(Path.GetDirectoryName(OutputAssembly)!, "AltCover.Recorder.g.dll");
        internal string Stamp => Path.Join(_intermediate, "e2e-coverage.stamp");
        internal string BackupAssembly => Path.Join(_intermediate, "FixtureApp.uninstrumented.dll");
        internal string FreshXamlAssembly => Path.Join(_intermediate, "fresh-xaml.dll");

        internal BuildFixture()
        {
            var appProject = AppProject();
            var source = XDocument.Load(appProject);
            var restore = source.Root!.Elements("Target")
                .Single(target => target.Attribute("Name")?.Value == "_E2ECoverageRestore");
            var define = source.Root.Elements("PropertyGroup").Elements("DefineConstants")
                .Single(property => property.Value.Contains(";E2E_COVERAGE", StringComparison.Ordinal));
            var referenceCondition = source.Root.Elements("ItemGroup")
                .Single(group => group.Elements("Reference")
                    .Any(reference => reference.Attribute("Include")?.Value == "AltCover.Recorder.g"))
                .Attribute("Condition")!.Value;
            new XDocument(new XElement("Project", new XElement(restore)))
                .Save(Path.Join(_root.FullName, "CoverageRestore.targets"));
            File.Copy(Path.Join(Path.GetDirectoryName(Path.GetDirectoryName(appProject))!, "global.json"),
                Path.Join(_root.FullName, "global.json"));

            var recorder = Directory.CreateDirectory(Path.Join(_root.FullName, "Recorder"));
            File.WriteAllText(Path.Join(recorder.FullName, "Recorder.csproj"), """
                <Project Sdk="Microsoft.NET.Sdk">
                  <PropertyGroup><TargetFramework>net11.0</TargetFramework><AssemblyName>AltCover.Recorder.g</AssemblyName></PropertyGroup>
                </Project>
                """);
            File.WriteAllText(Path.Join(recorder.FullName, "Recorder.cs"), """
                namespace AltCover.Recorder;
                public static class Instance { public static void Visit(string module, int point) { } }
                """);
            var app = Directory.CreateDirectory(Path.Join(_root.FullName, "App"));
            _project = Path.Join(app.FullName, "App.csproj");
            _program = Path.Join(app.FullName, "Program.cs");
            _intermediate = Path.Join(app.FullName, "obj", "Debug", "net11.0");
            OutputAssembly = Path.Join(app.FullName, "bin", "Debug", "net11.0", "FixtureApp.dll");
            var project = XDocument.Parse("""
                <Project Sdk="Microsoft.NET.Sdk">
                  <PropertyGroup>
                    <TargetFramework>net11.0</TargetFramework>
                    <AssemblyName>FixtureApp</AssemblyName>
                    <OutputType>Exe</OutputType>
                  </PropertyGroup>
                  <Import Project="../CoverageRestore.targets" />
                  <Target Name="XamlC" AfterTargets="CoreCompile">
                    <Copy SourceFiles="$(IntermediateOutputPath)$(TargetFileName)" DestinationFiles="$(IntermediateOutputPath)fresh-xaml.dll" SkipUnchangedFiles="true" />
                    <Copy SourceFiles="$(IntermediateOutputPath)$(TargetName).pdb" DestinationFiles="$(IntermediateOutputPath)fresh-xaml.pdb" SkipUnchangedFiles="true" />
                  </Target>
                  <Target Name="FixtureCoverageCheckpoint" AfterTargets="XamlC" Condition="'$(E2ECoverage)' == 'true'">
                    <Copy SourceFiles="$(IntermediateOutputPath)$(TargetFileName)" DestinationFiles="$(IntermediateOutputPath)$(TargetName).uninstrumented.dll" />
                    <Copy SourceFiles="$(IntermediateOutputPath)$(TargetName).pdb" DestinationFiles="$(IntermediateOutputPath)$(TargetName).uninstrumented.pdb" />
                    <Touch Files="$(IntermediateOutputPath)e2e-coverage.stamp" AlwaysCreate="true" />
                  </Target>
                </Project>
                """);
            project.Root!.Element("PropertyGroup")!.Add(new XElement(define));
            project.Root.Add(new XElement("ItemGroup", new XAttribute("Condition", referenceCondition),
                new XElement("ProjectReference", new XAttribute("Include", "../Recorder/Recorder.csproj"))));
            project.Save(_project);
            WriteProgram("plain-v1");
        }

        internal void WriteProgram(string plainText) => File.WriteAllText(_program, $$"""
            #if E2E_COVERAGE
            System.AppContext.SetSwitch("BibleOnSite.E2eCoverage.StartupReady", true);
            AltCover.Recorder.Instance.Visit("fixture", 1);
            System.Console.WriteLine("coverage");
            #else
            System.Console.WriteLine("{{plainText}}");
            #endif
            """);

        // Persistent build servers keep fixture assemblies mapped after the
        // build, which makes the temp-dir delete in Dispose flaky on reruns.
        internal string Build(bool coverage) => Execute("build", _project, "--nologo", "--verbosity", "minimal",
            "--disable-build-servers", "-p:E2ECoverage=" + (coverage ? "true" : "false"));

        internal void InvokeRestore(string skipProperty) => Execute("msbuild", _project, "--nologo",
            "--disable-build-servers", "-target:_E2ECoverageRestore", "-p:E2ECoverage=false", "-p:" + skipProperty + "=true");

        internal string Run() => Execute(OutputAssembly).Trim();

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
                throw new TimeoutException("The isolated SDK coverage/plain fixture exceeded thirty seconds.");
            }
            var combined = output.GetAwaiter().GetResult() + error.GetAwaiter().GetResult();
            Assert.True(process.ExitCode == 0, combined);
            return combined;
        }

        private static string AppProject()
        {
            for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory != null; directory = directory.Parent)
            {
                var candidate = Path.Join(directory.FullName, "BibleOnSite", "BibleOnSite.csproj");
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
            throw new FileNotFoundException("The app project is required for the real coverage cleanup target.");
        }

        public void Dispose()
        {
            Assert.StartsWith(Path.GetFullPath(Path.GetTempPath()), _root.FullName, StringComparison.OrdinalIgnoreCase);
            _root.Delete(recursive: true);
        }
    }
}
