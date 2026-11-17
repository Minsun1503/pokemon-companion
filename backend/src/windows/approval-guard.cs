using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

public static partial class PokemonWindowsAutomation {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetProp(IntPtr window, string name, IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetProp(IntPtr window, string name);
    static string ApprovalProperty = "PokemonCompanionTrustedWindow_v1";
    [StructLayout(LayoutKind.Sequential)] struct ApprovalPoint { public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetCursorPos(out ApprovalPoint point);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(ApprovalPoint point);

    static bool ProtectedProcess(IntPtr window) {
        if (window == IntPtr.Zero) return false;
        uint pid; GetWindowThreadProcessId(window, out pid);
        bool blocked = false;
        EnumWindows(delegate(IntPtr candidate, IntPtr ignored) {
            uint owner; GetWindowThreadProcessId(candidate, out owner);
            if (owner == pid && GetProp(candidate, ApprovalProperty) != IntPtr.Zero) { blocked = true; return false; }
            return true;
        }, IntPtr.Zero);
        return blocked;
    }
    static void GuardTrustedWindow(IntPtr window) {
        if (ProtectedProcess(window)) throw Rejected("PROTECTED_COMPANION", "Companion approval processes cannot be inspected, captured or controlled by automation.");
    }
    // Private worker command, absent from every model-facing tool schema.
    public static object ProtectCompanion(string encoded) {
        var value = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(encoded);
        var window = new IntPtr(Convert.ToInt64(value["window_id"]));
        uint pid; GetWindowThreadProcessId(window, out pid);
        if (!IsWindow(window) || pid != Convert.ToUInt32(value["process_id"])) throw Rejected("INVALID_ARGS", "Companion protection owner mismatch.");
        if (!SetProp(window, ApprovalProperty, new IntPtr(Convert.ToInt32(value["approval"]) == 1 ? 1 : 2))) throw Rejected("PROTECTION_FAILED", "Cannot protect the companion approval window.");
        return Obj("protected", true);
    }
    public static object GuardPhysical() {
        bool approval = false;
        EnumWindows(delegate(IntPtr window, IntPtr ignored) {
            if (IsWindowVisible(window) && GetProp(window, ApprovalProperty) == new IntPtr(1)) { approval = true; return false; }
            return true;
        }, IntPtr.Zero);
        if (approval) throw Rejected("APPROVAL_PENDING", "Physical input and full-screen capture are blocked while an approval dialog is visible.");
        GuardTrustedWindow(GetForegroundWindow());
        ApprovalPoint point; if (GetCursorPos(out point)) GuardTrustedWindow(WindowFromPoint(point));
        return Obj("allowed", true);
    }
    public static object TrustedWindowStatus() {
        int total = 0, approvals = 0, visibleApprovals = 0;
        EnumWindows(delegate(IntPtr window, IntPtr ignored) {
            var role = GetProp(window, ApprovalProperty);
            if (role != IntPtr.Zero) total++;
            if (role == new IntPtr(1)) approvals++;
            if (role == new IntPtr(1) && IsWindowVisible(window)) visibleApprovals++;
            return true;
        }, IntPtr.Zero);
        return Obj("protected_windows", total, "approval_windows", approvals, "visible_approvals", visibleApprovals);
    }
}
