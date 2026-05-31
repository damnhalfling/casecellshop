# CaseCellShop — Desafio Técnico Backend Pleno

API backend para a CaseCellShop: catálogo de produtos com cache, checkout assíncrono com
reserva atômica de estoque, e observabilidade estruturada.

## Stack

- **Runtime:** Node.js 20 + TypeScript 5
- **Framework:** Express 4
- **Cache:** In-memory (cache-aside + stale-while-revalidate)
- **Fila:** In-memory (simula RabbitMQ/SQS)
- **Observabilidade:** Pino (logs estruturados) + prom-client (métricas Prometheus)
- **Testes:** Jest

**Escolha da stack:** Node.js + TypeScript por aderência ao ambiente técnico esperado.
Todos os serviços de apoio são simulados em memória para facilitar execução local sem
dependências externas.

## Como rodar

```bash
# Instalar dependências
npm install

# Rodar em desenvolvimento
npm run dev

# Build + produção
npm run build
npm start

# Rodar testes
npm test

# Docker (alternativa)
docker compose up --build
```

O servidor sobe em `http://localhost:3000`.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /products | Lista produtos (com cache) |
| GET | /products/:id | Busca produto por ID |
| POST | /checkout | Inicia checkout assíncrono (202 Accepted) |
| GET | /orders/:orderId/status | Consulta status do pedido |
| POST | /admin/reconcile | Trigger manual de reconciliação |
| GET | /metrics | Métricas Prometheus |
| GET | /health | Health check |

## Exemplos de uso

```bash
# Listar produtos
curl http://localhost:3000/products

# Checkout
curl -X POST http://localhost:3000/checkout \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: meu-trace-123" \
  -d '{
    "items": [{"productId": "prod-001", "quantity": 2}],
    "idempotencyKey": "client-uuid-001"
  }'

# Consultar status
curl http://localhost:3000/orders/{orderId}/status
```

## Contrato da API

O contrato completo está em [`openapi.yaml`](./openapi.yaml).

---

## Simplificações feitas (por se tratar de desafio técnico)

- **Dados em memória** em vez de banco real (MySQL/PostgreSQL)
- **Fila em memória** em vez de RabbitMQ/SQS
- **Tracing stub** em vez de OpenTelemetry SDK real
- **Sem autenticação** — foco na lógica de negócio
- **Worker single-process** — em produção seria um consumer separado
- **Concorrência limitada** — em single-process JS, a atomicidade é garantida pelo event loop;
  em produção com múltiplas instâncias, usaríamos `UPDATE ... WHERE stock >= qty` no banco

---

## Parte 1.A — Respostas Conceituais

---

### Pergunta 1 — Diagnóstico, trade-offs e arquitetura alvo

#### Problema 01: Performance da vitrine

**Causa raiz:** Cada acesso à vitrine faz uma chamada síncrona ao ERP (banco MySQL).
Com milhões de acessos, o ERP se torna gargalo — não foi projetado para servir tráfego
de e-commerce em escala.

**Impacto:**
- **Cliente:** Páginas lentas (>2s), abandono de carrinho
- **Negócio:** Perda de conversão, reputação degradada
- **Operação:** ERP sobrecarregado afeta faturamento e financeiro

**Caminhos de solução:**

| Critério | Caminho A: Cache na frente do ERP | Caminho B: Read Model próprio |
|----------|-----------------------------------|-------------------------------|
| Complexidade | Baixa — adiciona Redis/CDN | Média — requer sync e banco próprio |
| Latência | ~5ms (cache hit) | ~10ms (banco otimizado) |
| Consistência | Eventual (TTL) | Eventual (sync delay) |
| Custo | Baixo (Redis managed) | Médio (banco + worker de sync) |
| Esforço | 1-2 sprints | 3-4 sprints |

**Escolha para 30 dias:** Cache (Redis) na frente do ERP com TTL curto (30s) e invalidação
por webhook/polling. Resolve 90% do problema com esforço mínimo.

**Evolução 60-90 dias:** Read model próprio (PostgreSQL) com sync via CDC ou polling,
permitindo queries otimizadas para e-commerce (filtros, busca, ordenação).

