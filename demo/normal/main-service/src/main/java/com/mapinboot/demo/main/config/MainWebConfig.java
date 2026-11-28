package com.mapinboot.demo.main.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Main 서비스 웹 MVC 설정
 */
@Configuration
public class MainWebConfig implements WebMvcConfigurer {

    /**
     * 데모 기본 경로 접근 시 index.html 포워딩 매핑 등록
     */
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/demo").setViewName("forward:/demo/index.html");
        registry.addViewController("/demo/").setViewName("forward:/demo/index.html");
    }
}

