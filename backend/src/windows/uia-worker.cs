using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Security.Cryptography;
using System.Windows.Automation;

public static class PokemonWindowsAutomation {
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder className, int count);
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
        public DateTime Created = DateTime.UtcNow;
        public Dictionary<int, AutomationElement> Elements = new Dictionary<int, AutomationElement>();
        public Dictionary<int, string> RuntimeIds = new Dictionary<int, string>();
    }
    class Visit {
        public AutomationElement Element;
        public int Depth;
        public bool IsRoot;
        public Visit(AutomationElement element, int depth, bool isRoot = false) { Element = element; Depth = depth; IsRoot = isRoot; }
    }
    static Dictionary<string, Snapshot> snapshots = new Dictionary<string, Snapshot>();
    static Dictionary<string, object> Obj(params object[] values) {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < values.Length; i += 2) result[(string)values[i]] = values[i + 1];
        return result;
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
        if (!Int64.TryParse(id, out value) || !IsWindow(new IntPtr(value))) throw new Exception("Window no longer exists. Call get_windows again.");
        return new IntPtr(value);
    }
    static Dictionary<string, object> WindowInfo(IntPtr handle) {
        var title = new StringBuilder(1024);
        GetWindowText(handle, title, title.Capacity);
        uint pid;
        GetWindowThreadProcessId(handle, out pid);
        string process = "";
        try { process = Process.GetProcessById((int)pid).ProcessName; } catch { }
        return Obj("id", handle.ToInt64().ToString(), "title", Clip(title.ToString(), 200), "process", process);
    }
    public static object Windows(string query) {
        var windows = new List<object>();
        EnumWindows(delegate(IntPtr handle, IntPtr unused) {
            if (!IsWindowVisible(handle)) return true;
            var info = WindowInfo(handle);
            var title = (string)info["title"];
            if (String.IsNullOrEmpty(title)) return true;
            if (!String.IsNullOrEmpty(query) && (title + " " + info["process"]).IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0) return true;
            var foreground = GetForegroundWindow();
            info["active"] = handle == foreground || handle == GetAncestor(foreground, 3);
            windows.Add(info);
            return windows.Count < 100;
        }, IntPtr.Zero);
        return Obj("windows", windows);
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
    static string RuntimeId(AutomationElement element) { return String.Join(".", element.GetRuntimeId()); }
    public static object UI(string windowId, string query, string roleFilter, int limit, int maxDepth) {
        var handle = Handle(windowId);
        var root = AutomationElement.FromHandle(handle);
        if (root == null) throw new Exception("UI Automation is unavailable for this window. Use keyboard shortcuts or a screenshot fallback.");
        var classNameBuilder = new StringBuilder(256);
        GetClassName(handle, classNameBuilder, classNameBuilder.Capacity);
        bool isChromium = classNameBuilder.ToString().IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) >= 0;
        var expired = new List<string>();
        foreach (var entry in snapshots) if ((DateTime.UtcNow - entry.Value.Created).TotalSeconds > 120) expired.Add(entry.Key);
        foreach (var key in expired) snapshots.Remove(key);
        if (snapshots.Count >= 8) {
            string oldestId = null;
            DateTime oldest = DateTime.MaxValue;
            foreach (var entry in snapshots) if (entry.Value.Created < oldest) { oldest = entry.Value.Created; oldestId = entry.Key; }
            snapshots.Remove(oldestId);
        }
        var snapshot = new Snapshot { Window = handle };
        var snapshotId = Guid.NewGuid().ToString("N");
        snapshots[snapshotId] = snapshot;
        var watch = Stopwatch.StartNew();
        var cache = new CacheRequest { TreeScope = TreeScope.Element };
        foreach (var property in new AutomationProperty[] {
            AutomationElement.IsOffscreenProperty, AutomationElement.IsPasswordProperty, AutomationElement.IsEnabledProperty,
            AutomationElement.IsKeyboardFocusableProperty, AutomationElement.ControlTypeProperty, AutomationElement.NameProperty,
            AutomationElement.AutomationIdProperty,
            ValuePattern.IsReadOnlyProperty, TogglePattern.ToggleStateProperty, SelectionItemPattern.IsSelectedProperty
        }) cache.Add(property);
        foreach (var pattern in new AutomationPattern[] {
            InvokePattern.Pattern, ValuePattern.Pattern, SelectionItemPattern.Pattern, TogglePattern.Pattern,
            ExpandCollapsePattern.Pattern, ScrollPattern.Pattern, TextPattern.Pattern
        }) cache.Add(pattern);
        var nodes = new List<object>();
        var pending = new Stack<Visit>();
        pending.Push(new Visit(root.GetUpdatedCache(cache), 0, true));
        int scanned = 0, matched = 0;
        bool depthLimited = false;
        while (pending.Count > 0 && scanned < 2500 && watch.ElapsedMilliseconds < 8000) {
            var visit = pending.Pop();
            scanned++;
            try {
                var element = visit.Element;
                // Queue one sibling at a time instead of fetching hundreds before inspecting any.
                if (!visit.IsRoot) {
                    var sibling = TreeWalker.ControlViewWalker.GetNextSibling(element, cache);
                    if (sibling != null) pending.Push(new Visit(sibling, visit.Depth));
                }
                var info = element.Cached;
                if (info.IsOffscreen || info.IsPassword) continue;
                string role = info.ControlType.ProgrammaticName.Replace("ControlType.", ""), name = info.Name ?? "", automationId = info.AutomationId ?? "";
                var actions = Actions(element);
                bool matches = String.IsNullOrEmpty(query) || (name + " " + automationId).IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0;
                if (matches && (String.IsNullOrEmpty(roleFilter) || role.Equals(roleFilter, StringComparison.OrdinalIgnoreCase))) {
                    bool useful = actions.Count > 0 || (!String.IsNullOrEmpty(name) && role != "Pane" && role != "Group" && role != "Window");
                    if (useful) {
                        matched++;
                        // One extra match proves truncation/ambiguity without walking the remaining tree.
                        if (nodes.Count == limit) break;
                        int id = nodes.Count + 1;
                        snapshot.Elements[id] = element;
                        snapshot.RuntimeIds[id] = RuntimeId(element);
                        var node = Obj("id", id, "role", role, "name", Clip(name, 160));
                        if (actions.Count > 0) node["actions"] = actions;
                        if (!String.IsNullOrEmpty(automationId)) node["automation_id"] = Clip(automationId, 100);
                        object pattern;
                        // Mutable field values stay live so fast reads preserve existing verification behavior.
                        if (element.TryGetCachedPattern(ValuePattern.Pattern, out pattern)) node["value"] = Clip(((ValuePattern)pattern).Current.Value, 160, node);
                        if (element.TryGetCachedPattern(TogglePattern.Pattern, out pattern)) node["state"] = ((TogglePattern)pattern).Cached.ToggleState.ToString();
                        if (element.TryGetCachedPattern(SelectionItemPattern.Pattern, out pattern)) node["selected"] = ((SelectionItemPattern)pattern).Cached.IsSelected;
                        if (!info.IsEnabled) node["enabled"] = false;
                        nodes.Add(node);
                    }
                }
                // Credit: Adapted from Vercel Labs agent-desktop (https://github.com/vercel-labs/agent-desktop)
                // A transparent web wrapper in Chromium/Electron (Group, Custom, Pane with no name, no automationId, no actions)
                // consumes raw depth but skips logical depth to avoid hitting maxDepth prematurely.
                bool isWebWrapper = isChromium &&
                    (role == "Pane" || role == "Group" || role == "Custom") &&
                    String.IsNullOrEmpty(name) &&
                    String.IsNullOrEmpty(automationId) &&
                    actions.Count == 0;
                int nextDepth = isWebWrapper ? visit.Depth : visit.Depth + 1;
                if (nextDepth <= maxDepth) {
                    var child = TreeWalker.ControlViewWalker.GetFirstChild(element, cache);
                    if (child != null) pending.Push(new Visit(child, nextDepth));
                } else depthLimited = true;
            } catch (ElementNotAvailableException) { } catch (InvalidOperationException) { }
        }
        var result = Obj("window", WindowInfo(handle), "snapshot", snapshotId, "nodes", nodes, "matched", matched,
            "truncated", matched > nodes.Count || pending.Count > 0 || depthLimited, "scanned", scanned);
        if (Environment.GetEnvironmentVariable("POKEMON_TIMING") == "1") result["uia_tree_walk_ms"] = watch.Elapsed.TotalMilliseconds;
        return result;
    }
    public static object Activate(string windowId) {
        var handle = Handle(windowId);
        ShowWindow(handle, 9);
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
        AutomationElement element;
        if (String.IsNullOrEmpty(snapshotId) || !snapshots.TryGetValue(snapshotId, out snapshot) ||
            (DateTime.UtcNow - snapshot.Created).TotalSeconds > 120 || !snapshot.Elements.TryGetValue(id, out element)) {
            throw new Exception("Unknown or expired element. Call get_ui again; do not reuse an old element id with a new snapshot.");
        }
        if (!IsWindow(snapshot.Window) || RuntimeId(element) != snapshot.RuntimeIds[id]) throw new Exception("Element has changed. Call get_ui again.");
        var root = element;
        bool belongs = false;
        for (int i = 0; root != null && i < 80; i++) {
            if (root.Current.NativeWindowHandle == snapshot.Window.ToInt64()) { belongs = true; break; }
            root = TreeWalker.RawViewWalker.GetParent(root);
        }
        if (!belongs) throw new Exception("Element no longer belongs to the selected window. Call get_ui again.");
        if (element.Current.IsPassword) throw new Exception("Password controls are not exposed.");
        return element;
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
        if (element.Current.IsOffscreen || !element.Current.IsEnabled) throw new Exception("Control is hidden or disabled. Call get_ui again.");
        object value;
        switch (action) {
            case "focus": element.SetFocus(); break;
            case "invoke": ((InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); break;
            case "set_value":
                var editable = (ValuePattern)element.GetCurrentPattern(ValuePattern.Pattern);
                if (editable.Current.IsReadOnly) throw new Exception("Control is read-only.");
                editable.SetValue(text ?? ""); break;
            case "select": ((SelectionItemPattern)element.GetCurrentPattern(SelectionItemPattern.Pattern)).Select(); break;
            case "toggle": ((TogglePattern)element.GetCurrentPattern(TogglePattern.Pattern)).Toggle(); break;
            case "expand": ((ExpandCollapsePattern)element.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Expand(); break;
            case "collapse": ((ExpandCollapsePattern)element.GetCurrentPattern(ExpandCollapsePattern.Pattern)).Collapse(); break;
            case "scroll":
                var scrolling = (ScrollPattern)element.GetCurrentPattern(ScrollPattern.Pattern);
                ScrollAmount horizontal = ScrollAmount.NoAmount, vertical = ScrollAmount.NoAmount;
                if (direction == "up") vertical = ScrollAmount.LargeDecrement;
                else if (direction == "down") vertical = ScrollAmount.LargeIncrement;
                else if (direction == "left") horizontal = ScrollAmount.LargeDecrement;
                else if (direction == "right") horizontal = ScrollAmount.LargeIncrement;
                else throw new Exception("Scroll requires up, down, left, or right.");
                scrolling.Scroll(horizontal, vertical); break;
            default: throw new Exception("Unsupported UI Automation action.");
        }
        var result = Obj("ok", true);
        try {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out value)) result["value"] = Clip(((ValuePattern)value).Current.Value, 160, result);
        } catch (ElementNotAvailableException) { }
        return result;
    }
}
