# CaseCellShop Backend API

## Objetivo
API backend para e-commerce de capinhas com:
- Catálogo de produtos com cache inteligente
- Checkout assíncrono com reserva atômica de estoque
- Consulta de status de pedidos
- Observabilidade estruturada

## Requisitos Funcionais
1. GET /products - lista produtos com cache (TTL 30s, stale-while-revalidate)
2. POST /checkout - inicia compra assíncrona (202 Accepted)
3. GET /orders/:orderId/status - acompanha processamento
4. Idempotência no checkout via idempotencyKey
5. Worker processa pedidos com retry e backoff

## Requisitos Não-Funcionais
- Logs estruturados com correlationId em todas as requisições
- Métricas Prometheus (cache hit/miss, checkout, worker, ERP)
- Tracing stub (spans para cada operação)
- Prevenção de overselling (atomic stock update)
- Tolerância a falha do ERP (retry + status tracking)

## Referências
- #[[file:openapi.yaml]]
- #[[file:README.md]]
