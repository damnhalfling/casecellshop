import { OrderRepository } from '../repositories/order-repository';
import { QueueService } from '../queue/queue-service';
import { StockService } from '../services/stock-service';
import { logger } from '../observability/logger';

/**
 * Worker de reconciliação.
 *
 * Executa periodicamente para:
 * 1. Pedidos "pending" há mais de X minutos → republica na fila
 * 2. Pedidos "processing" há mais de Y minutos → marca como failed + rollback estoque
 *
 * Em produção, seria um cron job ou scheduled task separado.
 * Aqui roda como setInterval no mesmo processo para demonstrar o conceito.
 */
export class ReconciliationWorker {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly queue: QueueService,
    private readonly stockService: StockService,
    private readonly pendingThresholdMs: number = 120_000, // 2 minutos
    private readonly processingThresholdMs: number = 300_000, // 5 minutos
    private readonly intervalMs: number = 60_000 // executa a cada 1 minuto
  ) {}

  start(): void {
    this.intervalId = setInterval(() => this.reconcile(), this.intervalMs);
    logger.info({
      event: 'reconciliation_worker_started',
      intervalMs: this.intervalMs,
      pendingThresholdMs: this.pendingThresholdMs,
      processingThresholdMs: this.processingThresholdMs,
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info({ event: 'reconciliation_worker_stopped' });
    }
  }

  /**
   * Executa reconciliação manualmente (útil para testes e endpoint admin).
   */
  async reconcile(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      republished: 0,
      failed: 0,
      errors: [],
    };

    try {
      await this.reconcilePendingOrders(result);
      await this.reconcileStuckProcessing(result);
    } catch (error) {
      logger.error({
        event: 'reconciliation_error',
        error: (error as Error).message,
      });
      result.errors.push((error as Error).message);
    }

    if (result.republished > 0 || result.failed > 0) {
      logger.info({
        event: 'reconciliation_completed',
        republished: result.republished,
        failed: result.failed,
      });
    }

    return result;
  }

  /**
   * Pedidos "pending" há mais tempo que o threshold → republica na fila.
   * Isso cobre o caso de "pedido órfão" (gravado mas não enfileirado).
   */
  private async reconcilePendingOrders(result: ReconciliationResult): Promise<void> {
    const pendingOrders = await this.orderRepo.findByStatus('pending');
    const now = Date.now();

    for (const order of pendingOrders) {
      const age = now - new Date(order.createdAt).getTime();

      if (age > this.pendingThresholdMs) {
        try {
          await this.queue.publish({
            orderId: order.id,
            correlationId: `reconciliation-${order.id}`,
            publishedAt: new Date().toISOString(),
          });
          result.republished++;

          logger.warn({
            event: 'reconciliation_republished',
            orderId: order.id,
            ageMs: age,
          });
        } catch (error) {
          result.errors.push(`Failed to republish ${order.id}: ${(error as Error).message}`);
        }
      }
    }
  }

  /**
   * Pedidos "processing" há mais tempo que o threshold → marca como failed + rollback.
   * Isso cobre o caso de worker que morreu durante processamento.
   */
  private async reconcileStuckProcessing(result: ReconciliationResult): Promise<void> {
    const processingOrders = await this.orderRepo.findByStatus('processing');
    const now = Date.now();

    for (const order of processingOrders) {
      const age = now - new Date(order.updatedAt).getTime();

      if (age > this.processingThresholdMs) {
        try {
          await this.orderRepo.updateStatus(
            order.id,
            'failed',
            'Timeout: pedido preso em processing (reconciliação)'
          );

          // Rollback do estoque
          for (const item of order.items) {
            await this.stockService.release(
              item.productId,
              item.quantity,
              `reconciliation-${order.id}`
            );
          }

          result.failed++;

          logger.warn({
            event: 'reconciliation_failed_stuck',
            orderId: order.id,
            ageMs: age,
          });
        } catch (error) {
          result.errors.push(`Failed to reconcile ${order.id}: ${(error as Error).message}`);
        }
      }
    }
  }
}

export interface ReconciliationResult {
  republished: number;
  failed: number;
  errors: string[];
}
