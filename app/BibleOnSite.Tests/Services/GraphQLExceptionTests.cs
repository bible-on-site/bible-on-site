using BibleOnSite.Services;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

public class GraphQLExceptionTests
{
    [Fact]
    public void Constructor_WithMessage_SetsMessage()
    {
        var ex = new GraphQLException("GraphQL failed");

        ex.Message.Should().Be("GraphQL failed");
        ex.InnerException.Should().BeNull();
    }

    [Fact]
    public void Constructor_WithMessageAndInnerException_SetsMessageAndInnerException()
    {
        var inner = new InvalidOperationException("inner");

        var ex = new GraphQLException("outer", inner);

        ex.Message.Should().Be("outer");
        ex.InnerException.Should().BeSameAs(inner);
    }
}
