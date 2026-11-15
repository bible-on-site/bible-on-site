using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text;
using Xunit;

public sealed class E2eXamlCompilationTests
{
    private static readonly string FixtureAssembly = typeof(E2eXamlCompilationTests).Assembly.Location;
    private const string FixtureControl = "E2eXamlFixtures.SharedTopBar";

    [Fact]
    public void CoverageBuildReplacesDebugInflationAndHotReloadWithoutChangingOtherProperties()
    {
        var properties = new Dictionary<string, object>
        {
            ["E2ECoverage"] = "true",
            ["MauiXamlInflator"] = "Runtime",
            ["MauiEnableXamlHotReload"] = "true",
            ["FirebaseEmulator"] = "true"
        };

        E2eXamlCompilation.Configure(properties);

        Assert.Equal("XamlC", properties["MauiXamlInflator"]);
        Assert.Equal("true", properties["_MauiForceXamlCForDebug"]);
        Assert.Equal("false", properties["MauiEnableXamlHotReload"]);
        Assert.Equal("true", properties["E2ECoverage"]);
        Assert.Equal("true", properties["FirebaseEmulator"]);
        Assert.False(properties.ContainsKey("NoWarn"));
    }

    [Theory]
    [InlineData("CompiledPage", FixtureControl)]
    [InlineData("CompiledPageWithHotReloadFallback", FixtureControl)]
    [InlineData("ExternalConstructorPage", "System.Text.StringBuilder")]
    public void ActualCompiledIlConstructsTheControlEvenWithARuntimeFallback(string page, string control) =>
        E2eXamlCompilation.VerifyCompiledPage(FixtureAssembly, $"E2eXamlFixtures.{page}", control);

    [Theory]
    [InlineData("RuntimeOnlyPage")]
    [InlineData("EmptyPage")]
    [InlineData("ConstructionOutsideInitializerPage")]
    [InlineData("MissingPage")]
    public void RuntimeOrMissingInitializationCannotBePublishedAsCompiledXaml(string page)
    {
        var failure = Assert.Throws<InvalidOperationException>(() =>
            E2eXamlCompilation.VerifyCompiledPage(FixtureAssembly, $"E2eXamlFixtures.{page}", FixtureControl));

        Assert.Contains($"E2eXamlFixtures.{page}.InitializeComponent", failure.Message);
        Assert.Contains("runtime-only", failure.Message);
    }

    [Fact]
    public void ProductionEntryPointRequiresTheActualReaderType() =>
        Assert.Throws<InvalidOperationException>(() => E2eXamlCompilation.VerifyPerekPage(FixtureAssembly));

    [Theory]
    [InlineData(new byte[] { 0xfe })]
    [InlineData(new byte[] { 0x45 })]
    [InlineData(new byte[] { 0x45, 1, 0, 0 })]
    [InlineData(new byte[] { 0x45, 0xff, 0xff, 0xff, 0xff })]
    [InlineData(new byte[] { 0x45, 0, 0, 0, 0x80 })]
    [InlineData(new byte[] { 0x45, 0xff, 0xff, 0xff, 0x7f })]
    [InlineData(new byte[] { 0x45, 2, 0, 0, 0, 0, 0, 0, 0 })]
    [InlineData(new byte[] { 0x73, 1, 2 })]
    [InlineData(new byte[] { 0xfe, 0x09, 1 })]
    public void MalformedInstructionsFailClosedWithAnImageError(byte[] il)
    {
        using var stream = File.OpenRead(FixtureAssembly);
        using var assembly = new PEReader(stream);

        Assert.Throws<BadImageFormatException>(() =>
            E2eXamlCompilation.ConstructsControl(assembly.GetMetadataReader(), il, FixtureControl));
    }

    [Theory]
    [InlineData(new byte[] { 0x45, 0, 0, 0, 0, 0x2a })]
    [InlineData(new byte[] { 0x45, 1, 0, 0, 0, 0, 0, 0, 0, 0x2a })]
    public void CompleteSwitchTablesStayWithinTheInstructionStream(byte[] il)
    {
        using var stream = File.OpenRead(FixtureAssembly);
        using var assembly = new PEReader(stream);

        Assert.False(E2eXamlCompilation.ConstructsControl(assembly.GetMetadataReader(), il, FixtureControl));
    }

    [Fact]
    public void MalformedTailCannotBeHiddenByAnEarlierControlConstructor()
    {
        var constructor = typeof(E2eXamlFixtures.SharedTopBar)
            .GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).Single();
        byte[] il = [0x73, .. BitConverter.GetBytes(constructor.MetadataToken), 0x26, 0xfe];
        using var stream = File.OpenRead(FixtureAssembly);
        using var assembly = new PEReader(stream);

        Assert.Throws<BadImageFormatException>(() =>
            E2eXamlCompilation.ConstructsControl(assembly.GetMetadataReader(), il, FixtureControl));
    }
}

// These fixtures are compiled into a real PE assembly. The verifier reads their
// method bodies without loading MAUI or executing the fixture constructors.
namespace E2eXamlFixtures
{
    internal sealed class SharedTopBar;

    internal sealed class CompiledPage
    {
        public object? Content { get; private set; }
        public void InitializeComponent() => Content = new SharedTopBar();
    }

    internal sealed class CompiledPageWithHotReloadFallback
    {
        public static bool HotReloadEnabled { get; set; }
        public object? Content { get; private set; }
        public void InitializeComponent()
        {
            if (HotReloadEnabled)
            {
                RuntimeLoader.LoadFromXaml(this);
                return;
            }
            Content = new SharedTopBar();
        }
    }

    internal sealed class ExternalConstructorPage
    {
        public object? Content { get; private set; }
        public void InitializeComponent() => Content = new StringBuilder();
    }

    internal sealed class RuntimeOnlyPage
    {
        public void InitializeComponent() => RuntimeLoader.LoadFromXaml(this);
    }

    internal sealed class EmptyPage
    {
        public void InitializeComponent() { }
    }

    internal sealed class ConstructionOutsideInitializerPage
    {
        public object Content { get; } = new SharedTopBar();
        public void InitializeComponent() => RuntimeLoader.LoadFromXaml(this);
    }

    internal static class RuntimeLoader
    {
        internal static void LoadFromXaml<T>(T target) => GC.KeepAlive(target);
    }
}
