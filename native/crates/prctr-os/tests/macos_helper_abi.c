/* Compile-only SDK assertions for public ABI fields decoded by the safe helper wrappers.
 * This is a test, not a runtime shim. */
#include <libproc.h>
#include <bsm/audit.h>
#include <stddef.h>
_Static_assert(sizeof(struct socket_fdinfo) == 792, "socket_fdinfo size");
_Static_assert(offsetof(struct socket_fdinfo, psi.soi_protocol) == 180, "protocol offset");
_Static_assert(offsetof(struct socket_fdinfo, psi.soi_kind) == 256, "socket kind offset");
_Static_assert(offsetof(struct socket_fdinfo, psi.soi_proto.pri_tcp.tcpsi_ini.insi_lport) == 268, "local port offset");
_Static_assert(offsetof(struct socket_fdinfo, psi.soi_proto.pri_tcp.tcpsi_state) == 344, "TCP state offset");
_Static_assert(sizeof(struct proc_fdinfo) == 8, "proc_fdinfo size");
_Static_assert(sizeof(auditpinfo_addr_t) == 56, "auditpinfo_addr_t size");
_Static_assert(offsetof(auditpinfo_addr_t, ap_asid) == 40, "audit session offset");
