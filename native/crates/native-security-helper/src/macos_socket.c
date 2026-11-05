// The target SDK owns socket_fdinfo's nested ABI. Rust receives only a bounded
// boolean about one descriptor already owned by this service.
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <unistd.h>

_Static_assert(sizeof(struct socket_fdinfo) < 16384, "bounded socket descriptor metadata");

int macos_service_listener_is_valid(int fd) {
    struct socket_fdinfo info = {0};
    int bytes = proc_pidfdinfo(getpid(), fd, PROC_PIDFDSOCKETINFO, &info, sizeof(info));
    int valid = bytes == sizeof(info)
        && info.psi.soi_family == AF_UNIX
        && info.psi.soi_type == SOCK_STREAM
        && (info.psi.soi_options & SO_ACCEPTCONN) != 0;
    volatile unsigned char *raw = (volatile unsigned char *)&info;
    for (size_t index = 0; index < sizeof(info); ++index) {
        raw[index] = 0;
    }
    return valid;
}
