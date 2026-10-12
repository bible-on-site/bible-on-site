using Microsoft.Maui;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Helpers;

public static class ReaderSafeArea
{
    public static void Configure(Layout root)
    {
        // MAUI includes root in GetVisualTreeDescendants. Apply its insets last
        // so clearing nested layouts cannot put the toolbar under the status bar.
        foreach (var element in root.GetVisualTreeDescendants())
        {
            if (element is Layout layout)
            {
                layout.SafeAreaEdges = SafeAreaEdges.None;
            }
        }
        root.SafeAreaEdges = new SafeAreaEdges(
            SafeAreaRegions.None,
            SafeAreaRegions.Container,
            SafeAreaRegions.None,
            SafeAreaRegions.Container);
    }
}
