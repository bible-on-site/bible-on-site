# Swipe Navigation for Perek Pages

## Implementation

Swipe navigation has been implemented for the mobile app to allow users to navigate between perakim by swiping left or right on the perek page.

## Technical Details

### Components Modified

1. **PerekPage.xaml** - Added `SwipeGestureRecognizer` to the `PasukimCollection`
2. **PerekPage.xaml.cs** - Enhanced swipe handlers with proper guards and animations

### Swipe Direction (RTL Layout)

In Hebrew (RTL) layout, the swipe directions are intuitive for Hebrew readers:

- **Swipe Left** → Navigate to **Previous** perek (like turning a page forward in a Hebrew book)
- **Swipe Right** → Navigate to **Next** perek (like turning a page backward in a Hebrew book)

### Features

1. **Smooth Animations**
   - Slide and fade transitions when navigating between perakim
   - 200ms duration for smooth, responsive feel
   - Cubic easing for natural motion

2. **Edge Handling**
   - Bounce animation when trying to swipe past first/last perek
   - Visual feedback that there are no more perakim in that direction

3. **Guards Against Conflicts**
   - Swipe disabled while showing articles view
   - Cooldown period (500ms) prevents rapid successive swipes during navigation
   - Respects ViewModel's `CanGoToPreviousPerek` and `CanGoToNextPerek` properties

4. **Scroll Integration**
   - Swipe gesture recognizer works alongside vertical scrolling
   - Threshold of 100 device-independent units ensures swipes are intentional
   - Scroll tracking prevents false positives during pasuk selection

### Code Structure

```csharp
#region Swipe Navigation

private bool _isNavigating;
private DateTime _lastSwipeTime = DateTime.MinValue;
private const int SwipeCooldownMs = 500;

private async void OnSwipedLeft(object? sender, SwipedEventArgs e)
{
    // Navigate to previous perek with guards and animation
}

private async void OnSwipedRight(object? sender, SwipedEventArgs e)
{
    // Navigate to next perek with guards and animation
}

private async Task BounceAnimationAsync()
{
    // Edge feedback animation
}

private async Task NavigateWithSwipeAnimationAsync(...)
{
    // Slide/fade animation implementation
}

#endregion
```

## User Experience

- **Natural Gesture**: Swipe horizontally to navigate between chapters
- **Visual Feedback**: Smooth slide animations show direction of navigation
- **Edge Awareness**: Bounce animation indicates when at first or last perek
- **Consistent**: Works the same way throughout the app

## Alternative Considered

**CarouselView** was considered (as mentioned in the original TODO comment), but:
- More complex to implement with 929 items
- Would require virtualization strategy for performance
- `SwipeGestureRecognizer` is simpler and more appropriate for this use case
- Previous concerns about Android crashes were addressed with proper guards

## Testing

The implementation has been built and installed on Android emulator. Users can:
1. Open any perek
2. Swipe left to go to previous perek
3. Swipe right to go to next perek
4. Try swiping at edges (perek 1 or 929) to see bounce animation
5. Verify vertical scrolling still works for reading verses

## Future Enhancements

Potential improvements:
- Add subtle haptic feedback on successful navigation
- Implement swipe progress indicator (show peek of next/previous perek while swiping)
- Add settings to customize swipe sensitivity threshold
- Consider adding swipe navigation to articles view as well
