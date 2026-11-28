package com.mapinboot.core.snapshot.runtime;

import com.mapinboot.core.collection.model.CollectionReport;

// 프레임워크 모듈별 기동 구성 수집 확장 계약
public interface RuntimeArchitectureCollector {
    String id();

    RuntimeArchitectureContribution collect(String serviceId, CollectionReport collectionReport);
}
