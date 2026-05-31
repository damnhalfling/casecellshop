import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Middleware que garante correlationId em todas as requisições.
 * Se o cliente enviar X-Correlation-Id, usa esse valor.
 * Caso contrário, gera um novo UUID.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const correlationId =
    (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    uuidv4();

  // Disponibiliza no request para uso nos handlers
  req.correlationId = correlationId;

  // Retorna no response header para rastreabilidade
  res.setHeader('X-Correlation-Id', correlationId);

  next();
}
