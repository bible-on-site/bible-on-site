using BibleOnSite.Controls;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds a screen-reader name for an activatable container from the text
/// inside it (#3252). Rows converted from the
/// Grid/Border + TapGestureRecognizer pattern to <see cref="TappableView"/>
/// keep carrying <see cref="SemanticProperties.Description"/> where one was
/// authored; the rest (chips, links, cards, calendar cells) get a name the
/// platform layer composes from their own visible labels — mirroring what
/// ListItemAutomationNames does for CollectionView rows on Windows.
/// </summary>
public static class AccessibleContentText
{
	/// <summary>
	/// Joins the element tree's readable text with ", ", dropping icon-font
	/// glyphs and collapsing whitespace (see <see cref="AccessibleItemText"/>).
	/// </summary>
	public static string ComposeName(Element? root)
	{
		if (root is null)
		{
			return string.Empty;
		}

		var parts = new List<string>();
		Collect(root, parts);
		return AccessibleItemText.Compose(parts);
	}

	private static void Collect(Element node, List<string> parts)
	{
		if (node is IVisualTreeElement visual)
		{
			foreach (var child in visual.GetVisualChildren())
			{
				if (child is Element element)
				{
					CollectElement(element, parts);
				}
			}
		}
	}

	private static void CollectElement(Element element, List<string> parts)
	{
		// Nested activatable or editable elements are their own UIA
		// elements with their own names — never absorbed into the host's.
		if (element is Button or ImageButton or CheckBox or RadioButton or Switch
			or Slider or Stepper or Picker or DatePicker or TimePicker
			or InputView or SearchBar or ItemsView
			or TappableView or FlyoutMenuRow)
		{
			return;
		}

		if (element is VisualElement { IsVisible: false })
		{
			return;
		}

		var explicitName = SemanticProperties.GetDescription(element) as string;
		if (!string.IsNullOrWhiteSpace(explicitName))
		{
			// A nested element that already names itself (e.g. an icon row
			// describing its own action) reads as one part.
			parts.Add(explicitName);
			return;
		}

		if (element is Label label)
		{
			parts.Add(!string.IsNullOrEmpty(label.Text)
				? label.Text
				: label.FormattedText?.ToString() ?? string.Empty);
			return;
		}

		Collect(element, parts);
	}
}
