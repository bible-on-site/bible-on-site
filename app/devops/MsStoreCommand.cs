using Nuke.Common.Tooling;
using Serilog;
using Serilog.Events;

/// <summary>Report CLI status lines by command outcome, including success messages on stderr.</summary>
internal static class MsStoreCommand
{
    public static int Run(string executable, string arguments, ILogger logger)
    {
        // msstore writes ordinary delete progress to stderr. NUKE's default
        // stderr logger turns even a successful delete into GitHub error annotations.
        var process = ProcessTasks.StartProcess(executable, arguments,
            logOutput: false, logInvocation: true);
        process.WaitForExit();
        var level = process.ExitCode == 0 ? LogEventLevel.Information : LogEventLevel.Warning;
        foreach (var line in process.Output)
        {
            logger.Write(level, "{MsStoreOutput:l}", line.Text);
        }
        return process.ExitCode;
    }
}
