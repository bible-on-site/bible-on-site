using BibleOnSite.Data;

namespace BibleOnSite.Helpers;

public static class SearchSelectionSummary
{
    public static string Describe(IReadOnlyList<string> selected, string defaultText, bool explicitSelection)
    {
        if (!explicitSelection)
        {
            return defaultText;
        }
        return selected.Count switch
        {
            0 => "ללא בחירה",
            1 => selected[0],
            _ => $"{selected[0]} +{selected.Count - 1}"
        };
    }

    public static string Books(IReadOnlyList<(int Id, string Name)> selected, bool explicitSelection)
    {
        if (explicitSelection)
        {
            var ids = selected.Select(book => book.Id).ToHashSet();
            foreach (var group in SefarimData.SefarimGroups.Values)
            {
                if (ids.SetEquals(Enumerable.Range(group.From, group.To - group.From + 1)))
                {
                    return group.Header;
                }
            }
        }
        return Describe(selected.Select(book => book.Name).ToArray(), "היכן לחפש", explicitSelection);
    }
}
