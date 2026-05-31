import { Router, Request, Response } from 'express';
import { ProductService } from '../services/product-service';

export function createProductRoutes(productService: ProductService): Router {
  const router = Router();

  /**
   * GET /products
   * Retorna lista de produtos com cache.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const correlationId = req.correlationId;
      const products = await productService.getAll(correlationId);

      res.json({
        data: products,
        meta: {
          total: products.length,
          correlationId,
        },
      });
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Erro ao buscar produtos',
        },
      });
    }
  });

  /**
   * GET /products/:id
   * Retorna produto específico.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const correlationId = req.correlationId;
      const product = await productService.getById(req.params.id, correlationId);

      if (!product) {
        res.status(404).json({
          error: {
            code: 'PRODUCT_NOT_FOUND',
            message: `Produto ${req.params.id} não encontrado`,
          },
        });
        return;
      }

      res.json({ data: product });
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Erro ao buscar produto',
        },
      });
    }
  });

  return router;
}
