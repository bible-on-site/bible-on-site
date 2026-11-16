using BibleOnSite.Helpers;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using AccessibilityView = Microsoft.UI.Xaml.Automation.Peers.AccessibilityView;
using AutomationProperties = Microsoft.UI.Xaml.Automation.AutomationProperties;
using Span = Microsoft.UI.Xaml.Documents.Span;
using Visibility = Microsoft.UI.Xaml.Visibility;
using WItemsView = Microsoft.UI.Xaml.Controls.ItemsView;

namespace BibleOnSite;

/// <summary>
/// Gives every CollectionView row a readable UIA name (#2766). WinUI names
/// a row container after its item's ToString(), which for a data item is
/// the CLR type name — Narrator read each pasuk, article and calendar row
/// as "BibleOnSite.Models.PasukDisplayItem". The name is rebuilt from the
/// realized row's own text on every (re)realization, so recycled
/// containers never keep a stale name.
/// Two platform shapes are covered: the legacy ListViewBase handlers
/// (CarouselView; CollectionView when the Items2 feature switch is off)
/// and the Items2 WinUI ItemsView whose internal ItemsRepeater realizes
/// ItemContainer elements (.NET 11 default).
/// </summary>
internal static class ListItemAutomationNames
{
	public static void Attach(ListViewBase list)
	{
		list.ContainerContentChanging -= OnContainerContentChanging;
		list.ContainerContentChanging += OnContainerContentChanging;
	}

	public static void Attach(WItemsView itemsView)
	{
		// The inner ItemsRepeater is a template part: try immediately for a
		// view whose template is already applied, and again on Loaded.
		itemsView.Loaded -= OnItemsViewLoaded;
		itemsView.Loaded += OnItemsViewLoaded;
		TryAttachRepeater(itemsView);
	}

	private static void OnItemsViewLoaded(object sender, RoutedEventArgs _)
	{
		if (sender is WItemsView itemsView)
		{
			TryAttachRepeater(itemsView);
		}
	}

	private static void TryAttachRepeater(WItemsView itemsView)
	{
		if (FindDescendant<ItemsRepeater>(itemsView) is not { } repeater)
		{
			return;
		}

		repeater.ElementPrepared -= OnRepeaterElementPrepared;
		repeater.ElementPrepared += OnRepeaterElementPrepared;
		repeater.ElementClearing -= OnRepeaterElementClearing;
		repeater.ElementClearing += OnRepeaterElementClearing;

		// Containers realized before this subscription (template applied
		// after items already loaded) never raise ElementPrepared again —
		// name the realized children we find right now.
		var count = VisualTreeHelper.GetChildrenCount(repeater);
		for (var i = 0; i < count; i++)
		{
			if (VisualTreeHelper.GetChild(repeater, i) is UIElement realized)
			{
				ApplyName(realized);
				if (realized is FrameworkElement element)
				{
					element.Loaded -= OnElementLoaded;
					element.Loaded += OnElementLoaded;
				}
			}
		}
	}

	private static void OnRepeaterElementPrepared(ItemsRepeater sender, ItemsRepeaterElementPreparedEventArgs args)
	{
		// Prepared elements are recycled containers (ItemContainer for an
		// ItemsView). Bindings may still be empty at this point, so a Loaded
		// pass re-collects rows whose text lands after realization.
		ApplyName(args.Element);
		if (args.Element is FrameworkElement element)
		{
			element.Loaded -= OnElementLoaded;
			element.Loaded += OnElementLoaded;
		}
	}

	private static void OnRepeaterElementClearing(ItemsRepeater sender, ItemsRepeaterElementClearingEventArgs args)
	{
		if (args.Element is FrameworkElement element)
		{
			element.Loaded -= OnElementLoaded;
			element.LayoutUpdated -= OnRetryLayoutUpdated;
		}

		args.Element.ClearValue(AutomationProperties.NameProperty);
	}

	private static void OnElementLoaded(object sender, RoutedEventArgs e)
	{
		if (sender is UIElement element)
		{
			ApplyName(element);
		}
	}

