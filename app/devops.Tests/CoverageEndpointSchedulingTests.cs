using System.Diagnostics;
using Xunit;

public sealed class CoverageEndpointSchedulingTests
{
    [Fact]
    public void CoverageHealthRespondsWhileManagedWorkersAreBlocked()
    {
        using var process = new Process();
        process.StartInfo = new ProcessStartInfo("dotnet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        process.StartInfo.ArgumentList.Add(Path.Join(AppContext.BaseDirectory, "coverage-scheduling-probe", "CoverageEndpointProbe.dll"));
        Assert.True(process.Start());
        try
        {
            Assert.True(process.WaitForExit(5000), "Isolated scheduling probe must finish within five seconds");
            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            Assert.True(process.ExitCode == 0, output + error);
            Assert.Contains("HTTP/1.1 200 OK", output);
        }
        finally
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
    }
}
