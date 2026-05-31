import client from 'prom-client';

// Registra métricas padrão do processo (CPU, memória, event loop)
client.collectDefaultMetrics({ prefix: 'casecellshop_' });

// --- Cache Metrics ---
export const cacheHits = new client.Counter({
  name: 'casecellshop_cache_hits_total',
  help: 'Total de cache hits',
  labelNames: ['cache_name'] as const,
});

export const cacheMisses = new client.Counter({
  name: 'casecellshop_cache_misses_total',
  help: 'Total de cache misses',
  labelNames: ['cache_name'] as const,
});

export const cacheStaleServed = new client.Counter({
  name: 'casecellshop_cache_stale_served_total',
  help: 'Total de vezes que cache stale foi servido como fallback',
  labelNames: ['cache_name'] as const,
});

// --- Checkout Metrics ---
export const checkoutRequests = new client.Counter({
  name: 'casecellshop_checkout_requests_total',
  help: 'Total de requisições de checkout',
  labelNames: ['status'] as const,
});

export const checkoutDuration = new client.Histogram({
  name: 'casecellshop_checkout_duration_seconds',
  help: 'Duração do processamento de checkout',
  labelNames: ['status'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

// --- Worker / Queue Metrics ---
export const workerProcessed = new client.Counter({
  name: 'casecellshop_worker_processed_total',
  help: 'Total de pedidos processados pelo worker',
  labelNames: ['result'] as const,
});

export const workerRetries = new client.Counter({
  name: 'casecellshop_worker_retries_total',
  help: 'Total de retries do worker',
});

export const queueSize = new client.Gauge({
  name: 'casecellshop_queue_size',
  help: 'Tamanho atual da fila de pedidos',
});

// --- ERP Metrics ---
export const erpLatency = new client.Histogram({
  name: 'casecellshop_erp_latency_seconds',
  help: 'Latência simulada de chamadas ao ERP',
  buckets: [0.5, 1, 2, 3, 5, 10],
});

// --- Stock Metrics ---
export const stockReservations = new client.Counter({
  name: 'casecellshop_stock_reservations_total',
  help: 'Total de reservas de estoque',
  labelNames: ['result'] as const,
});

export const oversellAttempts = new client.Counter({
  name: 'casecellshop_oversell_attempts_total',
  help: 'Tentativas de venda sem estoque suficiente',
});

// --- HTTP Metrics ---
export const httpRequestDuration = new client.Histogram({
  name: 'casecellshop_http_request_duration_seconds',
  help: 'Duração das requisições HTTP',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

export const registry = client.register;
