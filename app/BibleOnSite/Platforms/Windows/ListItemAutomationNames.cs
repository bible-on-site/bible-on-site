using BibleOnSite.Helpers;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using AutomationProperties = Microsoft.UI.Xaml.Automation.AutomationProperties;
using Span = Microsoft.UI.Xaml.Documents.Span;
using Visibility = Microsoft.UI.Xaml.Visibility;

namespace BibleOnSite;

/// <summary>
/// Gives every CollectionView row a readable UIA name (#2766). WinUI names
/// a ListViewItem after its data item's ToString(), which for MAUI's
/// item wrapper is the CLR type name — Narrator read each pasuk, article
/// and calendar row as "Microsoft.Maui.Controls.Platform.ItemTemplateContext".
/// The name is rebuilt from the realized row's own text on every
/// (re)realization, so recycled containers never keep a stale name.
/// </summary>
internal static class ListItemAutomationNames
{
	public static void Attach(ListViewBase list)
	{
		list.ContainerContentChanging -= OnContainerContentChanging;
		list.ContainerContentChanging += OnContainerContentChanging;
	}

	private static void OnContainerContentChanging(ListViewBase sender, ContainerContentChangingEventArgs args)
	{
		if (args.InRecycleQueue)
		{
			args.ItemContainer.ClearValue(AutomationProperties.NameProperty);
			return;
		}

		// Phase 1 runs after the item template content has been realized.
		args.RegisterUpdateCallback(1, static (_, realized) => ApplyName(realized.ItemContainer));
	}

	private static void ApplyName(SelectorItem container)
	{
		var parts = new List<string>();
		Collect(container, parts);
		var name = AccessibleItemText.Compose(parts);
		if (name.Length == 0)
		{
			container.ClearValue(AutomationProperties.NameProperty);
		}
		else
		{
			AutomationProperties.SetName(container, name);
		}
	}

	private static void Collect(DependencyObject node, List<string> parts)
	{
		var count = VisualTreeHelper.GetChildrenCount(node);
		for (var i = 0; i < count; i++)
		{
			var child = VisualTreeHelper.GetChild(node, i);
			// Buttons inside a row are their own UIA elements with their own names.
			if (child is ButtonBase or UIElement { Visibility: Visibility.Collapsed })
			{
				continue;
			}

			var explicitName = AutomationProperties.GetName(child);
			if (!string.IsNullOrWhiteSpace(explicitName))
			{
				parts.Add(explicitName);
				continue;
			}

			switch (child)
			{
				case TextBlock text:
					parts.Add(text.Inlines.Count > 0 ? InlineText(text.Inlines) : text.Text);
					continue;
				case RichTextBlock rich:
					parts.AddRange(rich.Blocks.OfType<Paragraph>().Select(p => InlineText(p.Inlines)));
					continue;
				default:
					Collect(child, parts);
					break;
			}
		}
	}

	private static string InlineText(InlineCollection inlines) =>
		string.Concat(inlines.Select(inline => inline switch
		{
			Run run => run.Text,
			Span span => InlineText(span.Inlines),
			LineBreak => " ",
			_ => string.Empty,
		}));
}
