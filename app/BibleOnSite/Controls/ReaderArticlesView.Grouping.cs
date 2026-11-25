using System.Collections;

namespace BibleOnSite.Controls;

public partial class ReaderArticlesView
{
    /// <summary>
    /// iOS emits a section supplementary view whenever a group template is
    /// present; resolving it calls IItemsViewSource.Group, which throws
    /// "IItemsViewSource is empty" on an empty source and crashes the layout
    /// pass (parasha reader crash in the mobile e2e, #3752). The group header
    /// template may only be applied while a grouped, non-empty source can
    /// serve it — flat or empty sources keep the untitled look.
    /// </summary>
    internal static bool ServesGroupHeaders(bool isGrouped, IEnumerable? itemsSource) =>
        isGrouped && itemsSource?.GetEnumerator().MoveNext() == true;
}
