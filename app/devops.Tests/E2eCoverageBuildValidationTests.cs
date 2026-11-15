using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Xml.Linq;
using Xunit;

public sealed class E2eCoverageBuildValidationTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(42)]
    [InlineData(2048)]
    [InlineData(int.MinValue + 2)]
    public void ActualProbeCallMatchesItsTemplateAcrossIntegerEncodings(int point)
    {
        using var fixture = new Fixture(CreateAssembly(point: point));
        E2eCoverageBuildValidation.Verify(fixture.AssemblyPath, fixture.TemplatePath);
    }

    [Theory]
    [InlineData("empty")]
    [InlineData("no-points")]
    [InlineData("wrong-module")]
    [InlineData("no-hash")]
    public void EmptyOrUnrelatedCoverageMapsCannotBePublished(string template)
    {
        using var fixture = new Fixture(CreateAssembly(), template);
        var error = Assert.Throws<InvalidOperationException>(() =>
            E2eCoverageBuildValidation.Verify(fixture.AssemblyPath, fixture.TemplatePath));
        Assert.Contains("no instrumented", error.Message);
    }

    [Theory]
    [InlineData("reference-only")]
    [InlineData("startup-only")]
    [InlineData("other-type")]
    [InlineData("other-recorder")]
    [InlineData("other-token")]
    [InlineData("other-signature")]
    [InlineData("other-hash")]
    [InlineData("token-in-constant")]
    public void ReferenceLivenessAndTokenBytesAreNotAnExecutedProbe(string form)
    {
        using var fixture = new Fixture(CreateAssembly(form));
        var error = Assert.Throws<InvalidOperationException>(() =>
            E2eCoverageBuildValidation.Verify(fixture.AssemblyPath, fixture.TemplatePath));
        Assert.Contains("no AltCover.Recorder.Instance.Visit", error.Message);
    }

    private sealed class Fixture : IDisposable
    {
        private readonly DirectoryInfo _directory = Directory.CreateTempSubdirectory("e2e-probe-proof-");
        internal string AssemblyPath { get; }
        internal string TemplatePath { get; }

        internal Fixture(byte[] image, string template = "valid")
        {
            AssemblyPath = Path.Join(_directory.FullName, "ProbeFixture.dll");
            TemplatePath = Path.Join(_directory.FullName, "template.opencover.xml");
            File.WriteAllBytes(AssemblyPath, image);
            var module = new XElement("Module",
                template == "no-hash" ? null : new XAttribute("hash", "matching-module"),
                new XElement("ModuleName", template == "wrong-module" ? "OtherAssembly" : "ProbeFixture"),
                new XElement("Classes", new XElement("Class", new XElement("Methods",
                    new XElement("Method", new XElement("SequencePoints", template == "no-points" ? null
                        : new XElement("SequencePoint", new XAttribute("uspid", 42))))))));
            new XDocument(new XElement("CoverageSession", new XElement("Modules",
                template == "empty" ? null : module))).Save(TemplatePath);
        }

        public void Dispose() => _directory.Delete(recursive: true);
    }

    // Build a real PE image, without running it. The token-in-constant case
    // deliberately embeds a call-shaped byte pattern inside an eight-byte operand.
    private static byte[] CreateAssembly(string form = "valid", int point = 42)
    {
        var metadata = new MetadataBuilder();
        metadata.AddModule(0, metadata.GetOrAddString("ProbeFixture.dll"),
            metadata.GetOrAddGuid(Guid.NewGuid()), default, default);
        metadata.AddAssembly(metadata.GetOrAddString("ProbeFixture"), new Version(1, 0), default, default, default, default);
        var runtime = metadata.AddAssemblyReference(metadata.GetOrAddString("System.Runtime"),
            new Version(10, 0), default, default, default, default);
        var objectType = metadata.AddTypeReference(runtime, metadata.GetOrAddString("System"), metadata.GetOrAddString("Object"));
        var recorder = metadata.AddAssemblyReference(metadata.GetOrAddString(form == "other-recorder" ? "OtherRecorder" : "AltCover.Recorder.g"),
            new Version(9, 0), default,
            metadata.GetOrAddBlob(new byte[] { form == "other-token" ? (byte)0 : (byte)0x4e, 0xbf, 0xfc, 0xaa, 0xbf, 0x10, 0xce, 0x6a }), default, default);
        var recorderType = metadata.AddTypeReference(recorder, metadata.GetOrAddString("AltCover.Recorder"),
            metadata.GetOrAddString(form == "other-type" ? "OtherInstance" : "Instance"));
        var target = metadata.AddMemberReference(recorderType,
            metadata.GetOrAddString(form == "startup-only" ? "MarkStartupReady" : "Visit"),
            metadata.GetOrAddBlob(form == "other-signature" ? new byte[] { 0, 2, 1, 14, 14 } : new byte[] { 0, 2, 1, 14, 8 }));
        var module = metadata.GetOrAddUserString(form == "other-hash" ? "different-build" : "matching-module");
        metadata.AddTypeDefinition(TypeAttributes.NotPublic, default, metadata.GetOrAddString("<Module>"),
            default, MetadataTokens.FieldDefinitionHandle(1), MetadataTokens.MethodDefinitionHandle(1));
        metadata.AddTypeDefinition(TypeAttributes.Public, default, metadata.GetOrAddString("Probe"),
            objectType, MetadataTokens.FieldDefinitionHandle(1), MetadataTokens.MethodDefinitionHandle(1));

        var instructions = new InstructionEncoder(new BlobBuilder());
        if (form == "token-in-constant")
        {
            instructions.OpCode(ILOpCode.Ldc_i8);
            instructions.CodeBuilder.WriteInt64(0x0000000a00000128);
            instructions.OpCode(ILOpCode.Pop);
        }
        else if (form != "reference-only")
        {
            instructions.LoadString(module);
            instructions.LoadConstantI4(point);
            instructions.Call(target);
        }
        instructions.OpCode(ILOpCode.Ret);
        var bodies = new BlobBuilder();
        var body = new MethodBodyStreamEncoder(bodies).AddMethodBody(instructions, maxStack: 2);
        metadata.AddMethodDefinition(MethodAttributes.Public | MethodAttributes.Static, MethodImplAttributes.IL,
            metadata.GetOrAddString("Record"), metadata.GetOrAddBlob(new byte[] { 0, 0, 1 }), body,
            MetadataTokens.ParameterHandle(1));
        var image = new BlobBuilder();
        new ManagedPEBuilder(new PEHeaderBuilder(imageCharacteristics: Characteristics.ExecutableImage | Characteristics.Dll),
            new MetadataRootBuilder(metadata), bodies, flags: CorFlags.ILOnly).Serialize(image);
        return image.ToArray();
    }
}
