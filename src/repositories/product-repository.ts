import { Product } from '../types';

/**
 * Repositório de produtos em memória.
 * Simula o banco de dados do ERP (MySQL read-only).
 * Em produção, seria uma conexão ao banco do ERP ou um read model próprio.
 */

const SEED_PRODUCTS: Product[] = [
  {
    id: 'prod-001',
    name: 'Capinha iPhone 15 Pro - Transparente',
    price: 49.90,
    stock: 100,
    category: 'iphone',
    imageUrl: '/images/iphone15-clear.jpg',
  },
  {
    id: 'prod-002',
    name: 'Capinha Samsung S24 Ultra - Silicone Preto',
    price: 39.90,
    stock: 50,
    category: 'samsung',
    imageUrl: '/images/s24-black.jpg',
  },
  {
    id: 'prod-003',
    name: 'Capinha Motorola Edge 40 - Antichoque',
    price: 59.90,
    stock: 5,
    category: 'motorola',
    imageUrl: '/images/edge40-shock.jpg',
  },
  {
    id: 'prod-004',
    name: 'Capinha iPhone 14 - MagSafe Azul',
    price: 89.90,
    stock: 30,
    category: 'iphone',
    imageUrl: '/images/iphone14-magsafe.jpg',
  },
  {
    id: 'prod-005',
    name: 'Capinha Xiaomi 14 - Fibra de Carbono',
    price: 44.90,
    stock: 0,
    category: 'xiaomi',
    imageUrl: '/images/xiaomi14-carbon.jpg',
  },
];

export class ProductRepository {
  private products: Map<string, Product>;

  constructor(initialProducts?: Product[]) {
    this.products = new Map();
    const seed = initialProducts || SEED_PRODUCTS;
    seed.forEach((p) => this.products.set(p.id, { ...p }));
  }

  async findAll(): Promise<Product[]> {
    // Simula latência de consulta ao banco do ERP
    await this.simulateLatency();
    return Array.from(this.products.values()).map((p) => ({ ...p }));
  }

  async findById(id: string): Promise<Product | null> {
    await this.simulateLatency();
    const product = this.products.get(id);
    return product ? { ...product } : null;
  }

  /**
   * Atomic decrement de estoque.
   * Retorna true se o decremento foi bem-sucedido (estoque suficiente).
   * Usa comparação atômica para evitar race condition.
   */
  async decrementStock(productId: string, quantity: number): Promise<boolean> {
    const product = this.products.get(productId);
    if (!product) return false;

    // Atomic check-and-update (em memória é síncrono, mas simula o conceito)
    if (product.stock < quantity) {
      return false;
    }

    product.stock -= quantity;
    return true;
  }

  /**
   * Restaura estoque (rollback de reserva expirada ou pedido cancelado).
   */
  async incrementStock(productId: string, quantity: number): Promise<void> {
    const product = this.products.get(productId);
    if (product) {
      product.stock += quantity;
    }
  }

  async getStock(productId: string): Promise<number> {
    const product = this.products.get(productId);
    return product?.stock ?? 0;
  }

  private simulateLatency(): Promise<void> {
    // Simula 50-150ms de latência do ERP
    const delay = 50 + Math.random() * 100;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
