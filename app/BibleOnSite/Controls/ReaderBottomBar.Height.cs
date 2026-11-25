using BibleOnSite.Config;

namespace BibleOnSite.Controls;

public partial class ReaderBottomBar
{
    /// <summary>Height of the bar before the safe-area inset is added.</summary>
    public static double TotalHeight => HomeUxPreview.Enabled ? 108 : 90;
}
