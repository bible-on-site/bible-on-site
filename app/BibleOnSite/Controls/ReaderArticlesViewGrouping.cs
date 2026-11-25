using System.Collections;

namespace BibleOnSite.Controls;

/// <summary>
/// Group-header policy for <see cref="ReaderArticlesView"/> (#3752). iOS
/// emits a section supplementary view whenever a group header template is
/// present; resolving it calls IItemsViewSource.Group, which throws
/// "IItemsViewSource is empty" on an empty source and crashes the layout
/// pass (parasha reader crash in the mobile e2e). The group header
/// template may only be applied while a grouped, non-empty source can
/// serve it — flat or empty sources keep the untitled look.
/// </summary>
internal static class ReaderArticlesViewGrouping
{
    internal static bool ServesGroupHeaders(bool isGrouped, IEnumerable? itemsSource) =>
        isGrouped && itemsSource?.GetEnumerator().MoveNext() == true;
}
