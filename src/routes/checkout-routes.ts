import { Router, Request, Response } from 'express';
import { CheckoutService, CheckoutError } from '../services/checkout-service';
import { CheckoutRequest } from '../types';
import { logger } from '../observability/logger';

export function createCheckoutRoutes(checkoutService: CheckoutService): Router {
  const router = Router();

  /**
   * POST /checkout
   * Inicia checkout assíncrono.
   * Retorna 202 Accepted com orderId para acompanhamento.
   */
  router.post('/', async (req: Request, res: Response) => {
    const correlationId = req.correlationId;

    try {
      // Validação básica
      const { items, idempotencyKey } = req.body as CheckoutRequest;

      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'items é obrigatório e deve ser um array não vazio',
          },
        });
        return;
      }

      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'idempotencyKey é obrigatório',
          },
        });
        return;
      }

      for (const item of items) {
        if (
          !item.productId ||
          !item.quantity ||
          item.quantity < 1 ||
          !Number.isInteger(item.quantity)
        ) {
          res.status(400).json({
            error: {
              code: 'INVALID_REQUEST',
              message: 'Cada item deve ter productId e quantity inteiro >= 1',
            },
          });
          return;
        }
      }

      const result = await checkoutService.processCheckout(
        { items, idempotencyKey },
        correlationId
      );

      res.status(202).json({
        data: result,
        meta: { correlationId },
      });
    } catch (error) {
      if (error instanceof CheckoutError) {
        const statusMap: Record<string, number> = {
          PRODUCT_NOT_FOUND: 404,
          INSUFFICIENT_STOCK: 409,
        };

        const status = statusMap[error.code] || 400;
        res.status(status).json({
          error: {
            code: error.code,
            message: error.message,
          },
          meta: { correlationId },
        });
        return;
      }

      logger.error({
        event: 'checkout_unexpected_error',
        correlationId,
        error: (error as Error).message,
      });

      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Erro interno no checkout',
        },
        meta: { correlationId },
      });
    }
  });

  return router;
}
