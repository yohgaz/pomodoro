using System;
using System.Runtime.InteropServices;

namespace Pomodoro.Desktop;

internal static class Native
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("user32.dll")]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    public const int WM_HOTKEY = 0x0312;
    public const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_NOREPEAT = 0x4000;

    // Barre de titre sombre aux couleurs de Pomodoro (Windows 11 ; ignoré
    // sans erreur sur les versions qui ne le gèrent pas).
    public static void DarkTitleBar(IntPtr hwnd)
    {
        int on = 1;
        DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int));          // DWMWA_USE_IMMERSIVE_DARK_MODE
        int caption = 0x00140D0B;                                       // #0B0D14 en COLORREF (BGR)
        DwmSetWindowAttribute(hwnd, 35, ref caption, sizeof(int));     // DWMWA_CAPTION_COLOR
        int border = 0x003D65F0;                                        // #F0653D
        DwmSetWindowAttribute(hwnd, 34, ref border, sizeof(int));      // DWMWA_BORDER_COLOR
    }
}
