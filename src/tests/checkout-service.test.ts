import { CheckoutService, CheckoutError } from '../services/checkout-service';
import { OrderRepository } from '../repositories/order-repository';
import { ProductRepository } from '../repositories/product-repository';
import { StockService } from '../services/stock-service';
import { ProductService } from '../services/product-service';
import { QueueService } from '../queue/queue-service';
import { Product } from '../types';

describe('CheckoutService', () => {
  let checkoutService: CheckoutService;
  let orderRepo: OrderRepository;
  let productRepo: ProductRepository;
  let stockService: StockService;
  let productService: ProductService;
  let queue: QueueService;

  const testProducts: Product[] = [
    { id: 'p1', name: 'Capinha A', price: 29.90, stock: 10, category: 'iphone', imageUrl: '' },
    { id: 'p2', name: 'Capinha B', price: 39.90, stock: 2, category: 'samsung', imageUrl: '' },
  ];

  beforeEach(() => {
    orderRepo = new OrderRepository();
    productRepo = new ProductRepository(testProducts);
    stockService = new StockService(productRepo);
    productService = new ProductService(productRepo);
    queue = new QueueService();
    checkoutService = new CheckoutService(
      orderRepo,
      productRepo,
      stockService,
      productService,
      queue
    );
  });

  describe('processCheckout', () => {
    it('deve criar pedido com sucesso e retornar 202 (pending)', async () => {
      const result = await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 2 }],
          idempotencyKey: 'idem-001',
        },
        'corr-1'
      );

      expect(result.orderId).toBeDefined();
      expect(result.status).toBe('pending');
      expect(result.message).toContain('recebido');
    });

    it('deve calcular total corretamente', async () => {
      const result = await checkoutService.processCheckout(
        {
          items: [
            { productId: 'p1', quantity: 2 }, // 2 * 29.90 = 59.80
            { productId: 'p2', quantity: 1 }, // 1 * 39.90 = 39.90
          ],
          idempotencyKey: 'idem-002',
        },
        'corr-1'
      );

      const order = await orderRepo.findById(result.orderId);
      expect(order!.totalAmount).toBeCloseTo(99.70, 2);
    });

    it('deve decrementar estoque após checkout', async () => {
      await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 3 }],
          idempotencyKey: 'idem-003',
        },
        'corr-1'
      );

      const stock = await productRepo.getStock('p1');
      expect(stock).toBe(7);
    });

    it('deve rejeitar se produto não existe', async () => {
      await expect(
        checkoutService.processCheckout(
          {
            items: [{ productId: 'nonexistent', quantity: 1 }],
            idempotencyKey: 'idem-004',
          },
          'corr-1'
        )
      ).rejects.toThrow(CheckoutError);
    });

    it('deve rejeitar se estoque insuficiente', async () => {
      await expect(
        checkoutService.processCheckout(
          {
            items: [{ productId: 'p2', quantity: 5 }],
            idempotencyKey: 'idem-005',
          },
          'corr-1'
        )
      ).rejects.toThrow(CheckoutError);

      // Estoque não deve ter mudado
      const stock = await productRepo.getStock('p2');
      expect(stock).toBe(2);
    });

    it('deve publicar mensagem na fila', async () => {
      const result = await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 1 }],
          idempotencyKey: 'idem-006',
        },
        'corr-1'
      );

      // Fila deve ter 1 mensagem (sem consumer registrado)
      expect(queue.getQueueSize()).toBe(1);
    });
  });

  describe('idempotência', () => {
    it('deve retornar mesmo pedido para mesma idempotencyKey', async () => {
      const result1 = await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 1 }],
          idempotencyKey: 'idem-same',
        },
        'corr-1'
      );

      const result2 = await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 1 }],
          idempotencyKey: 'idem-same',
        },
        'corr-2'
      );

      expect(result1.orderId).toBe(result2.orderId);

      // Estoque deve ter sido decrementado apenas uma vez
      const stock = await productRepo.getStock('p1');
      expect(stock).toBe(9);
    });

    it('deve tratar duplo clique sem duplicar pedido (sequencial)', async () => {
      // Simula retry/duplo clique sequencial com mesma key
      const result1 = await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 1 }],
          idempotencyKey: 'double-click',
        },
        'corr-dc-1'
      );

      const result2 = await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 1 }],
          idempotencyKey: 'double-click',
        },
        'corr-dc-2'
      );

      const result3 = await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 1 }],
          idempotencyKey: 'double-click',
        },
        'corr-dc-3'
      );

      // Todos retornam o mesmo orderId
      expect(result1.orderId).toBe(result2.orderId);
      expect(result2.orderId).toBe(result3.orderId);

      // Estoque decrementado apenas uma vez
      const stock = await productRepo.getStock('p1');
      expect(stock).toBe(9); // 10 - 1 = 9 (não 10 - 3 = 7)
    });
  });

  describe('getOrderStatus', () => {
    it('deve retornar status do pedido existente', async () => {
      const checkout = await checkoutService.processCheckout(
        {
          items: [{ productId: 'p1', quantity: 1 }],
          idempotencyKey: 'idem-status',
        },
        'corr-1'
      );

      const result = await checkoutService.getOrderStatus(checkout.orderId);
      expect(result).not.toBeNull();
      expect(result!.order.status).toBe('pending');
    });

    it('deve retornar null para pedido inexistente', async () => {
      const result = await checkoutService.getOrderStatus('nonexistent');
      expect(result).toBeNull();
    });
  });
});
