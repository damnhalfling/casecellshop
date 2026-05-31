import { logger } from '../observability/logger';
import { queueSize } from '../observability/metrics';

export interface QueueMessage {
  orderId: string;
  correlationId: string;
  publishedAt: string;
}

/**
 * Fila em memória simulando um broker (RabbitMQ, SQS, etc.).
 * Em produção, usaríamos um serviço de mensageria real.
 *
 * Características:
 * - FIFO simples
 * - Acknowledge manual (mensagem só sai da fila após ack)
 * - Visibilidade: mensagem "em processamento" não é entregue a outro consumer
 */
export class QueueService {
  private queue: QueueMessage[] = [];
  private processing: Map<string, QueueMessage> = new Map(); // orderId -> message
  private consumer: ((message: QueueMessage) => Promise<void>) | null = null;
  private isProcessing = false;

  async publish(message: QueueMessage): Promise<void> {
    this.queue.push(message);
    queueSize.set(this.queue.length);

    logger.info({
      event: 'queue_message_published',
      orderId: message.orderId,
      correlationId: message.correlationId,
      queueSize: this.queue.length,
    });

    // Trigger processing se consumer registrado
    if (this.consumer && !this.isProcessing) {
      this.processNext();
    }
  }

  /**
   * Registra um consumer para processar mensagens.
   */
  registerConsumer(handler: (message: QueueMessage) => Promise<void>): void {
    this.consumer = handler;
    // Processa mensagens pendentes
    if (this.queue.length > 0) {
      this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (!this.consumer || this.queue.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const message = this.queue.shift()!;
    this.processing.set(message.orderId, message);
    queueSize.set(this.queue.length);

    try {
      await this.consumer(message);
      this.processing.delete(message.orderId);
    } catch (error) {
      // Em caso de erro, recoloca na fila (retry)
      this.processing.delete(message.orderId);
      this.queue.push(message);
      queueSize.set(this.queue.length);
      logger.error({
        event: 'queue_processing_error',
        orderId: message.orderId,
        error: (error as Error).message,
      });
    } finally {
      this.isProcessing = false;
      // Processa próxima mensagem
      if (this.queue.length > 0) {
        // Pequeno delay para não bloquear o event loop
        setTimeout(() => this.processNext(), 100);
      }
    }
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getProcessingCount(): number {
    return this.processing.size;
  }
}
