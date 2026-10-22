#define _POSIX_C_SOURCE 200809L
#include "voiceid.h"

#include <errno.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

_Static_assert(sizeof(VoiceIdResultV1) == 24, "result ABI size");
_Static_assert(sizeof(float) == 4, "32-bit PCM");
_Static_assert(offsetof(VoiceIdResultV1, command) == 20, "result ABI command offset");

typedef struct Pcm { float *samples; size_t count; } Pcm;
typedef struct ThreadProbe { VoiceIdSession session; uint32_t status; uint64_t time; } ThreadProbe;

static const char *model_path;
static const char *keychain_namespace;
static const char *report_path;
static VoiceIdSession current_session;
static const char *completed[64];
static size_t completed_count;
static int cleanup_needed = 1;
static void cleanup(void);

static void write_report(int passed, const char *failed_case, uint32_t expected, uint32_t actual) {
    FILE *file = fopen(report_path, "w");
    if (file == NULL) { return; }
    fprintf(file, "{\n  \"schemaVersion\":\"voiceid_c_host_journey_v1\",\n");
    fprintf(file, "  \"status\":\"%s\",\n", passed ? "passed" : "failed");
    fprintf(file, "  \"abiVersion\":%" PRIu32 ",\n  \"resultBytes\":%zu,\n", voiceid_abi_version(), sizeof(VoiceIdResultV1));
    fprintf(file, "  \"capture\":\"real_time_synthetic_pcm_replay\",\n  \"liveMicrophoneQualified\":false,\n  \"walletSigning\":false,\n");
    fprintf(file, "  \"reportContainsMediaOrTemplates\":false,\n  \"completed\":[");
    for (size_t index = 0; index < completed_count; index++) {
        fprintf(file, "%s\"%s\"", index == 0 ? "" : ",", completed[index]);
    }
    fprintf(file, "],\n  \"failedCase\":\"%s\",\n  \"expected\":%" PRIu32 ",\n  \"actual\":%" PRIu32 "\n}\n", failed_case, expected, actual);
    fclose(file);
}

static void expect_status(const char *name, uint32_t expected, uint32_t actual) {
    if (actual != expected) {
        write_report(0, name, expected, actual);
        fprintf(stderr, "C ABI journey %s: expected %" PRIu32 ", received %" PRIu32 "\n", name, expected, actual);
        cleanup();
        cleanup_needed = 0;
        exit(1);
    }
}
static void expect_true(const char *name, int condition) { expect_status(name, 1, condition ? 1 : 0); }
static void record_case(const char *name) {
    expect_true("bounded_evidence", completed_count < 64);
    completed[completed_count++] = name;
    printf("verified C ABI case %s\n", name);
    fflush(stdout);
}

