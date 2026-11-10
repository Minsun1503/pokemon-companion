using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Automation;

public static partial class PokemonWindowsAutomation {
    class WalkReport {
        public bool Complete = true;
        public int Scanned;
        public double Elapsed;
    }
    static CacheRequest IdentityCache() {
        var cache = new CacheRequest { TreeScope = TreeScope.Element };
        foreach (var property in new AutomationProperty[] {
            AutomationElement.IsOffscreenProperty, AutomationElement.IsPasswordProperty, AutomationElement.ControlTypeProperty,
            AutomationElement.NameProperty, AutomationElement.AutomationIdProperty, AutomationElement.HelpTextProperty
        }) cache.Add(property);
        cache.Add(ValuePattern.Pattern);
        // Identity compares name/value evidence from the same fresh cache read.
        // Reading Current.Value separately for every editable node adds a provider
        // round trip and can mix a new value with an earlier accessible name.
        cache.Add(ValuePattern.ValueProperty);
        return cache;
    }
    static CacheRequest DiscoveryCache() {
        var cache = IdentityCache();
        foreach (var property in new AutomationProperty[] {
            AutomationElement.IsEnabledProperty, AutomationElement.IsKeyboardFocusableProperty,
            ValuePattern.IsReadOnlyProperty, TogglePattern.ToggleStateProperty, SelectionItemPattern.IsSelectedProperty
        }) cache.Add(property);
        foreach (var pattern in new AutomationPattern[] {
            InvokePattern.Pattern, SelectionItemPattern.Pattern, TogglePattern.Pattern, ExpandCollapsePattern.Pattern, ScrollPattern.Pattern, TextPattern.Pattern
        }) cache.Add(pattern);
        return cache;
    }
    static WalkReport WalkWindow(AutomationElement root, CacheRequest cache, int maxDepth, Action<AutomationElement, int> visit, IntPtr window) {
        if (root == null) throw Rejected("WINDOW_NOT_FOUND", "The target window has no accessibility root.");
        var report = new WalkReport();
        bool isChromium = WindowClass(window).IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) >= 0;
        if (isChromium) cache = DiscoveryCache(); // Wrapper actionability must be observed during capture and resolution alike.
        var watch = Stopwatch.StartNew();
        var pending = new Stack<Visit>();
        pending.Push(new Visit(root.GetUpdatedCache(cache), 0, true));
        while (pending.Count > 0 && report.Scanned < 2500 && watch.ElapsedMilliseconds < 8000) {
            var entry = pending.Pop();
            report.Scanned++;
            try {
                var element = entry.Element;
                if (!entry.IsRoot) {
                    var sibling = TreeWalker.ControlViewWalker.GetNextSibling(element, cache);
                    if (sibling != null) pending.Push(new Visit(sibling, entry.Depth, false, entry.RawDepth));
                }
                if (element.Cached.IsOffscreen || element.Cached.IsPassword) continue;
                visit(element, entry.Depth);
                var child = TreeWalker.ControlViewWalker.GetFirstChild(element, cache);
                if (child != null) {
                    var info = element.Cached;
                    string role = info.ControlType.ProgrammaticName.Replace("ControlType.", "");
                    // Preserve main's logical-depth flattening of transparent Chromium wrappers.
                    bool wrapper = isChromium && (role == "Pane" || role == "Group" || role == "Custom")
                        && String.IsNullOrEmpty(info.Name) && String.IsNullOrEmpty(info.AutomationId) && Actions(element).Count == 0;
                    int nextDepth = wrapper ? entry.Depth : entry.Depth + 1;
                    if (nextDepth <= maxDepth && entry.RawDepth < 79) pending.Push(new Visit(child, nextDepth, false, entry.RawDepth + 1));
                    else report.Complete = false;
                }
            } catch (ElementNotAvailableException) { report.Complete = false; }
            catch (InvalidOperationException) { report.Complete = false; }
        }
        if (pending.Count > 0) report.Complete = false;
        report.Elapsed = watch.Elapsed.TotalMilliseconds;
        return report;
    }
}
