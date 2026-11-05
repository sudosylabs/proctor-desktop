/* Proctor-owned narrow Endpoint Security ABI bridge. No ES message or string
 * pointer escapes this file. Build against the target's Apple SDK. */
#include <EndpointSecurity/EndpointSecurity.h>
#include <bsm/libbsm.h>
#include <mach/mach_time.h>
#include <dlfcn.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <Security/Security.h>

typedef struct {
    uint64_t global_sequence;
    uint64_t type_sequence;
    uint64_t mach_time;
    int64_t start_seconds;
    int64_t start_microseconds;
    int32_t process_id;
    uint32_t execution_generation;
    uint32_t audit_session_id;
    uint32_t audit_user_id;
    uint32_t kind; /* 1 fork, 2 exec, 3 exit, 0 unsupported message shape */
    audit_token_t audit_token; /* Exact kernel token, never a reconstructed token. */
} prctr_es_fact;

_Static_assert(sizeof(prctr_es_fact) == 96, "ES minimized fact ABI changed");

typedef void (*prctr_es_callback)(void *, const prctr_es_fact *);
typedef struct {
    es_client_t *client;
    atomic_bool accepting;
    prctr_es_callback callback;
    void *context;
} prctr_es_subscription;

uint64_t prctr_es_clock_now(void) { return mach_absolute_time(); }

static void erase_fact(prctr_es_fact *fact) {
    volatile unsigned char *bytes = (volatile unsigned char *)fact;
    for (size_t i = 0; i < sizeof(*fact); ++i) bytes[i] = 0;
}

static bool has_lifecycle_event(const es_event_type_t *events, size_t count) {
    if (count > 1024 || (count != 0 && events == NULL)) return true;
    for (size_t i = 0; i < count; ++i) {
        if (events[i] == ES_EVENT_TYPE_NOTIFY_FORK ||
            events[i] == ES_EVENT_TYPE_NOTIFY_EXEC ||
            events[i] == ES_EVENT_TYPE_NOTIFY_EXIT) return true;
    }
    return false;
}

/* The SDK warns that default mutes may change across OS releases. Inspect only
 * admitted event-class numbers; never read or retain muted paths/audit tokens.
 * Do not unmute system defaults or silently claim a filtered feed is complete. */
static bool lifecycle_notifications_unmuted(es_client_t *client) {
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
            valid = !has_lifecycle_event(paths->paths[i].events, paths->paths[i].event_count);
        }
        free_paths(paths);
        if (!valid) return false;
        es_muted_processes_t *processes = NULL;
        if (get_processes(client, &processes) != ES_RETURN_SUCCESS || processes == NULL) return false;
        valid = processes->count <= 4096 && (processes->count == 0 || processes->processes != NULL);
        for (size_t i = 0; valid && i < processes->count; ++i) {
            valid = !has_lifecycle_event(processes->processes[i].events, processes->processes[i].event_count);
        }
        free_processes(processes);
        return valid;
    }
    return false;
}

/* 0 success, 1 denied/missing privilege, 2 backend, 3 unproved cleanup.
 * On result 3, memory is deliberately retained: the supervising process must
 * be replaced because callback removal could not be proved. */
int prctr_es_close(prctr_es_subscription *subscription) {
    if (subscription == NULL) return 0;
    atomic_store_explicit(&subscription->accepting, false, memory_order_release);
    if (es_delete_client(subscription->client) != ES_RETURN_SUCCESS) return 3;
    free(subscription);
    return 0;
}

int prctr_es_open(void *context, prctr_es_callback callback,
                  prctr_es_subscription **result) {
    *result = NULL;
    prctr_es_subscription *subscription = calloc(1, sizeof(*subscription));
    if (subscription == NULL) return 2;
    subscription->context = context;
    subscription->callback = callback;
    atomic_init(&subscription->accepting, true);
    es_new_client_result_t created = es_new_client(&subscription->client,
        ^(es_client_t *client, const es_message_t *message) {
            (void)client;
            if (!atomic_load_explicit(&subscription->accepting, memory_order_acquire)) return;
            prctr_es_fact fact = {0};
            const es_process_t *process = NULL;
            if (message->version >= 4 && message->action_type == ES_ACTION_TYPE_NOTIFY) {
                fact.global_sequence = message->global_seq_num;
                fact.type_sequence = message->seq_num;
                fact.mach_time = message->mach_time;
                switch (message->event_type) {
                    case ES_EVENT_TYPE_NOTIFY_FORK:
                        fact.kind = 1;
                        process = message->event.fork.child;
                        break;
                    case ES_EVENT_TYPE_NOTIFY_EXEC:
                        fact.kind = 2;
                        process = message->event.exec.target;
                        break;
                    case ES_EVENT_TYPE_NOTIFY_EXIT:
                        fact.kind = 3;
                        process = message->process;
                        break;
                    default: break;
                }
            }
            if (process != NULL) {
                fact.process_id = audit_token_to_pid(process->audit_token);
                fact.execution_generation = (uint32_t)audit_token_to_pidversion(process->audit_token);
                fact.audit_session_id = audit_token_to_asid(process->audit_token);
                fact.audit_user_id = audit_token_to_auid(process->audit_token);
                fact.start_seconds = process->start_time.tv_sec;
                fact.start_microseconds = process->start_time.tv_usec;
                fact.audit_token = process->audit_token;
            } else {
                fact.kind = 0;
            }
            subscription->callback(subscription->context, &fact);
            erase_fact(&fact);
        });
    if (created != ES_NEW_CLIENT_RESULT_SUCCESS) {
        if (subscription->client != NULL) {
            if (prctr_es_close(subscription) != 0) return 3;
        } else {
            free(subscription);
        }
        switch (created) {
            case ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED:
            case ES_NEW_CLIENT_RESULT_ERR_NOT_PERMITTED:
            case ES_NEW_CLIENT_RESULT_ERR_NOT_PRIVILEGED: return 1;
            default: return 2;
        }
    }
    if (!lifecycle_notifications_unmuted(subscription->client)) {
        return prctr_es_close(subscription) == 0 ? 2 : 3;
    }
    const es_event_type_t events[] = {
        ES_EVENT_TYPE_NOTIFY_FORK, ES_EVENT_TYPE_NOTIFY_EXEC, ES_EVENT_TYPE_NOTIFY_EXIT
    };
    if (es_subscribe(subscription->client, events, 3) != ES_RETURN_SUCCESS) {
        return prctr_es_close(subscription) == 0 ? 2 : 3;
    }
    *result = subscription;
    return 0;
}

