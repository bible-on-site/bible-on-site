using BibleOnSite.Controls;
using FluentAssertions;

namespace BibleOnSite.Tests.Controls;

public class HtmlViewTests
{
    #region Default Values Tests

    [Fact]
    public void HtmlView_DefaultValues_ShouldBeCorrect()
    {
        // Arrange & Act
        var htmlView = new HtmlView();

        // Assert
        htmlView.HtmlContent.Should().BeNull();
        htmlView.FontSize.Should().Be(16.0);
        htmlView.FontFactor.Should().Be(1.0);
        htmlView.LineHeight.Should().Be(1.5);
        htmlView.TextAlignment.Should().Be(HtmlTextAlignment.Start);
        htmlView.TextDirection.Should().Be(HtmlTextDirection.Auto);
        htmlView.H1FontSizeMultiplier.Should().Be(1.125);
        htmlView.H2FontSizeMultiplier.Should().Be(1.0625);
        htmlView.H3FontSizeMultiplier.Should().Be(0.925);
    }

    #endregion

    #region EffectiveFontSize Tests

    [Theory]
    [InlineData(16, 1.0, 16)]
    [InlineData(16, 1.5, 24)]
    [InlineData(16, 0.5, 8)]
    [InlineData(20, 1.0, 20)]
    [InlineData(14, 1.25, 17.5)]
    public void EffectiveFontSize_ShouldCalculateCorrectly(double fontSize, double fontFactor, double expected)
    {
        // Arrange
        var htmlView = new HtmlView
        {
            FontSize = fontSize,
            FontFactor = fontFactor
        };

        // Act
        var result = htmlView.EffectiveFontSize;

        // Assert
        result.Should().Be(expected);
    }

    #endregion

    #region GetCssTextAlign Tests

    [Theory]
    [InlineData(HtmlTextAlignment.Start, HtmlTextDirection.Ltr, "left")]
    [InlineData(HtmlTextAlignment.Start, HtmlTextDirection.Rtl, "right")]
    [InlineData(HtmlTextAlignment.Start, HtmlTextDirection.Auto, "left")]
    [InlineData(HtmlTextAlignment.End, HtmlTextDirection.Ltr, "right")]
    [InlineData(HtmlTextAlignment.End, HtmlTextDirection.Rtl, "left")]
    [InlineData(HtmlTextAlignment.Center, HtmlTextDirection.Ltr, "center")]
    [InlineData(HtmlTextAlignment.Center, HtmlTextDirection.Rtl, "center")]
    [InlineData(HtmlTextAlignment.Justify, HtmlTextDirection.Ltr, "justify")]
    [InlineData(HtmlTextAlignment.Justify, HtmlTextDirection.Rtl, "justify")]
    public void GetCssTextAlign_ShouldReturnCorrectValue(HtmlTextAlignment alignment, HtmlTextDirection direction, string expected)
    {
        // Arrange
        var htmlView = new HtmlView
        {
            TextAlignment = alignment,
            TextDirection = direction
        };

        // Act
        var result = htmlView.GetCssTextAlign();

        // Assert
        result.Should().Be(expected);
    }

    #endregion

    #region GetCssDirection Tests

    [Theory]
    [InlineData(HtmlTextDirection.Ltr, "ltr")]
    [InlineData(HtmlTextDirection.Rtl, "rtl")]
    [InlineData(HtmlTextDirection.Auto, "auto")]
    public void GetCssDirection_ShouldReturnCorrectValue(HtmlTextDirection direction, string expected)
    {
        // Arrange
        var htmlView = new HtmlView
        {
            TextDirection = direction
        };

        // Act
        var result = htmlView.GetCssDirection();

        // Assert
        result.Should().Be(expected);
    }

    #endregion

    #region Event Tests

    [Fact]
    public void HtmlContentChanged_ShouldBeRaisedWhenContentChanges()
    {
        // Arrange
        var htmlView = new HtmlView();
        var eventRaised = false;
        htmlView.HtmlContentChanged += (_, _) => eventRaised = true;

        // Act
        htmlView.HtmlContent = "<p>Test</p>";

        // Assert
        eventRaised.Should().BeTrue();
    }

    [Fact]
    public void StyleChanged_ShouldBeRaisedWhenFontSizeChanges()
    {
        // Arrange
        var htmlView = new HtmlView();
        var eventRaised = false;
        htmlView.StyleChanged += (_, _) => eventRaised = true;

        // Act
        htmlView.FontSize = 20;

        // Assert
        eventRaised.Should().BeTrue();
    }

