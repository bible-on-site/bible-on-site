using BibleOnSite.Helpers;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Xunit;

namespace BibleOnSite.Tests.Helpers;

public class ReaderSafeAreaTests
{
    [Fact]
    public void ReaderKeepsVerticalInsetsAfterClearingTheInclusiveVisualTree()
    {
        var root = new Grid();
        var toolbar = new Grid();
        var content = new Grid();
        var verses = new VerticalStackLayout();
        root.Add(toolbar);
        root.Add(content);
        content.Add(verses);

        ReaderSafeArea.Configure(root);

        Assert.Equal(new SafeAreaEdges(SafeAreaRegions.None, SafeAreaRegions.Container,
            SafeAreaRegions.None, SafeAreaRegions.Container), root.SafeAreaEdges);
        Assert.Equal(SafeAreaEdges.None, toolbar.SafeAreaEdges);
        Assert.Equal(SafeAreaEdges.None, content.SafeAreaEdges);
        Assert.Equal(SafeAreaEdges.None, verses.SafeAreaEdges);
    }
}
