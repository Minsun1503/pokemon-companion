/* Native launcher for the portable Linux executable and macOS app bundle. */
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

static void directory(char *path) {
    char *slash = strrchr(path, '/');
    if (slash) *slash = '\0';
}

static int mkdirs(const char *path) {
    char buffer[PATH_MAX];
    if (snprintf(buffer, sizeof(buffer), "%s", path) >= (int)sizeof(buffer)) return -1;
    for (char *p = buffer + 1; *p; ++p) {
        if (*p == '/') {
            *p = '\0';
            if (mkdir(buffer, 0700) != 0 && errno != EEXIST) return -1;
            *p = '/';
        }
    }
    return mkdir(buffer, 0700) == 0 || errno == EEXIST ? 0 : -1;
}

int main(int argc, char **argv) {
    char executable[PATH_MAX], resolved[PATH_MAX], root[PATH_MAX];
#ifdef __APPLE__
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) != 0) return 1;
#else
    ssize_t size = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
    if (size < 0) return 1;
    executable[size] = '\0';
#endif
    if (!realpath(executable, resolved)) return 1;
    directory(resolved);
#ifdef __APPLE__
    if (snprintf(root, sizeof(root), "%s/../Resources/app", resolved) >= (int)sizeof(root)) return 1;
    if (!realpath(root, resolved)) return 1;
    snprintf(root, sizeof(root), "%s", resolved);
#else
    snprintf(root, sizeof(root), "%s", resolved);
#endif
    char node[PATH_MAX], entry[PATH_MAX], frontend[PATH_MAX], profile[PATH_MAX], log[PATH_MAX];
    if (snprintf(node, sizeof(node), "%s/runtime/node", root) >= (int)sizeof(node)
        || snprintf(entry, sizeof(entry), "%s/backend/dist/standalone.js", root) >= (int)sizeof(entry)
        || snprintf(frontend, sizeof(frontend), "%s/frontend", root) >= (int)sizeof(frontend)) return 1;
    const char *override = getenv("POKEMON_STANDALONE_USER_DATA_DIR");
    const char *home = getenv("HOME");
    if (!home) home = ".";
    if (override && *override) snprintf(profile, sizeof(profile), "%s", override);
#ifdef __APPLE__
    else snprintf(profile, sizeof(profile), "%s/Library/Application Support/pokemon-companion", home);
#else
    else {
        const char *data = getenv("XDG_DATA_HOME");
        if (data && *data) snprintf(profile, sizeof(profile), "%s/pokemon-companion", data);
        else snprintf(profile, sizeof(profile), "%s/.local/share/pokemon-companion", home);
    }
#endif
    if (mkdirs(profile) != 0) { perror("Could not create the companion profile"); return 1; }
    setenv("POKEMON_FRONTEND_DIR", frontend, 1);
    setenv("POKEMON_USER_DATA_DIR", profile, 1);
    setenv("POKEMON_WINDOW_TITLE", "Pokémon Companion", 1);
    unsetenv("POKEMON_UI");
    unsetenv("ELECTRON_RUN_AS_NODE");
    unsetenv("POKEMON_AGENT_AUDIT");
    if (chdir(root) != 0) return 1;
    int smoke = argc == 2 && strcmp(argv[1], "--smoke-test") == 0;
    if (!smoke) {
        if (snprintf(log, sizeof(log), "%s/app.log", profile) >= (int)sizeof(log)) return 1;
        if (!freopen(log, "a", stdout) || !freopen(log, "a", stderr)) return 1;
    }
    char *args[] = {node, entry, smoke ? "--smoke-test" : NULL, NULL};
    execv(node, args);
    perror("Could not start the bundled runtime");
    return 1;
}
