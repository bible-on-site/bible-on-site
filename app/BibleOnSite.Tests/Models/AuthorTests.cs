using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class AuthorTests
{
    [Fact]
    public void SystemId_ShouldBe99()
    {
        Author.SystemId.Should().Be(99);
    }

    [Fact]
    public void ImageUrl_ShouldBeCorrectlyFormatted()
    {
        var author = new Author
        {
            Id = 42,
            Name = "הרב משה פיינשטיין",
            Details = "פוסק הדור"
        };

        author.ImageUrl.Should().Be("https://bible-on-site-assets.s3.il-central-1.amazonaws.com/authors/high-res/42.jpg");
    }

    [Fact]
    public void ImageUrl_WithDifferentId_ShouldReflectId()
    {
        var author = new Author
        {
            Id = 1,
            Name = "Test",
            Details = "Test"
        };

        author.ImageUrl.Should().Contain("/1.jpg");

        author.Id = 999;
        author.ImageUrl.Should().Contain("/999.jpg");
    }

    #region ShortenedName Tests

    [Fact]
    public void ShortenedName_WithTwoWords_ShouldReturnBothWords()
    {
        var author = new Author
        {
            Id = 1,
            Name = "הרב כהנא",
            Details = "Test"
        };

        author.ShortenedName.Should().Be("הרב כהנא");
    }

    [Fact]
    public void ShortenedName_WithMoreThanTwoWords_ShouldReturnFirstTwoWords()
    {
        var author = new Author
        {
            Id = 1,
            Name = "הרב משה בן מימון הרמב\"ם",
            Details = "Test"
        };

        author.ShortenedName.Should().Be("הרב משה");
    }

    [Fact]
    public void ShortenedName_WithOneWord_ShouldReturnTheWord()
    {
        var author = new Author
        {
            Id = 1,
            Name = "רש\"י",
            Details = "Test"
        };

        author.ShortenedName.Should().Be("רש\"י");
    }

    [Fact]
    public void ShortenedName_WithEmptyName_ShouldReturnEmpty()
    {
        var author = new Author
        {
            Id = 1,
            Name = "",
            Details = "Test"
        };

        author.ShortenedName.Should().BeEmpty();
    }

    [Fact]
    public void ShortenedName_WithMultipleSpaces_ShouldHandleCorrectly()
    {
        var author = new Author
        {
            Id = 1,
            Name = "הרב   משה   פיינשטיין",
            Details = "Test"
        };

        // Should handle multiple spaces by splitting on whitespace
        author.ShortenedName.Should().Be("הרב משה");
    }

    #endregion

    [Fact]
    public void ArticlesCount_ShouldBeSettable()
    {
        var author = new Author
        {
            Id = 1,
            Name = "Test",
            Details = "Test",
            ArticlesCount = 25
        };

        author.ArticlesCount.Should().Be(25);
    }
}
