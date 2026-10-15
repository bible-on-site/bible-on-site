using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// הסתר שם השם — matcher + replacement tests use explicit options so they never
/// touch ambient state. Ambient tests (Pasuk.FormattedText / tikkun builder /
/// view-model revision) live in the serialized preferences collection and wrap
/// mutations in <see cref="DivineNameMasking.Scope"/>, which restores the
/// previous options on Dispose.
/// </summary>
public class DivineNameMaskingTests
{
    private static DivineNameMaskingOptions Enabled(
        DivineNameMaskOption elohim = DivineNameMaskOption.Hyphen,
        DivineNameMaskOption yhwh = DivineNameMaskOption.Heh,
        DivineNameMaskOption el = DivineNameMaskOption.Hyphen,
        DivineNameMaskOption shaddai = DivineNameMaskOption.Hyphen,
        string elohimCustom = "",
        string yhwhCustom = "",
        string shaddaiCustom = "") => new(
        Enabled: true,
        Elohim: elohim, ElohimCustom: elohimCustom,
        Yhwh: yhwh, YhwhCustom: yhwhCustom,
        El: el,
        Shaddai: shaddai, ShaddaiCustom: shaddaiCustom);

    public class MaskValue
    {
        [Fact]
        public void returns_every_name_form_unchanged_when_disabled()
        {
            foreach (var value in new[] { "יְהוָ֑ה", "אֱלֹהִ֑ים", "אֵ֑ל", "שַׁדַּ֥י" })
            {
                DivineNameMasking.MaskValue(value, DivineNameMaskingOptions.Disabled)
                    .Should().Be(value);
            }
        }

        [Theory]
        [InlineData("יְהוָ֑ה", "ה'")]
        [InlineData("יהוה", "ה'")]
        [InlineData("בַּֽיהוָ֔ה", "בה'")]
        [InlineData("וַֽיהוָ֖ה", "וה'")]
        [InlineData("לַ֭יהוָה", "לה'")]
        [InlineData("וּבַֽיהוָ֔ה", "ובה'")]
        public void masks_yhwh_as_heh(string value, string expected) =>
            DivineNameMasking.MaskValue(value, Enabled()).Should().Be(expected);

        [Fact]
        public void masks_yhwh_as_dalet_when_chosen() =>
            DivineNameMasking.MaskValue("יְהוָ֑ה", Enabled(yhwh: DivineNameMaskOption.Dalet))
                .Should().Be("ד'");

        [Fact]
        public void masks_yhwh_with_the_custom_text_when_chosen() =>
            DivineNameMasking.MaskValue("וַֽיהוָ֖ה",
                    Enabled(yhwh: DivineNameMaskOption.Custom, yhwhCustom: "השם"))
                .Should().Be("והשם");

        [Fact]
        public void keeps_yhwh_untouched_when_custom_text_is_blank() =>
            DivineNameMasking.MaskValue("יְהוָ֑ה",
                    Enabled(yhwh: DivineNameMaskOption.Custom, yhwhCustom: "  "))
                .Should().Be("יְהוָ֑ה");

        [Fact]
        public void reappends_trailing_paseq_and_maqaf()
        {
            var s = Enabled();
            DivineNameMasking.MaskValue("יְהוָ֣ה ׀", s).Should().Be("ה' ׀");
            DivineNameMasking.MaskValue("יְהוָה־", s).Should().Be("ה'־");
        }

        [Fact]
        public void leaves_other_yhwh_like_words_alone()
        {
            var s = Enabled();
            foreach (var value in new[] { "יְהוֹשֻׁ֑עַ", "יְהוֹרָ֥ם" })
            {
                DivineNameMasking.MaskValue(value, s).Should().Be(value);
            }
        }

