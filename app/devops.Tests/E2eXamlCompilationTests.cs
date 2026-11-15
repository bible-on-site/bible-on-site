using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
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

    [Theory]
    [InlineData("SharedTopBar", ".ctor", true)]
    [InlineData("OtherControl", ".ctor", false)]
    [InlineData("SharedTopBar", "Create", false)]
    public void LocalMemberReferencesRequireTheExpectedControlConstructor(string control, string member, bool accepted)
    {
        var bytes = MemberReferenceFixture(control, member);
        using var assembly = new PEReader(new MemoryStream(bytes));
        var metadata = assembly.GetMetadataReader();
        var reference = metadata.GetMemberReference(MetadataTokens.MemberReferenceHandle(1));
        Assert.Equal(HandleKind.TypeDefinition, reference.Parent.Kind);
        var parent = metadata.GetTypeDefinition((TypeDefinitionHandle)reference.Parent);
        Assert.Equal(control, metadata.GetString(parent.Name));

        var path = Path.Join(Path.GetTempPath(), $"e2e-xaml-{Guid.NewGuid():N}.dll");
        try
        {
            File.WriteAllBytes(path, bytes);
            if (accepted)
            {
                E2eXamlCompilation.VerifyPerekPage(path);
            }
            else
            {
                var failure = Assert.Throws<InvalidOperationException>(() => E2eXamlCompilation.VerifyPerekPage(path));
                Assert.Contains("MemberReference 0x0a000001 -> TypeDefinition 0x0200000", failure.Message);
                Assert.Contains($"BibleOnSite.Controls.{control}::{member}", failure.Message);
                Assert.Contains("IL bytes", failure.Message);
            }
        }
        finally
        {
            File.Delete(path);
        }
    }

    // XamlC's imported local constructor can be a MemberRef whose parent is a
    // TypeDef. C# emits a MethodDef for the same call, so ordinary C# fixtures
    // cannot exercise this distinct, valid metadata representation.
    private static byte[] MemberReferenceFixture(string control, string member)
    {
        var metadata = new MetadataBuilder();
        metadata.AddModule(0, metadata.GetOrAddString("E2eXamlFixture.dll"),
            metadata.GetOrAddGuid(Guid.NewGuid()), default, default);
        metadata.AddAssembly(metadata.GetOrAddString("E2eXamlFixture"), new Version(1, 0), default, default, default, default);
        var runtime = metadata.AddAssemblyReference(metadata.GetOrAddString("System.Runtime"),
            new Version(10, 0), default, default, default, default);
        var objectType = metadata.AddTypeReference(runtime,
            metadata.GetOrAddString("System"), metadata.GetOrAddString("Object"));
        var noFields = MetadataTokens.FieldDefinitionHandle(1);
        metadata.AddTypeDefinition(TypeAttributes.NotPublic, default, metadata.GetOrAddString("<Module>"),
            default, noFields, MetadataTokens.MethodDefinitionHandle(1));
        metadata.AddTypeDefinition(TypeAttributes.Public, metadata.GetOrAddString("BibleOnSite.Pages"),
            metadata.GetOrAddString("PerekPage"), objectType, noFields, MetadataTokens.MethodDefinitionHandle(1));
        var sharedTopBar = metadata.AddTypeDefinition(TypeAttributes.Public, metadata.GetOrAddString("BibleOnSite.Controls"),
            metadata.GetOrAddString("SharedTopBar"), objectType, noFields, MetadataTokens.MethodDefinitionHandle(2));
        var otherControl = metadata.AddTypeDefinition(TypeAttributes.Public, metadata.GetOrAddString("BibleOnSite.Controls"),
            metadata.GetOrAddString("OtherControl"), objectType, noFields, MetadataTokens.MethodDefinitionHandle(4));
        // Instance method, zero parameters, void return type.
        var signature = metadata.GetOrAddBlob(new byte[] { 0x20, 0, 0x01 });
        var target = metadata.AddMemberReference(control == "SharedTopBar" ? sharedTopBar : otherControl,
            metadata.GetOrAddString(member), signature);

        var bodies = new BlobBuilder();
        var bodyEncoder = new MethodBodyStreamEncoder(bodies);
        var instructions = new InstructionEncoder(new BlobBuilder());
        instructions.OpCode(ILOpCode.Newobj);
        instructions.Token(target);
        instructions.OpCode(ILOpCode.Pop);
        instructions.OpCode(ILOpCode.Ret);
        var initializer = bodyEncoder.AddMethodBody(instructions, maxStack: 1);
        var empty = new InstructionEncoder(new BlobBuilder());
        empty.OpCode(ILOpCode.Ret);
        var emptyBody = bodyEncoder.AddMethodBody(empty);
        var noParameters = MetadataTokens.ParameterHandle(1);
        metadata.AddMethodDefinition(MethodAttributes.Public, MethodImplAttributes.IL,
            metadata.GetOrAddString("InitializeComponent"), signature, initializer, noParameters);
        metadata.AddMethodDefinition(MethodAttributes.Public | MethodAttributes.SpecialName | MethodAttributes.RTSpecialName,
            MethodImplAttributes.IL, metadata.GetOrAddString(".ctor"), signature, emptyBody, noParameters);
        metadata.AddMethodDefinition(MethodAttributes.Public, MethodImplAttributes.IL,
            metadata.GetOrAddString("Create"), signature, emptyBody, noParameters);
        metadata.AddMethodDefinition(MethodAttributes.Public | MethodAttributes.SpecialName | MethodAttributes.RTSpecialName,
            MethodImplAttributes.IL, metadata.GetOrAddString(".ctor"), signature, emptyBody, noParameters);

        var image = new BlobBuilder();
        new ManagedPEBuilder(new PEHeaderBuilder(imageCharacteristics: Characteristics.ExecutableImage | Characteristics.Dll),
            new MetadataRootBuilder(metadata), bodies, flags: CorFlags.ILOnly).Serialize(image);
        return image.ToArray();
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
        public void InitializeComponent()
        {
            // Preserve an empty initializer so verification rejects an artifact
            // whose XAML compilation step produced no control construction.
        }
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
