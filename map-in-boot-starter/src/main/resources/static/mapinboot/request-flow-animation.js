(() => {
  "use strict";

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function positiveInteger(value) {
    if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
    if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function attributes(item) {
    return item && item.attributes && typeof item.attributes === "object" ? item.attributes : {};
  }

  function copyPosition(position) {
    return position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: position.x, y: position.y }
      : null;
  }

  function nodeMap(graph) {
    return new Map((graph && Array.isArray(graph.nodes) ? graph.nodes : []).map((node) => [node.id, node]));
  }

  function edgeMap(graph) {
    return new Map((graph && Array.isArray(graph.edges) ? graph.edges : []).map((edge) => [edge.id, edge]));
  }

  function appendStep(steps, definition) {
    steps.push({
      id: definition.id,
      label: definition.label,
      kind: definition.kind || "education",
      anchorId: definition.anchorId || null,
      displayItemId: definition.displayItemId || null,
      description: definition.description || "",
      filterEducation: definition.filterEducation || null,
      position: copyPosition(definition.position),
      transition: definition.transition || null
    });
  }

  function actualStep(steps, id, label, node, positions, description, filterEducation = null) {
    if (!node) return;
    appendStep(steps, {
      id,
      label,
      kind: "actual",
      anchorId: node.id,
      description,
      filterEducation,
      position: positions && positions[node.id]
    });
  }

  function runtimeStep(steps, id, label, component, displayModel, description) {
    if (!component || !displayModel) return;
    const itemId = (displayModel.runtimeComponentToItemIds && displayModel.runtimeComponentToItemIds[component.id] || [])[0];
    const item = itemId && displayModel.itemById && displayModel.itemById[itemId];
    if (!item) return;
    const bounds = item.bounds;
    appendStep(steps, {
      id,
      label,
      kind: "actual",
      anchorId: component.id,
      displayItemId: item.id,
      description,
      position: bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null
    });
  }

  function educationStep(steps, projection, positions, id, label, description, displayModel) {
    const node = projection && Array.isArray(projection.nodes)
      ? projection.nodes.find((item) => item.id === id)
      : null;
    const itemId = displayModel && displayModel.projectionToItemIds && displayModel.projectionToItemIds[id]?.[0];
    const displayItem = itemId && displayModel.itemById && displayModel.itemById[itemId];
    appendStep(steps, {
      id,
      label,
      kind: "education",
      anchorId: node ? node.id : displayItem ? id : null,
      displayItemId: displayItem ? displayItem.id : null,
      description,
      position: node ? node.position : positions && positions[id]
    });
  }

  function endpointFor(graph, endpointId) {
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    const candidateId = endpointId || graph && graph.endpointId;
    return candidateId ? nodes.find((node) => node.id === candidateId && node.type === "ENDPOINT") || null : null;
  }

  function transitionBetween(source, target, graph, projection, displayModel) {
    if (!source.anchorId || !target.anchorId || source.anchorId === target.anchorId) return null;
    const itemFor = (step) => {
      if (!displayModel || !step) return null;
      if (step.displayItemId) return displayModel.itemById && displayModel.itemById[step.displayItemId];
      return null;
    };
    const sourceItem = itemFor(source);
    const targetItem = itemFor(target);
    if (sourceItem && targetItem && sourceItem.cardId === targetItem.cardId) {
      const relation = (displayModel.displayRelations || []).find((item) =>
        !item.referenceOnly && item.sourceItemId === sourceItem.id && item.targetItemId === targetItem.id);
      if (relation && sourceItem.bounds && targetItem.bounds) {
        const center = (item) => ({ x: item.bounds.x + item.bounds.width / 2,
          y: item.bounds.y + item.bounds.height / 2 });
        const from = center(sourceItem);
        const to = center(targetItem);
        return { kind: "internal", from, to, sourceId: sourceItem.id, targetId: targetItem.id,
          length: Math.hypot(to.x - from.x, to.y - from.y) };
      }
    }
    const routedRelations = displayModel && displayModel.displayRelationToSegmentIds || {};
    const relation = sourceItem && targetItem && (displayModel.displayRelations || []).find((item) =>
      !item.referenceOnly && item.sourceItemId === sourceItem.id && item.targetItemId === targetItem.id
        && (routedRelations[item.id] || []).length > 0);
    if (relation) return {
      kind: "display",
      relationId: relation.id,
      sourceId: sourceItem.id,
      targetId: targetItem.id,
      sourceAnchorId: source.anchorId,
      targetAnchorId: target.anchorId,
      originalEdgeIds: (relation.originalEdgeIds || []).slice(),
      projectionEdgeIds: (relation.projectionEdgeIds || []).slice(),
      length: null
    };
    if (sourceItem && targetItem) {
      const queue = [{ itemId: sourceItem.id, relationIds: [] }];
      const visited = new Set([sourceItem.id]);
      while (queue.length) {
        const current = queue.shift();
        for (const next of displayModel.displayRelations || []) {
          if (next.referenceOnly || next.internalCardId || next.sourceItemId !== current.itemId
            || !(routedRelations[next.id] || []).length || visited.has(next.targetItemId)) continue;
          const relationIds = [...current.relationIds, next.id];
          if (next.targetItemId === targetItem.id) return { kind: "display", relationIds,
            relationId: relationIds[0], sourceId: sourceItem.id, targetId: targetItem.id, length: null };
          visited.add(next.targetItemId);
          queue.push({ itemId: next.targetItemId, relationIds });
        }
      }
    }
    return null;
  }

  function connectSteps(steps, graph, projection, displayModel, chainId) {
    const anchoredSteps = [];
    const notesByStep = new Map();
    steps.forEach((step, index) => {
      if (step.anchorId || !step.id.endsWith("-uncertain")) {
        anchoredSteps.push(step);
        return;
      }
      const note = [step.label, step.description].filter(Boolean).join(": ");
      const previous = anchoredSteps[anchoredSteps.length - 1];
      if (previous) notesByStep.set(previous, [...(notesByStep.get(previous) || []), note]);
      else {
        const next = steps.slice(index + 1).find((candidate) => candidate.anchorId);
        if (next) notesByStep.set(next, [...(notesByStep.get(next) || []), note]);
        else anchoredSteps.push(step);
      }
    });
    anchoredSteps.forEach((step) => {
      if (!displayModel || step.displayItemId || !step.anchorId) return;
      const ids = (displayModel.originalNodeToItemIds && displayModel.originalNodeToItemIds[step.anchorId])
        || (displayModel.runtimeComponentToItemIds && displayModel.runtimeComponentToItemIds[step.anchorId])
        || (displayModel.projectionToItemIds && displayModel.projectionToItemIds[step.anchorId]) || [];
      const items = ids.map((id) => displayModel.itemById[id]).filter(Boolean);
      const contextual = chainId ? items.filter((item) => item.rowId === `chain:${chainId}`
        || (displayModel.cardById[item.cardId]?.originalNodeIds || []).includes(chainId)) : [];
      const graphItems = items.filter((item) => (item.originalNodeIds || []).includes(step.anchorId)
        && item.originKind !== "RUNTIME_COMPONENT");
      const item = contextual.length === 1 ? contextual[0] : items.length === 1 ? items[0]
        : graphItems.length === 1 ? graphItems[0] : null;
      if (item) {
        step.displayItemId = item.id;
        if (item.bounds) step.position = { x: item.bounds.x + item.bounds.width / 2,
          y: item.bounds.y + item.bounds.height / 2 };
      }
    });
    const descriptions = {
      "education-http-request": "클라이언트가 HTTP 요청을 보냅니다. 웹 서버가 요청을 받아 처리 환경으로 전달합니다.",
      "education-web-server": "웹 서버가 연결과 HTTP 요청을 처리합니다. 요청은 웹 애플리케이션의 서블릿 처리 환경으로 전달됩니다.",
      "education-servlet-container": "요청을 처리할 웹 애플리케이션과 Servlet을 결정합니다. 적용되는 필터와 요청 처리 환경을 구성합니다.",
      "education-delegating-filter-proxy": "Servlet Filter에서 Spring Security의 필터 처리로 요청을 위임합니다. 보안 처리가 계속되면 이후 필터로 제어가 돌아갑니다.",
      "education-filter-chain-proxy": "요청에 맞는 SecurityFilterChain을 선택합니다. 선택된 체인의 필터가 순서대로 보안 처리를 수행할 수 있습니다.",
      "security-chain": "요청 조건에 맞는 보안 필터 체인을 선택합니다. 체인에 등록된 필터가 인증과 인가 처리를 담당합니다.",
      "dispatcher-servlet": "요청에 대응하는 Handler를 찾고 MVC 처리 과정을 조정합니다. 선택된 Handler는 적절한 HandlerAdapter를 통해 호출됩니다.",
      "education-handler-mapping": "요청 경로와 HTTP 메서드 등의 조건으로 Handler를 찾습니다. 확인된 매핑 정보를 다음 처리 단계에 전달합니다.",
      "endpoint-mapping": "요청 경로와 HTTP 메서드에 대응하는 매핑 정보입니다. 조건에 맞는 Handler를 선택할 때 사용합니다.",
      "education-handler-adapter": "선택된 Handler를 호출할 수 있도록 준비합니다. 필요한 인자를 구성하고 실행 결과를 처리할 수 있습니다.",
      "handler": "선택된 Controller 메서드가 요청을 처리합니다. 처리 결과는 응답을 만드는 과정으로 전달됩니다."
    };
    anchoredSteps.forEach((step) => {
      const item = step.displayItemId && displayModel?.itemById?.[step.displayItemId];
      if (item?.bounds) step.position = { x: item.bounds.x + item.bounds.width / 2,
        y: item.bounds.y + item.bounds.height / 2 };
      const node = graph?.nodes?.find((candidate) => candidate.id === step.anchorId);
      const component = displayModel?.runtimeComponents?.find((candidate) => candidate.id === step.anchorId);
      const data = attributes(node || component);
      const className = data.filterClass || component?.className;
      if (node?.type === "FILTER" || component?.kind === "SERVLET_FILTER_REGISTRATION") {
        const name = text(className || item?.label || step.label).split("|").pop().split(".").pop();
        if (name) step.label = name;
        if (!step.filterEducation) step.description = "요청과 응답을 다음 처리 단계로 전달하기 전에 필터의 등록된 처리를 수행합니다. 조건에 따라 이후 처리가 제한될 수 있습니다.";
      } else if (node?.type === "HANDLER") {
        const handler = text(data.handler || item?.label || step.label).replace(/\([^)]*\)/g, "");
        const parts = handler.split("#");
        step.label = parts.length > 1 ? `${parts[0].split(".").pop()}.${parts[1]}` : handler.split(".").pop();
      } else if (node?.type === "AUTHORIZATION" && item?.label) step.label = item.label;
      else if (item?.label && !text(item.label).includes("|") && !step.id.startsWith("education-")) step.label = item.label;
      if (text(step.label).includes("|")) step.label = text(step.label).split("|").filter(Boolean).pop() || "처리 단계";
      step.label = text(step.label).replace(/\b(?:[a-z_$][\w$]*\.)+([A-Z_$][\w$]*)/g, "$1");
      if (descriptions[step.id]) step.description = descriptions[step.id];
      if (notesByStep.has(step)) step.description = [step.description, ...notesByStep.get(step)].filter(Boolean).join(" ");
    });
    anchoredSteps.forEach((step, index) => {
      step.transition = index < anchoredSteps.length - 1
        ? transitionBetween(step, anchoredSteps[index + 1], graph, projection, displayModel) : null;
    });
    return anchoredSteps;
  }

  function confirmedFilterSet(index, graph, chainId) {
    if (!index || !chainId || typeof index.securityFiltersForChain !== "function") {
      return { status: "UNKNOWN", filters: [], edges: [] };
    }
    const result = index.securityFiltersForChain(chainId);
    const nodes = nodeMap(graph);
    const edges = edgeMap(graph);
    const chainRelations = (graph.edges || []).filter((edge) => edge.sourceId === chainId
      && edge.type === "FILTERED_BY");
    const hasUnconfirmedOrder = chainRelations.some((edge) => {
      const filter = nodes.get(edge.targetId);
      const order = positiveInteger(attributes(edge).filterOrder || attributes(filter).filterOrder);
      return edge.confidence !== "CONFIRMED" || !filter || filter.type !== "FILTER" || !order;
    });
    const relationshipsByNode = new Map((result.edges || []).filter((edge) => {
      const filter = nodes.get(edge.targetId);
      return edges.has(edge.id)
        && edge.sourceId === chainId
        && filter
        && filter.type === "FILTER"
        && attributes(filter).registrationKind === "SECURITY";
    }).map((edge) => [edge.targetId, edge]));
    const filters = (result.filters || []).map((filter) => nodes.get(filter.id)).filter(Boolean);
    const orderedEdges = filters.map((filter) => relationshipsByNode.get(filter.id)).filter(Boolean);
    if (hasUnconfirmedOrder || result.orderStatus !== "CONFIRMED" || filters.length !== (result.filters || []).length
      || orderedEdges.length !== filters.length) {
      return { status: result.orderStatus || "UNKNOWN", filters: [], edges: orderedEdges };
    }
    return {
      status: "CONFIRMED",
      filters,
      edges: orderedEdges
    };
  }

  // 실제 Snapshot 관계와 교육 전용 개념 단계를 분리한 Request 흐름 생성
  function buildSteps({ graph, index, endpointId, positions, projection, snapshot, displayModel } = {}) {
    const source = graph && typeof graph === "object" ? graph : { nodes: [], edges: [] };
    const sourceNodes = Array.isArray(source.nodes) ? source.nodes : [];
    const nodes = nodeMap(source);
    const edges = edgeMap(source);
    const endpoint = endpointFor(source, endpointId || source.detailEndpointId);
    const selectedEndpointId = endpoint ? endpoint.id : endpointId;
    const flowIndex = index || (window.MapInBootFlow && window.MapInBootFlow.createIndex
      ? window.MapInBootFlow.createIndex(source)
      : null);
    const steps = [];
    const runtimeComponents = displayModel && Array.isArray(displayModel.runtimeComponents)
      ? displayModel.runtimeComponents : [];
    const servletRegistrations = runtimeComponents.filter((component) => component.kind === "SERVLET_FILTER_REGISTRATION");
    const servletExecution = displayModel && displayModel.servletFilterExecution || { status: "UNKNOWN", entries: [] };
    const executionByComponentId = new Map((servletExecution.entries || []).map((entry) => [entry.componentId, entry]));

    educationStep(steps, projection, positions, "education-http-request", "HTTP 요청",
      "HTTP 요청이 웹 서버와 서블릿 컨테이너로 들어옵니다.", displayModel);
    if (displayModel && displayModel.projectionToItemIds
      && displayModel.projectionToItemIds["education-web-server"]?.length) {
      educationStep(steps, projection, positions, "education-web-server", "웹 서버",
        "실제 Runtime 웹 서버 항목입니다.", displayModel);
    }
    educationStep(steps, projection, positions, "education-servlet-container", "서블릿 컨테이너",
      "실제 컨테이너 항목 또는 Servlet 요청을 처리하는 일반 구조입니다.", displayModel);
    if (projection?.nodes?.some((node) => node.id === "education-request-prepare")) {
      educationStep(steps, projection, positions, "education-request-prepare", "요청 처리 준비",
        "요청 정보를 다음 처리 단계에 전달하는 일반적인 과정입니다. 실제 요청 객체를 뜻하지 않습니다.", displayModel);
    }
    educationStep(steps, projection, positions, "education-http-servlet-request", "요청·응답 객체",
      "HttpServletRequest는 경로와 헤더 등 요청 정보를 제공합니다. HttpServletResponse는 응답 상태와 헤더, 본문을 설정하는 데 사용됩니다.", displayModel);

    const servletFilterSteps = [];
    const servletStepRecords = [];
    let delegationIndex = -1;
    const addServletFilterStep = (component, graphNode, index) => {
      const delegation = Boolean(executionByComponentId.get(component && component.id)?.delegating)
        || /DelegatingFilterProxy|springSecurityFilterChain/i.test(`${component && component.className || ""} ${attributes(component).filterClass || ""} ${attributes(component).registrationName || ""} ${graphNode && graphNode.label || ""} ${attributes(graphNode).filterClass || ""}`);
      const stepId = component ? `servlet-filter-${component.id}` : `servlet-filter-${graphNode.id}`;
      if (component) runtimeStep(servletFilterSteps, stepId,
        `확인된 Servlet Filter · ${text(attributes(component).filterClass || component.className || component.kind).split(".").pop()}`,
        component, displayModel, `선택 API의 FilterMap 적용 순서 ${index + 1}입니다.`);
      else actualStep(servletFilterSteps, stepId, `확인된 Servlet Filter · ${graphNode.label}`,
        graphNode, positions, "GraphFlow가 확인한 Servlet Filter 순서입니다.");
      const step = servletFilterSteps[servletFilterSteps.length - 1];
      if (!step) return;
      servletStepRecords.push({ step, delegation });
      if (delegation) delegationIndex = servletStepRecords.length - 1;
    };
    const registrationByGraphNode = new Map();
    servletRegistrations.forEach((component) => (component.graphNodeIds || []).forEach((id) => {
      const matches = registrationByGraphNode.get(id) || [];
      matches.push(component);
      registrationByGraphNode.set(id, matches);
    }));
    let orderedGraphFilterIds = [];
    let servletOrderConfirmed = servletExecution.status === "CONFIRMED";
    if (servletOrderConfirmed && servletExecution.source === "TOMCAT_FILTER_MAP") {
      (servletExecution.orderedComponentIds || []).forEach((id, index) => {
        const component = servletRegistrations.find((item) => item.id === id);
        if (component) addServletFilterStep(component, null, index);
      });
    } else if (servletOrderConfirmed && servletExecution.source === "GRAPH_FLOW") {
      orderedGraphFilterIds = (servletExecution.orderedGraphNodeIds || []).slice();
    } else if (servletRegistrations.length === 0 && runtimeComponents.length === 0) {
      const servlets = sourceNodes.filter((node) => node.type === "SERVLET");
      const servlet = servlets.length === 1 ? servlets[0] : null;
      const servletOrder = servlet && flowIndex && typeof flowIndex.servletFiltersForServlet === "function"
        ? flowIndex.servletFiltersForServlet(servlet.id) : { orderStatus: "UNKNOWN", filters: [] };
      servletOrder.filters = servletOrder.filters || [];
      if (servletOrder.orderStatus === "CONFIRMED") {
        servletOrder.filters.forEach((filter) => orderedGraphFilterIds.push(filter.id));
        servletOrderConfirmed = true;
      } else servletOrderConfirmed = false;
    } else servletOrderConfirmed = false;
    if ((servletExecution.source === "GRAPH_FLOW" || servletRegistrations.length === 0) && servletOrderConfirmed) {
      orderedGraphFilterIds.forEach((id, index) => {
        const graphNode = nodes.get(id);
        const matches = registrationByGraphNode.get(id) || [];
        if (matches.length === 1) addServletFilterStep(matches[0], graphNode, index);
        else if (matches.length === 0 && graphNode && graphNode.type === "FILTER") addServletFilterStep(null, graphNode, index);
      });
    }
    if (!servletOrderConfirmed) {
      appendStep(steps, { id: "servlet-filter-order-uncertain", label: "Servlet Filter 순서 확인 불가",
        description: "Servlet Filter 등록 정보를 표시하지만 선택 API의 적용 순서를 확정할 근거가 부족해 순차 재생하지 않습니다." });
    }
    servletFilterSteps.forEach((step) => steps.push(step));
    const securityFlowAllowed = runtimeComponents.length === 0 && servletRegistrations.length === 0
      || (servletOrderConfirmed && delegationIndex >= 0);
    const securityStepStart = steps.length;
    const delegationItemId = displayModel && displayModel.projectionToItemIds
      && displayModel.projectionToItemIds["education-delegating-filter-proxy"]
      && displayModel.projectionToItemIds["education-delegating-filter-proxy"][0];
    if (securityFlowAllowed && !steps.some((step) => step.displayItemId && step.displayItemId === delegationItemId)) {
      educationStep(steps, projection, positions, "education-delegating-filter-proxy", "Spring Security 위임 필터",
        "일반적인 Spring Security 연동 흐름의 위임 단계입니다.", displayModel);
    }
    if (securityFlowAllowed) educationStep(steps, projection, positions, "education-filter-chain-proxy", "FilterChainProxy",
      "확인된 FilterChainProxy 항목 또는 일반적인 위임 흐름입니다.", displayModel);
    const match = selectedEndpointId && flowIndex && typeof flowIndex.firstMatchedChain === "function"
      ? flowIndex.firstMatchedChain(selectedEndpointId)
      : { status: "UNCERTAIN", chain: null, edge: null };
    const actualMatchEdge = match.edge && edges.get(match.edge.id);
    const chain = match.status === "CONFIRMED" && match.chain && nodes.get(match.chain.id)
      && actualMatchEdge ? nodes.get(match.chain.id) : null;
    if (securityFlowAllowed && chain) {
      actualStep(
        steps,
        "security-chain",
        `확인된 SecurityFilterChain · ${chain.label}`,
        chain,
        positions,
        "Snapshot에서 확인된 MATCHED_BY 관계로 첫 적용 Chain을 표시하며 조건과 순서는 해당 항목에서 확인합니다."
      );
      const filters = confirmedFilterSet(flowIndex, source, chain.id);
      if (filters.status === "CONFIRMED") {
        const standardFilterClient = window.MapInBootStandardFilters;
        const filterEducationByClass = new Map();
        if (standardFilterClient && standardFilterClient.list && standardFilterClient.classify) {
          const statusGraph = snapshot || source;
          const statusEntries = standardFilterClient.classify(
            statusGraph,
            statusGraph.analysisStatus || {},
            chain.id
          );
          const statusByClass = new Map(statusEntries.map((entry) => [entry.fqcn, entry]));
          standardFilterClient.list().forEach((reference) => {
            const status = statusByClass.get(reference.fqcn);
            filterEducationByClass.set(reference.fqcn, {
              ...reference,
              status: status ? status.status : "UNKNOWN",
              statusLabel: status ? status.statusLabel : standardFilterClient.statusLabel("UNKNOWN")
            });
          });
        }
        filters.filters.forEach((filter, indexInChain) => {
          const edge = filters.edges[indexInChain];
          if (!edge || !edges.has(edge.id)) return;
          actualStep(
            steps,
            `security-filter-${filter.id}`,
            `Security Filter · ${filter.label}`,
            filter,
            positions,
            `Snapshot에서 FILTERED_BY와 filterOrder ${attributes(edge).filterOrder || attributes(filter).filterOrder}를 확인했습니다.`,
            filterEducationByClass.get(attributes(filter).filterClass) || null
          );
        });
      } else {
        appendStep(steps, {
          id: "security-filter-order-uncertain",
          label: "Security Filter 순서 확인 불가",
          description: "순서를 확정할 근거가 부족해 확인된 통과 순서로 표시하지 않습니다."
        });
      }
    } else if (securityFlowAllowed) {
      appendStep(steps, {
        id: "security-chain-uncertain",
        label: "첫 SecurityFilterChain 확인 불가",
        kind: "education",
        description: "MATCHED_BY 관계가 없거나 불확실해 적용 Chain을 특정하지 않습니다."
      });
    }

    const policyEdge = chain && projection && (projection.edges || []).find((edge) =>
      edge.projectionKind === "authorization-policy" && edge.flowGroup === chain.id);
    const policy = policyEdge && nodes.get(policyEdge.targetId);
    if (policy) actualStep(steps, "authorization-policy", "인가 정책", policy, positions,
      "선택 요청에 적용되는 접근 조건입니다. 인증 정보와 정책의 조건에 따라 요청이 제한될 수 있습니다.");

    const securityStepEnd = steps.length;
    if (servletStepRecords.length && delegationIndex >= 0 && securityFlowAllowed) {
      const filterStart = steps.findIndex((step) => step === servletStepRecords[0].step);
      const prefix = steps.slice(0, filterStart);
      const securitySteps = steps.slice(securityStepStart, securityStepEnd);
      const suffix = steps.slice(securityStepEnd);
      steps.length = 0;
      steps.push(...prefix,
        ...servletStepRecords.slice(0, delegationIndex).map((record) => record.step),
        servletStepRecords[delegationIndex].step,
        ...securitySteps,
        ...servletStepRecords.slice(delegationIndex + 1).map((record) => record.step),
        ...suffix);
    }

    if ((!chain || match.status !== "CONFIRMED") && servletRegistrations.length === 0) appendStep(steps, {
      id: "servlet-next-target-uncertain",
      label: "다음 Servlet 처리 대상 확인 불가",
      description: "등록 순서와 실제 위임 관계가 확인되지 않아 다음 처리 대상을 연결하지 않습니다."
    });
    const runtimeDispatchers = runtimeComponents.filter((component) => ["SERVLET", "DISPATCHER_SERVLET"].includes(component.kind)
      && /DispatcherServlet/.test(`${component.className || ""} ${attributes(component).servletClass || ""}`));
    const graphDispatchers = sourceNodes.filter((node) => node.type === "SERVLET"
      && (attributes(node).servletKind === "DISPATCHER"
        || /DispatcherServlet/.test(text(attributes(node).servletClass))
        || text(attributes(node).servletName).toLowerCase() === "dispatcherservlet"));
    const runtimeDispatcher = runtimeDispatchers.length === 1 ? runtimeDispatchers[0] : null;
    const mappedDispatcher = runtimeDispatcher && (runtimeDispatcher.graphNodeIds || []).map((id) => nodes.get(id))
      .find((node) => node && node.type === "SERVLET");
    if (mappedDispatcher) actualStep(steps, "dispatcher-servlet", "확인된 DispatcherServlet",
      mappedDispatcher, positions, "Runtime DispatcherServlet과 연결된 Graph Node를 표시합니다.");
    else if (runtimeDispatcher) runtimeStep(steps, "dispatcher-servlet", "확인된 DispatcherServlet",
      runtimeDispatcher, displayModel, "Runtime에서 DispatcherServlet 구현을 확인했습니다.");
    else if (graphDispatchers.length === 1) actualStep(steps, "dispatcher-servlet", "확인된 DispatcherServlet",
      graphDispatchers[0], positions, "Snapshot에서 DispatcherServlet 식별 정보를 확인했습니다.");
    else appendStep(steps, { id: "dispatcher-servlet-uncertain", label: "DispatcherServlet 확인 불가",
      description: "Servlet 구성만으로 DispatcherServlet 실행 대상을 특정하지 않습니다." });
    educationStep(steps, projection, positions, "education-handler-mapping", "HandlerMapping",
      "실제 HandlerMapping Runtime 객체를 표시하며, 요청별 매핑은 원본 FLOWS_TO 관계에서 확인합니다.", displayModel);
    const actualEndpoint = endpoint && nodes.get(endpoint.id);
    if (actualEndpoint) actualStep(steps, "endpoint-mapping", `확인된 API Endpoint · ${actualEndpoint.label}`, actualEndpoint, positions, "Endpoint는 Servlet 실행 객체가 아니라 Handler 매핑 정보입니다.");
    educationStep(steps, projection, positions, "education-handler-adapter", "HandlerAdapter",
      "실제 HandlerAdapter Runtime 객체가 확인된 경우 해당 항목에서 구현을 확인합니다.", displayModel);

    const handler = selectedEndpointId && flowIndex && typeof flowIndex.handlerFor === "function"
      ? flowIndex.handlerFor(selectedEndpointId)
      : { status: "UNCERTAIN", node: null };
    const actualHandler = handler.status === "CONFIRMED" && handler.node && nodes.get(handler.node.id)
      ? nodes.get(handler.node.id) : null;
    if (actualHandler) {
      actualStep(
        steps,
        "handler",
        `확인된 Handler · ${actualHandler.label}`,
        actualHandler,
        positions,
        "Snapshot의 명시적 FLOWS_TO 관계로 Endpoint와 Handler를 연결합니다."
      );
    } else {
      appendStep(steps, {
        id: "handler-uncertain",
        label: "Handler 대응 확인 불가",
        description: "Snapshot에서 Endpoint와 Handler를 연결할 근거를 확인하지 못했습니다."
      });
    }

    educationStep(steps, projection, positions, "education-http-response", "HTTP 응답",
      "일반적인 동기 처리에서 Handler 결과가 호출자 방향으로 반환됩니다. 비동기·ERROR·FORWARD는 다른 흐름일 수 있습니다.",
      displayModel);

    return connectSteps(steps, source, projection, displayModel, chain && chain.id);
  }

  function pointInFrame(path, point, targetFrame) {
    if (!targetFrame || typeof path.getScreenCTM !== "function"
      || typeof targetFrame.getScreenCTM !== "function") return point;
    const source = path.getScreenCTM();
    const target = targetFrame.getScreenCTM();
    if (!source || !target) return point;
    const screenX = source.a * point.x + source.c * point.y + source.e;
    const screenY = source.b * point.x + source.d * point.y + source.f;
    const offsetX = screenX - target.e;
    const offsetY = screenY - target.f;
    const determinant = target.a * target.d - target.b * target.c;
    if (!Number.isFinite(determinant) || determinant === 0) return null;
    const x = (target.d * offsetX - target.c * offsetY) / determinant;
    const y = (-target.b * offsetX + target.a * offsetY) / determinant;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function pathPointAt(path, progress, cachedLength, targetFrame) {
    if (Array.isArray(path)) {
      const measured = path.map((item) => {
        try {
          return item && typeof item.getTotalLength === "function" ? item.getTotalLength() : 0;
        } catch {
          return 0;
        }
      });
      const totalLength = measured.reduce((sum, length) => sum + (Number.isFinite(length) && length > 0 ? length : 0), 0);
      if (!totalLength) return null;
      const ratio = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
      let distance = totalLength * ratio;
      for (let index = 0; index < path.length; index += 1) {
        const length = measured[index];
        if (!Number.isFinite(length) || length <= 0) continue;
        if (distance <= length || index === path.length - 1) {
          return pathPointAt(path[index], distance / length, length, targetFrame);
        }
        distance -= length;
      }
      return null;
    }
    if (!path || typeof path.getTotalLength !== "function" || typeof path.getPointAtLength !== "function") return null;
    try {
      const length = Number.isFinite(cachedLength) && cachedLength > 0 ? cachedLength : path.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) return null;
      const ratio = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
      const point = path.getPointAtLength(length * (path.requestFlowReverse ? 1 - ratio : ratio));
      return point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? pointInFrame(path, { x: point.x, y: point.y }, targetFrame)
        : null;
    } catch {
      return null;
    }
  }

  function defaultClock() {
    const request = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? (callback) => window.requestAnimationFrame(callback)
      : (callback) => setTimeout(() => callback(Date.now()), 16);
    const cancel = typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function"
      ? (id) => window.cancelAnimationFrame(id)
      : (id) => clearTimeout(id);
    const now = typeof performance !== "undefined" && typeof performance.now === "function"
      ? () => performance.now()
      : () => Date.now();
    return { requestFrame: request, cancelFrame: cancel, now };
  }

  function createController(options = {}) {
    const clock = options.clock || defaultClock();
    const duration = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
    let nodeHoldDuration = duration(options.nodeHoldDuration, 280);
    let playbackSpeed = duration(options.speed, 1);
    const minimumEdgeDuration = duration(options.minimumEdgeDuration, 450);
    const maximumEdgeDuration = Math.max(minimumEdgeDuration, duration(options.maximumEdgeDuration, 1000));
    const durationPerLength = duration(options.durationPerLength, 0.65);
    const unavailablePathDuration = duration(options.unavailablePathDuration, 280);
    const stepNoticeDuration = duration(options.stepNoticeDuration, 260);
    const reducedMotion = Boolean(options.reducedMotion);
    const reducedMotionStepDuration = duration(options.reducedMotionStepDuration, 650);
    const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : () => {};
    const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
    let steps = [];
    let status = "idle";
    let stepIndex = 0;
    let phase = null;
    let progress = 0;
    let startedAt = 0;
    let phaseElapsed = 0;
    let frameId = null;
    let destroyed = false;

    function snapshot() {
      return {
        status,
        stepIndex,
        phase,
        progress,
        step: steps[stepIndex] || null,
        nextStep: steps[stepIndex + 1] || null,
        transition: steps[stepIndex] && steps[stepIndex].transition || null,
        steps: steps.slice()
      };
    }

    function emitUpdate() {
      onUpdate(snapshot());
    }

    function setStatus(nextStatus) {
      if (status === nextStatus) return;
      status = nextStatus;
      onStateChange(snapshot());
    }

    function cancelFrame() {
      if (frameId === null) return;
      clock.cancelFrame(frameId);
      frameId = null;
    }

    function scheduleFrame() {
      if (frameId !== null || status !== "running" || destroyed) return;
      frameId = clock.requestFrame(frame);
    }

    function phaseForStep(step) {
      return step && step.anchorId ? "NODE_HOLD" : "STEP_NOTICE";
    }

    function edgeDuration(step) {
      const length = step && step.transition && step.transition.length;
      if (!Number.isFinite(length) || length <= 0) return null;
      const baseDuration = Math.min(maximumEdgeDuration, Math.max(minimumEdgeDuration, length * durationPerLength));
      return baseDuration / playbackSpeed;
    }

    function phaseDuration() {
      if (reducedMotion) return phase === "NODE_HOLD" ? nodeHoldDuration : reducedMotionStepDuration;
      if (phase === "NODE_HOLD") return nodeHoldDuration;
      if (phase === "EDGE_TRAVEL") return edgeDuration(steps[stepIndex]);
      if (phase === "PATH_UNAVAILABLE") return unavailablePathDuration;
      if (phase === "STEP_NOTICE") return stepNoticeDuration;
      return null;
    }

    function complete() {
      phase = "COMPLETE";
      progress = 1;
      phaseElapsed = 0;
      setStatus("complete");
      emitUpdate();
    }

    function nextStep() {
      if (stepIndex + 1 >= steps.length) {
        complete();
        return;
      }
      stepIndex += 1;
      phase = phaseForStep(steps[stepIndex]);
      phaseElapsed = 0;
      progress = 0;
    }

    function advancePhase() {
      const step = steps[stepIndex];
      const target = steps[stepIndex + 1];
      if (phase === "NODE_HOLD" && target) {
        if (!target.anchorId) {
          stepIndex += 1;
          phase = "STEP_NOTICE";
        }
        else if (step.anchorId === target.anchorId || !edgeDuration(step)) phase = "PATH_UNAVAILABLE";
        else phase = "EDGE_TRAVEL";
        phaseElapsed = 0;
        progress = 0;
        return;
      }
      nextStep();
    }

    function advance(timestamp) {
      if (steps.length === 0 || status !== "running") return false;
      let elapsed = Math.max(0, (Number.isFinite(timestamp) ? timestamp : clock.now()) - startedAt);
      while (status === "running") {
        const currentDuration = phaseDuration();
        if (!Number.isFinite(currentDuration) || currentDuration <= 0) {
          if (phase === "NODE_HOLD" || phase === "EDGE_TRAVEL") {
            phase = "PATH_UNAVAILABLE";
            phaseElapsed = 0;
            progress = 0;
          } else advancePhase();
          if (status !== "running") return false;
          continue;
        }
        if (elapsed < currentDuration) {
          phaseElapsed = elapsed;
          progress = reducedMotion ? 0 : elapsed / currentDuration;
          if (!reducedMotion) emitUpdate();
          return true;
        }
        elapsed -= currentDuration;
        startedAt += currentDuration;
        phaseElapsed = 0;
        progress = 0;
        if (reducedMotion) nextStep();
        else advancePhase();
        if (status !== "running") return false;
        if (reducedMotion) emitUpdate();
        if (elapsed === 0) {
          if (!reducedMotion) emitUpdate();
          return true;
        }
      }
      return false;
    }

    function frame(timestamp) {
      frameId = null;
      if (status !== "running" || destroyed) return;
      if (advance(timestamp)) scheduleFrame();
    }

    function setSteps(nextSteps) {
      if (destroyed) return;
      cancelFrame();
      steps = Array.isArray(nextSteps) ? nextSteps.slice() : [];
      status = "idle";
      stepIndex = 0;
      phase = null;
      progress = 0;
      phaseElapsed = 0;
      onStateChange(snapshot());
      emitUpdate();
    }

    function play() {
      if (destroyed || steps.length === 0 || status === "running") return;
      if (status === "complete" || status === "idle") {
        stepIndex = 0;
        phase = phaseForStep(steps[stepIndex]);
        progress = 0;
        phaseElapsed = 0;
      }
      startedAt = clock.now() - phaseElapsed;
      setStatus("running");
      emitUpdate();
      scheduleFrame();
    }

    function pause() {
      if (destroyed || status !== "running") return;
      advance(clock.now());
      cancelFrame();
      if (status === "running") setStatus("paused");
      emitUpdate();
    }

    // 재생 프레임을 정리하고 Controller가 소유한 현재 단계를 직접 선택
    function seekToStep(index) {
      if (destroyed || !Number.isInteger(index) || index < 0 || index >= steps.length) return false;
      cancelFrame();
      stepIndex = index;
      phase = phaseForStep(steps[stepIndex]);
      progress = 0;
      startedAt = clock.now();
      phaseElapsed = 0;
      setStatus("paused");
      emitUpdate();
      return true;
    }

    function setPlaybackSettings(settings = {}) {
      if (destroyed) return;
      const now = clock.now();
      const wasRunning = status === "running";
      if (wasRunning) advance(now);
      if (wasRunning && status !== "running") cancelFrame();

      const previousDuration = phaseDuration();
      const progressRatio = Number.isFinite(previousDuration) && previousDuration > 0
        ? Math.max(0, Math.min(1, phaseElapsed / previousDuration))
        : 0;
      if (Number.isFinite(settings.nodeHoldDuration) && settings.nodeHoldDuration > 0) {
        nodeHoldDuration = settings.nodeHoldDuration;
      }
      if (Number.isFinite(settings.speed) && settings.speed > 0) playbackSpeed = settings.speed;

      const nextDuration = phaseDuration();
      if (Number.isFinite(previousDuration) && previousDuration > 0
        && Number.isFinite(nextDuration) && nextDuration > 0) {
        phaseElapsed = nextDuration * progressRatio;
        if (status === "running") startedAt = now - phaseElapsed;
        progress = reducedMotion ? 0 : progressRatio;
      }
      emitUpdate();
    }

    function reset() {
      if (destroyed) return;
      cancelFrame();
      phase = null;
      phaseElapsed = 0;
      startedAt = 0;
      stepIndex = 0;
      progress = 0;
      setStatus("idle");
      emitUpdate();
    }

    function destroy() {
      cancelFrame();
      destroyed = true;
      status = "idle";
      phase = null;
    }

    return {
      setSteps,
      setPlaybackSettings,
      play,
      pause,
      seekToStep,
      reset,
      destroy,
      state: snapshot,
      activeFrameCount: () => frameId === null ? 0 : 1
    };
  }

  window.MapInBootRequestFlow = { buildSteps, createController, pathPointAt };
})();