        [Theory]
        [InlineData("אֱלֹהִ֑ים", "א-להים")]
        [InlineData("אֱלֹהֵ֗ינוּ", "א-להינו")]
        [InlineData("אֱלֹהֶֽיךָ", "א-להיך")]
        [InlineData("אֱלֹהַ֔י", "א-להי")]
        [InlineData("וְאֱלֹהִ֖ים", "וא-להים")]
        [InlineData("לֵֽאלֹהִ֑ים", "לא-להים")]
        [InlineData("מֵהָאֱלֹהִים֙", "מהא-להים")]
        [InlineData("אֱלָהָ֔א", "א-להא")]
        [InlineData("אֱלָהֲה֔וֹן", "א-לההון")]
        [InlineData("אֱלָהֲךְ֙", "א-להך")]
        [InlineData("אֱלֹהִים־", "א-להים־")]
        public void masks_the_elohim_family_with_a_hyphen(string value, string expected) =>
            DivineNameMasking.MaskValue(value, Enabled()).Should().Be(expected);

        [Theory]
        [InlineData("אֱלֹהִ֑ים", "אלקים")]
        [InlineData("אֱלֹהֵ֗ינוּ", "אלקינו")]
        [InlineData("אֱלֹהַ֔י", "אלקי")]
        [InlineData("אֱלוֹהַ֥", "אלוקה")]
        [InlineData("אֱלֹהֵיהֶ֑ם", "אלקיהם")]
        [InlineData("בֵּאלֹהִ֖ים", "באלקים")]
        public void masks_the_elohim_family_as_elokim(string value, string expected) =>
            DivineNameMasking.MaskValue(value, Enabled(elohim: DivineNameMaskOption.Elokim))
                .Should().Be(expected);

        [Fact]
        public void keeps_elohim_as_is_when_chosen() =>
            DivineNameMasking.MaskValue("אֱלֹהִ֑ים", Enabled(elohim: DivineNameMaskOption.AsIs))
                .Should().Be("אֱלֹהִ֑ים");

        [Fact]
        public void applies_elohim_custom_text_to_the_stem_keeping_prefix_and_suffix() =>
            DivineNameMasking.MaskValue("וְאֱלֹהֵינוּ֙",
                    Enabled(elohim: DivineNameMaskOption.Custom, elohimCustom: "אלופו"))
                .Should().Be("ואלופונו");

        [Fact]
        public void leaves_ele_lookalikes_alone()
        {
            var s = Enabled();
            foreach (var value in new[] { "אֵ֣לֶּה", "אֲלֵהֶ֗ם", "אֲלֵהֶ֜ן", "אֵ֥לּוּ" })
            {
                DivineNameMasking.MaskValue(value, s).Should().Be(value);
            }
        }

        [Theory]
        [InlineData("אֵ֑ל", "א-ל")]
        [InlineData("לְאֵ֖ל", "לא-ל")]
        [InlineData("מֵאֵ֣ל", "מא-ל")]
        [InlineData("הָאֵ֤ל", "הא-ל")]
        [InlineData("וְהָאֵל֙", "והא-ל")]
        [InlineData("בְּאֵ֣ל", "בא-ל")]
        [InlineData("אֵל־", "א-ל־")]
        public void masks_el_with_a_hyphen(string value, string expected) =>
            DivineNameMasking.MaskValue(value, Enabled()).Should().Be(expected);

        [Fact]
        public void masks_unpointed_el_documented_ambiguity() =>
            DivineNameMasking.MaskValue("אל", Enabled()).Should().Be("א-ל");

        [Theory]
        [InlineData("אֶ֖ל")]
        [InlineData("אַ֣ל")]
        [InlineData("אֲלֵהֶ֗ם")]
        [InlineData("וְאֶל־")]
        [InlineData("הֹאֶ֖ל")]
        [InlineData("שְׁאֵ֔ל")]
        [InlineData("שְׁמוּאֵ֑ל")]
        [InlineData("דָּנִיֵּ֔אל")]
        [InlineData("יִשְׂרָאֵֽל")]
        [InlineData("יִשָּׂאֵ֥ל")]
        [InlineData("דָּנָאֵ֖ל")]
        public void leaves_pointed_non_name_words_alone(string value) =>
            DivineNameMasking.MaskValue(value, Enabled()).Should().Be(value);

        [Fact]
        public void leaves_el_as_is_when_chosen() =>
            DivineNameMasking.MaskValue("אֵ֑ל", Enabled(el: DivineNameMaskOption.AsIs))
                .Should().Be("אֵ֑ל");

