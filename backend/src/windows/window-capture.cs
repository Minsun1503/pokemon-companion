using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static partial class PokemonWindowsAutomation {
    [StructLayout(LayoutKind.Sequential)] struct CaptureRect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out CaptureRect rectangle);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    public static object CaptureWindow(string windowId) {
        var handle = Handle(windowId);
        var foreground = GetForegroundWindow();
        if (IsIconic(handle) || (foreground != handle && GetAncestor(foreground, 3) != handle)) throw Rejected("FOREGROUND_MISMATCH", "Activate the selected window before capture.");
        CaptureRect rectangle;
        if (!GetWindowRect(handle, out rectangle)) throw Rejected("CAPTURE_FAILED", "Selected window bounds are unavailable.");
        int left = Math.Max(rectangle.Left, GetSystemMetrics(76)), top = Math.Max(rectangle.Top, GetSystemMetrics(77));
        int right = Math.Min(rectangle.Right, GetSystemMetrics(76) + GetSystemMetrics(78)), bottom = Math.Min(rectangle.Bottom, GetSystemMetrics(77) + GetSystemMetrics(79));
        int width = right - left, height = bottom - top;
        if (width <= 0 || height <= 0 || width > 16000 || height > 16000) throw Rejected("CAPTURE_FAILED", "Selected window has no bounded visible surface.");
        using (var image = new Bitmap(width, height)) {
            using (var graphics = Graphics.FromImage(image)) graphics.CopyFromScreen(left, top, 0, 0, new Size(width, height));
            foreground = GetForegroundWindow();
            if (foreground != handle && GetAncestor(foreground, 3) != handle) throw Rejected("FOREGROUND_MISMATCH", "Foreground changed during capture; discard the image.");
            double scale = Math.Min(1.0, Math.Min(1568.0 / Math.Max(width, height), Math.Sqrt(1150000.0 / ((double)width * height))));
            int scaledWidth = Math.Max(1, (int)(width * scale)), scaledHeight = Math.Max(1, (int)(height * scale));
            using (var scaled = new Bitmap(image, scaledWidth, scaledHeight)) using (var stream = new MemoryStream()) {
                scaled.Save(stream, ImageFormat.Png);
                string mimeType = "image/png";
                // Native responses are capped at two million characters, including Base64 and metadata.
                if (stream.Length > 1400000) {
                    stream.SetLength(0);
                    ImageCodecInfo jpeg = null;
                    foreach (var codec in ImageCodecInfo.GetImageEncoders()) if (codec.MimeType == "image/jpeg") jpeg = codec;
                    if (jpeg == null) throw Rejected("CAPTURE_FAILED", "JPEG encoder is unavailable.");
                    using (var parameters = new EncoderParameters(1)) {
                        parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 70L);
                        scaled.Save(stream, jpeg, parameters);
                    }
                    mimeType = "image/jpeg";
                }
                if (stream.Length > 1400000) throw Rejected("CAPTURE_FAILED", "Capture exceeds the bounded response size.");
                return Obj("image", Convert.ToBase64String(stream.ToArray()), "mime_type", mimeType, "image_width", scaledWidth, "image_height", scaledHeight,
                    "screen_left", left, "screen_top", top, "screen_width", width, "screen_height", height, "scope", "selected_visible_window", "verification_required", true);
            }
        }
    }
}
