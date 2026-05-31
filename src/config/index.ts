export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  cache: {
    /** TTL padrão para produtos em segundos */
    productsTtlSeconds: 30,
    /** TTL para produto individual */
    productTtlSeconds: 60,
  },
  checkout: {
    /** Tempo simulado de processamento do ERP (ms) */
    erpProcessingTimeMs: 2000,
    /** Máximo de retries do worker */
    maxRetries: 3,
    /** Delay entre retries (ms) */
    retryDelayMs: 1000,
  },
  stock: {
    /** Tempo de expiração de reserva (ms) */
    reservationExpiryMs: 300_000, // 5 minutos
  },
};
