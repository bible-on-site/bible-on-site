using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

// Instrumented device tests exercise the store's compiled XAML path. Ordinary
// Debug builds retain runtime inflation and Hot Reload for local development.
internal static class E2eXamlCompilation
{
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
        foreach (var instruction in E2eIl.Read(il))
        {
            if (instruction.Opcode == OpCodes.Newobj)
            {
                var handle = MetadataTokens.EntityHandle(instruction.Operand);
                var target = E2eIl.ReadMethodTarget(metadata, handle);
                if (targets != null && targets.Count < 8)
                {
                    targets.Add($"{handle.Kind} 0x{MetadataTokens.GetToken(handle):x8} -> "
                        + $"{target.Parent.Kind} 0x{MetadataTokens.GetToken(target.Parent):x8} {target.Type}::{target.Name}");
                }
                // Direct control construction proves compilation even when
                // Hot Reload retains a conditional path through runtime inflation.
                constructsControl |= target.Name == ".ctor" && target.Type == controlType;
            }
        }
        return constructsControl;
    }

    private static string FullName(MetadataReader metadata, StringHandle space, StringHandle name) =>
        $"{metadata.GetString(space)}.{metadata.GetString(name)}";
}
