import { QueueMessage, QueueService } from '../queue/queue-service';
import { OrderRepository } from '../repositories/order-repository';
import { StockService } from '../services/stock-service';
import { config } from '../config';
import { logger } from '../observability/logger';
import { workerProcessed, workerRetries, erpLatency } from '../observability/metrics';
import { tracer } from '../observability/tracing';

/**
 * Worker que processa pedidos da fila e "envia" ao ERP.
 *
 * Simula:
 * - Chamada ao ERP com latência variável
 * - Falhas aleatórias (para demonstrar retry)
 * - Retry com backoff
 * - Atualização de status do pedido
 *
 * Em produção:
 * - Seria um consumer de RabbitMQ/SQS
 * - Faria chamada HTTP real ao ERP para faturamento
 * - Teria dead-letter queue para mensagens que falharam N vezes
 */
export class ErpWorker {
  private failureRate: number;

  constructor(
    private readonly queue: QueueService,
    private readonly orderRepo: OrderRepository,
    private readonly stockService: StockService,
    failureRate: number = 0.2 // 20% de chance de falha simulada
  ) {
    this.failureRate = failureRate;
  }

  start(): void {
    this.queue.registerConsumer(this.handleMessage.bind(this));
    logger.info({ event: 'erp_worker_started' });
  }

  private async handleMessage(message: QueueMessage): Promise<void> {
    const span = tracer.startSpan('ErpWorker.handleMessage', {
      attributes: {
        orderId: message.orderId,
        correlationId: message.correlationId,
      },
    });

    logger.info({
      event: 'worker_processing_order',
      orderId: message.orderId,
      correlationId: message.correlationId,
    });

    // Atualiza status para "processing"
    await this.orderRepo.updateStatus(message.orderId, 'processing');

    try {
      // Simula chamada ao ERP
      await this.simulateErpCall(message);

      // Sucesso - atualiza status
      await this.orderRepo.updateStatus(message.orderId, 'confirmed');
      workerProcessed.inc({ result: 'success' });

      logger.info({
        event: 'order_confirmed',
        orderId: message.orderId,
        correlationId: message.correlationId,
      });

      tracer.endSpan(span);
    } catch (error) {
      const order = await this.orderRepo.findById(message.orderId);
      const retryCount = order?.retryCount ?? 0;

      if (retryCount < config.checkout.maxRetries) {
        // Retry
        await this.orderRepo.incrementRetry(message.orderId);
        workerRetries.inc();

        logger.warn({
          event: 'worker_retry',
          orderId: message.orderId,
          retryCount: retryCount + 1,
          maxRetries: config.checkout.maxRetries,
          correlationId: message.correlationId,
          error: (error as Error).message,
        });

        tracer.endSpan(span, 'error');

        // Re-throw para que a fila recoloque a mensagem
        throw error;
      } else {
        // Max retries atingido - marca como failed e libera estoque
        await this.orderRepo.updateStatus(
          message.orderId,
          'failed',
          `Falha após ${config.checkout.maxRetries} tentativas: ${(error as Error).message}`
        );

        // Rollback do estoque
        if (order) {
          for (const item of order.items) {
            await this.stockService.release(
              item.productId,
              item.quantity,
              message.correlationId
            );
          }
        }

        workerProcessed.inc({ result: 'failed' });

        logger.error({
          event: 'order_failed',
          orderId: message.orderId,
          retryCount,
          correlationId: message.correlationId,
          error: (error as Error).message,
        });

        tracer.endSpan(span, 'error');
      }
    }
  }

  /**
   * Simula chamada ao ERP com latência e possível falha.
   */
  private async simulateErpCall(message: QueueMessage): Promise<void> {
    const timer = erpLatency.startTimer();
    const delay = config.checkout.erpProcessingTimeMs * (0.5 + Math.random());

    await new Promise((resolve) => setTimeout(resolve, delay));

    timer();

    // Simula falha aleatória
    if (Math.random() < this.failureRate) {
      throw new Error('ERP timeout simulado');
    }
  }

  /**
   * Define taxa de falha (útil para testes).
   */
  setFailureRate(rate: number): void {
    this.failureRate = rate;
  }
}
