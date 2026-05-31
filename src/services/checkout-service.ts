import { v4 as uuidv4 } from 'uuid';
import { Order, CheckoutRequest, CheckoutResponse } from '../types';
import { OrderRepository } from '../repositories/order-repository';
import { ProductRepository } from '../repositories/product-repository';
import { StockService } from './stock-service';
import { ProductService } from './product-service';
import { QueueService } from '../queue/queue-service';
import { logger } from '../observability/logger';
import { checkoutRequests, checkoutDuration } from '../observability/metrics';
import { tracer } from '../observability/tracing';

/**
 * Serviço de checkout assíncrono.
 *
 * Fluxo:
 * 1. Verifica idempotência (se já existe pedido com mesma key, retorna o existente)
 * 2. Valida produtos e calcula total
 * 3. Reserva estoque atomicamente (all-or-nothing)
 * 4. Grava pedido com status "pending"
 * 5. Publica na fila para processamento assíncrono pelo worker
 * 6. Retorna 202 Accepted com orderId
 *
 * Decisão: gravar pedido ANTES de publicar na fila.
 * Motivo: se a publicação falhar, o pedido fica com status "pending" e pode ser
 * reconciliado. Se publicássemos antes de gravar, teríamos "mensagem fantasma"
 * (fila com pedido que não existe no banco).
 */
export class CheckoutService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductRepository,
    private readonly stockService: StockService,
    private readonly productService: ProductService,
    private readonly queue: QueueService
  ) {}

  async processCheckout(
    request: CheckoutRequest,
    correlationId: string
  ): Promise<CheckoutResponse> {
    const timer = checkoutDuration.startTimer();
    const span = tracer.startSpan('CheckoutService.processCheckout', {
      attributes: { correlationId, idempotencyKey: request.idempotencyKey },
    });

    try {
      // 1. Idempotência: verifica se já existe pedido com essa key
      const existing = await this.orderRepo.findByIdempotencyKey(
        request.idempotencyKey
      );
      if (existing) {
        logger.info({
          event: 'checkout_idempotent_hit',
          orderId: existing.id,
          idempotencyKey: request.idempotencyKey,
          correlationId,
        });
        checkoutRequests.inc({ status: 'idempotent' });
        timer({ status: 'idempotent' });
        tracer.endSpan(span);
        return {
          orderId: existing.id,
          status: existing.status,
          message: 'Pedido já existente (idempotência)',
        };
      }

      // 2. Valida produtos e calcula total
      let totalAmount = 0;
      const orderItems = [];

      for (const item of request.items) {
        const product = await this.productRepo.findById(item.productId);
        if (!product) {
          checkoutRequests.inc({ status: 'validation_error' });
          timer({ status: 'validation_error' });
          tracer.endSpan(span, 'error');
          throw new CheckoutError(
            `Produto não encontrado: ${item.productId}`,
            'PRODUCT_NOT_FOUND'
          );
        }
        totalAmount += product.price * item.quantity;
        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: product.price,
        });
      }

      // 3. Reserva estoque atomicamente
      const stockResult = await this.stockService.reserveAll(
        request.items,
        correlationId
      );

      if (!stockResult.success) {
        checkoutRequests.inc({ status: 'out_of_stock' });
        timer({ status: 'out_of_stock' });
        tracer.endSpan(span, 'error');
        throw new CheckoutError(
          `Estoque insuficiente para produto: ${stockResult.failedProductId}`,
          'INSUFFICIENT_STOCK'
        );
      }

      // 4. Grava pedido ANTES de publicar na fila
      const order: Order = {
        id: uuidv4(),
        items: orderItems,
        status: 'pending',
        totalAmount,
        idempotencyKey: request.idempotencyKey,
        createdAt: new Date(),
        updatedAt: new Date(),
        retryCount: 0,
      };

      await this.orderRepo.save(order);

      logger.info({
        event: 'order_created',
        orderId: order.id,
        totalAmount,
        itemCount: orderItems.length,
        correlationId,
      });

      // 5. Publica na fila
      try {
        await this.queue.publish({
          orderId: order.id,
          correlationId,
          publishedAt: new Date().toISOString(),
        });
      } catch (queueError) {
        // Se falhar ao publicar, pedido fica "pending" para reconciliação
        logger.error({
          event: 'queue_publish_failed',
          orderId: order.id,
          correlationId,
          error: (queueError as Error).message,
        });
        // Não faz rollback do estoque aqui - reconciliação cuidará disso
      }

      // 6. Invalida cache de produtos (estoque mudou)
      for (const item of request.items) {
        this.productService.invalidateProductCache(item.productId);
      }

      checkoutRequests.inc({ status: 'accepted' });
      timer({ status: 'accepted' });
      tracer.endSpan(span);

      return {
        orderId: order.id,
        status: 'pending',
        message: 'Pedido recebido e será processado',
      };
    } catch (error) {
      if (error instanceof CheckoutError) {
        throw error;
      }
      checkoutRequests.inc({ status: 'error' });
      timer({ status: 'error' });
      tracer.endSpan(span, 'error');
      throw error;
    }
  }

  async getOrderStatus(
    orderId: string
  ): Promise<{ order: Order } | null> {
    const order = await this.orderRepo.findById(orderId);
    return order ? { order } : null;
  }
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}
