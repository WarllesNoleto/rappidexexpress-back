import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CreateDeliveryDto } from '../delivery/dto';
import {
  PaymentType,
  StatusDelivery,
} from '../shared/constants/enums.constants';
import { IfoodAuthService } from './ifood-auth.service';

@Injectable()
export class IfoodOrdersService {
  private readonly logger = new Logger(IfoodOrdersService.name);

  constructor(
    private readonly ifoodAuthService: IfoodAuthService,
    private readonly configService: ConfigService,
  ) {}

  async getOrderDetails(orderId: string) {
    const accessToken = await this.ifoodAuthService.getAccessToken();

    try {
      const response = await axios.get(
        `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error('Erro ao buscar detalhes do pedido no iFood', {
        status,
        data,
        orderId,
      });

      throw new InternalServerErrorException(
        'Não foi possível buscar os detalhes do pedido no iFood.',
      );
    }
  }

  async analyzeOrder(orderId: string) {
    const order = await this.getOrderDetails(orderId);

    const orderType = order?.orderType ?? null;
    const deliveredBy = order?.delivery?.deliveredBy ?? null;
    const orderStatus =
      order?.orderStatus ??
      order?.status ??
      order?.metadata?.status ??
      null;

    const isDelivery = orderType === 'DELIVERY';
    const isMerchantDelivery = deliveredBy === 'MERCHANT';

    return {
      success: true,
      orderId,
      summary: {
        displayId: order?.displayId ?? null,
        orderType,
        deliveredBy,
        orderStatus,
        merchantId: order?.merchant?.id ?? null,
        merchantName: order?.merchant?.name ?? null,
        customerName: order?.customer?.name ?? null,
        customerPhone: order?.customer?.phone?.number ?? null,
      },
      canCreateRappidexDelivery: isDelivery && isMerchantDelivery,
      reason:
        isDelivery && isMerchantDelivery
          ? 'Pedido apto para virar entrega no Rappidex.'
          : 'Pedido não está apto para virar entrega no Rappidex.',
    };
  }

  async buildDeliveryPreview(orderId: string) {
    const deliveryData = await this.buildCreateDeliveryDto(orderId);

    return {
      success: true,
      orderId,
      deliveryPreview: {
        clientName: deliveryData.clientName,
        clientPhone: deliveryData.clientPhone,
        value: deliveryData.value,
        payment: deliveryData.payment,
        observation: deliveryData.observation,
        status: deliveryData.status,
        establishmentId: deliveryData.establishmentId,
        source: 'IFOOD',
      },
    };
  }

  async buildCreateDeliveryDto(orderId: string): Promise<CreateDeliveryDto> {
    const order = await this.getOrderDetails(orderId);
    const establishmentId = this.configService.get<string>(
      'IFOOD_TARGET_SHOPKEEPER_ID',
    );

    const customerName = order?.customer?.name ?? 'Cliente iFood';
    const customerPhone = this.normalizePhone(
      order?.customer?.phone?.number ?? '',
    );
    const displayId = order?.displayId ?? orderId;

    const totalValue =
      order?.total?.orderAmount ??
      order?.total?.subTotal ??
      order?.payments?.prepaid ??
      0;

    const deliveryAddress = [
      order?.delivery?.deliveryAddress?.streetName,
      order?.delivery?.deliveryAddress?.streetNumber,
      order?.delivery?.deliveryAddress?.neighborhood,
      order?.delivery?.deliveryAddress?.city,
    ]
      .filter(Boolean)
      .join(', ');

    const observation = [
      `Pedido iFood #${displayId}`,
      deliveryAddress ? `Endereço: ${deliveryAddress}` : null,
      order?.delivery?.observations
        ? `Obs entrega: ${order.delivery.observations}`
        : null,
      order?.takeout?.pickupCode
        ? `Código retirada: ${order.takeout.pickupCode}`
        : null,
    ]
      .filter(Boolean)
      .join(' | ');

    return {
      clientName: customerName,
      clientPhone: customerPhone,
      status: StatusDelivery.PENDING,
      establishmentId,
      value: String(totalValue),
      payment: this.resolvePaymentType(order),
      soda: 'NÃO',
      observation,
    };
  }

  private normalizePhone(phone: string): string {
    return String(phone || '').replace(/\D/g, '');
  }

  private resolvePaymentType(order: any): PaymentType {
    const raw = JSON.stringify(order?.payments ?? order ?? {}).toUpperCase();

    if (raw.includes('PIX')) {
      return PaymentType.PIX;
    }

    if (
      raw.includes('CREDIT') ||
      raw.includes('DEBIT') ||
      raw.includes('CARD') ||
      raw.includes('CARTAO') ||
      raw.includes('CARTÃO')
    ) {
      return PaymentType.CARTAO;
    }

    if (
      raw.includes('CASH') ||
      raw.includes('DINHEIRO') ||
      raw.includes('MONEY')
    ) {
      return PaymentType.DINHEIRO;
    }

    return PaymentType.PAGO;
  }
}