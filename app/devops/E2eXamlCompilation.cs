using System.Buffers.Binary;
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

// Instrumented device tests exercise the store's compiled XAML path. Ordinary
// Debug builds retain runtime inflation and Hot Reload for local development.
internal static class E2eXamlCompilation
{
    private static readonly Dictionary<short, OpCode> Opcodes = typeof(OpCodes)
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(field => field.FieldType == typeof(OpCode))
        .Select(field => (OpCode)field.GetValue(null)!)
        .ToDictionary(opcode => opcode.Value);

    internal static void Configure(IDictionary<string, object> properties)
    {
        properties["MauiXamlInflator"] = "XamlC";
        // MAUI's Debug XamlC task validates without writing IL unless forced.
        properties["_MauiForceXamlCForDebug"] = "true";
        properties["MauiEnableXamlHotReload"] = "false";
    }

    internal static void VerifyPerekPage(string assemblyPath) => VerifyCompiledPage(assemblyPath,
        "BibleOnSite.Pages.PerekPage", "BibleOnSite.Controls.SharedTopBar");

    internal static void VerifyCompiledPage(string assemblyPath, string pageType, string controlType)
    {
        using var stream = File.OpenRead(assemblyPath);
        using var assembly = new PEReader(stream);
        var metadata = assembly.GetMetadataReader();
        var evidence = new List<string>();
        foreach (var type in metadata.TypeDefinitions.Select(metadata.GetTypeDefinition))
        {
            if (FullName(metadata, type.Namespace, type.Name) != pageType)
            {
                continue;
            }
            foreach (var method in type.GetMethods().Select(metadata.GetMethodDefinition))
            {
                if (metadata.GetString(method.Name) != "InitializeComponent"
                    || method.RelativeVirtualAddress == 0)
                {
                    continue;
                }
                var il = assembly.GetMethodBody(method.RelativeVirtualAddress).GetILBytes()
                    ?? throw new BadImageFormatException("InitializeComponent has no IL.");
                var targets = new List<string>();
                if (ConstructsControl(metadata, il, controlType, targets))
                {
                    return;
                }
                evidence.Add($"{il.Length} IL bytes; newobj targets: "
                    + (targets.Count == 0 ? "none" : string.Join(", ", targets)));
            }
            break;
        }
        throw new InvalidOperationException(
            $"{assemblyPath}: {pageType}.InitializeComponent does not directly construct {controlType}. "
            + "The E2E app must contain compiled XAML, not a runtime-only InitializeComponent stub. "
            + "Observed: " + (evidence.Count == 0 ? "no initializer body" : string.Join("; ", evidence)) + ".");
    }

    internal static bool ConstructsControl(MetadataReader metadata, byte[] il, string controlType) =>
        ConstructsControl(metadata, il, controlType, null);

    private static bool ConstructsControl(MetadataReader metadata, byte[] il, string controlType, List<string>? targets)
    {
        var constructsControl = false;
        var offset = 0;
        while (offset < il.Length)
        {
            var first = il[offset++];
            if (first == 0xfe && offset == il.Length)
            {
                throw new BadImageFormatException("Truncated InitializeComponent opcode.");
            }
            var value = first == 0xfe ? (short)(0xfe00 | il[offset++]) : (short)first;
            if (!Opcodes.TryGetValue(value, out var opcode))
            {
                throw new BadImageFormatException($"Unknown IL opcode {value:x4}.");
            }
            var size = OperandSize(opcode.OperandType, il, offset);
            if (size > il.Length - offset)
            {
                throw new BadImageFormatException("Truncated InitializeComponent instruction.");
            }
            if (opcode == OpCodes.Newobj)
            {
                var handle = MetadataTokens.EntityHandle(BinaryPrimitives.ReadInt32LittleEndian(il.AsSpan(offset, 4)));
                var target = ReadTarget(metadata, handle);
                if (targets != null && targets.Count < 8)
                {
                    targets.Add($"{handle.Kind} 0x{MetadataTokens.GetToken(handle):x8} -> "
                        + $"{target.Parent.Kind} 0x{MetadataTokens.GetToken(target.Parent):x8} {target.Type}::{target.Name}");
                }
                // Direct control construction proves compilation even when
                // Hot Reload retains a conditional path through runtime inflation.
                constructsControl |= target.Name == ".ctor" && target.Type == controlType;
            }
            offset += size;
        }
        return constructsControl;
    }

    private static int OperandSize(OperandType type, byte[] il, int offset) => type switch
    {
        OperandType.InlineNone => 0,
        OperandType.ShortInlineBrTarget or OperandType.ShortInlineI or OperandType.ShortInlineVar => 1,
        OperandType.InlineVar => 2,
        OperandType.InlineI8 or OperandType.InlineR => 8,
        OperandType.InlineSwitch => SwitchOperandSize(il, offset),
        OperandType.InlineBrTarget or OperandType.InlineField or OperandType.InlineI
            or OperandType.InlineMethod or OperandType.InlineSig or OperandType.InlineString
            or OperandType.InlineTok or OperandType.InlineType or OperandType.ShortInlineR => 4,
        _ => throw new BadImageFormatException($"Unsupported IL operand type {type}.")
    };

    private static int SwitchOperandSize(byte[] il, int offset)
    {
        var remaining = il.Length - offset;
        if (remaining < 4)
        {
            throw new BadImageFormatException("Truncated InitializeComponent switch count.");
        }
        var count = BinaryPrimitives.ReadInt32LittleEndian(il.AsSpan(offset, 4));
        // Bound the count before multiplying it, so malformed tables cannot
        // overflow, move the cursor backwards or escape the method body.
        if (count < 0 || count > (remaining - 4) / 4)
        {
            throw new BadImageFormatException("Invalid InitializeComponent switch table.");
        }
        return 4 + 4 * count;
    }

    private static MethodTarget ReadTarget(MetadataReader metadata, EntityHandle handle)
    {
        if (handle.Kind == HandleKind.MethodDefinition)
        {
            var method = metadata.GetMethodDefinition((MethodDefinitionHandle)handle);
            var parent = method.GetDeclaringType();
            return new(metadata.GetString(method.Name), TypeName(metadata, parent), parent);
        }
        if (handle.Kind == HandleKind.MemberReference)
        {
            var method = metadata.GetMemberReference((MemberReferenceHandle)handle);
            return new(metadata.GetString(method.Name), TypeName(metadata, method.Parent), method.Parent);
        }
        return new("unknown", "unknown", default);
    }

    private static string TypeName(MetadataReader metadata, EntityHandle handle) => handle.Kind switch
    {
        HandleKind.TypeDefinition => DefinitionName(metadata, (TypeDefinitionHandle)handle),
        HandleKind.TypeReference => ReferenceName(metadata, (TypeReferenceHandle)handle),
        _ => "unknown"
    };

    private static string DefinitionName(MetadataReader metadata, TypeDefinitionHandle handle)
    {
        var type = metadata.GetTypeDefinition(handle);
        return FullName(metadata, type.Namespace, type.Name);
    }

    private static string ReferenceName(MetadataReader metadata, TypeReferenceHandle handle)
    {
        var type = metadata.GetTypeReference(handle);
        return FullName(metadata, type.Namespace, type.Name);
    }

    private readonly record struct MethodTarget(string Name, string Type, EntityHandle Parent);

    private static string FullName(MetadataReader metadata, StringHandle space, StringHandle name) =>
        $"{metadata.GetString(space)}.{metadata.GetString(name)}";
}
