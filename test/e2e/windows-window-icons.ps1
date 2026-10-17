param([Parameter(Mandatory = $true)][string]$WindowHandle)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct IconPropertyKey {
    public Guid Format;
    public uint Id;
    public IconPropertyKey(uint id) {
        Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); Id = id;
    }
}
[StructLayout(LayoutKind.Explicit, Size = 24)]
public struct IconPropVariant {
    [FieldOffset(0)] public ushort Type;
    [FieldOffset(8)] public IntPtr Pointer;
}
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IconPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out IconPropertyKey key);
    [PreserveSig] int GetValue(ref IconPropertyKey key, out IconPropVariant value);
    [PreserveSig] int SetValue(ref IconPropertyKey key, ref IconPropVariant value);
    [PreserveSig] int Commit();
}
public static class NativeWindowIconProbe {
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam,
        IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("shell32.dll", PreserveSig = true)]
    static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IconPropertyStore store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref IconPropVariant value);

    public static IntPtr GetIcon(IntPtr window, int type) {
        IntPtr result;
        if (SendMessageTimeout(window, 0x7F, new IntPtr(type), IntPtr.Zero,
            2, 2000, out result) == IntPtr.Zero)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "WM_GETICON failed");
        return result;
    }
    public static string GetProperty(IntPtr window, uint id) {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IconPropertyStore store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, ref iid, out store));
        try {
            IconPropertyKey key = new IconPropertyKey(id);
            IconPropVariant value;
            Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
            try {
                if (value.Type == 0) return null;
                if (value.Type == 31) return Marshal.PtrToStringUni(value.Pointer);
                if (value.Type == 8) return Marshal.PtrToStringBSTR(value.Pointer);
                throw new InvalidOperationException("Unexpected window property variant " + value.Type);
            } finally { PropVariantClear(ref value); }
        } finally { Marshal.ReleaseComObject(store); }
    }
}
"@

$window = [IntPtr]::new([long]$WindowHandle)
$frames = @()
foreach ($type in @(0, 1, 2)) {
    $handle = [NativeWindowIconProbe]::GetIcon($window, $type)
    $frame = @{ type = $type; handle = $handle.ToInt64().ToString() }
    if ($handle -ne [IntPtr]::Zero) {
        # These handles belong to the application: dispose the managed wrappers,
        # never call DestroyIcon on a borrowed WM_GETICON result.
        $icon = [System.Drawing.Icon]::FromHandle($handle)
        $bitmap = $icon.ToBitmap()
        $stream = [System.IO.MemoryStream]::new()
        try {
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            $frame.width = $bitmap.Width
            $frame.height = $bitmap.Height
            $frame.png = [Convert]::ToBase64String($stream.ToArray())
        } finally { $stream.Dispose(); $bitmap.Dispose(); $icon.Dispose() }
    }
    $frames += $frame
}
@{
    windowHandle = $WindowHandle
    frames = $frames
    shell = @{
        appId = [NativeWindowIconProbe]::GetProperty($window, 5)
        relaunchCommand = [NativeWindowIconProbe]::GetProperty($window, 2)
        relaunchIconResource = [NativeWindowIconProbe]::GetProperty($window, 3)
        relaunchDisplayName = [NativeWindowIconProbe]::GetProperty($window, 4)
    }
} | ConvertTo-Json -Depth 6 -Compress
