---
inclusion: always
---

# CaseCellShop - Padrões do Projeto

## Stack
- Node.js 20 + TypeScript 5 (strict mode)
- Express 4 para HTTP
- Pino para logs estruturados
- prom-client para métricas Prometheus
- Jest para testes
- Dados em memória (sem banco externo)

## Convenções de código
- Injeção de dependência via construtor (sem framework DI)
- Repositórios retornam cópias dos objetos (imutabilidade)
- Todos os logs devem incluir `correlationId` e `event`
- Métricas seguem nomenclatura `casecellshop_<domain>_<metric>_<unit>`
- Erros de negócio usam classes de erro tipadas (ex: CheckoutError)

## Arquitetura
- Cache-aside com stale-while-revalidate
- Checkout assíncrono: grava pedido → publica na fila → worker processa
- Reserva atômica de estoque (atomic conditional update)
- Idempotência via `idempotencyKey` no checkout

## Testes
- Unitários para serviços e cache
- Integração para fluxos HTTP completos
- Cenários de concorrência e edge cases
- `npm test` deve passar sem dependências externas
