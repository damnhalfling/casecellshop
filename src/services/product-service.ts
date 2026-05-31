import { Product } from '../types';
import { ProductRepository } from '../repositories/product-repository';
import { CacheService } from '../cache/cache-service';
import { config } from '../config';
import { logger } from '../observability/logger';
import { tracer } from '../observability/tracing';

const CACHE_KEY_ALL = 'products:all';
const CACHE_KEY_PREFIX = 'products:';

/**
 * Serviço de produtos com cache-aside + stale-while-revalidate.
 */
export class ProductService {
  private cache: CacheService;

  constructor(
    private readonly productRepo: ProductRepository,
    cache?: CacheService
  ) {
    this.cache = cache || new CacheService('products');
  }

  async getAll(correlationId: string): Promise<Product[]> {
    const span = tracer.startSpan('ProductService.getAll', {
      attributes: { correlationId },
    });

    try {
      // 1. Tenta cache
      const cached = this.cache.get<Product[]>(CACHE_KEY_ALL);

      if (cached && !cached.isStale) {
        span.attributes['cache'] = 'hit';
        tracer.endSpan(span);
        return cached.data;
      }

      // 2. Se stale, retorna stale e faz refresh em background
      if (cached && cached.isStale) {
        span.attributes['cache'] = 'stale';
        this.refreshInBackground(CACHE_KEY_ALL, correlationId);
        tracer.endSpan(span);
        return cached.data;
      }

      // 3. Cache miss - busca na origem
      span.attributes['cache'] = 'miss';
      const products = await this.productRepo.findAll();
      this.cache.set(CACHE_KEY_ALL, products, config.cache.productsTtlSeconds);

      tracer.endSpan(span);
      return products;
    } catch (error) {
      tracer.endSpan(span, 'error');

      // Fallback: se a origem falhar e temos cache stale, usa ele
      const stale = this.cache.get<Product[]>(CACHE_KEY_ALL);
      if (stale) {
        logger.warn({
          event: 'product_fetch_fallback_stale',
          correlationId,
          error: (error as Error).message,
        });
        return stale.data;
      }

      throw error;
    }
  }

  async getById(productId: string, correlationId: string): Promise<Product | null> {
    const cacheKey = `${CACHE_KEY_PREFIX}${productId}`;
    const cached = this.cache.get<Product>(cacheKey);

    if (cached && !cached.isStale) {
      return cached.data;
    }

    if (cached && cached.isStale) {
      this.refreshInBackground(cacheKey, correlationId, productId);
      return cached.data;
    }

    const product = await this.productRepo.findById(productId);
    if (product) {
      this.cache.set(cacheKey, product, config.cache.productTtlSeconds);
    }
    return product;
  }

  /**
   * Invalida cache após mudança de estoque (ex: após checkout).
   */
  invalidateProductCache(productId?: string): void {
    if (productId) {
      this.cache.invalidate(`${CACHE_KEY_PREFIX}${productId}`);
    }
    // Sempre invalida a lista completa quando estoque muda
    this.cache.invalidate(CACHE_KEY_ALL);
  }

  private refreshInBackground(
    cacheKey: string,
    correlationId: string,
    productId?: string
  ): void {
    // Proteção contra stampede
    if (!this.cache.acquireRefreshLock(cacheKey)) {
      return;
    }

    const doRefresh = async () => {
      try {
        if (productId) {
          const product = await this.productRepo.findById(productId);
          if (product) {
            this.cache.set(cacheKey, product, config.cache.productTtlSeconds);
          }
        } else {
          const products = await this.productRepo.findAll();
          this.cache.set(cacheKey, products, config.cache.productsTtlSeconds);
        }
        logger.debug({ event: 'cache_refreshed', cacheKey, correlationId });
      } catch (err) {
        logger.error({
          event: 'cache_refresh_failed',
          cacheKey,
          correlationId,
          error: (err as Error).message,
        });
      } finally {
        this.cache.releaseRefreshLock(cacheKey);
      }
    };

    // Fire-and-forget
    doRefresh();
  }
}
