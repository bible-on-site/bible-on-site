using BibleOnSite.Data;
using FluentAssertions;

namespace BibleOnSite.Tests.Data;

public class PerakimDataTests
{
    [Theory]
    [InlineData(1, null, 50)]   // בראשית
    [InlineData(2, null, 40)]   // שמות
    [InlineData(25, null, 150)] // תהלים
    public void GetPerakimCount_SimpleBooks_ShouldReturnCorrectCount(int seferId, int? additional, int expected)
    {
        // Act
        var result = PerakimData.GetPerakimCount(seferId, additional);

        // Assert
        result.Should().Be(expected);
    }

    [Theory]
    [InlineData(8, 1, 31)]  // שמואל א
    [InlineData(8, 2, 24)]  // שמואל ב
    [InlineData(9, 1, 22)]  // מלכים א
    [InlineData(9, 2, 25)]  // מלכים ב
    [InlineData(34, 70, 10)] // עזרא
    [InlineData(34, 50, 13)] // נחמיה
    [InlineData(35, 1, 29)]  // דברי הימים א
    [InlineData(35, 2, 36)]  // דברי הימים ב
    public void GetPerakimCount_BooksWithAdditionals_ShouldReturnCorrectCount(int seferId, int additional, int expected)
    {
        // Act
        var result = PerakimData.GetPerakimCount(seferId, additional);

        // Assert
        result.Should().Be(expected);
    }

    [Fact]
    public void GetPerakimCount_InvalidSeferId_ShouldReturnZero()
    {
        PerakimData.GetPerakimCount(999).Should().Be(0);
    }

    [Fact]
    public void GetPerakimCount_BookWithAdditionals_NoAdditionalProvided_ShouldReturnZero()
    {
        // שמואל without specifying א or ב
        PerakimData.GetPerakimCount(8).Should().Be(0);
    }

    [Fact]
    public void TotalPerakim_ShouldBe929()
    {
        PerakimData.TotalPerakim.Should().Be(929);
    }

    /// <summary>
    /// Canonical perakim counts per sefer (from the 929 global numbering).
    /// Any mismatch shifts perek IDs in the picker, causing wrong sefer names
    /// and navigation to wrong perakim.
    /// </summary>
    [Theory]
    [InlineData(1, 50)]   // בראשית
    [InlineData(2, 40)]   // שמות
    [InlineData(3, 27)]   // ויקרא
    [InlineData(4, 36)]   // במדבר
    [InlineData(5, 34)]   // דברים
    [InlineData(6, 24)]   // יהושע
    [InlineData(7, 21)]   // שופטים
    [InlineData(10, 66)]  // ישעיהו
    [InlineData(11, 52)]  // ירמיהו
    [InlineData(12, 48)]  // יחזקאל
    [InlineData(13, 14)]  // הושע
    [InlineData(14, 4)]   // יואל
    [InlineData(15, 9)]   // עמוס
    [InlineData(16, 1)]   // עובדיה
    [InlineData(17, 4)]   // יונה
    [InlineData(18, 7)]   // מיכה
    [InlineData(19, 3)]   // נחום
    [InlineData(20, 3)]   // חבקוק
    [InlineData(21, 3)]   // צפניה
    [InlineData(22, 2)]   // חגי
    [InlineData(23, 14)]  // זכריה
    [InlineData(24, 3)]   // מלאכי
    [InlineData(25, 150)] // תהלים
    [InlineData(26, 31)]  // משלי
    [InlineData(27, 42)]  // איוב
    [InlineData(28, 8)]   // שיר השירים
    [InlineData(29, 4)]   // רות
    [InlineData(30, 5)]   // איכה
    [InlineData(31, 12)]  // קהלת
    [InlineData(32, 10)]  // אסתר
    [InlineData(33, 12)]  // דניאל
    public void PerakimOfBooks_SimpleBooks_ShouldMatchCanonicalCounts(int seferId, int expectedCount)
    {
        PerakimData.GetPerakimCount(seferId).Should().Be(expectedCount,
            $"sefer {seferId} perakim count must match the canonical 929 numbering");
    }

    [Fact]
    public void PerakimOfBooks_AllSimpleBookCounts_SumShouldBe929()
    {
        int total = 0;
        foreach (var (_, value) in PerakimData.PerakimOfBooks)
        {
            if (value is int count)
            {
                total += count;
            }
            else if (value is Dictionary<int, int> additionalCounts)
            {
                total += additionalCounts.Values.Sum();
            }
        }

        total.Should().Be(929, "total perakim across all sefarim must equal 929");
    }

    /// <summary>
    /// Validates that the cumulative perek offsets derived from PerakimOfBooks
    /// produce the correct first-perek-ID for each sefer. A wrong count in any
    /// sefer shifts every subsequent sefer's offset, causing the perek picker to
    /// show wrong names and navigate to wrong perakim.
    /// Canonical first-perek-IDs come from the 929 global numbering.
    ///
    /// Regression: יואל had count 3 (should be 4) and מלאכי had count 4 (should be 3).
    /// This shifted seferId 19 (נחום, 3 perakim) to firstPerekId 539 = מיכה ז.
    /// GetPerek(539) returned "מיכה", so the picker displayed "מיכה" with only 3
    /// perakim whose IDs were 539/540/541 → מיכה-ז, נחום-א, נחום-ב.
    /// </summary>
    [Theory]
    [InlineData(1, 1)]     // בראשית
    [InlineData(6, 188)]   // יהושע (first Nevi'im sefer)
    [InlineData(14, 515)]  // יואל  — was wrong (3 instead of 4) causing off-by-one from עמוס onward
    [InlineData(15, 519)]  // עמוס
    [InlineData(18, 533)]  // מיכה  — user reported seeing 3 perakim (actually נחום shifted into מיכה's slot)
    [InlineData(19, 540)]  // נחום
    [InlineData(24, 565)]  // מלאכי — was wrong (4 instead of 3)
    [InlineData(25, 568)]  // תהלים (first Ketuvim sefer — validates Nevi'im total is correct)
    public void PerakimOfBooks_CumulativeOffsets_ShouldMatchCanonicalFirstPerekId(int seferId, int expectedFirstPerekId)
    {
        int currentPerekId = 1;
        for (int i = 1; i < seferId; i++)
        {
            currentPerekId += GetTotalPerakimForSefer(i);
        }

        currentPerekId.Should().Be(expectedFirstPerekId,
            $"sefer {seferId} first perek ID must match the canonical 929 numbering — " +
            $"a mismatch means a preceding sefer has wrong perakim count");
    }

    private static int GetTotalPerakimForSefer(int seferId)
    {
        var perakimData = PerakimData.PerakimOfBooks.GetValueOrDefault(seferId);
        if (perakimData is int count)
            return count;
        if (perakimData is Dictionary<int, int> additionalCounts)
            return additionalCounts.Values.Sum();
        return 0;
    }
}
