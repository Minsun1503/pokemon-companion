using System;
using System.Diagnostics;
using System.Security.Principal;
using System.Threading;

public static partial class PokemonWindowsAutomation {
    static Mutex controlMutex;
    static bool ownsControl;
    public static object AcquireControl() {
        if (ownsControl) throw Rejected("INVALID_ARGS", "The worker already owns the desktop control lease.");
        if (controlMutex == null) {
            string name = "Local\\PokemonCompanion.DesktopControl." + WindowsIdentity.GetCurrent().User.Value
                + "." + Process.GetCurrentProcess().SessionId;
            controlMutex = new Mutex(false, name);
        }
        bool abandoned = false;
        try { ownsControl = controlMutex.WaitOne(0); }
        catch (AbandonedMutexException) { ownsControl = true; abandoned = true; snapshots.Clear(); windowProofs.Clear(); }
        return Obj("acquired", ownsControl, "abandoned", abandoned);
    }
    public static object ReleaseControl() {
        if (!ownsControl) throw Rejected("INVALID_ARGS", "The worker does not own the desktop control lease.");
        controlMutex.ReleaseMutex();
        ownsControl = false;
        return Obj("released", true);
    }
}
