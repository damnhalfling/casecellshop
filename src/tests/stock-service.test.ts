import { StockService } from '../services/stock-service';
import { ProductRepository } from '../repositories/product-repository';
import { Product } from '../types';

describe('StockService', () => {
  let stockService: StockService;
  let productRepo: ProductRepository;

  const testProducts: Product[] = [
    { id: 'p1', name: 'Capinha A', price: 29.90, stock: 10, category: 'iphone', imageUrl: '' },
    { id: 'p2', name: 'Capinha B', price: 39.90, stock: 2, category: 'samsung', imageUrl: '' },
    { id: 'p3', name: 'Capinha C', price: 49.90, stock: 0, category: 'motorola', imageUrl: '' },
  ];

  beforeEach(() => {
    productRepo = new ProductRepository(testProducts);
    stockService = new StockService(productRepo);
  });

  describe('reserve', () => {
    it('deve reservar estoque quando disponível', async () => {
      const result = await stockService.reserve('p1', 5, 'corr-1');
      expect(result).toBe(true);

      const remaining = await productRepo.getStock('p1');
      expect(remaining).toBe(5);
    });

    it('deve rejeitar quando estoque insuficiente', async () => {
      const result = await stockService.reserve('p2', 5, 'corr-1');
      expect(result).toBe(false);

      // Estoque não deve ter mudado
      const remaining = await productRepo.getStock('p2');
      expect(remaining).toBe(2);
    });

    it('deve rejeitar quando estoque é zero', async () => {
      const result = await stockService.reserve('p3', 1, 'corr-1');
      expect(result).toBe(false);
    });

    it('deve rejeitar para produto inexistente', async () => {
      const result = await stockService.reserve('nonexistent', 1, 'corr-1');
      expect(result).toBe(false);
    });
  });

  describe('release', () => {
    it('deve restaurar estoque após release', async () => {
      await stockService.reserve('p1', 3, 'corr-1');
      await stockService.release('p1', 3, 'corr-1');

      const remaining = await productRepo.getStock('p1');
      expect(remaining).toBe(10);
    });
  });

  describe('reserveAll (atomicidade)', () => {
    it('deve reservar todos os itens quando todos têm estoque', async () => {
      const result = await stockService.reserveAll(
        [
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 1 },
        ],
        'corr-1'
      );

      expect(result.success).toBe(true);
      expect(await productRepo.getStock('p1')).toBe(8);
      expect(await productRepo.getStock('p2')).toBe(1);
    });

    it('deve fazer rollback de todos se um falhar', async () => {
      const result = await stockService.reserveAll(
        [
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 5 }, // Vai falhar (só tem 2)
        ],
        'corr-1'
      );

      expect(result.success).toBe(false);
      expect(result.failedProductId).toBe('p2');

      // p1 deve ter sido restaurado
      expect(await productRepo.getStock('p1')).toBe(10);
      // p2 não deve ter mudado
      expect(await productRepo.getStock('p2')).toBe(2);
    });
  });

  describe('concorrência (simulada)', () => {
    it('deve evitar overselling com reservas concorrentes', async () => {
      // p2 tem estoque = 2
      // 5 tentativas concorrentes de reservar 1 unidade cada
      const promises = Array.from({ length: 5 }, (_, i) =>
        stockService.reserve('p2', 1, `corr-${i}`)
      );

      const results = await Promise.all(promises);
      const successCount = results.filter(Boolean).length;

      // No máximo 2 devem ter sucesso (estoque inicial = 2)
      expect(successCount).toBeLessThanOrEqual(2);

      // Estoque final deve ser >= 0
      const finalStock = await productRepo.getStock('p2');
      expect(finalStock).toBeGreaterThanOrEqual(0);
    });

    /**
     * NOTA SOBRE CONCORRÊNCIA EM NODE.JS:
     *
     * Em single-process Node.js, o event loop serializa operações síncronas em memória,
     * então race conditions "reais" não ocorrem no mesmo tick. O teste acima valida
     * a lógica de negócio (nunca vender mais que o disponível).
     *
     * Em produção com múltiplas instâncias, a atomicidade seria garantida pelo banco:
     *   UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty
     *   (affected_rows = 0 indica estoque insuficiente)
     *
     * O teste abaixo simula o cenário de "esgotamento progressivo" que ocorreria
     * com múltiplos consumers processando simultaneamente.
     */
    it('deve esgotar estoque corretamente com múltiplas reservas sequenciais', async () => {
      // p2 tem estoque = 2
      // Reserva 1, depois 1, depois tenta mais 1 (deve falhar)
      const r1 = await stockService.reserve('p2', 1, 'seq-1');
      const r2 = await stockService.reserve('p2', 1, 'seq-2');
      const r3 = await stockService.reserve('p2', 1, 'seq-3');

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(r3).toBe(false); // Estoque esgotado

      const finalStock = await productRepo.getStock('p2');
      expect(finalStock).toBe(0);
    });

    it('deve garantir que estoque nunca fica negativo mesmo com reservas maiores que disponível', async () => {
      // p2 tem estoque = 2, tenta reservar 3 de uma vez
      const result = await stockService.reserve('p2', 3, 'big-reserve');
      expect(result).toBe(false);

      // Estoque não deve ter mudado
      const finalStock = await productRepo.getStock('p2');
      expect(finalStock).toBe(2);
    });
  });
});