---

#### Problema 02: Consistência de estoque

**Causa raiz:** Check-then-act sem atomicidade. Entre verificar estoque e confirmar compra,
outro cliente pode comprar o mesmo item. A loja consulta estoque do ERP (que pode estar
desatualizado) e não faz reserva.

**Impacto:**
- **Cliente:** Compra confirmada mas depois cancelada (frustração)
- **Negócio:** Overselling, custos de estorno, perda de confiança
- **Operação:** Trabalho manual de reconciliação

**Caminhos de solução:**

| Critério | A: Atomic update no banco | B: Lock pessimista | C: Reserva temporária |
|----------|--------------------------|--------------------|-----------------------|
| Complexidade | Baixa | Média | Alta |
| Latência | Mínima (+1 query) | Alta (lock wait) | Média (2 queries) |
| Consistência | Forte | Forte | Forte (com expiração) |
| Escalabilidade | Alta | Baixa (contenção) | Alta |
| Esforço | 1 sprint | 1 sprint | 2 sprints |

**Escolha:** Atomic conditional update (`UPDATE SET stock = stock - qty WHERE stock >= qty`).
Simples, escalável, sem contenção de locks.

---

#### Problema 03: Resiliência do checkout

**Causa raiz:** Checkout síncrono depende do ERP para faturar. Se o ERP demora ou falha,
o cliente fica esperando ou recebe erro.

**Impacto:**
- **Cliente:** Timeout, incerteza se compra foi efetivada
- **Negócio:** Pedidos perdidos, dupla cobrança se retry sem idempotência
- **Operação:** Sem visibilidade de pedidos "no limbo"

**Caminhos de solução:**

| Critério | A: Checkout assíncrono (fila) | B: Timeout + retry síncrono |
|----------|-------------------------------|------------------------------|
| Complexidade | Média (fila + worker) | Baixa |
| Latência percebida | Baixa (202 imediato) | Alta (espera ERP) |
| Resiliência | Alta (retry automático) | Baixa (depende do ERP) |
| Rastreabilidade | Alta (status por pedido) | Baixa |
| Esforço | 2 sprints | 1 sprint |

**Escolha:** Checkout assíncrono com fila. Cliente recebe 202 imediato, worker processa
com retry e backoff. Status consultável via polling.

---

#### Visão de arquitetura 30-90 dias

```
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│  Loja Web   │────▶│  API Gateway │────▶│  Cache  │ (Redis, TTL 30s)
└─────────────┘     └──────────────┘     └────┬────┘
                           │                   │ miss
                           │              ┌────▼────┐
                           │              │Read Model│ (PostgreSQL)
                           │              └────┬────┘
                    ┌──────▼──────┐            │ sync
                    │  Checkout   │       ┌────▼────┐
                    │  Service    │       │  ERP    │
                    └──────┬──────┘       └─────────┘
                           │
                    ┌──────▼──────┐
                    │    Fila     │ (RabbitMQ/SQS)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Worker    │──────▶ ERP (faturamento)
                    └─────────────┘

Observabilidade: Datadog Agent em cada serviço
- Logs → Datadog Logs (correlationId em todos)
- Métricas → Datadog Metrics (Prometheus scraping)
- Traces → Datadog APM (OpenTelemetry)
```

**Reconciliação:** Job periódico (cron) compara pedidos "pending" há mais de X minutos
com estado no ERP. Se ERP confirmou, atualiza status. Se não, reenfileira ou cancela.

---

### Pergunta 2 — Cache, invalidação e performance da vitrine

#### Camadas de cache

1. **CDN/Edge (CloudFront):** Cache de assets estáticos e respostas GET /products com
   `Cache-Control: public, max-age=10, stale-while-revalidate=20`. Reduz carga no backend.

2. **Application Cache (Redis):** Cache-aside para dados de produto.
   - TTL: 30s para lista, 60s para produto individual
   - Estratégia: Stale-While-Revalidate — se expirado, serve stale e revalida em background

