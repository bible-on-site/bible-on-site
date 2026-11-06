#include <stdio.h>
#include <unistd.h>

// A disposable host process, never the app or a simulator. Keep a named native
// frame on its blocked thread so the real OS sampler must retain usable data.
__attribute__((noinline)) void native_sampling_control_frame(void) {
    for (;;) pause();
}

int main(void) {
    puts("ready");
    fflush(stdout);
    native_sampling_control_frame();
    return 0;
}
