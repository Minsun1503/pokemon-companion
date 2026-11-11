using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Windows.Automation;

public static partial class PokemonWindowsAutomation {
    class WindowProof {
        public IntPtr Handle;
        public uint ProcessId;
        public long Started;
        public uint ThreadId;
        public string ClassName;
        public DateTime Created = DateTime.UtcNow;
    }
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int count);
    static Dictionary<string, WindowProof> windowProofs = new Dictionary<string, WindowProof>();
    static string WindowClass(IntPtr handle) {
        var name = new System.Text.StringBuilder(256);
        GetClassName(handle, name, name.Capacity);
        return name.ToString();
    }
    static string RememberWindow(IntPtr handle) {
        var expired = new List<string>();
        foreach (var entry in windowProofs) if ((DateTime.UtcNow - entry.Value.Created).TotalSeconds > 120) expired.Add(entry.Key);
        foreach (var key in expired) windowProofs.Remove(key);
        foreach (var entry in windowProofs) {
            if (entry.Value.Handle != handle) continue;
            try { VerifyWindow(entry.Value); return entry.Key; } catch { }
        }
        var proof = CaptureWindow(handle);
        if (proof == null) return null;
        if (windowProofs.Count >= 128) {
            string oldest = null;
            foreach (var entry in windowProofs) if (oldest == null || entry.Value.Created < windowProofs[oldest].Created) oldest = entry.Key;
            windowProofs.Remove(oldest);
        }
        string token = Guid.NewGuid().ToString("N");
        windowProofs[token] = proof;
        return token;
    }
    public static void CheckWindow(string windowId, string token) {
        if (String.IsNullOrEmpty(token)) return; // Existing unqualified window-id callers remain compatible.
        WindowProof proof;
        if (!windowProofs.TryGetValue(token, out proof) || (DateTime.UtcNow - proof.Created).TotalSeconds > 120
            || proof.Handle.ToInt64().ToString() != windowId) throw Rejected("STALE_REF", "Unknown, expired or mismatched window identity. Call get_windows again.");
        VerifyWindow(proof);
    }
    class ElementIdentity {
        public string Role, AutomationId, Name, Description;
        public bool UniqueAtCapture;
        public bool Meaningful { get { return AutomationId != null || Name != null || Description != null; } }
        public bool Matches(ElementIdentity live) {
            return Role == live.Role && (AutomationId == null || AutomationId == live.AutomationId)
                && (Name == null || Name == live.Name) && (Description == null || Description == live.Description);
        }
    }
    static string Meaningful(string value) { return String.IsNullOrWhiteSpace(value) ? null : value; }
    static WindowProof CaptureWindow(IntPtr handle) {
        using (Profile("window_capture_inclusive")) {
            uint pid;
            uint thread = GetWindowThreadProcessId(handle, out pid);
            try {
                using (var process = Process.GetProcessById((int)pid)) {
                    var proof = new WindowProof { Handle = handle, ProcessId = pid, Started = process.StartTime.ToUniversalTime().Ticks, ThreadId = thread, ClassName = WindowClass(handle) };
                    VerifyWindow(proof);
                    return proof;
                }
            } catch (ArgumentException) { return null; } catch (System.ComponentModel.Win32Exception) { return null; }
        }
    }
    static void VerifyWindow(WindowProof proof) {
        using (Profile("window_verify")) {
            if (proof == null || !IsWindow(proof.Handle)) throw Rejected("STALE_REF", "The target window has no current process identity. Call get_ui again.");
            uint pid;
            uint thread = GetWindowThreadProcessId(proof.Handle, out pid);
            if (pid != proof.ProcessId || thread != proof.ThreadId || WindowClass(proof.Handle) != proof.ClassName) throw Rejected("STALE_REF", "The target window's owner or native identity changed. Call get_ui again.");
            try {
                using (var process = Process.GetProcessById((int)pid)) {
                    if (process.StartTime.ToUniversalTime().Ticks != proof.Started) throw Rejected("STALE_REF", "The target process was replaced. Call get_ui again.");
                }
            } catch (ArgumentException) { throw Rejected("STALE_REF", "The target process exited. Call get_ui again."); }
            catch (System.ComponentModel.Win32Exception) { throw Rejected("STALE_REF", "The target process identity cannot be verified. Call get_ui again."); }
        }
    }
    static bool ValueNamed(string name, string value) {
        if (name == value) return true;
        double first, second;
        return Double.TryParse(name, NumberStyles.Float, CultureInfo.InvariantCulture, out first)
            && Double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out second)
            && !Double.IsInfinity(first) && !Double.IsNaN(first) && first == second;
    }
    static ElementIdentity Identity(AutomationElement element) {
        using (Profile("identity_projection")) {
            var info = element.Cached;
            string role = info.ControlType.ProgrammaticName.Replace("ControlType.", "");
            string name = Meaningful(info.Name);
            object value;
            if (name != null && Array.IndexOf(new string[] { "Edit", "ComboBox", "Spinner", "Slider", "ScrollBar", "CheckBox", "RadioButton", "List" }, role) >= 0
                && element.TryGetCachedPattern(ValuePattern.Pattern, out value)
                && ValueNamed(name, ((ValuePattern)value).Cached.Value)) name = null;
            return new ElementIdentity { Role = role, AutomationId = Meaningful(info.AutomationId), Name = name, Description = Meaningful(info.HelpText) };
        }
    }
    static void VerifyElement(Snapshot snapshot, ElementIdentity expected, AutomationElement element) {
        using (Profile("element_verify_inclusive")) {
            VerifyWindow(snapshot.Proof);
            AutomationElement live;
            using (Profile("identity_cache_fetch")) live = element.GetUpdatedCache(IdentityCache());
            if (!expected.Matches(Identity(live))) throw Rejected("STALE_REF", "The target's accessible identity changed. Call get_ui again.");
            var ancestor = element;
            var scopeRoot = snapshot.Scope == null ? null : ResolveRoot(snapshot);
            bool inScope = scopeRoot == null;
            for (int depth = 0; ancestor != null && depth < 80; depth++) {
                if (scopeRoot != null && Automation.Compare(ancestor, scopeRoot)) inScope = true;
                if (ancestor.Current.NativeWindowHandle == snapshot.Window.ToInt64()) {
                    if (!inScope) throw Rejected("STALE_REF", "The target left its captured subtree. Refresh get_ui.");
                    return;
                }
                using (Profile("ancestor_navigation")) ancestor = TreeWalker.RawViewWalker.GetParent(ancestor);
            }
            throw Rejected("STALE_REF", "The target left its original window. Call get_ui again.");
        }
    }
    static AutomationElement ResolveIdentity(Snapshot snapshot, ElementIdentity expected) {
        using (Profile("identity_resolve_inclusive")) {
            VerifyWindow(snapshot.Proof);
            if (!snapshot.CaptureComplete) throw Rejected("INCOMPLETE_SNAPSHOT", "The capture did not completely observe the window. Increase max_depth or refresh get_ui before acting.");
            if (!expected.Meaningful || !expected.UniqueAtCapture) throw Rejected("AMBIGUOUS_TARGET", "The target was not unique when captured. Find a control with a unique accessible identity.");
            AutomationElement found = null;
            int matches = 0;
            var scan = WalkWindow(ResolveRoot(snapshot), IdentityCache(), snapshot.MaxDepth, delegate(AutomationElement element, int depth) {
                if (expected.Matches(Identity(element))) { found = element; matches++; }
            }, snapshot.Window);
            VerifyWindow(snapshot.Proof);
            if (matches > 1) throw Rejected("AMBIGUOUS_TARGET", "Multiple live controls match the captured identity. Call get_ui again.");
            if (!scan.Complete) throw Rejected("INCOMPLETE_SNAPSHOT", "The live target scan was incomplete. Re-read the window before acting.");
            if (matches == 0) throw Rejected("STALE_REF", "No live control matches the captured identity. Call get_ui again.");
            VerifyElement(snapshot, expected, found);
            return found;
        }
    }
    static void ConfirmTarget(string snapshotId, int id, AutomationElement element) {
        var snapshot = snapshots[snapshotId];
        VerifyElement(snapshot, snapshot.Identities[id], element);
    }
    static AutomationElement ResolveRoot(Snapshot snapshot) {
        if (snapshot.Scope == null) return AutomationElement.FromHandle(snapshot.Window);
        if ((DateTime.UtcNow - snapshot.Scope.Created).TotalSeconds > 120) throw Rejected("STALE_REF", "The subtree root observation expired. Refresh get_ui.");
        return ResolveIdentity(snapshot.Scope, snapshot.RootIdentity);
    }
    public static object WaitBaseline(string windowId, string snapshotId, int id, string query, string role) {
        Snapshot snapshot;
        ElementIdentity identity;
        if (String.IsNullOrEmpty(snapshotId) || !snapshots.TryGetValue(snapshotId, out snapshot)
            || (DateTime.UtcNow - snapshot.Created).TotalSeconds > 120 || !snapshot.Identities.TryGetValue(id, out identity))
            throw Rejected("STALE_REF", "The prior absence observation expired. Refresh get_ui.");
        if (snapshot.Window.ToInt64().ToString() != windowId || snapshot.Scope != null || !snapshot.CaptureComplete || !identity.UniqueAtCapture)
            throw Rejected("INVALID_ARGS", "Absence requires a unique control observed in a complete whole-window snapshot of this window.");
        if (String.IsNullOrWhiteSpace(query) || !(String.Equals(query, identity.Name, StringComparison.OrdinalIgnoreCase)
            || String.Equals(query, identity.AutomationId, StringComparison.OrdinalIgnoreCase))
            || (!String.IsNullOrEmpty(role) && !String.Equals(role, identity.Role, StringComparison.OrdinalIgnoreCase)))
            throw Rejected("INVALID_ARGS", "Absence query must equal the captured control's stable name or automation ID, and role must match.");
        VerifyWindow(snapshot.Proof);
        string token = RememberWindow(snapshot.Window);
        if (token == null) throw Rejected("STALE_REF", "Cannot prove the prior window identity.");
        return Obj("window_ref", token);
    }
}