3. **In-process cache (opcional):** LRU cache no processo Node.js para hot keys (top 50 produtos).
   TTL curto (5s) para reduzir roundtrips ao Redis.

#### Invalidação

- **Proativa:** Webhook do ERP notifica mudança de preço/estoque → invalida chave específica
- **Reativa:** TTL garante que dados nunca ficam mais velhos que 30s
- **Fallback:** Se ERP/banco falhar, serve cache stale (melhor dado antigo que erro 500)

#### Prevenção de cache stampede

- **Mutex/lock por chave:** Apenas 1 processo faz refresh; demais servem stale
- **Jitter no TTL:** TTL = 30s ± random(0-5s) para evitar expiração simultânea
- **Background refresh:** Refresh acontece antes da expiração (stale-while-revalidate)

#### Métricas de validação

**Performance:**
- `cache_hit_ratio` = hits / (hits + misses) → meta: >90%
- `p95_latency_products` → meta: <50ms (com cache) vs ~150ms (sem)
- `erp_requests_per_minute` → deve cair proporcionalmente ao hit ratio

**Freshness (dados não obsoletos):**
- `cache_stale_served_ratio` = stale / total → alerta se >10%
- `max_cache_age_seconds` → alerta se >60s (2x TTL)
- `price_drift_count` → comparação periódica cache vs ERP (job de reconciliação)

---

### Pergunta 3 — Observabilidade, Datadog ou equivalente

#### Logs estruturados (campos obrigatórios)

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "info",
  "service": "casecellshop",
  "event": "checkout_completed",
  "correlationId": "uuid-request",
  "orderId": "uuid-order",
  "userId": "user-123",
  "duration_ms": 45,
  "metadata": {}
}
```

Campos obrigatórios: `timestamp`, `level`, `service`, `event`, `correlationId`.
Campos contextuais: `orderId`, `productId`, `userId`, `duration_ms`, `error`.

#### Métricas

| Tipo | Nome | Labels | Uso |
|------|------|--------|-----|
| Counter | `cache_hits_total` | cache_name | Hit ratio |
| Counter | `cache_misses_total` | cache_name | Hit ratio |
| Counter | `checkout_requests_total` | status | Volume e taxa de erro |
| Histogram | `checkout_duration_seconds` | status | Latência p50/p95/p99 |
| Counter | `worker_processed_total` | result | Throughput do worker |
| Counter | `worker_retries_total` | — | Saúde do ERP |
| Gauge | `queue_size` | — | Backpressure |
| Histogram | `erp_latency_seconds` | — | Degradação do ERP |
| Counter | `oversell_attempts_total` | — | Furos de estoque |

#### Traces / Spans

**GET /products:**
```
[Span] HTTP GET /products (root)
  └─[Span] CacheService.get (cache lookup)
  └─[Span] ProductRepository.findAll (se miss)
  └─[Span] CacheService.set (se miss)
```

**POST /checkout:**
```
[Span] HTTP POST /checkout (root)
  └─[Span] IdempotencyCheck
  └─[Span] ProductValidation
  └─[Span] StockService.reserveAll
  │   └─[Span] ProductRepository.decrementStock (por item)
  └─[Span] OrderRepository.save
  └─[Span] QueueService.publish
```

**Worker (assíncrono, mesmo traceId):**
```
[Span] ErpWorker.handleMessage
  └─[Span] OrderRepository.updateStatus (→ processing)
  └─[Span] ErpClient.submitOrder (chamada ao ERP)
  └─[Span] OrderRepository.updateStatus (→ confirmed/failed)
