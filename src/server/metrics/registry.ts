import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { PACKAGE_NAME } from "../../core/config/index.js";
import http from "node:http";

let exporter: PrometheusExporter | null = null;
let meterProvider: MeterProvider | null = null;
let authServer: http.Server | null = null;

export interface MetricsOptions {
  port: number;
  bearerToken?: string | undefined;
}

export const initMetricsRegistry = (options: MetricsOptions) => {
  if (exporter && meterProvider) {
    return { exporter, meterProvider };
  }

  if (options.bearerToken) {
    exporter = new PrometheusExporter({
      preventServerStart: true,
    });

    meterProvider = new MeterProvider({
      readers: [exporter],
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: PACKAGE_NAME,
      }),
    });

    authServer = http.createServer((req, res) => {
      // Health endpoint — no auth required
      if (req.url === "/health" || req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.writeHead(401, {
          "Content-Type": "text/plain",
          "WWW-Authenticate": 'Bearer realm="Metrics"',
        });
        res.end("Unauthorized: Missing or invalid Bearer token");
        return;
      }

      const token = authHeader.substring(7);

      if (token !== options.bearerToken) {
        res.writeHead(401, {
          "Content-Type": "text/plain",
          "WWW-Authenticate": 'Bearer realm="Metrics"',
        });
        res.end("Unauthorized: Invalid Bearer token");
        return;
      }

      if (req.url === "/metrics") {
        exporter!.getMetricsRequestHandler(req, res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    });

    authServer.listen(options.port);
  } else {
    exporter = new PrometheusExporter({ port: options.port });
    meterProvider = new MeterProvider({
      readers: [exporter],
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: PACKAGE_NAME,
      }),
    });
  }

  return { exporter, meterProvider };
};

export const getMetricsRegistry = () => {
  if (!exporter || !meterProvider) {
    throw new Error(
      "Metrics registry not initialized. Call initMetricsRegistry() first.",
    );
  }
  return { exporter, meterProvider, authServer };
};

export const getMeter = () => {
  const { meterProvider } = getMetricsRegistry();
  return meterProvider.getMeter(PACKAGE_NAME);
};

export interface MetricOptions {
  description?: string;
  unit?: string;
}

export const createObservableGauge = (name: string, options?: MetricOptions) => {
  const meter = getMeter();
  return meter.createObservableGauge(`${PACKAGE_NAME}_${name}`, options);
};
