/* Proctor-owned minimized ES session ABI. Only opaque correlation IDs and
 * event classes cross this boundary; no account, address or authentication
 * strings are dereferenced. These discretionary userspace events do not supply
 * a census, initial lock/attachment state, or audit-session attribution.
 * Source contract: Apple's ESMessage.h userspace-event and graphical ID notes. */
#include <EndpointSecurity/EndpointSecurity.h>
#include <dlfcn.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct {
    uint64_t global_sequence;
    uint64_t type_sequence;
    uint64_t mach_time;
    uint32_t graphical_session_id;
    uint32_t kind;
    uint32_t succeeded;
    uint32_t reserved;
} session_fact;
_Static_assert(sizeof(session_fact) == 40, "session fact ABI changed");
typedef void (*session_callback)(void *, const session_fact *);
typedef struct {
    es_client_t *client;
    atomic_bool accepting;
    session_callback callback;
    void *context;
} session_subscription;

static bool has_session_event(const es_event_type_t *events, size_t count) {
    if (count > 1024 || (count != 0 && events == NULL)) return true;
    for (size_t i = 0; i < count; ++i) {
        if (events[i] == ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGIN ||
            events[i] == ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGOUT ||
            events[i] == ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOCK ||
            events[i] == ES_EVENT_TYPE_NOTIFY_LW_SESSION_UNLOCK ||
            events[i] == ES_EVENT_TYPE_NOTIFY_SCREENSHARING_ATTACH ||
            events[i] == ES_EVENT_TYPE_NOTIFY_SCREENSHARING_DETACH ||
            events[i] == ES_EVENT_TYPE_NOTIFY_OPENSSH_LOGIN ||
            events[i] == ES_EVENT_TYPE_NOTIFY_OPENSSH_LOGOUT ||
            events[i] == ES_EVENT_TYPE_NOTIFY_LOGIN_LOGIN ||
            events[i] == ES_EVENT_TYPE_NOTIFY_LOGIN_LOGOUT) return true;
    }
    return false;
}

/* The SDK warns that default mutes may change across OS releases. Inspect only
 * admitted event-class numbers; never read or retain muted paths/audit tokens.
 * Do not unmute system defaults or silently claim a filtered feed is complete. */
static bool session_notifications_unmuted(es_client_t *client) {
    /* Resolve only this closed set of versioned SDK entrypoints. This avoids
     * requiring Clang's availability-runtime helper in Rust's -nodefaultlibs
     * link and fails explicitly on older OS versions without these APIs. */
    es_return_t (*get_paths)(es_client_t *, es_muted_paths_t **) = dlsym(RTLD_DEFAULT, "es_muted_paths_events");
    void (*free_paths)(es_muted_paths_t *) = dlsym(RTLD_DEFAULT, "es_release_muted_paths");
    es_return_t (*get_processes)(es_client_t *, es_muted_processes_t **) = dlsym(RTLD_DEFAULT, "es_muted_processes_events");
    void (*free_processes)(es_muted_processes_t *) = dlsym(RTLD_DEFAULT, "es_release_muted_processes");
    if (get_paths != NULL && free_paths != NULL && get_processes != NULL && free_processes != NULL) {
        es_muted_paths_t *paths = NULL;
        if (get_paths(client, &paths) != ES_RETURN_SUCCESS || paths == NULL) return false;
        bool valid = paths->count <= 4096 && (paths->count == 0 || paths->paths != NULL);
        for (size_t i = 0; valid && i < paths->count; ++i) {
            valid = !has_session_event(paths->paths[i].events, paths->paths[i].event_count);
        }
        free_paths(paths);
        if (!valid) return false;
        es_muted_processes_t *processes = NULL;
        if (get_processes(client, &processes) != ES_RETURN_SUCCESS || processes == NULL) return false;
        valid = processes->count <= 4096 && (processes->count == 0 || processes->processes != NULL);
        for (size_t i = 0; valid && i < processes->count; ++i) {
            valid = !has_session_event(processes->processes[i].events, processes->processes[i].event_count);
        }
        free_processes(processes);
        return valid;
    }
    return false;
}

/* SDK deletion is synchronous: invoke only inside the killable helper's
 * deadline-owned source worker. Failed deletion retains callback storage. */
int session_es_close(session_subscription *subscription) {
    if (subscription == NULL) return 0;
    atomic_store_explicit(&subscription->accepting, false, memory_order_release);
    if (es_delete_client(subscription->client) != ES_RETURN_SUCCESS) return 3;
    free(subscription);
    return 0;
}