        [Theory]
        [InlineData("שַׁדַּ֥י", "שד-י")]
        [InlineData("וְשַׁדַּ֖י", "ושד-י")]
        [InlineData("שדי", "שד-י")]
        public void masks_shaddai_with_a_hyphen(string value, string expected) =>
            DivineNameMasking.MaskValue(value, Enabled()).Should().Be(expected);

        [Theory]
        [InlineData("שְׂדֵ֖י")]
        [InlineData("שָׂדַ֖י")]
        [InlineData("בִּשְׂדֵ֖י")]
        [InlineData("שָׁדַ֖י")]
        public void leaves_sin_field_forms_alone(string value) =>
            DivineNameMasking.MaskValue(value, Enabled()).Should().Be(value);

        [Fact]
        public void masks_shaddai_with_custom_text_when_chosen() =>
            DivineNameMasking.MaskValue("לְשַׁדַּ֥י",
                    Enabled(shaddai: DivineNameMaskOption.Custom, shaddaiCustom: "אל שדי"))
                .Should().Be("לאל שדי");

        [Fact]
        public void keeps_shaddai_as_is_when_chosen() =>
            DivineNameMasking.MaskValue("שַׁדַּ֥י", Enabled(shaddai: DivineNameMaskOption.AsIs))
                .Should().Be("שַׁדַּ֥י");

        [Fact]
        public void masks_el_when_its_only_mark_is_not_niqqud()
        {
            // רפה (U+05BF) is not a vowel point — like unpointed אל it still
            // reads as the name.
            DivineNameMasking.MaskValue("אֿל", Enabled())
                .Should().Be("א-ל");
        }

        [Fact]
        public void never_leaves_orphaned_combining_marks()
        {
            var s = Enabled();
            foreach (var value in new[] { "יְהוָ֣ה ׀", "מֵהָאֱלֹהִים֙", "וְהָאֵ֤ל", "לְשַׁדַּ֥י" })
            {
                var masked = DivineNameMasking.MaskValue(value, s);
                masked.Normalize(System.Text.NormalizationForm.FormD)
                    .Should().NotMatchRegex("[\\p{Mn}\\p{Mc}]");
            }
        }

        [Fact]
        public void does_not_touch_parsha_markers_or_non_hebrew_text()
        {
            var s = Enabled();
            foreach (var value in new[] { "פ", "ס", "׀", "12:34", "" })
            {
                DivineNameMasking.MaskValue(value, s).Should().Be(value);
            }
        }

        [Fact]
        public void leaves_words_with_non_hebrew_body_characters_alone()
        {
            var s = Enabled();
            foreach (var value in new[] { "אcב", "א1ב" })
            {
                DivineNameMasking.MaskValue(value, s).Should().Be(value);
            }
        }

        [Fact]
        public void leaves_a_word_that_starts_with_a_combining_mark_alone() =>
            DivineNameMasking.MaskValue("ְאל", Enabled()).Should().Be("ְאל");

        [Fact]
        public void leaves_el_whose_aleph_carries_qamats_qatan_alone() =>
            DivineNameMasking.MaskValue("אׇל", Enabled()).Should().Be("אׇל");

        [Fact]
        public void keeps_elohim_untouched_when_the_custom_text_is_blank() =>
            DivineNameMasking.MaskValue("אֱלֹהִ֑ים",
                    Enabled(elohim: DivineNameMaskOption.Custom, elohimCustom: "  "))
                .Should().Be("אֱלֹהִ֑ים");

        [Fact]
        public void keeps_shaddai_untouched_when_the_custom_text_is_blank() =>
            DivineNameMasking.MaskValue("שַׁדַּ֥י",
                    Enabled(shaddai: DivineNameMaskOption.Custom, shaddaiCustom: ""))
                .Should().Be("שַׁדַּ֥י");

        [Fact]
        public void keeps_yhwh_untouched_for_a_non_yhwh_option_value() =>
            // An out-of-set option falls through to the custom-text arm; a blank
            // stored custom leaves the word untouched (service normalizes to
            // prevent this in practice).
            DivineNameMasking.MaskValue("יְהוָ֑ה",
                    Enabled(yhwh: DivineNameMaskOption.AsIs))
                .Should().Be("יְהוָ֑ה");

