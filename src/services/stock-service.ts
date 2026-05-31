import { ProductRepository } from '../repositories/product-repository';
import { logger } from '../observability/logger';
import { stockReservations, oversellAttempts } from '../observability/metrics';

/**
 * Serviço de estoque com reserva atômica.
 *
 * Estratégia: Atomic Conditional Update
 * - Decrementa estoque atomicamente no momento do checkout
 * - Se falhar (estoque insuficiente), rejeita imediatamente
 * - Se o pedido falhar depois, faz rollback (incrementa de volta)
 *
 * Trade-off escolhido:
 * - Atomic update é mais simples que lock pessimista ou distributed lock
 * - Suficiente para o cenário em memória (single-process)
 * - Em produção com múltiplas instâncias, usaríamos:
 *   UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty
 *   (atomic conditional update no banco)
 */
export class StockService {
  constructor(private readonly productRepo: ProductRepository) {}

  /**
   * Tenta reservar estoque para um item.
   * Retorna true se a reserva foi bem-sucedida.
   */
  async reserve(
    productId: string,
    quantity: number,
    correlationId: string
  ): Promise<boolean> {
    const success = await this.productRepo.decrementStock(productId, quantity);

    if (success) {
      stockReservations.inc({ result: 'success' });
      logger.info({
        event: 'stock_reserved',
        productId,
        quantity,
        correlationId,
      });
    } else {
      stockReservations.inc({ result: 'insufficient' });
      oversellAttempts.inc();
      logger.warn({
        event: 'stock_insufficient',
        productId,
        quantity,
        correlationId,
      });
    }

    return success;
  }

  /**
   * Libera estoque reservado (rollback).
   */
  async release(
    productId: string,
    quantity: number,
    correlationId: string
  ): Promise<void> {
    await this.productRepo.incrementStock(productId, quantity);
    stockReservations.inc({ result: 'released' });
    logger.info({
      event: 'stock_released',
      productId,
      quantity,
      correlationId,
    });
  }

  /**
   * Reserva múltiplos itens atomicamente.
   * Se qualquer item falhar, faz rollback de todos os anteriores.
   */
  async reserveAll(
    items: { productId: string; quantity: number }[],
    correlationId: string
  ): Promise<{ success: boolean; failedProductId?: string }> {
    const reserved: { productId: string; quantity: number }[] = [];

    for (const item of items) {
      const success = await this.reserve(
        item.productId,
        item.quantity,
        correlationId
      );

      if (!success) {
        // Rollback de todos os itens já reservados
        for (const r of reserved) {
          await this.release(r.productId, r.quantity, correlationId);
        }
        return { success: false, failedProductId: item.productId };
      }

      reserved.push(item);
    }

    return { success: true };
  }
}
