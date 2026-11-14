#include <errno.h>
#include <limits.h>
#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc.h>
#include <sys/proc_info.h>

// Read kernel process metadata only. Avoid Mach task/thread inspection and
// argument snapshots: even ps restricted to three PIDs exceeded five seconds.
// The same applies to thread enumeration: proc_pidinfo thread flavors copy
// proc-table rows inside one syscall each — no task_for_pid, no target
// suspension, no debugger handshake — so they still answer when lldb attach
// and `sample` cannot finish inside their caps.
static int parsePid(const char *text) {
    char *end = NULL;
    errno = 0;
    long value = strtol(text, &end, 10);
    if (errno || text[0] < '0' || text[0] > '9' ||
        *end || value <= 1 || value > INT_MAX) {
        fprintf(stderr, "Invalid process identity.\n");
        exit(EXIT_FAILURE);
    }
    return (int)value;
}

static char runState(int state) {
    switch (state) {
        case TH_STATE_RUNNING: return 'R';
        case TH_STATE_STOPPED: return 'T';
        case TH_STATE_WAITING: return 'W';
        case TH_STATE_UNINTERRUPTIBLE: return 'U';
        case TH_STATE_HALTED: return 'H';
        default: return '?';
    }
}

static int inspectThreads(int pid) {
    // This flavor cannot be sized in advance: an undersized buffer fails
    // ENOMEM rather than reporting the needed length, and a NULL buffer is
    // rejected the same way. Copy the whole ID table into one bounded read
    // instead — still a single syscall, no task_for_pid, no suspension.
    enum { MAX_THREAD_IDS = 4096 };
    uint64_t *threadIds = calloc(MAX_THREAD_IDS, sizeof(uint64_t));
    if (!threadIds) {
        fprintf(stderr, "Cannot reserve kernel thread storage.\n");
        return EXIT_FAILURE;
    }
    errno = 0;
    int stored = proc_pidinfo(pid, PROC_PIDLISTTHREADS, 0, threadIds,
                              MAX_THREAD_IDS * (int)sizeof(uint64_t));
    if (stored <= 0) {
        free(threadIds);
        if (errno == ESRCH) return EXIT_SUCCESS;
        fprintf(stderr, "Cannot read kernel thread list for %d: %s\n", pid, strerror(errno));
        return EXIT_FAILURE;
    }
    int count = stored / (int)sizeof(uint64_t);
    for (int index = 0; index < count; index++) {
        struct proc_threadinfo info = {0};
        if (proc_pidinfo(pid, PROC_PIDTHREADINFO, threadIds[index],
                         &info, sizeof(info)) != (int)sizeof(info)) continue;
        // pth_name is a fixed-size kernel field that may fill every byte
        // without a NUL. Byte-copy with both bounds explicit rather than a
        // memcpy whose size proof static analyzers cannot see.
        char name[MAXTHREADNAMESIZE + 1] = {0};
        for (int byte = 0; byte < MAXTHREADNAMESIZE; byte++) {
            if (!info.pth_name[byte]) break;
            name[byte] = info.pth_name[byte];
        }
        for (char *cursor = name; *cursor; cursor++) {
            if (*cursor == '\n' || *cursor == '\r') *cursor = ' ';
        }
        printf("%d %llu %c %d %d %s\n", pid, (unsigned long long)threadIds[index],
               runState(info.pth_run_state), info.pth_cpu_usage,
               info.pth_sleep_time, name[0] ? name : "-");
    }
    free(threadIds);
    return EXIT_SUCCESS;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "Require explicit candidate PIDs.\n");
        return EXIT_FAILURE;
    }
    int first = 1;
    int threads = 0;
    if (strcmp(argv[1], "--threads") == 0) {
        threads = 1;
        first = 2;
        if (argc < 3) {
            fprintf(stderr, "Require explicit candidate PIDs.\n");
            return EXIT_FAILURE;
        }
    }
    for (int index = first; index < argc; index++) {
        int pid = parsePid(argv[index]);
        if (threads) {
            int result = inspectThreads(pid);
            if (result != EXIT_SUCCESS) return result;
            continue;
        }
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
        // L denotes a live process; zombies were excluded above.
        printf("%d L %s\n", pid, path);
    }
    return EXIT_SUCCESS;
}
