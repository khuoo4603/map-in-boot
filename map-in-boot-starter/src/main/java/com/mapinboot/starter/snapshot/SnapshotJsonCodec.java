package com.mapinboot.starter.snapshot;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.snapshot.Snapshot;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

// Snapshot 전용 Jackson 3 JSON 변환
public class SnapshotJsonCodec {
    private final JsonMapper mapper;

    public SnapshotJsonCodec() {
        this(JsonMapper.builder().build());
    }

    public SnapshotJsonCodec(JsonMapper mapper) {
        if (mapper == null) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Snapshot JSON Mapper가 없습니다.");
        }
        this.mapper = mapper;
    }

    public String encode(Snapshot snapshot) {
        try {
            SnapshotAssembler.validateSnapshot(snapshot);
            return mapper.writeValueAsString(snapshot);
        } catch (MapInBootException exception) {
            throw exception;
        } catch (JacksonException exception) {
            throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, "Snapshot 직렬화에 실패했습니다.", exception);
        }
    }

    public Snapshot decode(String json) {
        if (json == null || json.isBlank()) {
            throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, "Snapshot JSON이 없습니다.");
        }
        try {
            Snapshot snapshot = mapper.readValue(json, Snapshot.class);
            SnapshotAssembler.validateSnapshot(snapshot);
            return snapshot;
        } catch (MapInBootException exception) {
            if (exception.getErrorCode() == ErrorCode.INVALID_SNAPSHOT) {
                throw exception;
            }
            throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, "Snapshot 구조 검증에 실패했습니다.", exception);
        } catch (RuntimeException exception) {
            throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, "Snapshot 역직렬화에 실패했습니다.", exception);
        }
    }

}
