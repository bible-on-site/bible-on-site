using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class PerushNoteDisplayTests
{
    public class DisplayContent
    {
        [Fact]
        public void returns_empty_string_when_there_are_no_notes()
        {
            var display = new PerushNoteDisplay { PerushName = "רש\"י" };

            display.DisplayContent.Should().BeEmpty();
        }

        [Fact]
        public void returns_single_note_text_when_there_is_one_note()
        {
            var display = new PerushNoteDisplay
            {
                PerushName = "רש\"י",
                NoteContents = ["הערה אחת"]
            };

            display.DisplayContent.Should().Be("הערה אחת");
        }

        [Fact]
        public void joins_multiple_notes_with_single_spaces()
        {
            var display = new PerushNoteDisplay
            {
                PerushName = "רש\"י",
                NoteContents = ["א", "ב", "ג"]
            };

            display.DisplayContent.Should().Be("א ב ג");
        }
    }

    public class NoteContents
    {
        [Fact]
        public void defaults_to_empty_list()
        {
            var display = new PerushNoteDisplay { PerushName = "רש\"י" };

            display.NoteContents.Should().NotBeNull().And.BeEmpty();
        }
    }

    public class PerushName
    {
        [Fact]
        public void is_settable()
        {
            var display = new PerushNoteDisplay { PerushName = "אבן עזרא" };

            display.PerushName.Should().Be("אבן עזרא");
        }
    }
}
