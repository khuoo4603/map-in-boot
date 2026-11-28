package com.mapinboot.core.collection;

import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionResult;
import java.util.Set;

// 수집 Adapter 확장 계약
public interface CollectorAdapter {
    String id();

    String getDescription();

    Set<String> getSupportedTypes();

    default boolean enabled() {
        return true;
    }

    default Set<String> dependsOn() {
        return Set.of();
    }

    CollectionResult collect(CollectionContext context);
}