/* Fixed buffers admit only the five sealed identity fields required by the
 * Proctor macOS contract. No executable path or arbitrary bundle data escapes. */
typedef struct {
    char signing_id[257];
    char team_id[65];
    char designated_requirement[513];
    char bundle_id[257];
    char version[65];
} prctr_macos_identity;

static bool copy_identity_string(CFTypeRef value, char *out, CFIndex capacity) {
    if (value == NULL || CFGetTypeID(value) != CFStringGetTypeID()) return false;
    CFIndex length = CFStringGetLength(value);
    if (length <= 0 || length >= capacity) return false;
    for (CFIndex i = 0; i < length; ++i) {
        if (CFStringGetCharacterAtIndex(value, i) == 0) return false;
    }
    return CFStringGetCString(value, out, capacity, kCFStringEncodingUTF8);
}

/* Only the source-owned worker calls this synchronous Security.framework
 * routine. Its outer owner must impose a deadline and replace a stuck helper.
 * The token is borrowed until all CF/SecCode references have been released. */
int prctr_macos_copy_identity(const audit_token_t *token, int32_t pid,
                             uint32_t generation, prctr_macos_identity *out) {
    memset(out, 0, sizeof(*out));
    if (audit_token_to_pid(*token) != pid ||
        (uint32_t)audit_token_to_pidversion(*token) != generation) return 1;
    CFDataRef data = CFDataCreateWithBytesNoCopy(NULL, (const UInt8 *)token,
        sizeof(*token), kCFAllocatorNull);
    CFDictionaryRef attributes = NULL;
    SecCodeRef code = NULL;
    CFDictionaryRef information = NULL;
    SecRequirementRef requirement = NULL;
    CFStringRef requirement_string = NULL;
    int result = 1;
    if (data == NULL) goto cleanup;
    const void *keys[] = {kSecGuestAttributeAudit};
    const void *values[] = {data};
    attributes = CFDictionaryCreate(NULL, keys, values, 1,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    if (attributes == NULL || SecCodeCopyGuestWithAttributes(NULL, attributes,
        kSecCSDefaultFlags, &code) != errSecSuccess || code == NULL) goto cleanup;
    /* SecCode.h documents this dynamic validation as secure against changes to
     * the file-system source. Never use SecStaticCodeCreateWithPath here. */
    if (SecCodeCheckValidity(code, kSecCSDefaultFlags, NULL) != errSecSuccess)
        goto cleanup;
    if (SecCodeCopySigningInformation(code, kSecCSSigningInformation,
        &information) != errSecSuccess || information == NULL) goto cleanup;
    if (SecCodeCopyDesignatedRequirement(code, kSecCSDefaultFlags,
        &requirement) != errSecSuccess || requirement == NULL) goto cleanup;
    if (SecRequirementCopyString(requirement, kSecCSDefaultFlags,
        &requirement_string) != errSecSuccess || requirement_string == NULL)
        goto cleanup;
    CFTypeRef plist = CFDictionaryGetValue(information, kSecCodeInfoPList);
    if (plist == NULL || CFGetTypeID(plist) != CFDictionaryGetTypeID()) goto cleanup;
    /* kSecCodeInfoPList is the secured Info.plist seen by code signing, not a
     * filesystem/CFBundle lookup. Missing platform-code fields stay unavailable. */
    if (!copy_identity_string(CFDictionaryGetValue(information, kSecCodeInfoIdentifier),
            out->signing_id, sizeof(out->signing_id)) ||
        !copy_identity_string(CFDictionaryGetValue(information, kSecCodeInfoTeamIdentifier),
            out->team_id, sizeof(out->team_id)) ||
        !copy_identity_string(requirement_string, out->designated_requirement,
            sizeof(out->designated_requirement)) ||
        !copy_identity_string(CFDictionaryGetValue(plist, CFSTR("CFBundleIdentifier")),
            out->bundle_id, sizeof(out->bundle_id)) ||
        !copy_identity_string(CFDictionaryGetValue(plist, CFSTR("CFBundleShortVersionString")),
            out->version, sizeof(out->version))) goto cleanup;
    /* Recheck the same dynamic object after copying sealed metadata. */
    if (SecCodeCheckValidity(code, kSecCSDefaultFlags, NULL) != errSecSuccess)
        goto cleanup;
    result = 0;
cleanup:
    if (requirement_string != NULL) CFRelease(requirement_string);
    if (requirement != NULL) CFRelease(requirement);
    if (information != NULL) CFRelease(information);
    if (code != NULL) CFRelease(code);
    if (attributes != NULL) CFRelease(attributes);
    if (data != NULL) CFRelease(data);
    return result;
}
