package com.mapinboot.core.collection.model;

import org.springframework.context.ApplicationContext;

public record CollectionContext(
        ApplicationContext applicationContext,
        String serviceId,
        String instanceId
) {
}
