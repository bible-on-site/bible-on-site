using BibleOnSite.Models;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// The focused-pasuk reader scopes "מה לחפש" to תוכן פסוק and תוכן פירוש only,
/// with a selection kept apart from the reader's own saved kinds (#2466).
/// </summary>
public class SearchKindsScopeTests
{
    private static readonly SearchFilter[] FocusedKinds = [SearchFilter.Pasuk, SearchFilter.Perush];

    [Fact]
    public void enter_scope_limits_options_to_the_allowed_kinds()
    {
        var viewModel = new SearchViewModel();

        viewModel.EnterKindsScope(FocusedKinds);

        viewModel.KindOptions.Should().BeEquivalentTo(FocusedKinds);
        viewModel.KindsScoped.Should().BeTrue();
    }

    [Fact]
    public void enter_scope_selects_both_allowed_kinds_by_default()
    {
        var viewModel = new SearchViewModel();

        viewModel.EnterKindsScope(FocusedKinds);

        viewModel.IsFilterEnabled(SearchFilter.Pasuk).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Perush).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Author).Should().BeFalse();
        viewModel.IsFilterEnabled(SearchFilter.Perek).Should().BeFalse();
        viewModel.IsFilterEnabled(SearchFilter.Articles).Should().BeFalse();
        viewModel.IsFilterEnabled(SearchFilter.Tanahpedia).Should().BeFalse();
    }

    [Fact]
    public void scoped_selection_does_not_touch_the_reader_kinds()
    {
        var viewModel = new SearchViewModel();
        viewModel.SetFilterEnabled(SearchFilter.Author, false);
        viewModel.SetFilterEnabled(SearchFilter.Articles, true);

        viewModel.EnterKindsScope(FocusedKinds);
        viewModel.SetFilterEnabled(SearchFilter.Perush, false);
        viewModel.ExitKindsScope();

        viewModel.IsFilterEnabled(SearchFilter.Author).Should().BeFalse();
        viewModel.IsFilterEnabled(SearchFilter.Articles).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Perush).Should().BeTrue();
        viewModel.KindsScoped.Should().BeFalse();
        viewModel.KindOptions.Should().BeEquivalentTo(Enum.GetValues<SearchFilter>());
    }

    [Fact]
    public void scoped_selection_survives_reentry_without_leaking_out()
    {
        var viewModel = new SearchViewModel();

        viewModel.EnterKindsScope(FocusedKinds);
        viewModel.SetFilterEnabled(SearchFilter.Pasuk, false);
        viewModel.ExitKindsScope();
        viewModel.EnterKindsScope(FocusedKinds);

        viewModel.IsFilterEnabled(SearchFilter.Pasuk).Should().BeFalse();
        viewModel.IsFilterEnabled(SearchFilter.Perush).Should().BeTrue();

        viewModel.ExitKindsScope();
        viewModel.IsFilterEnabled(SearchFilter.Pasuk).Should().BeTrue();
    }

    [Fact]
    public void disallowed_kind_cannot_be_enabled_while_scoped()
    {
        var viewModel = new SearchViewModel();
        viewModel.EnterKindsScope(FocusedKinds);

        viewModel.SetFilterEnabled(SearchFilter.Author, true);

        viewModel.IsFilterEnabled(SearchFilter.Author).Should().BeFalse();
    }

    [Fact]
    public void reset_to_defaults_respects_the_scope()
    {
        var viewModel = new SearchViewModel();
        viewModel.EnterKindsScope(FocusedKinds);
        viewModel.SetFilterEnabled(SearchFilter.Pasuk, false);

        viewModel.ResetFiltersToDefaults();

        viewModel.IsFilterEnabled(SearchFilter.Pasuk).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Perush).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Perek).Should().BeFalse();
    }

    [Fact]
    public void reset_to_defaults_outside_scope_restores_local_kinds()
    {
        var viewModel = new SearchViewModel();
        viewModel.SetFilterEnabled(SearchFilter.Pasuk, false);
        viewModel.SetFilterEnabled(SearchFilter.Articles, true);

        viewModel.ResetFiltersToDefaults();

        viewModel.IsFilterEnabled(SearchFilter.Pasuk).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Author).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Articles).Should().BeFalse();
    }

    [Fact]
    public void enter_scope_is_idempotent()
    {
        var viewModel = new SearchViewModel();
        viewModel.EnterKindsScope(FocusedKinds);
        viewModel.SetFilterEnabled(SearchFilter.Perush, false);

        viewModel.EnterKindsScope(FocusedKinds);

        viewModel.IsFilterEnabled(SearchFilter.Perush).Should().BeFalse();
        viewModel.KindOptions.Should().BeEquivalentTo(FocusedKinds);
    }

    [Fact]
    public void exit_scope_without_entering_is_a_no_op()
    {
        var viewModel = new SearchViewModel();

        viewModel.ExitKindsScope();

        viewModel.KindsScoped.Should().BeFalse();
        viewModel.IsFilterEnabled(SearchFilter.Pasuk).Should().BeTrue();
    }
}
