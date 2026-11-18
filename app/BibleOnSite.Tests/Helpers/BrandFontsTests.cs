using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Unit tests for <see cref="BrandFonts"/> — the shared Al Heperek UI faces
/// embedded into native article HTML.
/// </summary>
public class BrandFontsTests
{
    public class WebViewCss
    {
        [Fact]
        public void declares_all_three_ui_weights_on_one_family()
        {
            var css = BrandFonts.WebViewCss;

            css.Should().Contain("font-family:'Al Heperek Font UI'");
            css.Should().Contain("font-weight:400");
            css.Should().Contain("font-weight:600");
            css.Should().Contain("font-weight:700");
            css.Should().Contain("data:font/ttf;base64");
        }

        [Fact]
        public void is_cached_across_reads()
        {
            BrandFonts.WebViewCss.Should().BeSameAs(BrandFonts.WebViewCss);
        }
    }

    public class FontFace
    {
        [Fact]
        public void embeds_a_bundled_weight_as_a_base64_data_uri()
        {
            var face = BrandFonts.FontFace("Regular", 400);

            face.Should().StartWith("@font-face{");
            face.Should().Contain("font-weight:400");
        }

        [Fact]
        public void throws_when_the_bundled_resource_is_missing()
        {
            var act = () => BrandFonts.FontFace("NoSuchWeight", 100);

            act.Should().Throw<InvalidOperationException>()
                .WithMessage("*NoSuchWeight*");
        }
    }
}
