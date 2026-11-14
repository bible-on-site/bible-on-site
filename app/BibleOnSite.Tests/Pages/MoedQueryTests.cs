using System.Reflection;
using BibleOnSite.Pages;

namespace BibleOnSite.Tests.Pages;

public class MoedQueryTests
{
    private static object? Pending(MoedPage page, string field) =>
        typeof(MoedPage).GetField(field, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(page);

    [Theory]
    [InlineData("ראש-השנה")]
    [InlineData("literal%20slug")]
    [InlineData("a+b")]
    public void ShellQuery_DecodesTheEscapedCatalogueSlugExactlyOnce(string slug)
    {
        IQueryAttributable page = new MoedPage();
        page.ApplyQueryAttributes(new Dictionary<string, object> { ["slug"] = Uri.EscapeDataString(slug) });

        Pending((MoedPage)page, "_pendingSlug").Should().Be(slug);
        Pending((MoedPage)page, "_pendingId").Should().BeNull();
    }

    [Theory]
    [InlineData(4, 4)]
    [InlineData("5", 5)]
    [InlineData(-1, null)]
    [InlineData("invalid", null)]
    public void ShellQuery_IdNavigationReplacesAPreviousSlug(object value, int? expected)
    {
        var page = new MoedPage();
        page.ApplyQueryAttributes(new Dictionary<string, object> { ["slug"] = "first" });
        page.ApplyQueryAttributes(new Dictionary<string, object> { ["id"] = value });

        Pending(page, "_pendingId").Should().Be(expected);
        Pending(page, "_pendingSlug").Should().BeNull();
        page.ApplyQueryAttributes(new Dictionary<string, object> { ["slug"] = "second" });
        Pending(page, "_pendingId").Should().BeNull();
    }
}