        [Fact]
        public void tolerates_null_input() =>
            DivineNameMasking.MaskValue(null, Enabled()).Should().BeEmpty();
    }

    public class MaskText
    {
        [Fact]
        public void masks_every_divine_name_word_in_a_pasuk_string() =>
            DivineNameMasking.MaskText(
                    "וַיִּשְׁמַ֤ע יְהוָה֙ וַיִּתְאַנַּ֥ף בְּיִשְׂרָאֵ֑ל", Enabled())
                .Should().Be("וַיִּשְׁמַ֤ע ה' וַיִּתְאַנַּ֥ף בְּיִשְׂרָאֵ֑ל");

        [Fact]
        public void handles_maqaf_joined_compounds_word_by_word() =>
            DivineNameMasking.MaskText("יְהוָה־אֱלֹהֵינוּ֙", Enabled())
                .Should().Be("ה'־א-להינו");

        [Fact]
        public void returns_text_unchanged_when_disabled() =>
            DivineNameMasking.MaskText("יְהוָ֑ה אֱלֹהִ֖ים", DivineNameMaskingOptions.Disabled)
                .Should().Be("יְהוָ֑ה אֱלֹהִ֖ים");

        [Fact]
        public void tolerates_null_input() =>
            DivineNameMasking.MaskText(null, Enabled()).Should().BeEmpty();

        [Theory]
        [InlineData("אֱלֹהִ֑ים  שַׁדַּ֥י", "א-להים  שד-י")]
        [InlineData("אֱלֹהִ֑ים ", "א-להים ")]
        [InlineData(" ", " ")]
        public void keeps_consecutive_and_trailing_separators_intact(string text, string expected) =>
            DivineNameMasking.MaskText(text, Enabled()).Should().Be(expected);
    }

    [Collection(PreferencesServiceCollection.Name)]
    public class AmbientState
    {
        [Fact]
        public void apply_bumps_revision_only_on_change()
        {
            var revision = DivineNameMasking.Revision;
            var options = Enabled();
            try
            {
                DivineNameMasking.Apply(options);
                DivineNameMasking.Revision.Should().Be(revision + 1);

                // Same options again — no bump.
                DivineNameMasking.Apply(options);
                DivineNameMasking.Revision.Should().Be(revision + 1);
            }
            finally
            {
                DivineNameMasking.Apply(DivineNameMaskingOptions.Disabled);
            }
        }

        [Fact]
        public void scope_restores_previous_options_on_dispose()
        {
            using (DivineNameMasking.Scope(Enabled()))
            {
                DivineNameMasking.Current.Enabled.Should().BeTrue();
                DivineNameMasking.MaskValue("יְהוָ֑ה").Should().Be("ה'");
            }

            DivineNameMasking.Current.Enabled.Should().BeFalse();
            DivineNameMasking.MaskValue("יְהוָ֑ה").Should().Be("יְהוָ֑ה");
        }
    }

    /// <summary>
    /// FormattedText / tikkun-builder tests that require ambient masking state.
    /// Serialized against the other PreferencesService singleton tests; existing
    /// ambient-sensitive suites contain no divine-name segment values.
    /// </summary>
    [Collection(PreferencesServiceCollection.Name)]
    public class Rendering : IDisposable
    {
        public void Dispose()
        {
            // Service setters publish ambient options — always restore disabled
            // so no state leaks to other collections.
            DivineNameMasking.Apply(DivineNameMaskingOptions.Disabled);
        }

        private static Pasuk PasukOf(params PasukSegment[] segments) => new()
        {
            PasukNum = 1,
            Text = string.Join(' ', segments.Select(s => s.Value)),
            Segments = [.. segments]
        };

        private static string Flatten(FormattedString formatted) =>
            string.Concat(formatted.Spans.Select(s => s.Text));

