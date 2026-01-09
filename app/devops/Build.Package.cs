using Nuke.Common;

partial class Build
{
    Target Package => _ => _
        .Description("Package app for distribution")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Implement publishing for each platform
            Serilog.Log.Information("Package target not yet implemented");
        });

    Target Version => _ => _
        .Description("Display current version")
        .Executes(() =>
        {
            // TODO: Read version from csproj or Directory.Build.props
            Serilog.Log.Information("Version target not yet implemented");
        });
}
