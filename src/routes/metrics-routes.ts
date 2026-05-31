import { Router, Request, Response } from 'express';
import { registry } from '../observability/metrics';

export function createMetricsRoutes(): Router {
  const router = Router();

  /**
   * GET /metrics
   * Expõe métricas no formato Prometheus para scraping.
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const metrics = await registry.metrics();
      res.set('Content-Type', registry.contentType);
      res.send(metrics);
    } catch (error) {
      res.status(500).send('Erro ao coletar métricas');
    }
  });

  return router;
}
