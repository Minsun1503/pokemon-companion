using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static partial class PokemonWindowsAutomation {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry {
        public uint Size, Usage, ProcessId;
        public UIntPtr Heap;
        public uint Module, Threads, ParentId;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);

    static HashSet<uint> ProcessFamily(uint root) {
        var result = new HashSet<uint>(); result.Add(root);
        var parents = new Dictionary<uint, uint>();
        var snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) return result;
        try {
            var entry = new ProcessEntry(); entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            if (Process32FirstW(snapshot, ref entry)) do { parents[entry.ProcessId] = entry.ParentId; } while (Process32NextW(snapshot, ref entry));
        } finally { CloseHandle(snapshot); }
        for (int depth = 0; depth < 8; depth++) {
            bool changed = false;
            foreach (var pair in parents) if (result.Contains(pair.Value) && result.Add(pair.Key)) changed = true;
            if (!changed) break;
        }
        return result;
    }

    public static object AppIdentity(string windowId) {
        uint pid; GetWindowThreadProcessId(Handle(windowId), out pid);
        var owner = OpenProcess(0x1000, false, pid);
        if (owner == IntPtr.Zero) throw Rejected("IDENTITY_UNAVAILABLE", "Cannot read this application's executable identity.");
        string path;
        try {
            var name = new StringBuilder(2048); uint length = (uint)name.Capacity;
            if (!QueryFullProcessImageName(owner, 0, name, ref length)) throw Rejected("IDENTITY_UNAVAILABLE", "Cannot identify this application executable.");
            path = name.ToString();
        } finally { CloseHandle(owner); }
        string started; using (var process = Process.GetProcessById((int)pid)) started = process.StartTime.ToUniversalTime().Ticks.ToString();
        string version = ""; try { version = FileVersionInfo.GetVersionInfo(path).FileVersion ?? ""; } catch { }
        return Obj("process_id", pid, "process_started", started, "image_path", path, "version", version, "process_family", new List<uint>(ProcessFamily(pid)));
    }
    [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageTimeoutW")]
    static extern IntPtr ReadWindowMessage(IntPtr window, uint message, IntPtr count, StringBuilder text, uint flags, uint timeout, out IntPtr result);

    // Local listeners owned by the selected application process family; no active port scan.
    public static object CdpPorts(string windowId) {
        var handle = Handle(windowId);
        uint pid;
        GetWindowThreadProcessId(handle, out pid);
        var family = ProcessFamily(pid);
        var ports = new List<int>();
        var listeners = new List<object>();
        int size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, 2, 3, 0); // AF_INET, TCP_TABLE_OWNER_PID_LISTENER
        if (size <= 0 || size > 16 * 1024 * 1024) return Obj("process_id", pid, "ports", ports, "supported", false);
        var buffer = Marshal.AllocHGlobal(size);
        try {
            if (GetExtendedTcpTable(buffer, ref size, false, 2, 3, 0) != 0) return Obj("process_id", pid, "ports", ports, "supported", false);
            int rows = Marshal.ReadInt32(buffer);
            for (int i = 0; i < rows && i < (size - 4) / 24; i++) {
                int offset = 4 + i * 24;
                uint owner = (uint)Marshal.ReadInt32(buffer, offset + 20);
                uint address = (uint)Marshal.ReadInt32(buffer, offset + 4);
                if (!family.Contains(owner) || address != 0x0100007F) continue;
                int port = (Marshal.ReadByte(buffer, offset + 8) << 8) | Marshal.ReadByte(buffer, offset + 9);
                if (!ports.Contains(port) && ports.Count < 16) {ports.Add(port); listeners.Add(Obj("endpoint", "http://127.0.0.1:" + port, "process_id", owner));}
            }
        } finally { Marshal.FreeHGlobal(buffer); }
        int size6 = 0; GetExtendedTcpTable(IntPtr.Zero, ref size6, false, 23, 3, 0);
        if (size6 > 0 && size6 <= 16 * 1024 * 1024) {
            var table = Marshal.AllocHGlobal(size6);
            try {
                if (GetExtendedTcpTable(table, ref size6, false, 23, 3, 0) == 0) {
                    int rows = Marshal.ReadInt32(table);
                    for (int i = 0; i < rows && i < (size6 - 4) / 56 && listeners.Count < 32; i++) {
                        int offset = 4 + i * 56; uint owner = (uint)Marshal.ReadInt32(table, offset + 52);
                        if (!family.Contains(owner)) continue;
                        bool zero = true; for (int j = 0; j < 15; j++) if (Marshal.ReadByte(table, offset + j) != 0) zero = false;
                        byte last = Marshal.ReadByte(table, offset + 15); if (!zero || last != 1) continue;
                        int port = (Marshal.ReadByte(table, offset + 20) << 8) | Marshal.ReadByte(table, offset + 21);
                        listeners.Add(Obj("endpoint", "http://[::1]:" + port, "process_id", owner));
                    }
                }
            } finally { Marshal.FreeHGlobal(table); }
        }
        return Obj("process_id", pid, "ports", ports, "listeners", listeners, "supported", true, "scope", "selected_application_process_family_local_listeners");
    }

    public static object EndpointOwner(string windowId, string address) {
        Uri uri; if (!Uri.TryCreate(address, UriKind.Absolute, out uri) || !uri.IsLoopback) throw Rejected("INVALID_ARGS", "Endpoint must be loopback.");
        var probe = (Dictionary<string, object>)CdpPorts(windowId);
        bool owns = false;
        object list; if (probe.TryGetValue("listeners", out list)) foreach (Dictionary<string, object> listener in (List<object>)list) {
            var local = new Uri((string)listener["endpoint"]);
            if (local.Port == uri.Port && ((local.Host == "127.0.0.1" && (uri.Host == "localhost" || uri.Host == "127.0.0.1")) || local.Host == uri.Host)) owns = true;
        }
        return Obj("owns", owns, "scope", "selected_application_process_family");
    }

    // HWND text precedes UIA. Modern Chromium surfaces normally expose no useful child text.
    public static object Win32Text(string windowId, string query, int maxChars) {
        var handle = Handle(windowId);
        var nodes = new List<object>();
        var clock = Stopwatch.StartNew();
        int seen = 0, chars = 0;
        bool truncated = false;
        EnumChildWindows(handle, delegate(IntPtr child, IntPtr unused) {
            if (++seen > 200 || clock.ElapsedMilliseconds > 2000) { truncated = true; return false; }
            if (!IsWindowVisible(child)) return true;
            var text = new StringBuilder(Math.Min(1024, Math.Max(1, maxChars - chars)));
            IntPtr read;
            if (ReadWindowMessage(child, 0x000D, new IntPtr(text.Capacity), text, 2, 50, out read) == IntPtr.Zero) return true;
            var value = text.ToString();
            if (String.IsNullOrWhiteSpace(value) || (!String.IsNullOrEmpty(query) && value.IndexOf(query, StringComparison.OrdinalIgnoreCase) < 0)) return true;
            nodes.Add(Obj("window_id", child.ToInt64().ToString(), "class_name", WindowClass(child), "text", value));
            chars += value.Length;
            if (chars >= maxChars - 1) { truncated = true; return false; }
            return true;
        }, IntPtr.Zero);
        return Obj("window", WindowInfo(handle), "nodes", nodes, "available", nodes.Count > 0, "truncated", truncated, "method", "Win32_WM_GETTEXT");
    }
}