	private static void OnRetryLayoutUpdated(object? sender, object e)
	{
		if (sender is UIElement element)
		{
			ApplyName(element);
		}
	}

	private static T? FindDescendant<T>(DependencyObject node) where T : DependencyObject
	{
		var count = VisualTreeHelper.GetChildrenCount(node);
		for (var i = 0; i < count; i++)
		{
			var child = VisualTreeHelper.GetChild(node, i);
			if (child is T match)
			{
				return match;
			}

			if (FindDescendant<T>(child) is { } nested)
			{
				return nested;
			}
		}

		return null;
	}

	private static void OnContainerContentChanging(ListViewBase sender, ContainerContentChangingEventArgs args)
	{
		var container = args.ItemContainer;
		if (args.InRecycleQueue)
		{
			container.Loaded -= OnElementLoaded;
			container.LayoutUpdated -= OnRetryLayoutUpdated;
			container.ClearValue(AutomationProperties.NameProperty);
			return;
		}

		// Phase 1 runs after the item template content has been realized.
		args.RegisterUpdateCallback(1, static (_, realized) => ApplyName(realized.ItemContainer));

		// Two fallback passes around that callback: the immediate apply covers
		// lists whose containers realize without phases (nested CollectionViews
		// inside carousel item templates never reach phase 1, so the callback
		// alone left them unnamed — every pasuk row fell back to its item's
		// CLR type name), and Loaded re-collects rows whose text lands after
		// realization (FormattedText/MultiBinding spans). Each apply reads the
		// tree it finds, so the passes are idempotent.
		ApplyName(container);
		container.Loaded -= OnElementLoaded;
		container.Loaded += OnElementLoaded;
	}

	private static void ApplyName(UIElement element)
	{
		var parts = new List<string>();
		var sawInteractiveChild = Collect(element, parts);
		var name = AccessibleItemText.Compose(parts);
		if (name.Length == 0)
		{
			element.ClearValue(AutomationProperties.NameProperty);
			// A container without content yet only exposes its item wrapper's
			// CLR name. Keep it out of the UIA control/content views until
			// text lands — the retried apply below restores it.
			AutomationProperties.SetAccessibilityView(element, AccessibilityView.Raw);
			// Content can materialize after prepare/loaded (virtualized rows
			// realize their child on first layout). Keep retrying on layout
			// until a name sticks or the container is recycled — except rows
			// whose content is a self-named interactive control (a TappableView
			// row is one button that carries its own UIA name): those never
			// compose a name and would be rescanned on every layout.
			if (!sawInteractiveChild && element is FrameworkElement framework)
			{
				framework.LayoutUpdated -= OnRetryLayoutUpdated;
				framework.LayoutUpdated += OnRetryLayoutUpdated;
			}
		}
		else
		{
			if (element is FrameworkElement named)
			{
				named.LayoutUpdated -= OnRetryLayoutUpdated;
			}

			AutomationProperties.SetAccessibilityView(element, AccessibilityView.Control);
			AutomationProperties.SetName(element, name);
		}
	}

	private static bool Collect(DependencyObject node, List<string> parts)
	{
		var sawInteractiveChild = false;
		var count = VisualTreeHelper.GetChildrenCount(node);
		for (var i = 0; i < count; i++)
		{
			var child = VisualTreeHelper.GetChild(node, i);
			// Buttons inside a row are their own UIA elements with their own
			// names. A nested list names its own items — absorbing its rows
			// into the parent row's name would read the whole list.
			if (child is ButtonBase or ListViewBase or WItemsView or SelectorItem)
			{
				sawInteractiveChild = true;
				continue;
			}

			if (child is UIElement { Visibility: Visibility.Collapsed })
			{
				continue;
			}

			var explicitName = AutomationProperties.GetName(child);
			if (!string.IsNullOrWhiteSpace(explicitName) && !AccessibleItemText.IsClrTypeName(explicitName))
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
					sawInteractiveChild |= Collect(child, parts);
					break;
			}
		}

		return sawInteractiveChild;
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