static uint32_t open_session(VoiceIdSession *output) {
    return voiceid_open_v1((const uint8_t *)model_path, strlen(model_path), (const uint8_t *)keychain_namespace, strlen(keychain_namespace), output);
}
static void cleanup(void) {
    if (!cleanup_needed) { return; }
    if (current_session != 0) { (void)voiceid_close_v1(current_session); current_session = 0; }
    VoiceIdSession session = 0;
    if (open_session(&session) == VOICEID_OK) {
        (void)voiceid_enrollment_delete_v1(session);
        (void)voiceid_close_empty_namespace_v1(session);
    }
}
static uint64_t now_ns(void) {
    uint64_t value = 0;
    expect_status("clock", VOICEID_OK, voiceid_now_v1(current_session, &value));
    return value;
}
static void wait_until(uint64_t target) {
    for (;;) {
        uint64_t now = now_ns();
        if (now >= target) { return; }
        uint64_t remaining = target - now;
        struct timespec delay = { (time_t)(remaining / UINT64_C(1000000000)), (long)(remaining % UINT64_C(1000000000)) };
        while (nanosleep(&delay, &delay) != 0 && errno == EINTR) {}
    }
}
static Pcm read_pcm(const char *path) {
    FILE *file = fopen(path, "rb");
    expect_true("pcm_file", file != NULL);
    expect_true("pcm_seek", fseek(file, 0, SEEK_END) == 0);
    long bytes = ftell(file);
    expect_true("pcm_bound", bytes > 0 && bytes <= 160000L * 4 && bytes % 640 == 0);
    rewind(file);
    Pcm pcm = { calloc((size_t)bytes / 4, sizeof(float)), (size_t)bytes / 4 };
    expect_true("pcm_allocation", pcm.samples != NULL);
    expect_true("pcm_read", fread(pcm.samples, 4, pcm.count, file) == pcm.count);
    fclose(file);
    return pcm;
}
static void *probe_thread(void *argument) {
    ThreadProbe *probe = argument;
    probe->time = UINT64_MAX;
    probe->status = voiceid_now_v1(probe->session, &probe->time);
    return NULL;
}
static void stream_pcm(VoiceIdRequest request, const Pcm *pcm) {
    uint64_t start = now_ns();
    uint64_t sequence = 0;
    for (size_t offset = 0; offset < pcm->count; offset += 1600) {
        size_t count = pcm->count - offset;
        if (count > 1600) { count = 1600; }
        wait_until(start + (uint64_t)(offset + count) * UINT64_C(62500));
        expect_status("stream_push", VOICEID_OK, voiceid_push_v1(current_session, request, sequence, start + (uint64_t)offset * UINT64_C(62500), pcm->samples + offset, count));
        sequence++;
    }
}
static VoiceIdRequest begin_attempt(uint32_t timeout_ms) {
    VoiceIdRequest request = 0;
    expect_status("begin", VOICEID_OK, voiceid_begin_v1(current_session, timeout_ms, &request));
    expect_true("request_nonzero", request != 0);
    return request;
}
static VoiceIdResultV1 command_result(const Pcm *pcm) {
    VoiceIdRequest request = begin_attempt(30000);
    VoiceIdResultV1 result = { UINT64_MAX, UINT64_MAX, UINT32_MAX, UINT32_MAX };
    expect_status("take_before_finish", VOICEID_NOT_READY, voiceid_take_v1(current_session, request, &result));
    expect_true("early_output_empty", result.request == 0 && result.outcome == 0 && result.command == 0);
    stream_pcm(request, pcm);
    expect_status("finish", VOICEID_OK, voiceid_finish_v1(current_session, request));
    expect_status("null_take_output", VOICEID_INVALID_INPUT, voiceid_take_v1(current_session, request, NULL));
    expect_status("take", VOICEID_OK, voiceid_take_v1(current_session, request, &result));
    expect_true("result_correlated", result.request == request && result.valid_until_ns > now_ns());
    VoiceIdResultV1 duplicate = result;
    expect_status("duplicate_take", VOICEID_INVALID_HANDLE, voiceid_take_v1(current_session, request, &duplicate));
    expect_true("duplicate_output_empty", duplicate.request == 0 && duplicate.command == 0);
    return result;
}

