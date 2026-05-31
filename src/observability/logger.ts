import pino from 'pino';

/**
 * Logger estruturado com pino.
 * Campos obrigatórios em cada log:
 * - timestamp (automático pelo pino)
 * - level
 * - service: "casecellshop"
 * - correlationId / requestId
 * - orderId (quando aplicável)
 * - event: nome do evento de negócio
 */
export const logger = pino({
  name: 'casecellshop',
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

export type Logger = typeof logger;
