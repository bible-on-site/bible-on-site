using System.Buffers.Binary;
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;

// Decode operands before inspecting call targets: token-looking bytes inside
// constants and switch tables are not instructions.
internal static class E2eIl
{
    private static readonly Dictionary<short, OpCode> Opcodes = typeof(OpCodes)
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(field => field.FieldType == typeof(OpCode))
        .Select(field => (OpCode)field.GetValue(null)!)
        .ToDictionary(opcode => opcode.Value);

    internal readonly record struct Instruction(OpCode Opcode, int Operand);
    internal readonly record struct MethodTarget(string Name, string Type, EntityHandle Parent, BlobHandle Signature);

    internal static List<Instruction> Read(byte[] il)
    {
        var instructions = new List<Instruction>();
        var offset = 0;
        while (offset < il.Length)
        {
            var first = il[offset++];
            if (first == 0xfe && offset == il.Length)
            {
                throw new BadImageFormatException("Truncated IL opcode.");
            }
            var value = first == 0xfe ? (short)(0xfe00 | il[offset++]) : (short)first;
            if (!Opcodes.TryGetValue(value, out var opcode))
            {
                throw new BadImageFormatException($"Unknown IL opcode {value:x4}.");
            }
            var size = OperandSize(opcode.OperandType, il, offset);
            if (size > il.Length - offset)
            {
                throw new BadImageFormatException("Truncated IL instruction.");
            }
            var operand = size == 4 ? BinaryPrimitives.ReadInt32LittleEndian(il.AsSpan(offset, 4)) : 0;
            instructions.Add(new(opcode, operand));
            offset += size;
        }
        return instructions;
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
            throw new BadImageFormatException("Truncated IL switch count.");
        }
        var count = BinaryPrimitives.ReadInt32LittleEndian(il.AsSpan(offset, 4));
        if (count < 0 || count > (remaining - 4) / 4)
        {
            throw new BadImageFormatException("Invalid IL switch table.");
        }
        return 4 + 4 * count;
    }

    internal static MethodTarget ReadMethodTarget(MetadataReader metadata, EntityHandle handle)
    {
        if (handle.Kind == HandleKind.MethodDefinition)
        {
            var method = metadata.GetMethodDefinition((MethodDefinitionHandle)handle);
            var parent = method.GetDeclaringType();
            return new(metadata.GetString(method.Name), TypeName(metadata, parent), parent, method.Signature);
        }
        if (handle.Kind == HandleKind.MemberReference)
        {
            var method = metadata.GetMemberReference((MemberReferenceHandle)handle);
            return new(metadata.GetString(method.Name), TypeName(metadata, method.Parent), method.Parent, method.Signature);
        }
        return new("unknown", "unknown", default, default);
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

    private static string FullName(MetadataReader metadata, StringHandle space, StringHandle name) =>
        $"{metadata.GetString(space)}.{metadata.GetString(name)}";
}
