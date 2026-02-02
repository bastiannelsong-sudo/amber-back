import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';

export interface NotificationEvent {
  id: string;
  event_type: string;
  summary: string;
  product_name: string | null;
  seller_sku: string | null;
  total_amount: number | null;
  currency_id: string | null;
  order_id: number | null;
  order_status: string | null;
  topic: string;
  received: Date;
}

@Injectable()
export class NotificationGateway {
  private readonly logger = new Logger(NotificationGateway.name);
  private clients = new Map<string, Subject<MessageEvent>>();

  addClient(clientId: string): Subject<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    this.clients.set(clientId, subject);
    this.logger.log(`SSE client connected: ${clientId} (total: ${this.clients.size})`);
    return subject;
  }

  removeClient(clientId: string): void {
    const subject = this.clients.get(clientId);
    if (subject) {
      subject.complete();
      this.clients.delete(clientId);
    }
    this.logger.log(`SSE client disconnected: ${clientId} (total: ${this.clients.size})`);
  }

  @OnEvent('notification.processed')
  handleNotificationProcessed(payload: NotificationEvent): void {
    this.logger.log(`Broadcasting notification to ${this.clients.size} clients`);

    const messageEvent: MessageEvent = {
      data: JSON.stringify(payload),
      type: 'notification',
      id: payload.id,
    };

    for (const [clientId, subject] of this.clients) {
      try {
        subject.next(messageEvent);
      } catch (error) {
        this.logger.warn(`Error sending to client ${clientId}, removing`);
        this.removeClient(clientId);
      }
    }
  }
}
