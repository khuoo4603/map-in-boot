package com.mapinboot.starter.snapshot;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.snapshot.Snapshot;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;

// Snapshot JSON의 원자적 저장·복원·구조 이력 및 보존기간 관리
public class LocalSnapshotStore {
    private static final Log log = LogFactory.getLog(LocalSnapshotStore.class);
    private static final String SUPPORTED_SCHEMA_VERSION = "1";
    private static final Pattern MANAGED_FILE = Pattern.compile("snapshot-[0-9a-fA-F-]{36}\\.json");

    private final Path directory;
    private final int retentionDays;
    private final SnapshotJsonCodec codec;

    public LocalSnapshotStore(Path directory, int retentionDays, SnapshotJsonCodec codec) {
        if (directory == null || codec == null || retentionDays < 1 || retentionDays > 90) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Snapshot 저장 설정이 올바르지 않습니다.");
        }
        this.directory = directory.normalize();
        this.retentionDays = retentionDays;
        this.codec = codec;
    }

    public Optional<Snapshot> loadLatest(String serviceId) {
        if (isBlank(serviceId)) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Snapshot 복원 serviceId가 비어 있습니다.");
        }
        return readSnapshots(serviceId, true).stream()
                .max(Comparator.comparing(stored -> stored.snapshot().capturedAt()))
                .map(StoredSnapshot::snapshot);
    }

    public Optional<Snapshot> save(Snapshot snapshot, boolean complete) {
        if (snapshot == null) {
            throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, "저장할 Snapshot이 없습니다.");
        }
        if (!SUPPORTED_SCHEMA_VERSION.equals(snapshot.schemaVersion())) {
            throw new MapInBootException(ErrorCode.UNSUPPORTED_SCHEMA, "지원하지 않는 Snapshot schemaVersion입니다.");
        }
        String json = codec.encode(snapshot);
        boolean snapshotComplete = isComplete(snapshot);
        if (complete && !snapshotComplete) {
            throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT,
                    "Snapshot 완전성 인자와 저장 데이터가 일치하지 않습니다.");
        }
        if (!complete && snapshotComplete) {
            log.warn("Snapshot 부분 결과가 완전 기준선 형태와 일치하지 않아 저장하지 않습니다.");
            return Optional.empty();
        }
        if (!complete && snapshot.nodes().isEmpty()) {
            return Optional.empty();
        }
        prepareDirectoryForWrite();

        List<StoredSnapshot> existing = readSnapshots(snapshot.serviceId(), false);
        Optional<StoredSnapshot> latestAny = latest(existing);
        Optional<StoredSnapshot> latestComplete = existing.stream()
                .filter(stored -> isComplete(stored.snapshot()))
                .max(Comparator.comparing(stored -> stored.snapshot().capturedAt()));

        if (!complete) {
            if (latestComplete.isPresent()) {
                return Optional.of(latestComplete.get().snapshot());
            }
            if (latestAny.isPresent()) {
                return Optional.of(latestAny.get().snapshot());
            }
            Path target = newTarget();
            writeAtomically(target, json);
            cleanupAfterSaveSafely(snapshot.serviceId());
            return Optional.of(snapshot);
        }

        if (latestComplete.isPresent()
                && latestComplete.get().snapshot().graphFingerprint().equals(snapshot.graphFingerprint())) {
            Snapshot updated = withSnapshotId(snapshot, latestComplete.get().snapshot().snapshotId());
            writeAtomically(latestComplete.get().path(), codec.encode(updated));
            cleanupAfterSaveSafely(snapshot.serviceId());
            return Optional.of(updated);
        }

        Path target = newTarget();
        writeAtomically(target, json);
        cleanupAfterSaveSafely(snapshot.serviceId());
        return Optional.of(snapshot);
    }

    private List<StoredSnapshot> readSnapshots(String serviceId, boolean failIfNoValid) {
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) {
            return List.of();
        }
        if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
            throw snapshotReadFailed(null);
        }

        List<StoredSnapshot> snapshots = new ArrayList<>();
        boolean foundManagedFile = false;
        MapInBootException firstFailure = null;
        try (DirectoryStream<Path> paths = Files.newDirectoryStream(directory)) {
            for (Path path : paths) {
                if (!MANAGED_FILE.matcher(path.getFileName().toString()).matches()) {
                    continue;
                }
                foundManagedFile = true;
                if (Files.isSymbolicLink(path) || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                    firstFailure = firstFailure == null ? snapshotReadFailed(null) : firstFailure;
                    logReadIssue(firstFailure);
                    continue;
                }
                try {
                    Snapshot snapshot = codec.decode(Files.readString(path, StandardCharsets.UTF_8));
                    if (serviceId != null && !serviceId.equals(snapshot.serviceId())) {
                        continue;
                    }
                    if (!SUPPORTED_SCHEMA_VERSION.equals(snapshot.schemaVersion())) {
                        throw new MapInBootException(ErrorCode.UNSUPPORTED_SCHEMA,
                                "지원하지 않는 Snapshot schemaVersion입니다.");
                    }
                    snapshots.add(new StoredSnapshot(path, snapshot));
                } catch (MapInBootException exception) {
                    firstFailure = firstFailure == null ? exception : firstFailure;
                    logReadIssue(exception);
                } catch (IOException exception) {
                    firstFailure = firstFailure == null ? snapshotReadFailed(exception) : firstFailure;
                    logReadIssue(firstFailure);
                }
            }
        } catch (IOException exception) {
            throw snapshotReadFailed(exception);
        }
        if (snapshots.isEmpty() && foundManagedFile && failIfNoValid && firstFailure != null) {
            throw firstFailure;
        }
        return snapshots;
    }

    private void prepareDirectoryForWrite() {
        try {
            if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) {
                if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
                    throw snapshotWriteFailed(null);
                }
                return;
            }
            Files.createDirectories(directory);
            if (Files.isSymbolicLink(directory) || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
                throw snapshotWriteFailed(null);
            }
        } catch (MapInBootException exception) {
            throw exception;
        } catch (IOException exception) {
            throw snapshotWriteFailed(exception);
        }
    }

    private Path newTarget() {
        return directory.resolve("snapshot-" + UUID.randomUUID() + ".json");
    }

    private void writeAtomically(Path target, String json) {
        if (!isManagedTarget(target)) {
            throw snapshotWriteFailed(null);
        }
        Path temporary = null;
        try {
            temporary = Files.createTempFile(directory, ".snapshot-", ".tmp");
            Files.writeString(temporary, json, StandardCharsets.UTF_8,
                    StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING);
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(target)) {
                throw snapshotWriteFailed(null);
            }
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            temporary = null;
        } catch (AtomicMoveNotSupportedException exception) {
            throw snapshotWriteFailed(exception);
        } catch (MapInBootException exception) {
            throw exception;
        } catch (IOException exception) {
            throw snapshotWriteFailed(exception);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // 임시 파일 정리 실패는 원래 저장 오류에 종속
                }
            }
        }
    }

    private void cleanupAfterSave(String serviceId) {
        List<StoredSnapshot> snapshots = readSnapshots(serviceId, false);
        if (snapshots.isEmpty()) {
            return;
        }

        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        Optional<StoredSnapshot> latestAny = latest(snapshots);
        Optional<StoredSnapshot> latestComplete = snapshots.stream()
                .filter(stored -> isComplete(stored.snapshot()))
                .max(Comparator.comparing(stored -> stored.snapshot().capturedAt()));
        Map<String, StoredSnapshot> newestByFingerprint = new HashMap<>();
        for (StoredSnapshot stored : snapshots) {
            if (!isComplete(stored.snapshot())) {
                continue;
            }
            newestByFingerprint.merge(stored.snapshot().graphFingerprint(), stored,
                    (left, right) -> left.snapshot().capturedAt().isAfter(right.snapshot().capturedAt()) ? left : right);
        }

        Set<Path> keep = new HashSet<>();
        latestAny.ifPresent(stored -> keep.add(stored.path()));
        latestComplete.ifPresent(stored -> keep.add(stored.path()));
        newestByFingerprint.values().stream()
                .filter(stored -> !stored.snapshot().capturedAt().isBefore(cutoff))
                .forEach(stored -> keep.add(stored.path()));

        for (StoredSnapshot stored : snapshots) {
            boolean duplicateComplete = isComplete(stored.snapshot())
                    && !newestByFingerprint.get(stored.snapshot().graphFingerprint()).path().equals(stored.path());
            boolean expired = stored.snapshot().capturedAt().isBefore(cutoff);
            if ((duplicateComplete || expired) && !keep.contains(stored.path())) {
                deleteManaged(stored.path());
            }
        }
    }

    private void cleanupAfterSaveSafely(String serviceId) {
        try {
            cleanupAfterSave(serviceId);
        } catch (RuntimeException exception) {
            log.warn("Snapshot Retention 정리 실패: " + errorSummary(exception));
        }
    }

    private void deleteManaged(Path path) {
        if (!isManagedTarget(path) || Files.isSymbolicLink(path)) {
            throw snapshotWriteFailed(null);
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException exception) {
            throw snapshotWriteFailed(exception);
        }
    }

    private boolean isManagedTarget(Path path) {
        Path normalized = path.normalize();
        return directory.equals(normalized.getParent())
                && MANAGED_FILE.matcher(normalized.getFileName().toString()).matches();
    }

    private Optional<StoredSnapshot> latest(List<StoredSnapshot> snapshots) {
        return snapshots.stream().max(Comparator.comparing(stored -> stored.snapshot().capturedAt()));
    }

    private boolean isComplete(Snapshot snapshot) {
        if (snapshot == null || snapshot.analysisStatus().isEmpty()
                || !snapshot.analysisStatus().values().stream().allMatch(AnalysisStatus.READY::equals)
                || snapshot.nodes().isEmpty()) {
            return false;
        }
        return true;
    }

    private void logReadIssue(MapInBootException exception) {
        log.warn("Snapshot 자료 건너뜀: " + exception.getErrorCode().getCode());
    }

    private String errorSummary(RuntimeException exception) {
        if (exception instanceof MapInBootException mapInBootException) {
            return mapInBootException.getErrorCode().getCode();
        }
        return "예상하지 못한 오류";
    }

    private Snapshot withSnapshotId(Snapshot snapshot, String snapshotId) {
        return new Snapshot(snapshotId, snapshot.capturedAt(), snapshot.schemaVersion(), snapshot.sdkVersion(),
                snapshot.serviceId(), snapshot.instanceId(), snapshot.applicationVersion(), snapshot.graphFingerprint(),
                snapshot.nodes(), snapshot.edges(), snapshot.evidence(), snapshot.findings(), snapshot.analysisStatus());
    }

    private MapInBootException snapshotReadFailed(Throwable cause) {
        return cause == null
                ? new MapInBootException(ErrorCode.SNAPSHOT_READ_FAILED, "Snapshot 파일을 읽을 수 없습니다.")
                : new MapInBootException(ErrorCode.SNAPSHOT_READ_FAILED, "Snapshot 파일을 읽을 수 없습니다.", cause);
    }

    private MapInBootException snapshotWriteFailed(Throwable cause) {
        return cause == null
                ? new MapInBootException(ErrorCode.SNAPSHOT_WRITE_FAILED, "Snapshot 파일을 저장할 수 없습니다.")
                : new MapInBootException(ErrorCode.SNAPSHOT_WRITE_FAILED, "Snapshot 파일을 저장할 수 없습니다.", cause);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record StoredSnapshot(Path path, Snapshot snapshot) {
    }
}
