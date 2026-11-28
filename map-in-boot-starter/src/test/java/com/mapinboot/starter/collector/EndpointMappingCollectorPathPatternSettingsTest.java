package com.mapinboot.starter.collector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.evidence.Fact;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.PathContainer;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.util.pattern.PathPatternParser;

class EndpointMappingCollectorPathPatternSettingsTest {

    @Test
    void collectsNonDefaultMvcPathPatternSettingsFromRuntimeMapping() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext(
                CaseInsensitiveMvcConfiguration.class)) {
            EndpointMappingCollectorAdapter adapter = new EndpointMappingCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals("READY", result.status().name());
            Fact endpoint = result.facts().stream()
                    .filter(fact -> "/api/orders".equals(fact.attributes().get("path")))
                    .findFirst()
                    .orElse(null);
            assertNotNull(endpoint);
            assertEquals("NON_DEFAULT", endpoint.attributes().get("mvcPathPatternSettings"));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class CaseInsensitiveMvcConfiguration {

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            PathPatternParser parser = new PathPatternParser();
            parser.setCaseSensitive(false);
            parser.setPathOptions(PathContainer.Options.HTTP_PATH);
            RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
            mapping.setPatternParser(parser);
            return mapping;
        }

        @Bean
        CaseInsensitiveController caseInsensitiveController() {
            return new CaseInsensitiveController();
        }
    }

    @RestController
    static class CaseInsensitiveController {

        @RequestMapping(path = "/api/orders", method = RequestMethod.GET)
        public void orders() {
        }
    }
}
