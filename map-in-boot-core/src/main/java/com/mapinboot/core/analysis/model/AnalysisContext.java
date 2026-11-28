package com.mapinboot.core.analysis.model;

import com.mapinboot.core.collection.model.CollectionReport;

public record AnalysisContext(
        CollectionReport collectionReport,
        String serviceId
) {
}
