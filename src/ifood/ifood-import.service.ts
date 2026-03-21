import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryService } from '../delivery/delivery.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';

@Injectable()
export class IfoodImportService {
  private readonly logger = new Logger(IfoodImportService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly deliveryService: DeliveryService,
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
  ) {}

  async importFromEvents(events: any[]) {
    if (!Array.isArray(events) || events.length === 0) {
      this.logger.log('Importação automática: nenhum evento recebido do iFood.');
      return;
    }

    const placedEvents = events.filter(
      (event) => event?.code === 'PLC' || event?.fullCode === 'PLACED',
    );

    if (placedEvents.length === 0) {
      this.logger.log('Importação automática: nenhum evento PLACED encontrado.');
      return;
    }

    const uniqueOrderIds = [
      ...new Set(placedEvents.map((e) => e?.orderId).filter(Boolean)),
    ];

    const targetShopkeeperId = this.configService.get<string>(
      'IFOOD_TARGET_SHOPKEEPER_ID',
    );

    if (!targetShopkeeperId) {
      this.logger.error(
        'Importação automática: IFOOD_TARGET_SHOPKEEPER_ID não configurado.',
      );
      return;
    }

    for (const orderId of uniqueOrderIds) {
      try {
        const existingLink =
          await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);

        if (existingLink) {
          this.logger.log(
            `Importação automática: pedido ${orderId} já importado. DeliveryId ${existingLink.deliveryId}`,
          );
          continue;
        }

        const analysis = await this.ifoodOrdersService.analyzeOrder(orderId);

        if (!analysis?.canCreateRappidexDelivery) {
          this.logger.warn(
            `Importação automática: pedido ${orderId} não apto pelo tipo de pedido/entrega.`,
          );
          continue;
        }

        const filteredEvents = events.filter(
          (event) => event?.orderId === orderId,
        );

        const hasCancelledEvent = filteredEvents.some(
          (event) =>
            event?.code === 'CAN' ||
            event?.fullCode === 'CANCELLED' ||
            event?.code === 'CAR' ||
            event?.fullCode === 'CANCELLATION_REQUESTED',
        );

        if (hasCancelledEvent) {
          this.logger.warn(
            `Importação automática: pedido ${orderId} ignorado porque possui evento de cancelamento.`,
          );
          continue;
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

        this.logger.log(
          `Importação automática: pedido ${orderId} importado com sucesso. DeliveryId ${createdDelivery.id}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Importação automática: erro ao processar pedido ${orderId}: ${error?.message || error}`,
        );
      }
    }
  }
}