int main(int argc, char **argv) {
    if (argc != 11) {
        fprintf(stderr, "required: models namespace enroll1 enroll2 enroll3 approve cancel other extra evidence.json\n");
        return 2;
    }
    model_path = argv[1]; keychain_namespace = argv[2]; report_path = argv[10];
    expect_status("register_cleanup", 0, (uint32_t)atexit(cleanup));
    expect_status("abi_version", 1, voiceid_abi_version());
    expect_status("null_open_output", VOICEID_INVALID_INPUT, voiceid_open_v1(NULL, 0, NULL, 0, NULL));
    expect_status("invalid_close", VOICEID_INVALID_HANDLE, voiceid_close_v1(UINT64_MAX));
    expect_status("open", VOICEID_OK, open_session(&current_session));
    uint64_t state = 0;
    expect_status("initial_status", VOICEID_OK, voiceid_status_v1(current_session, &state));
    expect_true("empty_namespace", state == VOICEID_EMPTY);
    VoiceIdRequest missing = UINT64_MAX;
    expect_status("unenrolled_attempt", VOICEID_MISSING, voiceid_begin_v1(current_session, 30000, &missing));
    expect_true("missing_output_empty", missing == 0);
    VoiceIdSession duplicate = UINT64_MAX;
    expect_status("exclusive_namespace", VOICEID_CONFLICT, open_session(&duplicate));
    expect_true("duplicate_session_empty", duplicate == 0);
    ThreadProbe probe = { current_session, 0, 0 };
    pthread_t thread;
    expect_status("thread_create", 0, (uint32_t)pthread_create(&thread, NULL, probe_thread, &probe));
    expect_status("thread_join", 0, (uint32_t)pthread_join(thread, NULL));
    expect_status("wrong_thread", VOICEID_INVALID_HANDLE, probe.status);
    expect_true("wrong_thread_output_empty", probe.time == 0);
    record_case("layout_handles_thread_and_namespace_fences");

    VoiceIdRequest setup = 0;
    expect_status("setup_begin_cancel", VOICEID_OK, voiceid_enrollment_begin_v1(current_session, &setup));
    expect_status("setup_cancel", VOICEID_OK, voiceid_cancel_v1(current_session, setup));
    VoiceIdRequest cancelled_setup = setup;
    expect_status("setup_begin", VOICEID_OK, voiceid_enrollment_begin_v1(current_session, &setup));
    expect_true("fresh_setup_identity", setup != cancelled_setup);
    float zero = 0;
    uint64_t remaining = UINT64_MAX;
    expect_status("stale_setup", VOICEID_INVALID_HANDLE, voiceid_enrollment_sample_v1(current_session, cancelled_setup, now_ns(), &zero, 1, &remaining));
    for (int index = 0; index < 3; index++) {
        Pcm pcm = read_pcm(argv[3 + index]);
        uint64_t start = now_ns();
        wait_until(start + (uint64_t)pcm.count * UINT64_C(62500));
        expect_status("setup_sample", VOICEID_OK, voiceid_enrollment_sample_v1(current_session, setup, start, pcm.samples, pcm.count, &remaining));
        expect_true("setup_remaining", remaining == (uint64_t)(2 - index));
        free(pcm.samples);
    }
    expect_status("enrolled_status", VOICEID_OK, voiceid_status_v1(current_session, &state));
    expect_true("enrollment_ready", state == VOICEID_READY);
    expect_status("setup_cannot_replace", VOICEID_CONFLICT, voiceid_enrollment_begin_v1(current_session, &missing));
    record_case("three_capture_durable_enrollment_and_cancelled_setup");

    VoiceIdRequest cancelled = begin_attempt(30000);
    expect_status("cancel", VOICEID_OK, voiceid_cancel_v1(current_session, cancelled));
    VoiceIdRequest active = begin_attempt(30000);
    expect_true("fresh_attempt_identity", active != cancelled);
    expect_status("stale_cancel", VOICEID_INVALID_HANDLE, voiceid_cancel_v1(current_session, cancelled));
    expect_status("null_pcm", VOICEID_INVALID_INPUT, voiceid_push_v1(current_session, active, 0, now_ns(), NULL, 1));
    expect_status("oversized_pcm", VOICEID_INVALID_INPUT, voiceid_push_v1(current_session, active, 0, now_ns(), &zero, SIZE_MAX));
    expect_status("current_attempt_survives", VOICEID_OK, voiceid_cancel_v1(current_session, active));
    record_case("cancellation_stale_request_and_bounded_input");

    const uint32_t commands[4] = { VOICEID_APPROVE, VOICEID_CANCEL, VOICEID_NO_COMMAND, VOICEID_UNRECOGNIZED };
    const char *names[4] = { "owner_approve_single_consumption", "owner_cancel_single_consumption", "other_speaker_rejected", "extra_words_unrecognized" };
    for (int index = 0; index < 4; index++) {
        Pcm pcm = read_pcm(argv[6 + index]);
        VoiceIdResultV1 result = command_result(&pcm);
        expect_true("command_outcome", result.outcome == (index == 2 ? VOICEID_REJECTED : VOICEID_MATCHED));
        expect_true("exact_command", result.command == commands[index]);
        record_case(names[index]);
        free(pcm.samples);
    }

    active = begin_attempt(250);
    wait_until(now_ns() + UINT64_C(350000000));
    VoiceIdResultV1 unfinished = { 0, 0, 0, 0 };
    expect_status("unfinished_expiry", VOICEID_EXPIRED, voiceid_take_v1(current_session, active, &unfinished));
    expect_true("unfinished_output_empty", unfinished.request == 0 && unfinished.command == 0);
    uint64_t started = now_ns();
    active = begin_attempt(3000);
    float silence[1600] = { 0 };
    uint64_t captured = now_ns();
    wait_until(captured + UINT64_C(100000000));
    expect_status("expiry_push", VOICEID_OK, voiceid_push_v1(current_session, active, 0, captured, silence, 1600));
    expect_status("expiry_finish", VOICEID_OK, voiceid_finish_v1(current_session, active));
    wait_until(started + UINT64_C(3100000000));
    VoiceIdResultV1 expired = { 0, 0, 0, 0 };
    expect_status("expired_result", VOICEID_EXPIRED, voiceid_take_v1(current_session, active, &expired));
    expect_true("expired_output_empty", expired.request == 0 && expired.command == 0);
    active = begin_attempt(30000);
    expect_status("recovery_after_expiry", VOICEID_OK, voiceid_cancel_v1(current_session, active));
    record_case("exclusive_expiry_and_new_attempt_recovery");

    active = begin_attempt(30000);
    captured = now_ns();
    wait_until(captured + UINT64_C(100000000));
    expect_status("gap_first", VOICEID_OK, voiceid_push_v1(current_session, active, 0, captured, silence, 1600));
    wait_until(captured + UINT64_C(200000000));
    expect_status("gap_rejected", VOICEID_DISCONTINUITY, voiceid_push_v1(current_session, active, 2, captured + UINT64_C(100000000), silence, 1600));
    expect_status("stopped_session", VOICEID_STOPPED, voiceid_begin_v1(current_session, 30000, &missing));
    VoiceIdSession old_session = current_session;
    expect_status("close_stopped", VOICEID_OK, voiceid_close_v1(current_session));
    current_session = 0;
    expect_status("reopen", VOICEID_OK, open_session(&current_session));
    expect_true("fresh_session_identity", old_session != current_session);
    expect_status("old_session_invalid", VOICEID_INVALID_HANDLE, voiceid_now_v1(old_session, &state));
    expect_status("durable_reload", VOICEID_OK, voiceid_status_v1(current_session, &state));
    expect_true("durable_enrollment_ready", state == VOICEID_READY);
    expect_status("old_request_invalid", VOICEID_INVALID_HANDLE, voiceid_take_v1(current_session, active, &expired));
    record_case("gap_close_reopen_and_old_epoch_rejection");

    Pcm approve = read_pcm(argv[6]);
    active = begin_attempt(30000);
    stream_pcm(active, &approve);
    free(approve.samples);
    expect_status("delete_pending_finish", VOICEID_OK, voiceid_finish_v1(current_session, active));
    expect_status("delete_enrollment", VOICEID_OK, voiceid_enrollment_delete_v1(current_session));
    expect_status("deleted_pending_invalid", VOICEID_INVALID_HANDLE, voiceid_take_v1(current_session, active, &expired));
    expect_status("deleted_cannot_begin", VOICEID_MISSING, voiceid_begin_v1(current_session, 30000, &missing));
    expect_status("namespace_cleanup", VOICEID_OK, voiceid_close_empty_namespace_v1(current_session));
    current_session = 0;
    record_case("delete_invalidates_result_and_removes_namespace");
    cleanup_needed = 0;
    write_report(1, "", 0, 0);
    return 0;
}
