import {
  BadRequestException,
  Controller,
  Get,
  Param,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryService } from '../delivery/delivery.service';
import { IfoodAuthService } from './ifood-auth.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';

@Controller('ifood')
export class IfoodAdminController {
  constructor(
    private readonly configService: ConfigService,
    private readonly deliveryService: DeliveryService,
    private readonly ifoodAuthService: IfoodAuthService,
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodPollingService: IfoodPollingService,
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
  ) {}

  @Get('token-test')
  async tokenTest() {
    const accessToken = await this.ifoodAuthService.getAccessToken();

    return {
      success: true,
      message: 'Token do iFood gerado com sucesso.',
      tokenPreview: `${accessToken.slice(0, 20)}...`,
    };
  }

  @Get('order-test/:orderId')
  async orderTest(@Param('orderId') orderId: string) {
    const order = await this.ifoodOrdersService.getOrderDetails(orderId);

    return {
      success: true,
      message: 'Pedido encontrado com sucesso.',
      order,
    };
  }

  @Get('order-analyze/:orderId')
  async orderAnalyze(@Param('orderId') orderId: string) {
    return this.ifoodOrdersService.analyzeOrder(orderId);
  }

  @Get('delivery-preview/:orderId')
  async deliveryPreview(@Param('orderId') orderId: string) {
    return this.ifoodOrdersService.buildDeliveryPreview(orderId);
  }

  @Get('polling-test')
  async pollingTest() {
    const events = await this.ifoodPollingService.pollEvents();

    return {
      success: true,
      message: 'Eventos consultados com sucesso.',
      events,
    };
  }

  @Get('polling-test/order/:orderId')
  async pollingTestByOrder(@Param('orderId') orderId: string) {
    const events = await this.ifoodPollingService.pollEvents();

    const filteredEvents = Array.isArray(events)
      ? events.filter((event) => event?.orderId === orderId)
      : [];

    return {
      success: true,
      message: 'Eventos do pedido consultados com sucesso.',
      orderId,
      total: filteredEvents.length,
      events: filteredEvents,
    };
  }

  @Get('order-readiness/:orderId')
  async orderReadiness(@Param('orderId') orderId: string) {
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
      orderAnalysis?.canCreateRappidexDelivery && !hasCancelledEvent;

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
        ? 'Pedido não pode mudar para entrega no Rappidex porque já possui evento de cancelamento.'
        : canCreateRappidexDelivery
        ? 'Pedido apto para virar entrega no Rappidex.'
        : 'Pedido não está apto para virar entrega no Rappidex.',
    };
  }

  @Get('create-delivery-test/:orderId')
  async createDeliveryTest(@Param('orderId') orderId: string) {
    const existingLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);

    if (existingLink) {
      throw new BadRequestException(
        `Este pedido do iFood já foi importado para o Rappidex. DeliveryId: ${existingLink.deliveryId}`,
      );
    }

    const readiness = await this.orderReadiness(orderId);

    if (!readiness.canCreateRappidexDelivery) {
      throw new BadRequestException(readiness.reason);
    }

    const targetShopkeeperId = this.configService.get<string>(
      'IFOOD_TARGET_SHOPKEEPER_ID',
    );

    if (!targetShopkeeperId) {
      throw new BadRequestException(
        'IFOOD_TARGET_SHOPKEEPER_ID não configurado no .env.',
      );
    }

    const order = await this.ifoodOrdersService.getOrderDetails(orderId);
    const deliveryDto =
      await this.ifoodOrdersService.buildCreateDeliveryDto(orderId);

    const createdDelivery = await this.deliveryService.createDelivery(
      deliveryDto,
      {
        id: targetShopkeeperId,
        phone: '',
        user: 'ifood.integration',
        type: 'shopkeeperadmin' as any,
        permission: 'admin' as any,
        cityId: '',
      },
    );

    await this.ifoodOrderLinkService.createLink({
      ifoodOrderId: orderId,
      ifoodDisplayId: order?.displayId ?? orderId,
      merchantId: order?.merchant?.id ?? '',
      deliveryId: createdDelivery.id,
      shopkeeperId: targetShopkeeperId,
    });

    return {
      success: true,
      message: 'Entrega criada no Rappidex com sucesso.',
      orderId,
      delivery: createdDelivery,
    };
  }
}