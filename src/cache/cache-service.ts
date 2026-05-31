import { CacheEntry } from '../types';
import { cacheHits, cacheMisses, cacheStaleServed } from '../observability/metrics';
import { logger } from '../observability/logger';

/**
 * Cache em memória com:
 * - TTL configurável por entrada
 * - Fallback para dados stale quando a origem falha
 * - Proteção contra cache stampede via mutex simples
 * - Métricas de hit/miss/stale
 *
 * Estratégia: Cache-Aside com Stale-While-Revalidate
 * - Na leitura: se cache válido, retorna direto (hit)
 * - Se expirado mas existe: retorna stale + dispara refresh em background
 * - Se não existe: busca na origem (miss)
 */
export class CacheService {
  private store: Map<string, CacheEntry<unknown>> = new Map();
  private refreshLocks: Set<string> = new Set();
  private readonly cacheName: string;

  constructor(cacheName: string = 'default') {
    this.cacheName = cacheName;
  }

  /**
   * Busca valor do cache.
   * Retorna { data, isStale } ou null se não encontrado.
   */
  get<T>(key: string): { data: T; isStale: boolean } | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      cacheMisses.inc({ cache_name: this.cacheName });
      return null;
    }

    const age = Date.now() - entry.cachedAt;
    const isStale = age > entry.ttl * 1000;

    if (isStale) {
      cacheStaleServed.inc({ cache_name: this.cacheName });
      logger.debug({
        event: 'cache_stale',
        cache: this.cacheName,
        key,
        ageMs: age,
        ttlMs: entry.ttl * 1000,
      });
    } else {
      cacheHits.inc({ cache_name: this.cacheName });
    }

    return { data: entry.data, isStale };
  }

  /**
   * Armazena valor no cache com TTL em segundos.
   */
  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.store.set(key, {
      data,
      cachedAt: Date.now(),
      ttl: ttlSeconds,
    });
  }

  /**
   * Invalida uma entrada específica.
   */
  invalidate(key: string): void {
    this.store.delete(key);
    logger.debug({ event: 'cache_invalidate', cache: this.cacheName, key });
  }

  /**
   * Invalida todas as entradas.
   */
  invalidateAll(): void {
    this.store.clear();
    logger.debug({ event: 'cache_invalidate_all', cache: this.cacheName });
  }

  /**
   * Verifica se um refresh já está em andamento para evitar stampede.
   * Retorna true se o lock foi adquirido (caller deve fazer refresh).
   * Lock expira automaticamente após timeout para evitar locks órfãos.
   */
  acquireRefreshLock(key: string, timeoutMs: number = 10_000): boolean {
    if (this.refreshLocks.has(key)) {
      return false; // Outro processo já está fazendo refresh
    }
    this.refreshLocks.add(key);

    // Safety timeout: libera lock automaticamente se não for liberado manualmente
    setTimeout(() => {
      if (this.refreshLocks.has(key)) {
        this.refreshLocks.delete(key);
        logger.warn({
          event: 'cache_refresh_lock_timeout',
          cache: this.cacheName,
          key,
          timeoutMs,
        });
      }
    }, timeoutMs);

    return true;
  }

  releaseRefreshLock(key: string): void {
    this.refreshLocks.delete(key);
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
    };
  }
}
