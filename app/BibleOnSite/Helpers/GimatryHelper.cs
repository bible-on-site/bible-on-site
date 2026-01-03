namespace BibleOnSite.Helpers;

/// <summary>
/// Helper class for Hebrew numeral (Gematria) conversions.
/// Converts between numeric values and Hebrew letter representations.
/// </summary>
public static class GimatryHelper
{
    private static readonly Dictionary<char, int> LettersValues = new()
    {
        ['א'] = 1,
        ['ב'] = 2,
        ['ג'] = 3,
        ['ד'] = 4,
        ['ה'] = 5,
        ['ו'] = 6,
        ['ז'] = 7,
        ['ח'] = 8,
        ['ט'] = 9,
        ['י'] = 10,
        ['כ'] = 20,
        ['ל'] = 30,
        ['מ'] = 40,
        ['נ'] = 50,
        ['ס'] = 60,
        ['ע'] = 70,
        ['פ'] = 80,
        ['צ'] = 90,
        ['ק'] = 100,
        ['ר'] = 200,
        ['ש'] = 300,
        ['ת'] = 400,
        // Final letters (sofit) - same values as regular
        ['ך'] = 20,
        ['ם'] = 40,
        ['ן'] = 50,
        ['ף'] = 80,
        ['ץ'] = 90
    };

    private static readonly Dictionary<char, int> LettersValuesWithMantzpach = new()
    {
        ['א'] = 1,
        ['ב'] = 2,
        ['ג'] = 3,
        ['ד'] = 4,
        ['ה'] = 5,
        ['ו'] = 6,
        ['ז'] = 7,
        ['ח'] = 8,
        ['ט'] = 9,
        ['י'] = 10,
        ['כ'] = 20,
        ['ל'] = 30,
        ['מ'] = 40,
        ['נ'] = 50,
        ['ס'] = 60,
        ['ע'] = 70,
        ['פ'] = 80,
        ['צ'] = 90,
        ['ק'] = 100,
        ['ר'] = 200,
        ['ש'] = 300,
        ['ת'] = 400,
        // Final letters with special values (מנצפ"ך)
        ['ך'] = 500,
        ['ם'] = 600,
        ['ן'] = 700,
        ['ף'] = 800,
        ['ץ'] = 900
    };

    private static readonly Dictionary<int, char> ValuesToLetters;

    static GimatryHelper()
    {
        ValuesToLetters = new Dictionary<int, char>
        {
            [0] = '\0',
            [1] = 'א',
            [2] = 'ב',
            [3] = 'ג',
            [4] = 'ד',
            [5] = 'ה',
            [6] = 'ו',
            [7] = 'ז',
            [8] = 'ח',
            [9] = 'ט',
            [10] = 'י',
            [20] = 'כ',
            [30] = 'ל',
            [40] = 'מ',
            [50] = 'נ',
            [60] = 'ס',
            [70] = 'ע',
            [80] = 'פ',
            [90] = 'צ',
            [100] = 'ק',
            [200] = 'ר',
            [300] = 'ש',
            [400] = 'ת'
        };
    }

    /// <summary>
    /// Checks if a character is a Hebrew letter.
    /// </summary>
    public static bool IsHebrewLetter(char c)
    {
        return c >= 'א' && c <= 'ת';
    }

    /// <summary>
    /// Converts a Hebrew phrase to its numeric Gematria value.
    /// </summary>
    public static int ToNumber(string phrase)
    {
        int sum = 0;
        foreach (char c in phrase)
        {
            if (LettersValues.TryGetValue(c, out int value))
            {
                sum += value;
            }
        }
        return sum;
    }

    /// <summary>
    /// Converts a Hebrew phrase to its numeric Gematria value using special final letter values (מנצפ"ך).
    /// </summary>
    public static int ToNumberWithMantzpach(string phrase)
    {
        int sum = 0;
        foreach (char c in phrase)
        {
            if (LettersValuesWithMantzpach.TryGetValue(c, out int value))
            {
                sum += value;
            }
        }
        return sum;
    }

    /// <summary>
    /// Converts a number to its Hebrew letter representation.
    /// </summary>
    /// <param name="number">The number to convert (1-999 without thousands support, or higher with thousands).</param>
    /// <param name="includeThousands">Whether to include thousands representation.</param>
    /// <param name="thousandsSeparator">Separator character between thousands and the rest.</param>
    /// <returns>The Hebrew letter representation.</returns>
    public static string ToLetters(int number, bool includeThousands = false, string thousandsSeparator = "")
    {
        if (number <= 0)
        {
            return string.Empty;
        }

        var result = string.Empty;

        // Handle thousands
        if (includeThousands && number > 1000)
        {
            int alafim = (number / 1000) % 10;
            number -= alafim * 1000;
            if (ValuesToLetters.TryGetValue(alafim, out char alafimChar) && alafimChar != '\0')
            {
                result += alafimChar;
                result += thousandsSeparator;
            }
        }

        int ones = number % 10;
        int tens = (number / 10) % 10;
        int rest = number - tens * 10 - ones;

        // Handle hundreds
        if (rest >= 100)
        {
            if (rest <= 400)
            {
                if (ValuesToLetters.TryGetValue(rest, out char hundredsChar))
                {
                    result += hundredsChar;
                }
            }
            else
            {
                int tafCount = rest / 400;
                int remainder = rest % 400;
                for (int i = 0; i < tafCount; i++)
                {
                    result += 'ת';
                }
                if (remainder > 0 && ValuesToLetters.TryGetValue(remainder, out char remainderChar))
                {
                    result += remainderChar;
                }
            }
        }

        // Handle tens
        if (tens > 0 && ValuesToLetters.TryGetValue(tens * 10, out char tensChar))
        {
            result += tensChar;
        }

        // Handle ones
        if (ones > 0 && ValuesToLetters.TryGetValue(ones, out char onesChar))
        {
            result += onesChar;
        }

        // Replace יה with טו and יו with טז (avoid writing divine names)
        result = result.Replace("יה", "טו").Replace("יו", "טז");

        return result;
    }
}

/// <summary>
/// Extension methods for integer to Hebrew letter conversion.
/// </summary>
public static class GimatryExtensions
{
    /// <summary>
    /// Converts an integer to its Hebrew letter representation.
    /// </summary>
    public static string ToHebrewLetters(this int number, bool includeThousands = false, string thousandsSeparator = "")
    {
        return GimatryHelper.ToLetters(number, includeThousands, thousandsSeparator);
    }
}
