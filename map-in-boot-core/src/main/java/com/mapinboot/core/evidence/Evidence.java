package com.mapinboot.core.evidence;

import com.mapinboot.core.common.status.EvidenceSource;

public record Evidence(
        String id,
        EvidenceSource source,
        String location,
        String summary
) {
}
