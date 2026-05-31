import { Router, Request, Response } from 'express';
import { CheckoutService } from '../services/checkout-service';

export function createOrderRoutes(checkoutService: CheckoutService): Router {
  const router = Router();

  /**
   * GET /orders/:orderId/status
   * Retorna status atual do pedido.
   */
  router.get('/:orderId/status', async (req: Request, res: Response) => {
    const correlationId = (req as any).correlationId;
    const { orderId } = req.params;

    try {
      const result = await checkoutService.getOrderStatus(orderId);

      if (!result) {
        res.status(404).json({
          error: {
            code: 'ORDER_NOT_FOUND',
            message: `Pedido ${orderId} não encontrado`,
          },
          meta: { correlationId },
        });
        return;
      }

      res.json({
        data: {
          orderId: result.order.id,
          status: result.order.status,
          totalAmount: result.order.totalAmount,
          items: result.order.items,
          createdAt: result.order.createdAt,
          updatedAt: result.order.updatedAt,
          retryCount: result.order.retryCount,
          errorMessage: result.order.errorMessage,
        },
        meta: { correlationId },
      });
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Erro ao consultar status do pedido',
        },
        meta: { correlationId },
      });
    }
  });

  return router;
}