static void copy_fact(const es_message_t *message, session_fact *fact) {
    if (message->version < 4 || message->action_type != ES_ACTION_TYPE_NOTIFY) return;
    fact->global_sequence = message->global_seq_num;
    fact->type_sequence = message->seq_num;
    fact->mach_time = message->mach_time;
    fact->succeeded = 1;
    switch (message->event_type) {
        case ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGIN:
            if (message->event.lw_session_login == NULL) return;
            fact->kind = 1;
            fact->graphical_session_id = message->event.lw_session_login->graphical_session_id;
            break;
        case ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGOUT:
            if (message->event.lw_session_logout == NULL) return;
            fact->kind = 2;
            fact->graphical_session_id = message->event.lw_session_logout->graphical_session_id;
            break;
        case ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOCK:
            if (message->event.lw_session_lock == NULL) return;
            fact->kind = 3;
            fact->graphical_session_id = message->event.lw_session_lock->graphical_session_id;
            break;
        case ES_EVENT_TYPE_NOTIFY_LW_SESSION_UNLOCK:
            if (message->event.lw_session_unlock == NULL) return;
            fact->kind = 4;
            fact->graphical_session_id = message->event.lw_session_unlock->graphical_session_id;
            break;
        case ES_EVENT_TYPE_NOTIFY_SCREENSHARING_ATTACH:
            if (message->event.screensharing_attach == NULL) return;
            fact->kind = 5;
            fact->graphical_session_id = message->event.screensharing_attach->graphical_session_id;
            fact->succeeded = message->event.screensharing_attach->success ? 1 : 0;
            break;
        case ES_EVENT_TYPE_NOTIFY_SCREENSHARING_DETACH:
            if (message->event.screensharing_detach == NULL) return;
            fact->kind = 6;
            fact->graphical_session_id = message->event.screensharing_detach->graphical_session_id;
            break;
        case ES_EVENT_TYPE_NOTIFY_OPENSSH_LOGIN:
            if (message->event.openssh_login == NULL) return;
            fact->kind = 7;
            fact->succeeded = message->event.openssh_login->success ? 1 : 0;
            break;
        case ES_EVENT_TYPE_NOTIFY_OPENSSH_LOGOUT:
            if (message->event.openssh_logout == NULL) return;
            fact->kind = 8;
            break;
        case ES_EVENT_TYPE_NOTIFY_LOGIN_LOGIN:
            if (message->event.login_login == NULL) return;
            fact->kind = 9;
            fact->succeeded = message->event.login_login->success ? 1 : 0;
            break;
        case ES_EVENT_TYPE_NOTIFY_LOGIN_LOGOUT:
            if (message->event.login_logout == NULL) return;
            fact->kind = 10;
            break;
        default: break;
    }
}

int session_es_open(void *context, session_callback callback,
                         session_subscription **result) {
    *result = NULL;
    session_subscription *subscription = calloc(1, sizeof(*subscription));
    if (subscription == NULL) return 2;
    subscription->context = context;
    subscription->callback = callback;
    atomic_init(&subscription->accepting, true);
    es_new_client_result_t created = es_new_client(&subscription->client,
        ^(es_client_t *client, const es_message_t *message) {
            (void)client;
            if (!atomic_load_explicit(&subscription->accepting, memory_order_acquire)) return;
            session_fact fact = {0};
            copy_fact(message, &fact);
            subscription->callback(subscription->context, &fact);
            volatile unsigned char *bytes = (volatile unsigned char *)&fact;
            for (size_t i = 0; i < sizeof(fact); ++i) bytes[i] = 0;
        });
    if (created != ES_NEW_CLIENT_RESULT_SUCCESS) {
        if (subscription->client != NULL) {
            if (session_es_close(subscription) != 0) return 3;
        } else { free(subscription); }
        switch (created) {
            case ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED:
            case ES_NEW_CLIENT_RESULT_ERR_NOT_PERMITTED:
            case ES_NEW_CLIENT_RESULT_ERR_NOT_PRIVILEGED: return 1;
            default: return 2;
        }
    }
    if (!session_notifications_unmuted(subscription->client)) {
        return session_es_close(subscription) == 0 ? 2 : 3;
    }
    const es_event_type_t events[] = {
        ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGIN,
        ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOGOUT,
        ES_EVENT_TYPE_NOTIFY_LW_SESSION_LOCK,
        ES_EVENT_TYPE_NOTIFY_LW_SESSION_UNLOCK,
        ES_EVENT_TYPE_NOTIFY_SCREENSHARING_ATTACH,
        ES_EVENT_TYPE_NOTIFY_SCREENSHARING_DETACH,
        ES_EVENT_TYPE_NOTIFY_OPENSSH_LOGIN,
        ES_EVENT_TYPE_NOTIFY_OPENSSH_LOGOUT,
        ES_EVENT_TYPE_NOTIFY_LOGIN_LOGIN,
        ES_EVENT_TYPE_NOTIFY_LOGIN_LOGOUT
    };
    if (es_subscribe(subscription->client, events, 10) != ES_RETURN_SUCCESS) {
        return session_es_close(subscription) == 0 ? 2 : 3;
    }
    *result = subscription;
    return 0;
}
