using System.Globalization;
using BibleOnSite.Helpers;
using Xunit;

namespace BibleOnSite.Tests.Helpers;

public sealed class AccessibleTextSectionsTests
{
    [Fact]
    public void LargeCommentaryKeepsEveryParagraphInBoundedSpokenSections()
    {
        var text = string.Concat(Enumerable.Repeat("פירוש ארוך דברי תורה ללימוד ועיון במקורות עם פירוש נוסף על הפסוק.\n", 2200));
        var sections = AccessibleTextSections.Split(text);
        Assert.Equal(text, string.Concat(sections.Select(s => text.Substring(s.Start, s.Length))));
        Assert.All(sections, s => Assert.InRange(s.Length, 1, AccessibleTextSections.MaximumLength));
        Assert.All(sections.SkipLast(1), s => Assert.Equal('\n', text[s.Start + s.Length - 1]));
    }

    [Theory]
    [InlineData("א\u05b7", 7)]
    [InlineData("👨‍👩‍👧‍👦", 15)]
    [InlineData("\r\n", 3)]
    public void SectionsNeverCutAUnicodeGrapheme(string element, int limit)
    {
        var text = string.Concat(Enumerable.Repeat(element, 100));
        var boundaries = StringInfo.ParseCombiningCharacters(text).Append(text.Length).ToHashSet();
        var sections = AccessibleTextSections.Split(text, limit);
        Assert.Equal(text, string.Concat(sections.Select(s => text.Substring(s.Start, s.Length))));
        Assert.All(sections, s =>
        {
            Assert.Contains(s.Start, boundaries);
            Assert.Contains(s.Start + s.Length, boundaries);
        });
    }

    [Fact]
    public void OneOversizedGraphemeMakesProgressWithoutLosingItsMarks()
    {
        var text = "א" + new string('\u05b7', 1100);
        Assert.Equal(new AccessibleTextSections.Section(0, text.Length), Assert.Single(AccessibleTextSections.Split(text)));
    }

    [Fact]
    public void EmptyDocumentHasNoSpokenSections() => Assert.Empty(AccessibleTextSections.Split(string.Empty));

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void InvalidLimitsAreRejected(int limit)
        => Assert.Throws<ArgumentOutOfRangeException>(() => AccessibleTextSections.Split("text", limit));

[Fact]
    public void GraphemeLongerThanTheLimit_IsKeptIntact()
    {
        // "a" + combining acute is one grapheme of two UTF-16 units; a limit of 1
        // cannot split inside it, so the section expands to the grapheme end.
        var sections = AccessibleTextSections.Split("ábc", 1);

        sections.Should().Equal(
            new AccessibleTextSections.Section(0, 2),
            new AccessibleTextSections.Section(2, 1),
            new AccessibleTextSections.Section(3, 1));
    }
}