        [Fact]
        public void formatted_text_masks_divine_names_while_segments_stay_canonical()
        {
            var pasuk = PasukOf(
                new PasukSegment { Type = SegmentType.Qri, Value = "וַיִּשְׁמַ֤ע" },
                new PasukSegment { Type = SegmentType.Qri, Value = "יְהוָה֙" },
                new PasukSegment { Type = SegmentType.Qri, Value = "אֱלֹהֵ֖ינוּ" });

            using (DivineNameMasking.Scope(Enabled()))
            {
                Flatten(pasuk.FormattedText).Should().Be("וַיִּשְׁמַ֤ע ה' א-להינו");
            }

            pasuk.Segments.Select(s => s.Value)
                .Should().Equal("וַיִּשְׁמַ֤ע", "יְהוָה֙", "אֱלֹהֵ֖ינוּ");
            pasuk.Text.Should().Be("וַיִּשְׁמַ֤ע יְהוָה֙ אֱלֹהֵ֖ינוּ");
        }

        [Fact]
        public void formatted_text_cache_rebuilds_when_the_masking_revision_changes()
        {
            var pasuk = PasukOf(new PasukSegment { Type = SegmentType.Qri, Value = "יְהוָה֙" });

            var unmasked = pasuk.FormattedText;
            Flatten(unmasked).Should().Be("יְהוָה֙");

            using (DivineNameMasking.Scope(Enabled()))
            {
                var masked = pasuk.FormattedText;
                masked.Should().NotBeSameAs(unmasked);
                Flatten(masked).Should().Be("ה'");
            }

            // Revision restored → the original rendering comes back.
            Flatten(pasuk.FormattedText).Should().Be("יְהוָה֙");
        }

        [Fact]
        public void formatted_text_masks_the_ktiv_and_the_qri_variant_note()
        {
            var pasuk = PasukOf(
                new PasukSegment { Type = SegmentType.Ktiv, Value = "יְהוָ֔ה", PairedOffset = 1 },
                new PasukSegment { Type = SegmentType.Qri, Value = "אֱלֹהִ֔ים", PairedOffset = -1 });

            using (DivineNameMasking.Scope(Enabled()))
            {
                Flatten(pasuk.FormattedText).Should().Be("ה' (קְרִי: א-להים)");
            }
        }

        [Fact]
        public void formatted_text_masks_each_word_of_a_multi_word_qri_segment()
        {
            // Bracketed qri text arrives as one segment holding several words —
            // MaskText handles each word; single-word MaskValue would skip it.
            var pasuk = PasukOf(
                new PasukSegment { Type = SegmentType.Ktiv, Value = "יְהוָ֔ה", PairedOffset = 1 },
                new PasukSegment { Type = SegmentType.Qri, Value = "יְהוָה אֱלֹהִים", PairedOffset = -1 });

            using (DivineNameMasking.Scope(Enabled()))
            {
                Flatten(pasuk.FormattedText).Should().Be("ה' (קְרִי: ה' א-להים)");
            }
        }

        [Fact]
        public void reciting_highlight_span_uses_the_masked_text()
        {
            var pasuk = PasukOf(
                new PasukSegment { Type = SegmentType.Qri, Value = "א" },
                new PasukSegment { Type = SegmentType.Qri, Value = "יְהוָ֑ה" });

            using (DivineNameMasking.Scope(Enabled()))
            {
                pasuk.RecitingSegment = 2;
                var highlighted = pasuk.FormattedText.Spans.Single(s => s.BackgroundColor != null);
                highlighted.Text.Should().Be("ה'");
                // The recitation index itself is untouched.
                pasuk.RecitingSegment.Should().Be(2);
            }
        }

        [Fact]
        public void tikkun_words_mask_names_and_survive_hide_marks()
        {
            var pesukim = new List<Pasuk>
            {
                PasukOf(
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "יְהוָ֑ה" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "אֱלֹהִ֖ים" })
            };

            using (DivineNameMasking.Scope(Enabled()))
            {
                TikkunKorimTextBuilder.BuildWords(pesukim, false, false)
                    .Select(w => w.Text).Should().Equal("א", "ה'", "א-להים");
                // hideMarks is a no-op on masked words (they carry no marks).
                TikkunKorimTextBuilder.BuildWords(pesukim, false, true)
                    .Select(w => w.Text).Should().Equal("א", "ה'", "א-להים");
            }
        }

