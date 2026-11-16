(() => {
  "use strict";

  const ELK_VERSION = "0.12.1";
  const WORKER_URL = "/mapinboot/vendor/elk-worker.min.js";
  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 82;
  const LAYOUT_OPTIONS = Object.freeze({
    "org.eclipse.elk.algorithm": "layered",
    "org.eclipse.elk.direction": "RIGHT",
    "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
    "org.eclipse.elk.portConstraints": "FIXED_SIDE",
    "org.eclipse.elk.spacing.nodeNode": "40",
    "org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers": "90",
    "org.eclipse.elk.padding": "[top=32,left=32,bottom=32,right=32]"
  });

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function buildGraph(graph) {
    const children = graph.nodes
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => ({
        id: node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        ports: [
          { id: `${node.id}:in`, properties: { "org.eclipse.elk.port.side": "WEST" } },
          { id: `${node.id}:out`, properties: { "org.eclipse.elk.port.side": "EAST" } }
        ]
      }));
    const edges = graph.edges
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => ({
        id: edge.id,
        sources: [`${edge.sourceId}:out`],
        targets: [`${edge.targetId}:in`]
      }));
    return {
      id: "mapinboot-graph",
      layoutOptions: LAYOUT_OPTIONS,
      children,
      edges
    };
  }

  function copyPoint(point) {
    return point && finite(point.x) && finite(point.y) ? { x: point.x, y: point.y } : null;
  }

  function extractLayout(result) {
    if (!result || !Array.isArray(result.children) || !Array.isArray(result.edges)) {
      throw new Error("ELK 결과 구조가 올바르지 않습니다.");
    }
    const positions = {};
    result.children.forEach((child) => {
      if (!child.id || !finite(child.x) || !finite(child.y)) {
        throw new Error("ELK Node 좌표가 올바르지 않습니다.");
      }
      positions[child.id] = { x: child.x, y: child.y };
    });
    const edgeRoutes = {};
    result.edges.forEach((edge) => {
      if (!edge.id) throw new Error("ELK Edge ID가 없습니다.");
      edgeRoutes[edge.id] = {
        sections: Array.isArray(edge.sections)
          ? edge.sections.map((section) => ({
            startPoint: copyPoint(section.startPoint),
            bendPoints: Array.isArray(section.bendPoints) ? section.bendPoints.map(copyPoint).filter(Boolean) : [],
            endPoint: copyPoint(section.endPoint)
          }))
          : []
      };
    });
    return {
      positions,
      edgeRoutes,
      width: finite(result.width) && result.width > 0 ? result.width : 640,
      height: finite(result.height) && result.height > 0 ? result.height : 360
    };
  }

  function createClient(ElkConstructor = window.ELK) {
    let elk = null;
    let latestRequest = 0;
    if (typeof ElkConstructor === "function") {
      elk = new ElkConstructor({ workerUrl: WORKER_URL });
    }
    return {
      workerUrl: WORKER_URL,
      layoutOptions: LAYOUT_OPTIONS,
      buildGraph,
      layout(graph) {
        const requestId = ++latestRequest;
        if (!elk) return Promise.reject(new Error("ELK.js Worker를 사용할 수 없습니다."));
        return elk.layout(buildGraph(graph), { layoutOptions: LAYOUT_OPTIONS }).then((result) => {
          const layout = extractLayout(result);
          return { ...layout, requestId, stale: requestId !== latestRequest };
        });
      },
      terminate() {
        latestRequest += 1;
        if (elk && typeof elk.terminateWorker === "function") elk.terminateWorker();
      }
    };
  }

  const client = createClient();
  window.MapInBootLayout = {
    version: ELK_VERSION,
    workerUrl: WORKER_URL,
    layoutOptions: LAYOUT_OPTIONS,
    buildGraph,
    extractLayout,
    createClient,
    layout: (graph) => client.layout(graph),
    terminate: () => client.terminate()
  };
})();
