using System.Reflection;

namespace DeviceTestApp.Runner;

// Trimmed equivalent of upstream's TestOptions (Runner/TestOptions.cs).
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
