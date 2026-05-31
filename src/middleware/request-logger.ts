import { Request, Response, NextFunction } from 'express';
import { logger } from '../observability/logger';
import { httpRequestDuration } from '../observability/metrics';

/**
 * Middleware de logging estruturado para todas as requisições HTTP.
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  const correlationId = (req as any).correlationId;

  // Log de entrada
  logger.info({
    event: 'http_request_start',
    method: req.method,
    path: req.path,
    correlationId,
    userAgent: req.headers['user-agent'],
  });

  // Intercepta o fim da resposta
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;

    // Métrica de duração
    httpRequestDuration.observe(
      {
        method: req.method,
        route: req.route?.path || req.path,
        status_code: res.statusCode.toString(),
      },
      duration
    );

    // Log de saída
    logger.info({
      event: 'http_request_end',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      correlationId,
    });
  });

  next();
}
