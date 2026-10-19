using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public class AppiumLogTailTests
{
    [Fact]
    public void Tail_returns_the_bounded_end_of_the_log()
    {
        var directory = Directory.CreateTempSubdirectory();
        try
        {
            var content = string.Concat(Enumerable.Range(0, 500).Select(i => $"line {i}\n"));
            File.WriteAllText(Path.Join(directory.FullName, "appium.log"), content);

            var tail = AppiumLog.Tail(directory.FullName, 200);

            Assert.True(tail.Length <= 200, $"tail was {tail.Length} chars");
            Assert.EndsWith("line 499\n", tail);
            Assert.DoesNotContain("line 0", tail);
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    [Fact]
    public void Tail_returns_empty_when_no_log_exists()
    {
        var directory = Directory.CreateTempSubdirectory();
        try
        {
            Assert.Equal(string.Empty, AppiumLog.Tail(directory.FullName, 4096));
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }
}