        [Fact]
        public void perek_view_model_toggle_persists_and_bumps_the_masking_revision()
        {
            var storage = new InMemoryPreferencesStorage();
            var service = PreferencesService.CreateForTesting(storage);
            service.Load();
            var viewModel = new PerekViewModel(service, null, null, null, null, null, null, null);
            var revision = viewModel.DivineNameMaskingRevision;
            viewModel.DivineNameMaskingEnabled.Should().BeFalse();

            viewModel.DivineNameMaskingEnabled = true;

            viewModel.DivineNameMaskingEnabled.Should().BeTrue();
            viewModel.DivineNameMaskingRevision.Should().Be(revision + 1);
            storage.Get("divineNameMaskingEnabled", false).Should().BeTrue();
        }

        [Fact]
        public void perek_view_model_revision_bumps_when_a_mask_option_changes()
        {
            var storage = new InMemoryPreferencesStorage();
            var service = PreferencesService.CreateForTesting(storage);
            service.Load();
            var viewModel = new PerekViewModel(service, null, null, null, null, null, null, null);
            var revision = viewModel.DivineNameMaskingRevision;

            service.DivineNameMaskYhwh = DivineNameMaskOption.Dalet;

            viewModel.DivineNameMaskingRevision.Should().Be(revision + 1);
        }
    }

    /// <summary>
    /// PreferencesService persistence/normalization for the masking settings.
    /// </summary>
    [Collection(PreferencesServiceCollection.Name)]
    public class Preferences : IDisposable
    {
        private readonly InMemoryPreferencesStorage _storage = new();
        private readonly PreferencesService _service;

        public Preferences()
        {
            _service = PreferencesService.CreateForTesting(_storage);
        }

        public void Dispose()
        {
            DivineNameMasking.Apply(DivineNameMaskingOptions.Disabled);
        }

        [Fact]
        public void defaults_to_disabled_with_the_documented_per_name_defaults()
        {
            _service.Load();

            _service.DivineNameMaskingEnabled.Should().BeFalse();
            _service.DivineNameMaskElohim.Should().Be(DivineNameMaskOption.Hyphen);
            _service.DivineNameMaskYhwh.Should().Be(DivineNameMaskOption.Heh);
            _service.DivineNameMaskEl.Should().Be(DivineNameMaskOption.AsIs);
            _service.DivineNameMaskShaddai.Should().Be(DivineNameMaskOption.AsIs);
            _service.GetDivineNameMaskingOptions().Enabled.Should().BeFalse();
        }

        [Fact]
        public void choices_persist_across_service_reloads()
        {
            _service.Load();
            _service.DivineNameMaskingEnabled = true;
            _service.DivineNameMaskElohim = DivineNameMaskOption.Elokim;
            _service.DivineNameMaskElohimCustom = "אלופו";
            _service.DivineNameMaskYhwh = DivineNameMaskOption.Dalet;
            _service.DivineNameMaskYhwhCustom = "השם";
            _service.DivineNameMaskEl = DivineNameMaskOption.Hyphen;
            _service.DivineNameMaskShaddai = DivineNameMaskOption.Custom;
            _service.DivineNameMaskShaddaiCustom = "אל שדי";

            var restored = PreferencesService.CreateForTesting(_storage);
            restored.Load();

            restored.DivineNameMaskingEnabled.Should().BeTrue();
            restored.DivineNameMaskElohim.Should().Be(DivineNameMaskOption.Elokim);
            restored.DivineNameMaskElohimCustom.Should().Be("אלופו");
            restored.DivineNameMaskYhwh.Should().Be(DivineNameMaskOption.Dalet);
            restored.DivineNameMaskYhwhCustom.Should().Be("השם");
            restored.DivineNameMaskEl.Should().Be(DivineNameMaskOption.Hyphen);
            restored.DivineNameMaskShaddai.Should().Be(DivineNameMaskOption.Custom);
            restored.DivineNameMaskShaddaiCustom.Should().Be("אל שדי");
        }

        [Fact]
        public void out_of_set_stored_options_fall_back_to_the_default()
        {
            // יהוה has no "asis"; אל has no "custom" — invalid stored values normalize.
            _storage.Set("divineNameMaskYhwh", "asis");
            _storage.Set("divineNameMaskEl", "custom");
            _storage.Set("divineNameMaskElohim", "nonsense");

            _service.Load();

            _service.DivineNameMaskYhwh.Should().Be(DivineNameMaskOption.Heh);
            _service.DivineNameMaskEl.Should().Be(DivineNameMaskOption.AsIs);
            _service.DivineNameMaskElohim.Should().Be(DivineNameMaskOption.Hyphen);
        }

        [Fact]
        public void an_out_of_set_value_set_programmatically_falls_back()
        {
            _service.Load();
            _service.DivineNameMaskYhwh = DivineNameMaskOption.Dalet;
            _service.DivineNameMaskYhwh = DivineNameMaskOption.AsIs;

            _service.DivineNameMaskYhwh.Should().Be(DivineNameMaskOption.Heh);
            _storage.Get("divineNameMaskYhwh", "").Should().Be("heh");
        }

        [Fact]
        public void custom_text_is_trimmed_and_capped()
        {
            _service.Load();
            _service.DivineNameMaskYhwhCustom = "  השם  ";
            _service.DivineNameMaskYhwhCustom.Should().Be("השם");

            _service.DivineNameMaskYhwhCustom = new string('א', 100);
            _service.DivineNameMaskYhwhCustom.Should().HaveLength(40);
        }

        [Fact]
        public void masking_changes_raise_preferences_changed_and_apply_globally()
        {
            _service.Load();
            var eventCount = 0;
            _service.PreferencesChanged += (_, _) => eventCount++;

            _service.DivineNameMaskingEnabled = true;

            eventCount.Should().Be(1);
            DivineNameMasking.Current.Enabled.Should().BeTrue();
            DivineNameMasking.MaskValue("יְהוָ֑ה").Should().Be("ה'");
        }

        [Fact]
        public void unchanged_values_do_not_raise_preferences_changed()
        {
            _service.Load();
            var eventCount = 0;
            _service.PreferencesChanged += (_, _) => eventCount++;

            _service.DivineNameMaskingEnabled = false; // already default
            _service.DivineNameMaskElohim = DivineNameMaskOption.Hyphen; // already default

            eventCount.Should().Be(0);
        }

        [Fact]
        public void switching_an_option_back_to_as_is_persists_the_name()
        {
            _service.Load();
            _service.DivineNameMaskEl = DivineNameMaskOption.Hyphen;

            _service.DivineNameMaskEl = DivineNameMaskOption.AsIs;

            _service.DivineNameMaskEl.Should().Be(DivineNameMaskOption.AsIs);
            _storage.Get("divineNameMaskEl", "").Should().Be("asis");
        }

        [Fact]
        public void a_null_custom_text_normalizes_to_empty_and_is_a_no_op()
        {
            _service.Load();
            var eventCount = 0;
            _service.PreferencesChanged += (_, _) => eventCount++;

            _service.DivineNameMaskYhwhCustom = null!;

            _service.DivineNameMaskYhwhCustom.Should().BeEmpty();
            eventCount.Should().Be(0, "an unchanged normalized value must not notify");
        }

        [Fact]
        public void setting_the_same_custom_text_again_does_not_notify()
        {
            _service.Load();
            _service.DivineNameMaskShaddaiCustom = "אל שדי";
            var eventCount = 0;
            _service.PreferencesChanged += (_, _) => eventCount++;

            _service.DivineNameMaskShaddaiCustom = " אל שדי "; // trims to the stored value

            eventCount.Should().Be(0);
            _storage.Get("divineNameMaskShaddaiCustom", "").Should().Be("אל שדי");
        }

        [Fact]
        public void load_publishes_a_stored_enabled_state_to_renderers()
        {
            _storage.Set("divineNameMaskingEnabled", true);
            _storage.Set("divineNameMaskElohim", "elokim");

            _service.Load();

            DivineNameMasking.Current.Should().BeEquivalentTo(_service.GetDivineNameMaskingOptions());
            DivineNameMasking.MaskValue("אֱלֹהִ֑ים").Should().Be("אלקים");
        }
    }
}
