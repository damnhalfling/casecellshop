import { Order, OrderStatus } from '../types';

/**
 * Repositório de pedidos em memória.
 * Em produção, seria um banco próprio da loja (PostgreSQL, por exemplo).
 */
export class OrderRepository {
  private orders: Map<string, Order> = new Map();
  private idempotencyIndex: Map<string, string> = new Map(); // idempotencyKey -> orderId

  async save(order: Order): Promise<void> {
    this.orders.set(order.id, { ...order });
    this.idempotencyIndex.set(order.idempotencyKey, order.id);
  }

  async findById(id: string): Promise<Order | null> {
    const order = this.orders.get(id);
    return order ? { ...order } : null;
  }

  async findByIdempotencyKey(key: string): Promise<Order | null> {
    const orderId = this.idempotencyIndex.get(key);
    if (!orderId) return null;
    return this.findById(orderId);
  }

  async updateStatus(
    orderId: string,
    status: OrderStatus,
    errorMessage?: string
  ): Promise<void> {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = status;
      order.updatedAt = new Date();
      if (errorMessage) {
        order.errorMessage = errorMessage;
      }
    }
  }

  async incrementRetry(orderId: string): Promise<number> {
    const order = this.orders.get(orderId);
    if (order) {
      order.retryCount += 1;
      order.updatedAt = new Date();
      return order.retryCount;
    }
    return 0;
  }

  async findByStatus(status: OrderStatus): Promise<Order[]> {
    return Array.from(this.orders.values())
      .filter((o) => o.status === status)
      .map((o) => ({ ...o }));
  }

  async getAll(): Promise<Order[]> {
    return Array.from(this.orders.values()).map((o) => ({ ...o }));
  }
}
