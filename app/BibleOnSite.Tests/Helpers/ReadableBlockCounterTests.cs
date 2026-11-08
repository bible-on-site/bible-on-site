using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Readable-block counting that aligns stored <c>*_metric_block</c> rows
/// with rendered HTML fragments (issue #2607) — the app twin of
/// <c>htmlToReadableSegments</c>: block-boundary closes, br/hr breaks,
/// script/style removal, entity decoding and the word-free-block filter.
/// </summary>
public sealed class ReadableBlockCounterTests
{
    [Fact]
    public void Empty_And_Null_Count_Zero()
    {
        ReadableBlockCounter.Count(null).Should().Be(0);
        ReadableBlockCounter.Count("").Should().Be(0);
    }

    [Fact]
    public void PlainText_CountsAsOneBlock()
    {
        ReadableBlockCounter.Count("בְּרֵאשִׁית בָּרָא").Should().Be(1);
    }

    [Fact]
    public void Paragraphs_SplitIntoBlocks()
    {
        ReadableBlockCounter.Count("<p>א</p><p>ב</p><p>ג</p>").Should().Be(3);
    }

    [Fact]
    public void BlockCloseTags_EndSegments()
    {
        ReadableBlockCounter.Count("<div>one</div><section>two</section><h2>three</h2>").Should().Be(3);
        ReadableBlockCounter.Count("<ul><li>a</li><li>b</li></ul>").Should().Be(2);
    }

    [Fact]
    public void Br_And_Hr_BreakText()
    {
        ReadableBlockCounter.Count("א<br>ב").Should().Be(2);
        ReadableBlockCounter.Count("א<br/>ב<hr>ג").Should().Be(3);
    }

    [Fact]
    public void NestedBlocks_SplitOnlyAtCloses()
    {
        // Only a closing block tag flushes — text around a nested open tag
        // joins the inner block, matching the stored-block scanner.
        ReadableBlockCounter.Count("<div><div>א</div></div>").Should().Be(1);
        ReadableBlockCounter.Count("<div>א<div>ב</div>ג</div>").Should().Be(2);
    }

    [Fact]
    public void InlineTags_DoNotSplit()
    {
        ReadableBlockCounter.Count("<p><b>א</b> <a href='#'>ב</a> <sup>ג</sup></p>").Should().Be(1);
    }

    [Fact]
    public void ScriptsAndStyles_NeverReachASegment()
    {
        ReadableBlockCounter.Count("<p>א</p><script>var x = 'ב';</script><p>ב</p>").Should().Be(2);
        ReadableBlockCounter.Count("<style>p { color: red }</style>א").Should().Be(1);
        // Both in one fragment — each removal round picks the earliest tag.
        ReadableBlockCounter.Count("<script>s</script><style>t</style>א").Should().Be(1);
        ReadableBlockCounter.Count("<style>t</style>א<script>s</script>").Should().Be(1);
        // '<scriptx' is not a script block — its text still counts.
        ReadableBlockCounter.Count("<scriptx>א</scriptx>").Should().Be(1);
        // The shared scanners match the close by prefix ('</script' without
        // the '>'), so whitespace or a stray suffix still ends the block.
        ReadableBlockCounter.Count("א<script>x</script >").Should().Be(1);
        ReadableBlockCounter.Count("א<script>x</scriptx>").Should().Be(1);
        // Unterminated script removes to EOF.
        ReadableBlockCounter.Count("א<script").Should().Be(1);
    }

    [Fact]
    public void WordFreeSegments_AreDropped()
    {
        // Whitespace/markup-only blocks are not stored rows.
        ReadableBlockCounter.Count("<p>א</p><p>   </p><p>ב</p>").Should().Be(2);
        ReadableBlockCounter.Count("<p>&nbsp;</p><p>א</p>").Should().Be(1);
        ReadableBlockCounter.Count("<p>—</p><p>א</p>").Should().Be(1);
    }

    [Fact]
    public void Entities_DecodeInsideSegments()
    {
        ReadableBlockCounter.Count("<p>&lt;tag&gt;</p>").Should().Be(1);
        ReadableBlockCounter.Count("א&amp;ב").Should().Be(1);
        // Unknown entities stay literal — and letters inside them count.
        ReadableBlockCounter.Count("&nosuchentity;").Should().Be(1);
    }

    [Fact]
    public void NumericEntities_DecodeOrStayLiteral()
    {
        ReadableBlockCounter.Count("&#65;&#x41;").Should().Be(1);
        // Past the Unicode ceiling — the scanner keeps the entity literal.
        ReadableBlockCounter.Count("&#x110000;").Should().Be(1);
        // Far past int.MaxValue — overflow degrades to literal, never a throw.
        ReadableBlockCounter.Count("&#xFFFFFFFFF;").Should().Be(1);
    }

    [Fact]
    public void HexEntity_RequiresLowercaseX()
    {
        // The shared pattern is '#x' literally — '&#x21;' decodes to a
        // word-free '!' and drops, while '&#X21;' stays literal text whose
        // letters keep the segment.
        ReadableBlockCounter.Count("&#x21;").Should().Be(0);
        ReadableBlockCounter.Count("&#33;").Should().Be(0);
        ReadableBlockCounter.Count("&#X21;").Should().Be(1);
    }

    [Fact]
    public void MalformedEntities_StayLiteralText()
    {
        // An '&' that never closes, an empty body, and bodies outside the
        // entity shape all stay literal text inside the segment.
        ReadableBlockCounter.Count("a & b").Should().Be(1);
        ReadableBlockCounter.Count("&;").Should().Be(0);
        ReadableBlockCounter.Count("&x9;").Should().Be(1);
        ReadableBlockCounter.Count("&#x;").Should().Be(1);
        ReadableBlockCounter.Count("&#12a;").Should().Be(1);
    }

    [Fact]
    public void LiteralLessThan_StaysText()
    {
        ReadableBlockCounter.Count("1 < 2").Should().Be(1);
        // An unterminated tag at EOF stays literal text.
        ReadableBlockCounter.Count("א<tag").Should().Be(1);
    }

    [Fact]
    public void Hebrew_And_Digits_Count()
    {
        ReadableBlockCounter.Count("<p>בראשית</p><p>123</p>").Should().Be(2);
        // Niqqud/taamim carry no word char of their own.
        ReadableBlockCounter.Count("<p>ּ֑</p><p>א</p>").Should().Be(1);
    }
}
