#include <errno.h>
#include <limits.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc.h>
#include <sys/proc_info.h>

// Read kernel process metadata only. Avoid Mach task/thread inspection and
// argument snapshots: even ps restricted to three PIDs exceeded five seconds.
int main(int argc, char **argv) {
    int identity = argc > 1 && strcmp(argv[1], "--identity") == 0;
    int first = identity ? 2 : 1;
    if (argc <= first) {
        fprintf(stderr, "Require explicit candidate PIDs.\n");
        return EXIT_FAILURE;
    }
    for (int index = first; index < argc; index++) {
        char *end = NULL;
        errno = 0;
        long value = strtol(argv[index], &end, 10);
        if (errno || argv[index][0] < '0' || argv[index][0] > '9' ||
            *end || value <= 1 || value > INT_MAX) {
            fprintf(stderr, "Invalid process identity.\n");
            return EXIT_FAILURE;
        }
        int pid = (int)value;
        struct proc_bsdinfo info = {0};
        errno = 0;
        int size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
        if (size == 0 && errno == ESRCH) continue;
        if (size != (int)sizeof(info) || info.pbi_pid != (unsigned int)pid) {
            fprintf(stderr, "Cannot read kernel process state for %d: %s\n", pid, strerror(errno));
            return EXIT_FAILURE;
        }
        if (info.pbi_status == SZOMB) continue;
        char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
        errno = 0;
        if (proc_pidpath(pid, path, sizeof(path)) <= 0) {
            if (errno == ESRCH) continue;
            fprintf(stderr, "Cannot read executable path for %d: %s\n", pid, strerror(errno));
            return EXIT_FAILURE;
        }
        if (path[0] != '/' || !memchr(path, 0, sizeof(path)) ||
            strchr(path, '\n') || strchr(path, '\r')) {
            fprintf(stderr, "Invalid kernel executable path for %d.\n", pid);
            return EXIT_FAILURE;
        }
        // Keep the cleanup API unchanged. Failure sampling additionally pins
        // the kernel launch time, so a reused PID cannot qualify a report.
        if (identity) {
            if (info.pbi_start_tvsec == 0 || info.pbi_start_tvusec >= 1000000) {
                fprintf(stderr, "Invalid kernel process launch time for %d.\n", pid);
                return EXIT_FAILURE;
            }
            printf("%d L@%llu.%06llu %s\n", pid,
                (unsigned long long)info.pbi_start_tvsec,
                (unsigned long long)info.pbi_start_tvusec, path);
        } else {
            // L denotes a live process; zombies were excluded above.
            printf("%d L %s\n", pid, path);
        }
    }
    return EXIT_SUCCESS;
}
