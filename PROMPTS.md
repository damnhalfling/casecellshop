# PROMPTS.md — Registro de uso de IA

## Contexto

Este projeto foi desenvolvido com auxílio de IA (Kiro/Claude) como ferramenta de produtividade.
A IA foi usada para acelerar a implementação, mas todas as decisões arquiteturais, trade-offs
e respostas conceituais foram revisadas e validadas pelo desenvolvedor.

## Prompts relevantes utilizados

### 1. Scaffolding inicial do projeto

**Prompt:**
> "Vamos criar um novo projeto para uma entrevista de emprego! [contexto completo do desafio técnico]"

**Uso:** Geração da estrutura inicial do projeto com TypeScript, Express, cache em memória,
fila simulada, worker, testes e observabilidade.

**Revisão:** Validei a arquitetura proposta, ajustei configurações de TTL, e revisei a
lógica de idempotência e reserva atômica de estoque.

### 2. Respostas conceituais

**Prompt:**
> "Responda as 5 perguntas conceituais do desafio considerando o contexto da CaseCellShop"

**Uso:** Base para as respostas da Parte 1.A, com análise de trade-offs e diagramas.

**Revisão:** Reescrevi trechos para refletir minha experiência real, adicionei exemplos
concretos e ajustei comparações de soluções.

### 3. Testes automatizados

**Prompt:**
> "Crie testes unitários e de integração cobrindo cache, concorrência e idempotência"

**Uso:** Geração dos test suites com cenários de edge case.

**Revisão:** Adicionei cenário de duplo clique, validei que testes de concorrência
realmente exercitam a race condition.

## Filosofia de uso

- IA como **acelerador**, não como substituto de pensamento crítico
- Toda saída foi **revisada** antes de ser commitada
- Decisões de arquitetura são **minhas** — a IA ajudou a implementar
- Trade-offs foram **avaliados manualmente** considerando o contexto do desafio
