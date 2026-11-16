using System.Text;
using Xunit;

public sealed class StoreListingTests
{
    public static IEnumerable<object[]> LocaleDirectories =>
        Directory.GetDirectories(StoreListingRoot())
            .Select(path => new object[] { Path.GetFileName(path)! })
            .Where(locale => (string)locale[0] != "screenshots");

    // Every locale directory feeds a Google Play listing through
    // SyncGooglePlayListing; the Edits API rejects over-limit text.
    [Theory]
    [MemberData(nameof(LocaleDirectories))]
    public void PlayListingTextStaysInsideStoreLimits(string locale)
    {
        Assert.InRange(ReadLocaleFile(locale, "title.txt").Length, 1, 30);
        Assert.InRange(ReadLocaleFile(locale, "short-description.txt").Length, 1, 80);
        Assert.InRange(ReadLocaleFile(locale, "description.txt").Length, 1, 4000);
    }

    // #2124 ASO: the query term must lead, ahead of the numeric 929 brand.
    [Fact]
    public void HebrewTitleLeadsWithTheTanakhKeyword() =>
        Assert.StartsWith("תנ\"ך", ReadLocaleFile("he", "title.txt"));

    // #2124: the en-US listing exists for transliterated discovery queries.
    [Fact]
    public void EnglishListingCoversTheTransliteratedQueries()
    {
        var description = ReadLocaleFile("en-US", "description.txt");
        Assert.Contains("Tanakh", description);
        Assert.Contains("Tanach", description);
        Assert.Contains("Hebrew Bible", description);
    }

    // Apple caps keywords at 100 bytes (not chars) and promotional text at 170.
    [Fact]
    public void AppStoreFieldsStayInsideSubmissionLimits()
    {
        Assert.True(Encoding.UTF8.GetByteCount(ReadLocaleFile("he", "keywords.txt")) <= 100);
        Assert.InRange(ReadLocaleFile("he", "promotional-text.txt").Length, 1, 170);
    }

    [Fact]
    public void BothStoresShipAtLeastOneScreenshot()
    {
        Assert.NotEmpty(Directory.GetFiles(Path.Join(StoreListingRoot(), "screenshots", "android"), "*.png"));
        Assert.NotEmpty(Directory.GetFiles(Path.Join(StoreListingRoot(), "screenshots", "ios"), "*.png"));
    }

    static string ReadLocaleFile(string locale, string name) =>
        File.ReadAllText(Path.Join(StoreListingRoot(), locale, name)).Trim();

    static string StoreListingRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Join(directory.FullName, "store-listing");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new DirectoryNotFoundException("app/store-listing is required for listing validation.");
    }
}
