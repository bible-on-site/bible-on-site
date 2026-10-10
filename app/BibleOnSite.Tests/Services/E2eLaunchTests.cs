using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

// E2eLaunch gates whether a run can reach production analytics (#2120). These
// tests pin the three detection paths — environment variable, persisted marker
// file (extras-less relaunches), and the in-process flag — plus self-persisting
// on first detection so later relaunches in the same install stay marked.
[Collection("Process environment")]
public class E2eLaunchTests : IDisposable
{
    private readonly string _directory;
    private readonly string? _previousEnv;

    public E2eLaunchTests()
    {
        _previousEnv = Environment.GetEnvironmentVariable(E2eLaunch.Variable);
        Environment.SetEnvironmentVariable(E2eLaunch.Variable, null);
        _directory = Path.Combine(Path.GetTempPath(), $"e2e-launch-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_directory);
        E2eLaunch.ResetForTests();
        E2eLaunch.MarkerDirectory = () => _directory;
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(E2eLaunch.Variable, _previousEnv);
        E2eLaunch.ResetForTests();
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }

    private string MarkerPath => Path.Combine(_directory, "e2e.launch");

    [Fact]
    public void IsMarked_IsFalseWithoutEnvironmentOrMarkerFile()
    {
        E2eLaunch.IsMarked.Should().BeFalse();
    }

    [Fact]
    public void IsMarked_IsTrueWithTheEnvironmentVariable()
    {
        Environment.SetEnvironmentVariable(E2eLaunch.Variable, "1");

        E2eLaunch.IsMarked.Should().BeTrue();
    }

    [Fact]
    public void IsMarked_PersistsAMarkerFileOnFirstEnvironmentDetection()
    {
        Environment.SetEnvironmentVariable(E2eLaunch.Variable, "1");

        E2eLaunch.IsMarked.Should().BeTrue();
        File.Exists(MarkerPath).Should().BeTrue(
            "the persisted marker is what keeps extras-less relaunches marked");
    }

    [Fact]
    public void IsMarked_IsTrueFromTheMarkerFileAcrossProcesses()
    {
        // A relaunch carries no env and no extra; only the file survives.
        Directory.CreateDirectory(_directory);
        File.WriteAllText(MarkerPath, "1");

        E2eLaunch.IsMarked.Should().BeTrue();
    }

    [Fact]
    public void IsMarked_StaysTrueInProcessAfterMarkWithoutAReadableFile()
    {
        E2eLaunch.Mark();

        // An in-process flag keeps the current launch marked even when the
        // file could not be written (read-only directory simulates failure).
        E2eLaunch.MarkerDirectory = () => Path.Combine(_directory, "missing");
        E2eLaunch.IsMarked.Should().BeTrue();
    }
}
