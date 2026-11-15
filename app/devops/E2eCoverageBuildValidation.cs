using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Xml.Linq;

// A live recorder endpoint is not proof of instrumentation. Verify the actual
// build output and its matching OpenCover map before publishing either artifact.
internal static class E2eCoverageBuildValidation
{
    internal static void Verify(string assemblyPath, string templatePath)
    {
        using var stream = File.OpenRead(assemblyPath);
        using var assembly = new PEReader(stream);
        var metadata = assembly.GetMetadataReader();
        var assemblyName = metadata.GetString(metadata.GetAssemblyDefinition().Name);
        var template = XDocument.Load(templatePath);
        var hashes = template.Descendants("Module")
            .Where(module => module.Element("ModuleName")?.Value == assemblyName
                && module.Descendants("SequencePoint").Any())
            .Select(module => module.Attribute("hash")?.Value)
            .OfType<string>()
            .Where(hash => !string.IsNullOrWhiteSpace(hash))
            .ToHashSet(StringComparer.Ordinal);
        if (hashes.Count == 0)
        {
            throw new InvalidOperationException(
                $"{templatePath}: no instrumented {assemblyName} module with sequence points. "
                + "An empty AltCover template cannot be published as app coverage.");
        }
        if (!HasMatchingProbe(assembly, metadata, hashes))
        {
            throw new InvalidOperationException(
                $"{assemblyPath}: no AltCover.Recorder.Instance.Visit(string,int32) probe "
                + "matches the coverage template. A recorder reference or startup signal alone is not instrumentation.");
        }
    }

    private static bool HasMatchingProbe(PEReader assembly, MetadataReader metadata, HashSet<string> hashes)
    {
        var found = false;
        foreach (var address in metadata.MethodDefinitions
            .Select(handle => metadata.GetMethodDefinition(handle).RelativeVirtualAddress)
            .Where(address => address != 0))
        {
            var il = assembly.GetMethodBody(address).GetILBytes()
                ?? throw new BadImageFormatException("An app method has no IL.");
            var instructions = E2eIl.Read(il);
            for (var index = 2; index < instructions.Count; index++)
            {
                var call = instructions[index];
                var module = instructions[index - 2];
                if (call.Opcode != OpCodes.Call || module.Opcode != OpCodes.Ldstr
                    || !LoadsInteger(instructions[index - 1].Opcode))
                {
                    continue;
                }
                var target = E2eIl.ReadMethodTarget(metadata, MetadataTokens.EntityHandle(call.Operand));
                if (target.Type != "AltCover.Recorder.Instance" || target.Name != "Visit"
                    || !metadata.GetBlobBytes(target.Signature).SequenceEqual(new byte[] { 0, 2, 1, 14, 8 })
                    || !IsRecorderReference(metadata, target.Parent))
                {
                    continue;
                }
                if ((module.Operand & unchecked((int)0xff000000)) != 0x70000000)
                {
                    throw new BadImageFormatException("Invalid probe module string token.");
                }
                var hash = metadata.GetUserString(MetadataTokens.UserStringHandle(module.Operand & 0x00ffffff));
                found |= hashes.Contains(hash);
            }
        }
        return found;
    }

    private static bool LoadsInteger(OpCode opcode) => opcode == OpCodes.Ldc_I4 || opcode == OpCodes.Ldc_I4_S
        || opcode == OpCodes.Ldc_I4_M1 || opcode == OpCodes.Ldc_I4_0 || opcode == OpCodes.Ldc_I4_1
        || opcode == OpCodes.Ldc_I4_2 || opcode == OpCodes.Ldc_I4_3 || opcode == OpCodes.Ldc_I4_4
        || opcode == OpCodes.Ldc_I4_5 || opcode == OpCodes.Ldc_I4_6 || opcode == OpCodes.Ldc_I4_7
        || opcode == OpCodes.Ldc_I4_8;

    private static bool IsRecorderReference(MetadataReader metadata, EntityHandle parent)
    {
        if (parent.Kind != HandleKind.TypeReference)
        {
            return false;
        }
        var scope = metadata.GetTypeReference((TypeReferenceHandle)parent).ResolutionScope;
        if (scope.Kind != HandleKind.AssemblyReference)
        {
            return false;
        }
        var reference = metadata.GetAssemblyReference((AssemblyReferenceHandle)scope);
        var token = metadata.GetBlobBytes(reference.PublicKeyOrToken);
        if ((reference.Flags & AssemblyFlags.PublicKey) != 0)
        {
            // Cecil emits the full public key; C# normally emits its token.
            var identity = new AssemblyName();
            identity.SetPublicKey(token);
            token = identity.GetPublicKeyToken() ?? [];
        }
        return metadata.GetString(reference.Name) == "AltCover.Recorder.g"
            && token.SequenceEqual(new byte[] { 0x4e, 0xbf, 0xfc, 0xaa, 0xbf, 0x10, 0xce, 0x6a });
    }
}
