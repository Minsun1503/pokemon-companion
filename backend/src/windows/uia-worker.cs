using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Security.Cryptography;
using System.Windows.Automation;

public static partial class PokemonWindowsAutomation {
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("imm32.dll")] static extern bool ImmIsIME(IntPtr layout);
    delegate bool EnumProc(IntPtr window, IntPtr data);

    class Snapshot {
        public IntPtr Window;
        public WindowProof Proof;
        public int MaxDepth;
        public bool CaptureComplete;
        public Snapshot Scope;
        public ElementIdentity RootIdentity;
        public int ScopeDepth;
        public DateTime Created = DateTime.UtcNow;
        public Dictionary<int, ElementIdentity> Identities = new Dictionary<int, ElementIdentity>();
    }
    class Visit {
        public AutomationElement Element;
        public int Depth;
        public int RawDepth;
        public bool IsRoot;
        public Visit(AutomationElement element, int depth, bool isRoot = false, int rawDepth = 0) { Element = element; Depth = depth; IsRoot = isRoot; RawDepth = rawDepth; }
    }
    static Dictionary<string, Snapshot> snapshots = new Dictionary<string, Snapshot>();
    // Internal key protection only. These actions are absent from the public tool schema.
    public static object LearningKey(string encoded, bool decrypt) {
        if (String.IsNullOrEmpty(encoded) || encoded.Length > 4096) throw Rejected("INVALID_ARGS", "Invalid protected-key input.");
        byte[] input = Convert.FromBase64String(encoded);
        if (!decrypt && input.Length != 32) throw Rejected("INVALID_ARGS", "Learning keys must be 32 bytes.");
        byte[] output = decrypt
            ? System.Security.Cryptography.ProtectedData.Unprotect(input, null, System.Security.Cryptography.DataProtectionScope.CurrentUser)
            : System.Security.Cryptography.ProtectedData.Protect(input, null, System.Security.Cryptography.DataProtectionScope.CurrentUser);
        try { return Obj("key", Convert.ToBase64String(output)); }
        finally { Array.Clear(input, 0, input.Length); Array.Clear(output, 0, output.Length); }
    }
    public static object Status() {
        return Obj("protocol_version", 1, "worker", "ready", "automation", "UIAutomation", "snapshot_count", snapshots.Count,
            "snapshot_ttl_seconds", 120, "snapshot_limit", 8, "permissions", "not_checked_per_target",
            "foreground_available", GetForegroundWindow() != IntPtr.Zero, "coordination", "windows_named_mutex");
    }
    static Dictionary<string, object> Obj(params object[] values) {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < values.Length; i += 2) result[(string)values[i]] = values[i + 1];
        return result;
    }
    static Exception Rejected(string code, string message) {
        var error = new Exception(message);
        error.Data["code"] = code;
        error.Data["delivery"] = "not_delivered";
        error.Data["retry"] = code == "INVALID_ARGS" || code == "PAUSED" || code == "CANCELLED" ? "unsafe" : "safe";
        return error;
    }
    static string Clip(string value, int length, Dictionary<string, object> node = null) {
        if (String.IsNullOrEmpty(value)) return "";
        if (value.Length > length) {
            if (node != null) node["value_clipped"] = true;
            return value.Substring(0, length) + "…";
        }
        return value;
    }
    static IntPtr Handle(string id) {
        long value;
        if (!Int64.TryParse(id, out value) || !IsWindow(new IntPtr(value))) throw Rejected("WINDOW_NOT_FOUND", "Window no longer exists. Call get_windows again.");
        return new IntPtr(value);
    }
    static Dictionary<string, object> WindowInfo(IntPtr handle) {
        using (Profile("window_metadata_inclusive")) {
            var title = new StringBuilder(1024);
            GetWindowText(handle, title, title.Capacity);
            uint pid;
            GetWindowThreadProcessId(handle, out pid);
            string process = "";
            try { process = Process.GetProcessById((int)pid).ProcessName; } catch { }
            var result = Obj("id", handle.ToInt64().ToString(), "title", Clip(title.ToString(), 200), "process", process, "minimized", IsIconic(handle));
            string token = RememberWindow(handle);
            if (token != null) result["window_ref"] = token;
            return result;
        }
    }
    public static object Windows(string query) {
        using (Profile("window_enumeration_inclusive")) {
            var windows = new List<object>();
            bool truncated = false;
            EnumWindows(delegate(IntPtr handle, IntPtr unused) {
                if (!IsWindowVisible(handle)) return true;
                var info = WindowInfo(handle);
                var title = (string)info["title"];
                if (String.IsNullOrEmpty(title)) return true;
                if (!String.IsNullOrEmpty(query) && (title + " " + info["process"]).IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0) return true;
                var foreground = GetForegroundWindow();
                info["active"] = handle == foreground || handle == GetAncestor(foreground, 3);
                if (windows.Count == 100) { truncated = true; return false; }
                windows.Add(info);
                return true;
            }, IntPtr.Zero);
            return Obj("windows", windows, "complete", !truncated, "truncated", truncated);
        }
    }
    static List<string> Actions(AutomationElement element) {
        var actions = new List<string>();
        if (!element.Cached.IsEnabled || element.Cached.IsPassword) return actions;
        object pattern;
        if (element.TryGetCachedPattern(InvokePattern.Pattern, out pattern)) actions.Add("invoke");
        if (element.TryGetCachedPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Cached.IsReadOnly) actions.Add("set_value");
        if (element.TryGetCachedPattern(SelectionItemPattern.Pattern, out pattern)) actions.Add("select");
        if (element.TryGetCachedPattern(TogglePattern.Pattern, out pattern)) actions.Add("toggle");
        if (element.TryGetCachedPattern(ExpandCollapsePattern.Pattern, out pattern)) { actions.Add("expand"); actions.Add("collapse"); }
        if (element.TryGetCachedPattern(ScrollPattern.Pattern, out pattern)) actions.Add("scroll");
        if (element.TryGetCachedPattern(TextPattern.Pattern, out pattern) || element.TryGetCachedPattern(ValuePattern.Pattern, out pattern)) actions.Add("read_text");
        if (element.Cached.IsKeyboardFocusable) actions.Add("focus");
        return actions;
    }
    public static object UI(string windowId, string query, string roleFilter, int limit, int maxDepth) {
        return UI(windowId, query, roleFilter, limit, maxDepth, null, null, 0, null);
    }
    public static object UI(string windowId, string query, string roleFilter, int limit, int maxDepth, string view, string rootSnapshot, int rootId, string windowRef) {
        using (Profile("discovery_inclusive")) {
            var handle = Handle(windowId);
            CheckWindow(windowId, windowRef);
            var windowProof = String.IsNullOrEmpty(windowRef) ? CaptureWindow(handle) : windowProofs[windowRef];
            var root = AutomationElement.FromHandle(handle);
            Snapshot scope = null;
            ElementIdentity rootIdentity = null;
            if (!String.IsNullOrEmpty(rootSnapshot)) {
                root = Target(rootSnapshot, rootId);
                scope = snapshots[rootSnapshot];
                if (scope.Window != handle || scope.ScopeDepth >= 4) throw Rejected("INVALID_ARGS", "Subtree roots must belong to this window; at most four nested scopes are supported.");
                rootIdentity = scope.Identities[rootId];
            }
            if (root == null) throw new Exception("UI Automation is unavailable for this window. Use keyboard shortcuts or a screenshot fallback.");
            var expired = new List<string>();
            foreach (var entry in snapshots) if ((DateTime.UtcNow - entry.Value.Created).TotalSeconds > 120) expired.Add(entry.Key);
            foreach (var key in expired) snapshots.Remove(key);
            if (snapshots.Count >= 8) {
                string oldestId = null;
                DateTime oldest = DateTime.MaxValue;
                foreach (var entry in snapshots) if (entry.Value.Created < oldest) { oldest = entry.Value.Created; oldestId = entry.Key; }
                snapshots.Remove(oldestId);
            }
            var snapshot = new Snapshot { Window = handle, Proof = windowProof, MaxDepth = maxDepth,
                Scope = scope, RootIdentity = rootIdentity, ScopeDepth = scope == null ? 0 : scope.ScopeDepth + 1 };
            var snapshotId = Guid.NewGuid().ToString("N");
            snapshots[snapshotId] = snapshot;
            var observed = new List<ElementIdentity>();
            var nodes = new List<object>();
            int matched = 0;
            var scan = WalkWindow(root, DiscoveryCache(), maxDepth, delegate(AutomationElement element, int depth) {
                var identity = Identity(element);
                observed.Add(identity);
                var info = element.Cached;
                string role = identity.Role, name = info.Name ?? "", automationId = info.AutomationId ?? "";
                bool matches = String.IsNullOrEmpty(query) || (name + " " + automationId).IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0;
                if (!matches || (!String.IsNullOrEmpty(roleFilter) && !role.Equals(roleFilter, StringComparison.OrdinalIgnoreCase))) return;
                var actions = Actions(element);
                bool container = Array.IndexOf(new string[] { "Window", "Pane", "Group", "ToolBar", "Tab", "MenuBar" }, role) >= 0;
                if (view == "skeleton") {
                    if (!container || String.IsNullOrEmpty(name)) return;
                } else if (actions.Count == 0 && (String.IsNullOrEmpty(name) || container)) return;
                matched++;
                if (nodes.Count >= limit) return;
                int id = nodes.Count + 1;
                var node = Obj("id", id, "role", role, "name", Clip(name, 160));
                if (view == "skeleton" || scope != null) node["depth"] = depth;
                if (actions.Count > 0) node["actions"] = actions;
                if (!String.IsNullOrEmpty(automationId)) node["automation_id"] = Clip(automationId, 100);
                object pattern;
                if (view != "skeleton" && element.TryGetCachedPattern(ValuePattern.Pattern, out pattern)) { using (Profile("discovery_value_read")) node["value"] = Clip(((ValuePattern)pattern).Cached.Value, 160, node); }
                if (element.TryGetCachedPattern(TogglePattern.Pattern, out pattern)) node["state"] = ((TogglePattern)pattern).Cached.ToggleState.ToString();
                if (element.TryGetCachedPattern(SelectionItemPattern.Pattern, out pattern)) node["selected"] = ((SelectionItemPattern)pattern).Cached.IsSelected;
                if (!info.IsEnabled) node["enabled"] = false;
                nodes.Add(node);
                snapshot.Identities[id] = identity;
            }, handle);
            if (snapshot.Proof != null) VerifyWindow(snapshot.Proof);
            snapshot.CaptureComplete = scan.Complete && snapshot.Proof != null;
            foreach (var entry in snapshot.Identities) {
                int count = 0;
                foreach (var identity in observed) if (entry.Value.Matches(identity)) count++;
                entry.Value.UniqueAtCapture = snapshot.CaptureComplete && entry.Value.Meaningful && count == 1;
                ((Dictionary<string, object>)nodes[entry.Key - 1])["targetable"] = entry.Value.UniqueAtCapture;
            }
            bool truncated = matched > nodes.Count || !scan.Complete;
            var result = Obj("window", WindowInfo(handle), "snapshot", snapshotId, "nodes", nodes, "matched", matched,
                "truncated", truncated, "complete", !truncated, "scanned", scan.Scanned);
            if (view == "skeleton") result["view"] = "skeleton";
            if (scope != null) result["scope"] = Obj("root_snapshot", rootSnapshot, "root_element_id", rootId);
            if (Environment.GetEnvironmentVariable("POKEMON_TIMING") == "1") result["uia_tree_walk_ms"] = scan.Elapsed;
            return result;
        }
    }
    public static object Activate(string windowId) {
        return Activate(windowId, null);
    }
    public static object Activate(string windowId, string windowRef) {
        var handle = Handle(windowId);
        CheckWindow(windowId, windowRef);
        ShowWindow(handle, 9);
        try { CheckWindow(windowId, windowRef); }
        catch (Exception error) { throw new Exception("Window identity changed after the restore attempt. Inspect the window before continuing. " + error.Message); }
        if (!SetForegroundWindow(handle) && GetForegroundWindow() != handle && GetAncestor(GetForegroundWindow(), 3) != handle) throw new Exception("Windows blocked foreground activation. Retry once; get_ui/invoke/set_value often work in the background. Re-read its UI and use windows focus on a known control when available.");
        return Obj("ok", true);
    }
    public static object Foreground() {
        var handle = GetForegroundWindow();
        var info = WindowInfo(handle);
        info["root_owner_id"] = GetAncestor(handle, 3).ToInt64().ToString();
        return info;
    }
    static void RejectScriptHost(string target) {
        string name = Path.GetFileNameWithoutExtension(target).ToLowerInvariant();
        if (Array.IndexOf(new string[] { "cmd", "powershell", "pwsh", "wscript", "cscript", "mshta" }, name) >= 0)
            throw new Exception("launch does not support command shells or script hosts.");
    }
    public static object Launch(string target) {
        if (String.IsNullOrWhiteSpace(target) || target.IndexOfAny(new char[] { '"', '<', '>', '|', '\r', '\n', '\0' }) >= 0)
            throw new Exception("launch requires an http/https URL or executable name/path, without shell commands or arguments.");
        Uri url;
        if (Uri.TryCreate(target, UriKind.Absolute, out url) && (url.Scheme == "http" || url.Scheme == "https")) {
            Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true });
            return Obj("started", url.AbsoluteUri);
        }
        RejectScriptHost(target);
        string executable = null;
        if (target.IndexOfAny(new char[] { '\\', '/' }) >= 0 || Path.IsPathRooted(target)) {
            if (Path.GetExtension(target).Equals(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(target)) executable = Path.GetFullPath(target);
        } else {
            string extension = Path.GetExtension(target);
            if (extension != "" && !extension.Equals(".exe", StringComparison.OrdinalIgnoreCase))
                throw new Exception("launch accepts only an http/https URL or executable name/path.");
            string filename = extension == "" ? target + ".exe" : target;
            foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
                if (String.IsNullOrWhiteSpace(folder)) continue;
                string candidate = Path.Combine(folder.Trim('"'), filename);
                if (File.Exists(candidate)) { executable = Path.GetFullPath(candidate); break; }
            }
            if (executable == null) {
                object shell = null;
                try {
                    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                    shell = Activator.CreateInstance(shellType);
                    foreach (Environment.SpecialFolder location in new Environment.SpecialFolder[] { Environment.SpecialFolder.StartMenu, Environment.SpecialFolder.CommonStartMenu }) {
                        string folder = Environment.GetFolderPath(location);
                        if (!Directory.Exists(folder)) continue;
                        foreach (string shortcut in Directory.GetFiles(folder, "*.lnk", SearchOption.AllDirectories)) {
                            if (!Path.GetFileNameWithoutExtension(shortcut).Equals(Path.GetFileNameWithoutExtension(target), StringComparison.OrdinalIgnoreCase)) continue;
                            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcut });
                            try {
                                // Read TargetPath only: shortcut arguments must never become commands.
                                string candidate = (string)link.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, link, null);
                                if (!Path.GetExtension(candidate).Equals(".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate)) continue;
                                candidate = Path.GetFullPath(candidate);
                                if (executable != null && !executable.Equals(candidate, StringComparison.OrdinalIgnoreCase))
                                    throw new Exception("Multiple Start Menu executables match. Supply the full executable path.");
                                executable = candidate;
                            } finally { Marshal.FinalReleaseComObject(link); }
                        }
                    }
                } finally { if (shell != null) Marshal.FinalReleaseComObject(shell); }
            }
        }
        if (executable == null) throw new Exception("Executable not found in PATH or the Start Menu. Supply its full .exe path; shell commands and arguments are not supported.");
        RejectScriptHost(executable);
        Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
        return Obj("started", executable, "query", Path.GetFileNameWithoutExtension(executable));
    }
    public static object InputMethod() {
        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero) return Obj("status", "unavailable");
        uint process;
        var layout = GetKeyboardLayout(GetWindowThreadProcessId(foreground, out process));
        return Obj("keyboard_layout", unchecked((uint)layout.ToInt64()).ToString("X8"), "language_id", (layout.ToInt64() & 0xffff).ToString("X4"), "imm_ime", ImmIsIME(layout));
    }
    static AutomationElement Target(string snapshotId, int id) {
        Snapshot snapshot;
        ElementIdentity identity;
        if (String.IsNullOrEmpty(snapshotId) || !snapshots.TryGetValue(snapshotId, out snapshot) ||
            (DateTime.UtcNow - snapshot.Created).TotalSeconds > 120 || !snapshot.Identities.TryGetValue(id, out identity)) {
            throw Rejected("STALE_REF", "Unknown or expired element. Call get_ui again; do not reuse an old element id with a new snapshot.");
        }
        return ResolveIdentity(snapshot, identity);
    }
    public static object TextPage(string snapshotId, int id, int offset, int count, string expectedVersion, string requiredText) {
        if (offset < 0 || offset > 1000000 || count < 1 || count > 12000) throw new Exception("Invalid course text page bounds.");
        var element = Target(snapshotId, id);
        object value;
        string full;
        if (element.Current.ControlType != ControlType.Document && element.TryGetCurrentPattern(ValuePattern.Pattern, out value)) {
            full = ((ValuePattern)value).Current.Value ?? "";
        } else {
            var pattern = (TextPattern)element.GetCurrentPattern(TextPattern.Pattern);
            full = pattern.DocumentRange.GetText(1000001) ?? "";
        }
        bool sourceTruncated = full.Length > 1000000;
        if (sourceTruncated) full = full.Substring(0, 1000000);
        string version;
        using (var hash = SHA256.Create()) version = BitConverter.ToString(hash.ComputeHash(Encoding.Unicode.GetBytes(full))).Replace("-", "").ToLowerInvariant();
        if (!String.IsNullOrEmpty(expectedVersion) && expectedVersion != version) throw new Exception("Lesson text changed. Restart read_lesson at offset 0; no navigation was replayed.");
        if (offset > full.Length) throw new Exception("Course text offset is beyond the readable document.");
        int end = Math.Min(full.Length, offset + count);
        if (end < full.Length && end > offset && Char.IsHighSurrogate(full[end - 1]) && Char.IsLowSurrogate(full[end])) end--;
        int matches = 0, first = -1;
        if (!String.IsNullOrEmpty(requiredText)) {
            int position = 0;
            while ((position = full.IndexOf(requiredText, position, StringComparison.Ordinal)) >= 0) {
                if (first < 0) first = position;
                matches++;
                position += requiredText.Length;
            }
        }
        var result = Obj("text", full.Substring(offset, end - offset), "offset", offset, "next_offset", end < full.Length ? (object)end : null,
            "has_more", end < full.Length, "total_characters", full.Length, "source_truncated", sourceTruncated, "version", version);
        if (!String.IsNullOrEmpty(requiredText)) {
            result["match_count"] = matches;
            result["match_excerpt"] = first < 0 ? "" : full.Substring(Math.Max(0, first - 80), Math.Min(full.Length, first + requiredText.Length + 80) - Math.Max(0, first - 80));
        }
        return result;
    }
    public static object Act(string snapshotId, int id, string action, string text, string direction) {
        using (Profile("act_inclusive")) {
            var element = Target(snapshotId, id);
            if (action == "read_text") {
                object editable;
                if (element.Current.ControlType != ControlType.Document && element.TryGetCurrentPattern(ValuePattern.Pattern, out editable)) {
                    var full = ((ValuePattern)editable).Current.Value ?? "";
                    var readResult = Obj("text", Clip(full, 8000));
                    if (full.Length > 8000) readResult["truncated"] = true;
                    return readResult;
                }
                var pattern = (TextPattern)element.GetCurrentPattern(TextPattern.Pattern);
                var documentText = pattern.DocumentRange.GetText(8001) ?? "";
                var documentResult = Obj("text", Clip(documentText, 8000));
                if (documentText.Length > 8000) documentResult["truncated"] = true;
                return documentResult;
            }
            if (element.Current.IsOffscreen || !element.Current.IsEnabled) throw Rejected("ACTION_NOT_SUPPORTED", "Control is hidden or disabled. Call get_ui again.");
            object value;
            using (Profile("pattern_dispatch_inclusive")) {
                switch (action) {
                    case "focus": ConfirmTarget(snapshotId, id, element); using (Profile("pattern_action")) element.SetFocus(); break;
                    case "invoke":
                        var invoking = (InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern);
                        ConfirmTarget(snapshotId, id, element); using (Profile("pattern_action")) invoking.Invoke(); break;
                    case "set_value":
                        var editable = (ValuePattern)element.GetCurrentPattern(ValuePattern.Pattern);
                        if (editable.Current.IsReadOnly) throw Rejected("ACTION_NOT_SUPPORTED", "Control is read-only.");
                        ConfirmTarget(snapshotId, id, element); using (Profile("pattern_action")) editable.SetValue(text ?? ""); break;
                    case "select":
                        var selection = (SelectionItemPattern)element.GetCurrentPattern(SelectionItemPattern.Pattern);
                        ConfirmTarget(snapshotId, id, element); using (Profile("pattern_action")) selection.Select(); break;
                    case "toggle":
                        var toggle = (TogglePattern)element.GetCurrentPattern(TogglePattern.Pattern);
                        ConfirmTarget(snapshotId, id, element); using (Profile("pattern_action")) toggle.Toggle(); break;
                    case "expand":
                        var expanding = (ExpandCollapsePattern)element.GetCurrentPattern(ExpandCollapsePattern.Pattern);
                        ConfirmTarget(snapshotId, id, element); using (Profile("pattern_action")) expanding.Expand(); break;
                    case "collapse":
                        var collapsing = (ExpandCollapsePattern)element.GetCurrentPattern(ExpandCollapsePattern.Pattern);
                        ConfirmTarget(snapshotId, id, element); using (Profile("pattern_action")) collapsing.Collapse(); break;
                    case "scroll":
                        var scrolling = (ScrollPattern)element.GetCurrentPattern(ScrollPattern.Pattern);
                        ScrollAmount horizontal = ScrollAmount.NoAmount, vertical = ScrollAmount.NoAmount;
                        if (direction == "up") vertical = ScrollAmount.LargeDecrement;
                        else if (direction == "down") vertical = ScrollAmount.LargeIncrement;
                        else if (direction == "left") horizontal = ScrollAmount.LargeDecrement;
                        else if (direction == "right") horizontal = ScrollAmount.LargeIncrement;
                        else throw new Exception("Scroll requires up, down, left, or right.");
                        ConfirmTarget(snapshotId, id, element); using (Profile("pattern_action")) scrolling.Scroll(horizontal, vertical); break;
                    default: throw new Exception("Unsupported UI Automation action.");
                }
            }
            var result = Obj("ok", true);
            using (Profile("post_action_value_read")) {
                try {
                    if (element.TryGetCurrentPattern(ValuePattern.Pattern, out value)) result["value"] = Clip(((ValuePattern)value).Current.Value, 160, result);
                } catch (ElementNotAvailableException) { }
            }
            return result;
        }
    }
}
