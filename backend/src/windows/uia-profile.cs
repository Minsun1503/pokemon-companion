using System;
using System.Collections.Generic;
using System.Diagnostics;

public static partial class PokemonWindowsAutomation {
    // The worker dispatches synchronously. Profiles contain fixed phase names only;
    // no window handles, selectors, values, or protected-key material are recorded.
    static Dictionary<string, double> profileTimes;
    static Dictionary<string, int> profileCounts;
    public static void BeginProfile() {
        bool enabled = Environment.GetEnvironmentVariable("POKEMON_TIMING") == "1";
        profileTimes = enabled ? new Dictionary<string, double>() : null;
        profileCounts = enabled ? new Dictionary<string, int>() : null;
    }
    public static object EndProfile() {
        if (profileTimes == null) return null;
        var result = Obj("phase_ms", profileTimes, "counts", profileCounts);
        profileTimes = null;
        profileCounts = null;
        return result;
    }
    sealed class ProfileScope : IDisposable {
        readonly string name;
        readonly long started;
        bool disposed;
        public ProfileScope(string phase) { name = phase; started = Stopwatch.GetTimestamp(); }
        public void Dispose() {
            if (disposed || profileTimes == null) return;
            disposed = true;
            double total;
            profileTimes.TryGetValue(name, out total);
            profileTimes[name] = total + (Stopwatch.GetTimestamp() - started) * 1000.0 / Stopwatch.Frequency;
            int count;
            profileCounts.TryGetValue(name, out count);
            profileCounts[name] = count + 1;
        }
    }
    static IDisposable Profile(string phase) {
        return profileTimes == null ? null : new ProfileScope(phase);
    }
}
