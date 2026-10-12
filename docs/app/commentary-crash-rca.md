# Commentary slowdown and iOS watchdog RCA

The supplied 2026-10-12 crash report is a main-thread responsiveness failure in version 5.0.152 (build 152), on iPhone17,2 / iOS 27.0.1. FRONTBOARD terminates the application with SIGKILL, code 0x8BADF00D, after the background scene-update consumes its ten-second allowance. Application CPU time is 10.281 seconds. This report does not identify an out-of-memory termination, nor the selected commentary.

## Evidence and workload

The main-thread stack runs through UITextView.setAttributedText, _layoutText, _UITextContainerView.sizeToFit, NSTextLayoutManager.ui_contentSizeForLastContainerView, text-segment enumeration, _fetchCaretOffsets and CTLineEnumerateCaretOffsets. The reader places unscrollable native text views inside chapter rows. TextKit 2 therefore sizes an entire commentary while preparing caret positions for RTL text.

The corpus contains 339,715 notes in 929 chapters. The largest chapter payload is 776,850 compressed bytes / 2,962,306 uncompressed bytes, with 2,312 notes and 953 source/verse groups (perek 71). The largest combined source/verse display is 266,536 UTF-8 bytes (perek 151, source 40, verse 3). These are measurements of the delivered corpus, not the user's unknown selected sources.

Before this fix the reader decoded every commentary in each cached chapter before selection. Adding a source rebuilt the complete per-verse display list. Replacing BindableLayout.ItemsSource recreated existing native views even when their model instances were reused. The all-commentaries-for-one-verse overlay also eagerly created every source inside a ScrollView. Singleton Preferences subscriptions retained closed reader view models and their chapter caches.

## Changes

- Reader caches retain compressed chapter bytes and source/verse identities. Excluded UTF-8 content is streamed through a fixed skip buffer; text is decoded only for a realized cell's verse and source on a worker.
- HtmlView rejects stale completions after recycling or disconnect, and releases loaded text on disconnect. Display models do not retain decoded production commentary text.
- An incremental ObservableCollection preserves existing inline views when another source is checked. The focused one-verse overlay uses CollectionView so sources outside its realized rows are not loaded.
- iOS deliberately selects TextKit 1 before assigning attributed text. This removes the TextKit 2 whole-text caret-enumeration path shown in the report while preserving native links, formatting and exact search positioning.
- Preferences subscriptions hold readers weakly, so closed screens and their caches can be collected.
- Chapter-wide selection defaults to five sources. Preferences allows a different limit with a Hebrew note about slower reading and increased memory use. Lowering the limit trims the active selection. A search jump can replace the last slot to reveal its source without exceeding the limit.
- The commentary menu filters source names, including Hebrew abbreviation punctuation, without changing the selected sources. The focused one-verse view still offers every source.
- The iOS scroll stress fixture now uses 2,200 RTL paragraphs and up to five sources under the ordinary interaction deadlines. No watchdog or timeout allowance is increased.

## Validation

The largest delivered chapter measured 43.1 ms / 6,525,128 allocated bytes for full decoding versus 33.7 ms / 216,200 allocated bytes for compressed metadata (one desktop run, including cold setup). Both paths process the compressed stream; the new path avoids allocating the chapter's text. This is a 96.7% allocation reduction, not a device frame-time measurement.

The 1,639 unit tests and 49 mobile-harness unit tests pass. The closed-reader collection regression fails before the weak subscription change and passes afterward. A full integration-inclusive run passed 1,648 tests and exposed one existing asset-set test that rejected the generated notes/index; its corrected assertion passes in the final unit run.

Managed regressions cover excluded-text allocations, lazy verse/source loading and note order, cell preservation without collection reset, exact second-note search positioning, preference persistence and enforcement, menu name filtering, and collection of closed readers. Android compilation and the mobile harness are validated separately from the native iOS stress scenario. The raw device crash report is deliberately not committed.

Native iOS validation must exercise the stress fixture; managed tests cannot establish UIKit layout performance. The crash stack supports the native layout diagnosis, but cannot prove which commentary or selection caused the incident.

Apple documents [watchdog termination diagnosis](https://developer.apple.com/documentation/xcode/addressing-watchdog-terminations) and [UITextView's TextKit compatibility behavior](https://developer.apple.com/videos/play/wwdc2025/222/) (the bidirectional text section).
