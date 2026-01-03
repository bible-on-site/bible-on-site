namespace BibleOnSite.Data;

/// <summary>
/// Static data about Perakim structure - number of perakim per sefer.
/// For books with additionals, the value is a dictionary mapping additional to perek count.
/// </summary>
public static class PerakimData
{
    /// <summary>
    /// Number of perakim per sefer.
    /// Simple int for regular books, Dictionary for books with additionals.
    /// Key 1/2 = א/ב for שמואל, מלכים, דברי הימים
    /// Key 70/50 = עזרא/נחמיה
    /// </summary>
    public static readonly Dictionary<int, object> PerakimOfBooks = new()
    {
        [1] = 50,   // בראשית
        [2] = 40,   // שמות
        [3] = 27,   // ויקרא
        [4] = 36,   // במדבר
        [5] = 34,   // דברים
        [6] = 24,   // יהושע
        [7] = 21,   // שופטים
        [8] = new Dictionary<int, int> { [1] = 31, [2] = 24 },  // שמואל א, ב
        [9] = new Dictionary<int, int> { [1] = 22, [2] = 25 },  // מלכים א, ב
        [10] = 66,  // ישעיהו
        [11] = 52,  // ירמיהו
        [12] = 48,  // יחזקאל
        [13] = 14,  // הושע
        [14] = 3,   // יואל
        [15] = 9,   // עמוס
        [16] = 1,   // עובדיה
        [17] = 4,   // יונה
        [18] = 7,   // מיכה
        [19] = 3,   // נחום
        [20] = 3,   // חבקוק
        [21] = 3,   // צפניה
        [22] = 2,   // חגי
        [23] = 14,  // זכריה
        [24] = 4,   // מלאכי
        [25] = 150, // תהלים
        [26] = 31,  // משלי
        [27] = 42,  // איוב
        [28] = 8,   // שיר השירים
        [29] = 4,   // רות
        [30] = 5,   // איכה
        [31] = 12,  // קהלת
        [32] = 10,  // אסתר
        [33] = 12,  // דניאל
        [34] = new Dictionary<int, int> { [70] = 10, [50] = 13 },  // עזרא (70), נחמיה (50)
        [35] = new Dictionary<int, int> { [1] = 29, [2] = 36 }     // דברי הימים א, ב
    };

    /// <summary>
    /// Total number of perakim in the 929 cycle.
    /// </summary>
    public const int TotalPerakim = 929;

    /// <summary>
    /// Gets the number of perakim for a sefer.
    /// </summary>
    /// <param name="seferId">The sefer ID.</param>
    /// <param name="additional">The additional marker for split books (optional).</param>
    /// <returns>The number of perakim, or 0 if not found.</returns>
    public static int GetPerakimCount(int seferId, int? additional = null)
    {
        if (!PerakimOfBooks.TryGetValue(seferId, out var value))
        {
            return 0;
        }

        if (value is int count)
        {
            return count;
        }

        if (value is Dictionary<int, int> additionalCounts && additional.HasValue)
        {
            return additionalCounts.TryGetValue(additional.Value, out var additionalCount)
                ? additionalCount
                : 0;
        }

        return 0;
    }
}