```

#### SLI/SLO e Alertas

| SLI | SLO | Alerta |
|-----|-----|--------|
| Latência GET /products p95 | < 100ms | > 200ms por 5min |
| Taxa de erro checkout | < 1% | > 5% por 2min |
| Cache hit ratio | > 90% | < 70% por 10min |
| Queue size | < 100 | > 500 por 5min |
| Oversell attempts | 0 | > 0 (imediato) |
| Worker success rate | > 95% | < 80% por 5min |

#### Dashboard básico (Datadog)

```
┌─────────────────────────────────────────────────────┐
│  CaseCellShop - Overview Dashboard                  │
├─────────────────┬───────────────────────────────────┤
│ Request Rate    │ Error Rate (4xx/5xx)              │
│ [timeseries]    │ [timeseries]                      │
├─────────────────┼───────────────────────────────────┤
│ P95 Latency     │ Cache Hit Ratio                   │
│ [timeseries]    │ [gauge: 94%]                      │
├─────────────────┼───────────────────────────────────┤
│ Queue Size      │ Worker Throughput                  │
│ [timeseries]    │ [timeseries: success vs failed]   │
├─────────────────┼───────────────────────────────────┤
│ ERP Latency p95 │ Oversell Attempts                 │
│ [timeseries]    │ [counter: 0 ✓]                    │
└─────────────────┴───────────────────────────────────┘
```

---

### Pergunta 4 — Concorrência, estoque e idempotência

#### Por que checagem simples é insuficiente

```
Thread A: SELECT stock FROM products WHERE id = 'X'  → stock = 1
Thread B: SELECT stock FROM products WHERE id = 'X'  → stock = 1
Thread A: if (stock >= 1) → true → UPDATE stock = 0
Thread B: if (stock >= 1) → true → UPDATE stock = -1  ← OVERSELLING!
```

O problema é o **gap temporal** entre ler e escrever (TOCTOU — Time of Check to Time of Use).

#### Comparação de abordagens

| Abordagem | Como funciona | Prós | Contras |
|-----------|---------------|------|---------|
| **Atomic conditional update** | `UPDATE SET stock = stock - qty WHERE stock >= qty` | Simples, sem locks, escalável | Requer suporte do banco |
| **Lock pessimista** | `SELECT ... FOR UPDATE` | Garantia forte | Contenção, deadlocks, latência |
| **Reserva temporária** | Decrementa + TTL; confirma ou expira | Flexível, suporta carrinho | Complexo, precisa de cleanup |
| **Distributed lock** | Redis SETNX por produto | Funciona multi-instância | Complexo, risco de lock órfão |

**Escolha:** Atomic conditional update. Em SQL:
```sql
UPDATE products
SET stock = stock - :quantity, updated_at = NOW()
WHERE id = :productId AND stock >= :quantity;
-- Se affected_rows = 0, estoque insuficiente
```

Na implementação em memória, o event loop do Node.js garante atomicidade (single-threaded),
mas o código simula o padrão para demonstrar o conceito.

#### Idempotência

**Mecanismo:** `idempotencyKey` fornecida pelo cliente (UUID).

**Fluxo:**
1. Recebe request com `idempotencyKey`
2. Busca no banco: existe pedido com essa key?
   - Sim → retorna o pedido existente (sem efeitos colaterais)
   - Não → processa normalmente e grava com a key

**Proteções:**
- **Retry:** Mesma key retorna mesmo resultado
- **Duplo clique:** Frontend gera UUID uma vez, envia N vezes → mesmo pedido
- **Reprocessamento:** Worker usa orderId como chave; se já confirmado, ignora

**Teste de overselling:**
```typescript
// 5 tentativas concorrentes para produto com estoque = 2
const promises = Array.from({ length: 5 }, (_, i) =>
  stockService.reserve('p2', 1, `corr-${i}`)
);
const results = await Promise.all(promises);
const successCount = results.filter(Boolean).length;
expect(successCount).toBeLessThanOrEqual(2);
```

---

### Pergunta 5 — Mensageria, resiliência, contrato e IA

#### Publicar antes ou depois de gravar?

**Decisão: gravar ANTES de publicar na fila.**

**Justificativa:**

| Cenário | Gravar antes, publicar depois | Publicar antes, gravar depois |
|---------|-------------------------------|-------------------------------|
| Falha após 1ª operação | Pedido existe sem mensagem ("pedido órfão") | Mensagem existe sem pedido ("mensagem fantasma") |
| Reconciliação | Job busca pedidos "pending" antigos e reenfileira | Worker recebe msg, busca pedido, não encontra → DLQ |
| Risco | Menor — pedido existe, pode ser reconciliado | Maior — mensagem sem pedido é mais difícil de tratar |

**Mitigação de pedido órfão:**
- Job de reconciliação a cada 5min: busca pedidos "pending" há mais de 2min e republica na fila
- Alerta se `pending_orders_older_than_5min > 0`

**Mitigação de mensagem fantasma (se ocorrer):**
- Worker verifica se pedido existe antes de processar
- Se não existe, descarta mensagem e loga warning

#### Retry e status

- Worker tenta até 3x com backoff (1s, 2s, 4s)
- Após 3 falhas → status "failed" + rollback de estoque + alerta
- Status transitions: `pending → processing → confirmed | failed`

#### OpenAPI

Contrato completo em [`openapi.yaml`](./openapi.yaml) com schemas de sucesso e erro,
exemplos de request/response, e documentação de cada endpoint.

#### Testes

- Unitários: cache, estoque (concorrência), idempotência
- Integração: fluxo completo checkout → status
- Cenários de edge: duplo clique, estoque insuficiente, produto inexistente

#### Uso de IA

Documentado em [`PROMPTS.md`](./PROMPTS.md). IA usada como acelerador de implementação,
com revisão crítica de todas as decisões.

---

## Observabilidade — Runbook básico

### Alerta: Cache hit ratio < 70%

1. Verificar se TTL está muito curto (< 10s)
2. Verificar se há invalidações excessivas (webhook com alta frequência)
3. Verificar se houve deploy recente (cache frio)
4. Ação: aumentar TTL ou investigar padrão de invalidação

### Alerta: Queue size > 500

1. Verificar latência do ERP (`erp_latency_seconds`)
2. Verificar taxa de erro do worker (`worker_processed_total{result="failed"}`)
3. Se ERP lento: escalar workers ou ativar circuit breaker
4. Se worker falhando: verificar logs do worker, possível bug

### Alerta: Oversell attempts > 0

1. Verificar logs com `event: stock_insufficient`
2. Identificar produto afetado
3. Verificar se cache de estoque está desatualizado
4. Ação imediata: invalidar cache do produto afetado

---

## Decisões e trade-offs

| Decisão | Motivo | Trade-off |
|---------|--------|-----------|
| Cache em memória | Zero dependências externas para o desafio | Não persiste entre restarts |
| Fila em memória | Simplicidade de execução | Sem garantias de durabilidade |
| Atomic update (não lock) | Simples e escalável | Requer banco com suporte |
| Gravar antes de enfileirar | Pedido órfão é mais fácil de reconciliar | Precisa de job de reconciliação |
| Stale-while-revalidate | Latência consistente para o cliente | Pode servir dado levemente antigo |
| Worker no mesmo processo | Simplicidade para o desafio | Em produção seria separado |
| Reconciliation worker | Detecta pedidos órfãos e stuck | Adiciona complexidade operacional |
| Docker multi-stage | Imagem leve (~120MB) e build reproduzível | Requer Docker instalado |
| Lock timeout no cache | Evita locks órfãos se refresh travar | Pode causar refresh duplicado em edge case |

---

## Estrutura do projeto

```
src/
├── config/          # Configurações centralizadas
├── cache/           # CacheService (cache-aside + stale-while-revalidate + stampede lock com timeout)
├── middleware/      # correlationId, request logger
├── observability/   # Logger (pino), Metrics (prom-client), Tracing (stub)
├── queue/           # QueueService (fila em memória)
├── repositories/    # ProductRepository, OrderRepository (in-memory)
├── routes/          # Express routes (products, checkout, orders, metrics)
├── services/        # ProductService, CheckoutService, StockService
├── tests/           # Jest tests (unit + integration)
├── types/           # TypeScript interfaces + Express augmentation
├── workers/         # ErpWorker (consumer da fila) + ReconciliationWorker
└── server.ts        # Express app factory + DI

Dockerfile           # Multi-stage build (builder + production)
docker-compose.yml   # Execução com Docker
openapi.yaml         # Contrato OpenAPI 3.0.3
```
