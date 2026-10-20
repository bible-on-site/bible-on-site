using System.Diagnostics;
using Nuke.Common;

partial class Build
{
    // These targets are selected only by local run commands. Their ordering
    // prepares generated assets before restore/project evaluation, including watch.
    Target PrepareAndroidRecitation => _ => _
        .Description("Prepare local recitation assets for the Android emulator")
        .Unlisted()
        .Before(PrepareApiConfig)
        .Executes(() => PrepareLocalRecitation("Android"));

    Target PrepareWindowsRecitation => _ => _
        .Description("Prepare local recitation assets for Windows")
        .Unlisted()
        .Before(Restore, RestoreWindows, Compile, CompileWindows)
        .Executes(() => PrepareLocalRecitation("Windows"));

    Target PrepareIosRecitation => _ => _
        .Description("Prepare local recitation assets for the iOS simulator")
        .Unlisted()
        .Before(Restore, Compile)
        .Executes(() => PrepareLocalRecitation("iOS"));

    void PrepareLocalRecitation(string platform)
    {
        var start = new ProcessStartInfo
        {
            FileName = "node",
            WorkingDirectory = RootDirectory.Parent,
            UseShellExecute = false,
        };
        start.ArgumentList.Add((RootDirectory.Parent / "devops" / "local-recitation.mjs").ToString());
        start.ArgumentList.Add("prepare");
        start.ArgumentList.Add("--platform");
        start.ArgumentList.Add(platform);
        start.ArgumentList.Add("--app-directory");
        start.ArgumentList.Add(SourceDirectory.ToString());
        using var process = Process.Start(start)
            ?? throw new InvalidOperationException("Could not start recitation asset preparation.");
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                "Recitation preparation failed. Configure the recordings directory with " +
                "'node devops/local-recitation.mjs configure'.");
        }
    }
}

