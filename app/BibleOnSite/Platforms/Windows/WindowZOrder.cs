using System.Runtime.InteropServices;

namespace BibleOnSite;

/// <summary>
/// Win32 z-order band switch for the app window (#2766). WinUI 3 exposes no
/// managed always-on-top API — <c>AppWindow</c>/<c>OverlappedPresenter</c>
/// have no topmost concept — so the opt-in "תמיד מעל חלונות אחרים" preference
/// is applied with <c>SetWindowPos</c> on the window's HWND.
///
/// The band is a window style (<c>WS_EX_TOPMOST</c>): it survives
/// maximize/restore/minimize/Snap and presenter swaps, so the chosen stacking
/// is restored automatically after every window-state transition. Nothing
/// else in the app touches the band — an un-opted window stays an ordinary
/// overlapped window that other applications can cover.
/// </summary>
internal static class WindowZOrder
{
	private const uint SwpNoActivate = 0x0010;
	private const uint SwpNoMove = 0x0002;
	private const uint SwpNoSize = 0x0001;

	// InsertAfter values for SetWindowPos: top/bottom of the topmost band.
	private static readonly IntPtr HwndTopMost = new(-1);
	private static readonly IntPtr HwndNoTopMost = new(-2);

	[DllImport("user32.dll", SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
		int x, int y, int cx, int cy, uint flags);

	/// <summary>
	/// Moves the window into (<paramref name="topMost"/> = true) or out of
	/// (false) the topmost band without activating, moving or resizing it.
	/// Returns false when the call fails — callers treat that as best-effort
	/// because window placement must never block the preference write.
	/// </summary>
	public static bool SetTopMost(IntPtr hwnd, bool topMost) =>
		SetWindowPos(hwnd, topMost ? HwndTopMost : HwndNoTopMost,
			0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
}
