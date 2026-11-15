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
        foreach (var typeHandle in metadata.TypeDefinitions)
        {
            var type = metadata.GetTypeDefinition(typeHandle);
            if (FullName(metadata, type.Namespace, type.Name) != pageType)
            {
                continue;
            }
            foreach (var methodHandle in type.GetMethods())
            {
                var method = metadata.GetMethodDefinition(methodHandle);
                if (metadata.GetString(method.Name) != "InitializeComponent"
                    || method.RelativeVirtualAddress == 0)
                {
                    continue;
                }
                var il = assembly.GetMethodBody(method.RelativeVirtualAddress).GetILBytes()
                    ?? throw new BadImageFormatException("InitializeComponent has no IL.");
                if (ConstructsControl(metadata, il, controlType))
                {
                    return;
                }
            }
            break;
        }
        throw new InvalidOperationException(
            $"{assemblyPath}: {pageType}.InitializeComponent does not directly construct {controlType}. "
            + "The E2E app must contain compiled XAML, not a runtime-only InitializeComponent stub.");
    }

    internal static bool ConstructsControl(MetadataReader metadata, byte[] il, string controlType)
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
            if (opcode == OpCodes.Newobj && IsConstructorOf(metadata,
                MetadataTokens.EntityHandle(BinaryPrimitives.ReadInt32LittleEndian(il.AsSpan(offset, 4))), controlType))
            {
                // Direct control construction proves compilation even when
                // Hot Reload retains a conditional path through runtime inflation.
                constructsControl = true;
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

    private static bool IsConstructorOf(MetadataReader metadata, EntityHandle handle, string controlType)
    {
        if (handle.Kind == HandleKind.MethodDefinition)
        {
            var method = metadata.GetMethodDefinition((MethodDefinitionHandle)handle);
            var type = metadata.GetTypeDefinition(method.GetDeclaringType());
            return metadata.GetString(method.Name) == ".ctor"
                && FullName(metadata, type.Namespace, type.Name) == controlType;
        }
        if (handle.Kind == HandleKind.MemberReference)
        {
            var method = metadata.GetMemberReference((MemberReferenceHandle)handle);
            if (metadata.GetString(method.Name) != ".ctor" || method.Parent.Kind != HandleKind.TypeReference)
            {
                return false;
            }
            var type = metadata.GetTypeReference((TypeReferenceHandle)method.Parent);
            return FullName(metadata, type.Namespace, type.Name) == controlType;
        }
        return false;
    }

    private static string FullName(MetadataReader metadata, StringHandle space, StringHandle name) =>
        $"{metadata.GetString(space)}.{metadata.GetString(name)}";
}
