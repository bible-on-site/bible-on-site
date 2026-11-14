using BibleOnSite.Controls;
using Microsoft.Maui.Controls;
using Xunit;

namespace BibleOnSite.Tests.Controls;

public sealed class RecitationDecoderHostTests
{
    [Fact]
    public void ReadingDoesNotCreateWebKitAndAudioReusesOneExcludedView()
    {
        var host = new RecitationDecoderHost();
        Assert.Null(host.Content);
        Assert.True(AutomationProperties.GetExcludedWithChildren(host));
        var view = host.GetOrCreateView();
        Assert.Same(view, host.Content);
        Assert.Same(view, host.GetOrCreateView());
        Assert.Equal(0, host.Opacity);
        Assert.True(host.InputTransparent);
        Assert.Equal("RecitationDecoder", view.AutomationId);
    }
}
