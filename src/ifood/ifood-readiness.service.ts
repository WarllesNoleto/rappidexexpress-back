import { Injectable } from '@nestjs/common';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';

@Injectable()
export class IfoodReadinessService {
  constructor(
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodPollingService: IfoodPollingService,
  ) {}

  async getOrderReadiness(orderId: string) {
    const orderAnalysis = await this.ifoodOrdersService.analyzeOrder(orderId);
    const events = await this.ifoodPollingService.pollEvents();

    const filteredEvents = Array.isArray(events)
      ? events.filter((event) => event?.orderId === orderId)
      : [];

    const hasCancelledEvent = filteredEvents.some(
      (event) =>
        event?.code === 'CAN' ||
        event?.fullCode === 'CANCELLED' ||
        event?.code === 'CAR' ||
        event?.fullCode === 'CANCELLATION_REQUESTED',
    );

    const latestEvent =
      filteredEvents.length > 0
        ? [...filteredEvents].sort(
            (a, b) =>
              new Date(b?.createdAt || 0).getTime() -
              new Date(a?.createdAt || 0).getTime(),
          )[0]
        : null;

    const canCreateRappidexDelivery =
      !!orderAnalysis?.canCreateRappidexDelivery && !hasCancelledEvent;

    return {
      success: true,
      orderId,
      summary: orderAnalysis.summary,
      eventSummary: {
        totalEvents: filteredEvents.length,
        latestEventCode: latestEvent?.code ?? null,
        latestEventFullCode: latestEvent?.fullCode ?? null,
        hasCancelledEvent,
      },
      canCreateRappidexDelivery,
      reason: hasCancelledEvent
        ? 'Pedido não pode virar entrega no Rappidex porque já possui evento de cancelamento.'
        : canCreateRappidexDelivery
        ? 'Pedido apto para virar entrega no Rappidex.'
        : 'Pedido não está apto para virar entrega no Rappidex.',
    };
  }
}