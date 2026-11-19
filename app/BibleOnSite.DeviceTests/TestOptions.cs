using System.Reflection;

namespace BibleOnSite.DeviceTests.Runner;

// Trimmed equivalent of upstream's TestOptions (DeviceTests.Runners Runner/TestOptions.cs).
public class TestOptions
{
    public List<Assembly> Assemblies { get; set; } = new();
    public List<string> SkipCategories { get; set; } = new();
}

public class HeadlessRunnerOptions
{
    public string TestResultsFilename { get; set; } = "testResults.xml";
    public bool RequiresUIContext { get; set; } = true;
}
