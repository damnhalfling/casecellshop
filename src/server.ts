import express from 'express';
import { config } from './config';
import { logger } from './observability/logger';

// Repositories
import { ProductRepository } from './repositories/product-repository';
import { OrderRepository } from './repositories/order-repository';

// Services
import { CacheService } from './cache/cache-service';
import { ProductService } from './services/product-service';
import { StockService } from './services/stock-service';
import { CheckoutService } from './services/checkout-service';
import { QueueService } from './queue/queue-service';

// Worker
import { ErpWorker } from './workers/erp-worker';

// Middleware
import { correlationIdMiddleware } from './middleware/correlation-id';
import { requestLoggerMiddleware } from './middleware/request-logger';

// Routes
import { createProductRoutes } from './routes/product-routes';
import { createCheckoutRoutes } from './routes/checkout-routes';
import { createOrderRoutes } from './routes/order-routes';
import { createMetricsRoutes } from './routes/metrics-routes';

export function createApp() {
  const app = express();

  // --- Dependency Injection ---
  const productRepo = new ProductRepository();
  const orderRepo = new OrderRepository();
  const cache = new CacheService('products');
  const queue = new QueueService();

  const productService = new ProductService(productRepo, cache);
  const stockService = new StockService(productRepo);
  const checkoutService = new CheckoutService(
    orderRepo,
    productRepo,
    stockService,
    productService,
    queue
  );

  // Worker (processa pedidos da fila)
  const erpWorker = new ErpWorker(queue, orderRepo, stockService, 0.1);
  erpWorker.start();

  // --- Middleware ---
  app.use(express.json());
  app.use(correlationIdMiddleware);
  app.use(requestLoggerMiddleware);

  // --- Routes ---
  app.use('/products', createProductRoutes(productService));
  app.use('/checkout', createCheckoutRoutes(checkoutService));
  app.use('/orders', createOrderRoutes(checkoutService));
  app.use('/metrics', createMetricsRoutes());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      queueSize: queue.getQueueSize(),
    });
  });

  return { app, productRepo, orderRepo, queue, erpWorker, stockService, productService, checkoutService };
}

// Start server se executado diretamente
if (require.main === module) {
  const { app } = createApp();

  app.listen(config.port, () => {
    logger.info({
      event: 'server_started',
      port: config.port,
      environment: process.env.NODE_ENV || 'development',
    });
    console.log(`🚀 CaseCellShop API rodando em http://localhost:${config.port}`);
    console.log(`📊 Métricas em http://localhost:${config.port}/metrics`);
    console.log(`❤️  Health check em http://localhost:${config.port}/health`);
  });
}
