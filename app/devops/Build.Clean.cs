using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Utilities.Collections;

partial class Build
{
    Target Clean => _ => _
        .Description("Clean build outputs")
        .Executes(() =>
        {
            SourceDirectory.GlobDirectories("**/bin", "**/obj").ForEach(x => x.DeleteDirectory());
            TestsDirectory.GlobDirectories("**/bin", "**/obj").ForEach(x => x.DeleteDirectory());
        });
}
