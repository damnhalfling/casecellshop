import { v4 as uuidv4 } from 'uuid';

/**
 * Tracing simplificado (stub) para demonstrar o conceito.
 * Em produção, usaríamos OpenTelemetry SDK com exportador para Datadog/Jaeger.
 *
 * Cada span registra:
 * - traceId: identificador do trace completo
 * - spanId: identificador do span atual
 * - parentSpanId: span pai (se houver)
 * - operationName: nome da operação
 * - startTime / endTime
 * - attributes: metadados adicionais
 * - status: ok | error
 */

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'ok' | 'error';
}

export class Tracer {
  private spans: Span[] = [];

  startSpan(
    operationName: string,
    options?: { traceId?: string; parentSpanId?: string; attributes?: Record<string, string | number | boolean> }
  ): Span {
    const span: Span = {
      traceId: options?.traceId || uuidv4(),
      spanId: uuidv4(),
      parentSpanId: options?.parentSpanId,
      operationName,
      startTime: Date.now(),
      attributes: options?.attributes || {},
      status: 'ok',
    };
    this.spans.push(span);
    return span;
  }

  endSpan(span: Span, status: 'ok' | 'error' = 'ok'): void {
    span.endTime = Date.now();
    span.status = status;
  }

  getSpans(): Span[] {
    return [...this.spans];
  }

  clear(): void {
    this.spans = [];
  }
}

// Singleton para uso global
export const tracer = new Tracer();
