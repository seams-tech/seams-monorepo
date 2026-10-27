#ifndef SEAMS_VOICEID_H
#define SEAMS_VOICEID_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* macOS, ABI 1. Each session and its requests belong to the creating OS thread.
 * All calls are synchronous. Call cancel between work calls on that same thread.
 * A caller must close every session before unloading the library.
 *
 * Supply readable input buffers and writable aligned output memory. Lengths must
 * describe the actual allocations. Inputs are copied during each call. No Rust
 * allocation or borrowed result pointer crosses this interface.
 *
 * Calls clear valid scalar/result outputs before work. Check the return status
 * before using output. An invalid output pointer cannot consume a result.
 * A contained Rust panic invalidates every session on the current thread.
 * At most four sessions may be open on one thread.
 *
 * A matched command describes perception. It grants no wallet authority.
 * The consumer owns operation presentation, authority, binding and consumption.
 */
enum VoiceIdStatusCode {
    VOICEID_OK = 0,
    VOICEID_INVALID_INPUT = 1,
    VOICEID_INVALID_HANDLE = 2,
    VOICEID_BUSY = 3,
    VOICEID_MISSING = 4,
    VOICEID_EXPIRED = 5,
    VOICEID_CANCELLED = 6,
    VOICEID_DISCONTINUITY = 7,
    VOICEID_FAILED = 8,
    VOICEID_CONFLICT = 9,
    VOICEID_NOT_READY = 10,
    VOICEID_STOPPED = 11,
    VOICEID_PANICKED = 12
};
enum VoiceIdSessionStatus {
    VOICEID_EMPTY = 1,
    VOICEID_READY = 2,
    VOICEID_LISTENING = 3,
    VOICEID_COMPLETED = 4,
    VOICEID_ENROLLING = 5,
    VOICEID_SESSION_STOPPED = 6
};
enum VoiceIdOutcome {
    VOICEID_MATCHED = 1,
    VOICEID_REJECTED = 2,
    VOICEID_AMBIGUOUS = 3,
    VOICEID_INSUFFICIENT = 4
};
enum VoiceIdCommand {
    VOICEID_NO_COMMAND = 0,
    VOICEID_APPROVE = 1,
    VOICEID_CANCEL = 2,
    VOICEID_UNRECOGNIZED = 3
};

typedef uint64_t VoiceIdSession;
typedef uint64_t VoiceIdRequest;
typedef struct VoiceIdResultV1 {
    VoiceIdRequest request;
    uint64_t valid_until_ns;
    uint32_t outcome;
    uint32_t command;
} VoiceIdResultV1;

uint32_t voiceid_abi_version(void);

/* Paths and namespace are bounded UTF-8 without a trailing NUL. The model path
 * must be absolute. Namespace must start with com.seams.voiceid. It is normalized
 * to lowercase. Open acquires its exclusive process lease and verifies assets.
 * This call opens no microphone and performs no network access.
 */
uint32_t voiceid_open_v1(const uint8_t *models, size_t models_len,
                       const uint8_t *namespace_bytes, size_t namespace_len,
                       VoiceIdSession *output);
uint32_t voiceid_close_v1(VoiceIdSession session);

/* Consumes the session even on failure. Removes its device metadata only when
 * the namespace has no enrollment and no active request. Regular close retains
 * all enrollment/device data. Empty-namespace cleanup leaves the lease file.
 */
uint32_t voiceid_close_empty_namespace_v1(VoiceIdSession session);

/* Times use this session's monotonic epoch, in nanoseconds. Map the capture
 * clock before submission. Begin each request before acquiring its first sample.
 * No result may cross a close/reopen boundary.
 */
uint32_t voiceid_now_v1(VoiceIdSession session, uint64_t *output);
uint32_t voiceid_status_v1(VoiceIdSession session, uint64_t *output);
uint32_t voiceid_begin_v1(VoiceIdSession session, uint32_t timeout_ms,
                         VoiceIdRequest *output);

/* Contiguous finite mono 16 kHz PCM in [-1, 1]. Each chunk has 1..1600 samples.
 * Sequence numbers increase by one. Source time advances by sample_count/16000.
 * Cumulative input may not exceed 160000 samples (10 seconds).
 */
uint32_t voiceid_push_v1(VoiceIdSession session, VoiceIdRequest request,
                        uint64_t sequence, uint64_t captured_at_ns,
                        const float *samples, size_t sample_count);
uint32_t voiceid_finish_v1(VoiceIdSession session, VoiceIdRequest request);
uint32_t voiceid_take_v1(VoiceIdSession session, VoiceIdRequest request,
                        VoiceIdResultV1 *output);
uint32_t voiceid_cancel_v1(VoiceIdSession session, VoiceIdRequest request);

/* Deliberate setup requires three consistent captures within 90 seconds.
 * Each capture follows begin, has at most 160000 samples, is a multiple of 160
 * samples, contains >=2 seconds of voiced frames and ends with >=800 ms quiet.
 * Captures cannot overlap. Remaining is 2, then 1, then 0 after durable commit.
 * A sample rejected after admission ends setup. Cancel discards collected embeddings.
 */
uint32_t voiceid_enrollment_begin_v1(VoiceIdSession session, VoiceIdRequest *output);
uint32_t voiceid_enrollment_sample_v1(VoiceIdSession session, VoiceIdRequest request,
                                    uint64_t captured_at_ns, const float *samples,
                                    size_t sample_count, uint64_t *remaining);

/* Invalidate active work before deleting the stored enrollment. */
uint32_t voiceid_enrollment_delete_v1(VoiceIdSession session);

#ifdef __cplusplus
}
#endif
#endif
