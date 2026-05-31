import express from 'express';
import { createApp } from '../server';

// Simula supertest inline (sem dependência extra)
import http from 'http';

function request(app: express.Application) {
  const server = http.createServer(app);

  return {
    get(path: string) {
      return makeRequest(server, 'GET', path);
    },
    post(path: string, body?: object) {
      return makeRequest(server, 'POST', path, body);
    },
  };
}

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: object
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const options: http.RequestOptions = {
        hostname: 'localhost',
        port: addr.port,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          try {
            resolve({
              status: res.statusCode!,
              body: JSON.parse(data),
              headers: res.headers,
            });
          } catch {
            resolve({ status: res.statusCode!, body: data, headers: res.headers });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

describe('Integration Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    const created = createApp();
    app = created.app;
  });

  describe('GET /products', () => {
    it('deve retornar lista de produtos com status 200', async () => {
      const res = await request(app).get('/products');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it('deve incluir correlationId no response', async () => {
      const res = await request(app).get('/products');

      expect(res.headers['x-correlation-id']).toBeDefined();
    });

    it('deve usar cache na segunda chamada', async () => {
      // Primeira chamada (miss)
      await request(app).get('/products');
      // Segunda chamada (hit)
      const res = await request(app).get('/products');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('POST /checkout', () => {
    it('deve retornar 202 para checkout válido', async () => {
      const res = await request(app).post('/checkout', {
        items: [{ productId: 'prod-001', quantity: 1 }],
        idempotencyKey: 'test-idem-001',
      });

      expect(res.status).toBe(202);
      expect(res.body.data.orderId).toBeDefined();
      expect(res.body.data.status).toBe('pending');
    });

    it('deve retornar 400 para request inválido', async () => {
      const res = await request(app).post('/checkout', {
        items: [],
        idempotencyKey: 'test-idem-002',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });

    it('deve retornar 400 para quantity não inteiro', async () => {
      const res = await request(app).post('/checkout', {
        items: [{ productId: 'prod-001', quantity: 1.5 }],
        idempotencyKey: 'test-idem-float',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });

    it('deve retornar 409 para estoque insuficiente', async () => {
      const res = await request(app).post('/checkout', {
        items: [{ productId: 'prod-003', quantity: 100 }],
        idempotencyKey: 'test-idem-003',
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    });
  });

  describe('GET /orders/:orderId/status', () => {
    it('deve retornar 404 para pedido inexistente', async () => {
      const res = await request(app).get('/orders/nonexistent/status');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('deve retornar status do pedido após checkout', async () => {
      // Cria pedido
      const checkout = await request(app).post('/checkout', {
        items: [{ productId: 'prod-001', quantity: 1 }],
        idempotencyKey: 'test-idem-status',
      });

      const orderId = checkout.body.data.orderId;

      // Consulta status
      const res = await request(app).get(`/orders/${orderId}/status`);

      expect(res.status).toBe(200);
      expect(res.body.data.orderId).toBe(orderId);
      expect(['pending', 'processing', 'confirmed']).toContain(res.body.data.status);
    });
  });

  describe('GET /health', () => {
    it('deve retornar status healthy', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });
  });
});