    [Fact]
    public void StyleChanged_ShouldBeRaisedWhenFontFactorChanges()
    {
        // Arrange
        var htmlView = new HtmlView();
        var eventRaised = false;
        htmlView.StyleChanged += (_, _) => eventRaised = true;

        // Act
        htmlView.FontFactor = 1.5;

        // Assert
        eventRaised.Should().BeTrue();
    }

    [Fact]
    public void StyleChanged_ShouldBeRaisedWhenTextAlignmentChanges()
    {
        // Arrange
        var htmlView = new HtmlView();
        var eventRaised = false;
        htmlView.StyleChanged += (_, _) => eventRaised = true;

        // Act
        htmlView.TextAlignment = HtmlTextAlignment.Justify;

        // Assert
        eventRaised.Should().BeTrue();
    }

    [Fact]
    public void StyleChanged_ShouldBeRaisedWhenTextDirectionChanges()
    {
        // Arrange
        var htmlView = new HtmlView();
        var eventRaised = false;
        htmlView.StyleChanged += (_, _) => eventRaised = true;

        // Act
        htmlView.TextDirection = HtmlTextDirection.Rtl;

        // Assert
        eventRaised.Should().BeTrue();
    }

    [Fact]
    public void StyleChanged_ShouldBeRaisedWhenLineHeightChanges()
    {
        // Arrange
        var htmlView = new HtmlView();
        var eventRaised = false;
        htmlView.StyleChanged += (_, _) => eventRaised = true;

        // Act
        htmlView.LineHeight = 2.0;

        // Assert
        eventRaised.Should().BeTrue();
    }

    [Fact]
    public void StyleChanged_ShouldBeRaisedWhenH1MultiplierChanges()
    {
        // Arrange
        var htmlView = new HtmlView();
        var eventRaised = false;
        htmlView.StyleChanged += (_, _) => eventRaised = true;

        // Act
        htmlView.H1FontSizeMultiplier = 1.5;

        // Assert
        eventRaised.Should().BeTrue();
    }

    [Fact]
    public void LinkTapped_ShouldBeRaisedWithCorrectUrl()
    {
        // Arrange
        var htmlView = new HtmlView();
        string? tappedUrl = null;
        htmlView.LinkTapped += (_, args) => tappedUrl = args.Url;

        // Act
        htmlView.RaiseLinkTapped("https://example.com/article/123");

        // Assert
        tappedUrl.Should().Be("https://example.com/article/123");
    }

    [Fact]
    public void LinkTapped_HandledPropertyShouldDefaultToFalse()
    {
        // Arrange
        var htmlView = new HtmlView();
        bool? handled = null;
        htmlView.LinkTapped += (_, args) => handled = args.Handled;

        // Act
        htmlView.RaiseLinkTapped("https://example.com");

        // Assert
        handled.Should().BeFalse();
    }

    [Fact]
    public void LinkTapped_ShouldAllowSettingHandled()
    {
        // Arrange
        var htmlView = new HtmlView();
        LinkTappedEventArgs? eventArgs = null;
        htmlView.LinkTapped += (_, args) =>
        {
            args.Handled = true;
            eventArgs = args;
        };

        // Act
        htmlView.RaiseLinkTapped("https://example.com");

        // Assert
        eventArgs.Should().NotBeNull();
        eventArgs!.Handled.Should().BeTrue();
    }

    #endregion

    #region Property Binding Tests

    [Fact]
    public void Properties_ShouldBeBindable()
    {
        // Arrange & Act
        var htmlView = new HtmlView
        {
            HtmlContent = "<h1>Title</h1><p>Content</p>",
            FontSize = 18,
            FontFactor = 1.2,
            TextAlignment = HtmlTextAlignment.Justify,
            TextDirection = HtmlTextDirection.Rtl,
            LineHeight = 1.8,
            H1FontSizeMultiplier = 1.3,
            H2FontSizeMultiplier = 1.15,
            H3FontSizeMultiplier = 1.0
        };

        // Assert
        htmlView.HtmlContent.Should().Be("<h1>Title</h1><p>Content</p>");
        htmlView.FontSize.Should().Be(18);
        htmlView.FontFactor.Should().Be(1.2);
        htmlView.TextAlignment.Should().Be(HtmlTextAlignment.Justify);
        htmlView.TextDirection.Should().Be(HtmlTextDirection.Rtl);
        htmlView.LineHeight.Should().Be(1.8);
        htmlView.H1FontSizeMultiplier.Should().Be(1.3);
        htmlView.H2FontSizeMultiplier.Should().Be(1.15);
        htmlView.H3FontSizeMultiplier.Should().Be(1.0);
    }

    #endregion
}
