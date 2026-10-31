package com.mapinboot.starter.snapshot;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.snapshot.Snapshot;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LocalSnapshotStoreIntegrationTest {
    @TempDir
    Path tempDirectory;

    @Test
    void savesAndRestoresSnapshotFromAnotherStoreInstance() throws Exception {
        SnapshotJsonCodec codec = new SnapshotJsonCodec();
        LocalSnapshotStore store = store(codec, 7);
        Snapshot source = snapshot(Instant.parse("2026-10-31T00:00:00Z"), AnalysisStatus.READY, "/one");

        Optional<Snapshot> saved = store.save(source, true);
        Files.writeString(tempDirectory.resolve("unmanaged.json"), "not a snapshot");
        Files.writeString(tempDirectory.resolve(".snapshot-test.tmp"), "partial");

        Optional<Snapshot> restored = new LocalSnapshotStore(tempDirectory, 7, codec).loadLatest("service");

        assertTrue(saved.isPresent());
        assertEquals(source.snapshotId(), saved.get().snapshotId());
        assertTrue(restored.isPresent());
        assertEquals(source, restored.get());
        assertTrue(new LocalSnapshotStore(tempDirectory, 7, codec).loadLatest("other-service").isEmpty());
        assertEquals(1, managedFiles().size(), managedFiles()::toString);
    }

    @Test
    void loadingDoesNotCreateMissingDirectory() throws Exception {
        Path missing = tempDirectory.resolve("missing");

        assertTrue(new LocalSnapshotStore(missing, 7, new SnapshotJsonCodec()).loadLatest("service").isEmpty());
        assertFalse(Files.exists(missing));
    }

    @Test
    void sameFingerprintUpdatesLastSnapshotWithoutAddingHistory() throws Exception {
        LocalSnapshotStore store = store(new SnapshotJsonCodec(), 7);
        Snapshot first = snapshot(Instant.parse("2026-10-30T00:00:00Z"), AnalysisStatus.READY, "/one");
        Snapshot latest = withEvidenceSummary(withApplicationVersion(
                snapshot(Instant.parse("2026-10-31T00:00:00Z"), AnalysisStatus.READY, "/one"), "latest-version"),
                "latest-evidence");

        store.save(first, true);
        Snapshot persisted = store.save(latest, true).orElseThrow();

        assertEquals(first.snapshotId(), persisted.snapshotId());
        assertEquals(latest.capturedAt(), persisted.capturedAt());
        assertEquals("latest-version", store.loadLatest("service").orElseThrow().applicationVersion());
        assertEquals("latest-evidence", store.loadLatest("service").orElseThrow().evidence().get(0).summary());
        assertEquals(1, managedFiles().size());
        assertEquals(latest.capturedAt(), store.loadLatest("service").orElseThrow().capturedAt());
    }

    @Test
    void changedFingerprintCreatesNewHistory() throws Exception {
        LocalSnapshotStore store = store(new SnapshotJsonCodec(), 7);

        store.save(snapshot(Instant.parse("2026-10-30T00:00:00Z"), AnalysisStatus.READY, "/one"), true);
        Snapshot changed = snapshot(Instant.parse("2026-10-31T00:00:00Z"), AnalysisStatus.READY, "/two");
        store.save(changed, true);

        assertEquals(2, managedFiles().size());
        assertEquals(changed.snapshotId(), store.loadLatest("service").orElseThrow().snapshotId());
    }

    @Test
    void partialResultDoesNotOverwriteCompletedSnapshotAndFirstPartialIsAllowed() throws Exception {
        LocalSnapshotStore store = store(new SnapshotJsonCodec(), 7);
        Snapshot complete = snapshot(Instant.parse("2026-10-30T00:00:00Z"), AnalysisStatus.READY, "/one");
        Snapshot partial = snapshot(Instant.parse("2026-10-31T00:00:00Z"), AnalysisStatus.PARTIAL, "/two");

        store.save(complete, true);
        Optional<Snapshot> preserved = store.save(partial, false);

        assertEquals(complete.snapshotId(), preserved.orElseThrow().snapshotId());
        assertEquals(1, managedFiles().size());

        Path firstPartialDirectory = tempDirectory.resolve("first-partial");
        LocalSnapshotStore firstPartialStore = new LocalSnapshotStore(firstPartialDirectory, 7, new SnapshotJsonCodec());
        assertEquals(partial.snapshotId(), firstPartialStore.save(partial, false).orElseThrow().snapshotId());
        assertEquals(1, fileCount(firstPartialDirectory));
    }

    @Test
    void corruptedNewestSnapshotFallsBackToValidOlderSnapshot() throws Exception {
        LocalSnapshotStore store = store(new SnapshotJsonCodec(), 7);
        Snapshot older = snapshot(Instant.parse("2026-10-30T00:00:00Z"), AnalysisStatus.READY, "/one");
        Snapshot newest = snapshot(Instant.parse("2026-10-31T00:00:00Z"), AnalysisStatus.READY, "/two");

        store.save(older, true);
        store.save(newest, true);
        Path newestFile = null;
        for (Path path : managedFiles()) {
            if (Files.readString(path).contains(newest.snapshotId())) {
                newestFile = path;
                break;
            }
        }
        assertNotNull(newestFile);
        Files.writeString(newestFile, "{broken-json");

        Snapshot restored = store.loadLatest("service").orElseThrow();

        assertEquals(older.snapshotId(), restored.snapshotId());
    }

    @Test
    void unsupportedSchemaIsReportedSeparately() throws Exception {
        Snapshot unsupported = snapshot(Instant.parse("2026-10-31T00:00:00Z"), AnalysisStatus.READY, "/one");
        Snapshot schemaTwo = new Snapshot(unsupported.snapshotId(), unsupported.capturedAt(), "2",
                unsupported.sdkVersion(), unsupported.serviceId(), unsupported.instanceId(),
                unsupported.applicationVersion(), unsupported.graphFingerprint(), unsupported.nodes(), unsupported.edges(),
                unsupported.evidence(), unsupported.findings(), unsupported.analysisStatus());
        Files.createDirectories(tempDirectory);
        Files.writeString(tempDirectory.resolve("snapshot-11111111-1111-1111-1111-111111111111.json"),
                new SnapshotJsonCodec().encode(schemaTwo));

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new LocalSnapshotStore(tempDirectory, 7, new SnapshotJsonCodec()).loadLatest("service"));

        assertEquals(ErrorCode.UNSUPPORTED_SCHEMA, exception.getErrorCode());
    }

    @Test
    void saveRejectsUnsupportedSchema() {
        Snapshot source = snapshot(Instant.now(), AnalysisStatus.READY, "/one");
        Snapshot unsupported = new Snapshot(source.snapshotId(), source.capturedAt(), "2", source.sdkVersion(),
                source.serviceId(), source.instanceId(), source.applicationVersion(), source.graphFingerprint(),
                source.nodes(), source.edges(), source.evidence(), source.findings(), source.analysisStatus());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> store(new SnapshotJsonCodec(), 7).save(unsupported, true));

        assertEquals(ErrorCode.UNSUPPORTED_SCHEMA, exception.getErrorCode());
    }

    @Test
    void saveRejectsCompleteFlagWhenAnalysisStatusIsEmpty() {
        Snapshot source = snapshot(Instant.now(), AnalysisStatus.READY, "/one");
        Snapshot withoutStatus = new Snapshot(source.snapshotId(), source.capturedAt(), source.schemaVersion(),
                source.sdkVersion(), source.serviceId(), source.instanceId(), source.applicationVersion(),
                source.graphFingerprint(), source.nodes(), source.edges(), source.evidence(), source.findings(), Map.of());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> store(new SnapshotJsonCodec(), 7).save(withoutStatus, true));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void retentionExpiryUsesConfiguredDayBoundary() throws Exception {
        for (int retentionDays : List.of(1, 7, 90)) {
            Path directory = tempDirectory.resolve("expiry-" + retentionDays);
            LocalSnapshotStore store = new LocalSnapshotStore(directory, retentionDays, new SnapshotJsonCodec());
            Snapshot old = snapshot(Instant.now().minus(retentionDays + 1L, ChronoUnit.DAYS),
                    AnalysisStatus.READY, "/old-" + retentionDays);
            Snapshot latest = snapshot(Instant.now(), AnalysisStatus.READY, "/latest-" + retentionDays);

            store.save(old, true);
            store.save(latest, true);

            try (var paths = Files.list(directory)) {
                assertEquals(1, paths.filter(path -> path.getFileName().toString()
                        .matches("snapshot-[0-9a-fA-F-]{36}\\.json")).count());
            }
            assertEquals(latest.snapshotId(), store.loadLatest("service").orElseThrow().snapshotId());
        }
    }

    @Test
    void writeFailureUsesSnapshotWriteErrorWithoutCreatingManagedFile() throws Exception {
        Path file = tempDirectory.resolve("not-a-directory");
        Files.writeString(file, "existing");
        LocalSnapshotStore store = new LocalSnapshotStore(file, 7, new SnapshotJsonCodec());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> store.save(snapshot(Instant.now(), AnalysisStatus.READY, "/one"), true));

        assertEquals(ErrorCode.SNAPSHOT_WRITE_FAILED, exception.getErrorCode());
        assertTrue(Files.isRegularFile(file));
        assertFalse(Files.exists(file.resolve("snapshot-any.json")));
    }

    private LocalSnapshotStore store(SnapshotJsonCodec codec, int retentionDays) {
        return new LocalSnapshotStore(tempDirectory, retentionDays, codec);
    }

    private List<Path> managedFiles() throws Exception {
        try (var paths = Files.list(tempDirectory)) {
            return paths.filter(path -> path.getFileName().toString().matches("snapshot-[0-9a-fA-F-]{36}\\.json"))
                    .toList();
        }
    }

    private long fileCount(Path directory) throws Exception {
        try (var paths = Files.list(directory)) {
            return paths.count();
        }
    }

    private Snapshot snapshot(Instant capturedAt, AnalysisStatus status, String path) {
        Evidence evidence = new Evidence("evidence-" + path, EvidenceSource.RUNTIME, "runtime", "Endpoint");
        Fact fact = new Fact("fact-" + path, "ENDPOINT_MAPPING", "endpoint-" + path,
                Map.of("httpMethod", "GET", "path", path, "handler", "Handler#handle"), List.of(evidence.id()));
        CollectionReport collection = new CollectionReport(List.of(fact), List.of(evidence),
                Map.of("collector", status), List.of());
        Relation relation = new Relation("relation-" + path, fact.subjectKey(), "Handler#handle", EdgeType.FLOWS_TO,
                Map.of("flowKind", "HANDLER"), Confidence.CONFIRMED, List.of(evidence.id()));
        AnalysisReport analysis = new AnalysisReport(collection, List.of(relation), List.of(evidence),
                Map.of("analyzer", status), List.of());
        Snapshot assembled = new SnapshotAssembler(List.of(), "1")
                .assemble(analysis, "service", "instance", "test");
        return new Snapshot(assembled.snapshotId(), capturedAt, assembled.schemaVersion(), assembled.sdkVersion(),
                assembled.serviceId(), assembled.instanceId(), assembled.applicationVersion(), assembled.graphFingerprint(),
                assembled.nodes(), assembled.edges(), assembled.evidence(), assembled.findings(), assembled.analysisStatus());
    }

    private Snapshot withApplicationVersion(Snapshot snapshot, String applicationVersion) {
        return new Snapshot(snapshot.snapshotId(), snapshot.capturedAt(), snapshot.schemaVersion(), snapshot.sdkVersion(),
                snapshot.serviceId(), snapshot.instanceId(), applicationVersion, snapshot.graphFingerprint(),
                snapshot.nodes(), snapshot.edges(), snapshot.evidence(), snapshot.findings(), snapshot.analysisStatus());
    }

    private Snapshot withEvidenceSummary(Snapshot snapshot, String summary) {
        Evidence existing = snapshot.evidence().get(0);
        Evidence updated = new Evidence(existing.id(), existing.source(), existing.location(), summary);
        return new Snapshot(snapshot.snapshotId(), snapshot.capturedAt(), snapshot.schemaVersion(), snapshot.sdkVersion(),
                snapshot.serviceId(), snapshot.instanceId(), snapshot.applicationVersion(), snapshot.graphFingerprint(),
                snapshot.nodes(), snapshot.edges(), List.of(updated), snapshot.findings(), snapshot.analysisStatus());
    }
}
