import { CacheService } from '../cache/cache-service';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService('test');
  });

  describe('get/set', () => {
    it('deve retornar null para chave inexistente', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('deve armazenar e recuperar valor', () => {
      cache.set('key1', { name: 'test' }, 60);
      const result = cache.get<{ name: string }>('key1');

      expect(result).not.toBeNull();
      expect(result!.data.name).toBe('test');
      expect(result!.isStale).toBe(false);
    });

    it('deve marcar como stale após TTL expirar', async () => {
      cache.set('key1', 'value', 0.001); // TTL de 1ms

      // Espera TTL expirar
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = cache.get('key1');
      expect(result).not.toBeNull();
      expect(result!.isStale).toBe(true);
    });
  });

  describe('invalidate', () => {
    it('deve remover entrada específica', () => {
      cache.set('key1', 'value1', 60);
      cache.set('key2', 'value2', 60);

      cache.invalidate('key1');

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).not.toBeNull();
    });

    it('deve remover todas as entradas com invalidateAll', () => {
      cache.set('key1', 'value1', 60);
      cache.set('key2', 'value2', 60);

      cache.invalidateAll();

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });
  });

  describe('stampede protection', () => {
    it('deve permitir apenas um refresh por vez', () => {
      const acquired1 = cache.acquireRefreshLock('key1');
      const acquired2 = cache.acquireRefreshLock('key1');

      expect(acquired1).toBe(true);
      expect(acquired2).toBe(false);
    });

    it('deve liberar lock após release', () => {
      cache.acquireRefreshLock('key1');
      cache.releaseRefreshLock('key1');

      const acquired = cache.acquireRefreshLock('key1');
      expect(acquired).toBe(true);
    });
  });
});
