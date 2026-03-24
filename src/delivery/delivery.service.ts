import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { DeliveryEntity, LogEntity, UserEntity } from '../database/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { addHours } from 'date-fns';

import {
  ConfigsDto,
  CreateDeliveryDto,
  DeliveryResult,
  ListDeliveriesQueryDTO,
  ListDeliverysResult,
  UpdateDeliveryDto,
} from './dto';
import { UserRequest } from '../shared/interfaces';
import { StatusDelivery, UserType } from '../shared/constants/enums.constants';
import { IfoodOrderLinkService } from '../ifood/ifood-order-link.service';
import { IfoodOrdersService } from '../ifood/ifood-orders.service';
import { sendNotificationsFor } from 'src/shared/utils/notification.functions';
import { OrdersGateway } from '../gateway/orders.gateway';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
  motoboysDeliveriesAmount = 2;
  blockDeliverys = false;
    constructor(
  @InjectRepository(UserEntity)
  private readonly userRepository: MongoRepository<UserEntity>,
  @InjectRepository(DeliveryEntity)
  private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
  @InjectRepository(LogEntity)
  private readonly logRepository: MongoRepository<LogEntity>,
  private readonly ordersGateway: OrdersGateway,
  @Inject(forwardRef(() => IfoodOrdersService))
  private readonly ifoodOrdersService: IfoodOrdersService,
  @Inject(forwardRef(() => IfoodOrderLinkService))
  private readonly ifoodOrderLinkService: IfoodOrderLinkService,
) {}

  private async syncIfoodIfNeeded(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    deliveryData: UpdateDeliveryDto,
  ) {
    if (!deliveryData.status) {
  return;
}

if (previousDelivery.status === deliveryData.status) {
  return;
}

    const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
      previousDelivery.id,
    );

    if (!ifoodLink) {
      return;
    }

    const orderId = ifoodLink.ifoodOrderId;

    try {
      if (deliveryData.status === StatusDelivery.ONCOURSE) {
        const motoboy = nextDelivery?.motoboy;

        if (!motoboy) {
          throw new BadRequestException(
            'Motoboy não encontrado para sincronizar a saída ao iFood.',
          );
        }

        await this.ifoodOrdersService.assignDriver(orderId, motoboy);
        await this.ifoodOrdersService.notifyGoingToOrigin(orderId);
        return;
      }

      if (deliveryData.status === StatusDelivery.COLLECTED) {
        await this.ifoodOrdersService.notifyArrivedAtOrigin(orderId);
        await this.ifoodOrdersService.dispatchLogisticsOrder(orderId);
        await this.ifoodOrdersService.dispatchOrder(orderId);
        return;
      }

      if (deliveryData.status === StatusDelivery.CANCELED) {
  await this.ifoodOrdersService.requestCancellation(
    orderId,
    'Cancelado no Rappidex pela alteração do status da entrega.',
  );
  return;
}

if (deliveryData.status === StatusDelivery.FINISHED) {
  await this.ifoodOrdersService.notifyArrivedAtDestination(orderId);

  if (!deliveryData.deliveryCode) {
    throw new BadRequestException(
      'Informe o código de entrega do iFood para finalizar este pedido.',
    );
  }

  const verifyResult = await this.ifoodOrdersService.verifyDeliveryCode(
    orderId,
    deliveryData.deliveryCode,
  );

  if (verifyResult?.success === false) {
    throw new BadRequestException(
      'O código de entrega do iFood é inválido.',
    );
  }
}
    } catch (error: any) {
      this.logger.error(
        `Falha ao sincronizar delivery ${previousDelivery.id} com o iFood.`,
        error?.stack || error,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Não foi possível sincronizar o status da entrega com o iFood.',
      );
    }
  }

  async listDeliveries(
    user: UserRequest,
    queryParams: ListDeliveriesQueryDTO,
  ): Promise<ListDeliverysResult> {
    
    const userForRequest = await this.findOneUserById(user.id);

    const skip = (queryParams.page - 1) * queryParams.itemsPerPage;
    const take = queryParams.itemsPerPage;
    const where = { isActive: true };
    let deliveries;
    let count;

    where['establishment.cityId'] = userForRequest.cityId;

    if (
      userForRequest.type === UserType.ADMIN ||
      userForRequest.type === UserType.SUPERADMIN
    ) {
      if (queryParams.status)
        where['status'] = { $in: queryParams.status.split(',') };
      if (queryParams.establishmentId)
        where['establishment.id'] = queryParams.establishmentId;
      if (queryParams.motoboyId) where['motoboy.id'] = queryParams.motoboyId;
      if (queryParams.createdBy) where['createdBy'] = queryParams.createdBy;
    }

    if (userForRequest.type === UserType.MOTOBOY) {
      if (queryParams.status) {
        const arrayOnStatus = queryParams.status.split(',');
        where['status'] = { $in: arrayOnStatus };

        // Se tiver um momento em que for necessario que o motoboy solicite todos os pedidos, ele vai conseguir ver tudo
        if (!arrayOnStatus.includes(StatusDelivery.PENDING)) {
          where['motoboy.id'] = userForRequest.id;
        }
      } else {
        where['motoboy.id'] = userForRequest.id;
      }

      if (queryParams.establishmentId)
        where['establishment.id'] = queryParams.establishmentId;
    }

    //Lojistaadmin pode ver o mesmo que o lojista normal, unica diferença é que eles podem atribuir uma entrega ao motoboy
    if (
      userForRequest.type === UserType.SHOPKEEPER ||
      userForRequest.type === UserType.SHOPKEEPERADMIN
    ) {
      where['establishment.id'] = userForRequest.id;
      if (queryParams.status)
        where['status'] = { $in: queryParams.status.split(',') };
      if (queryParams.motoboyId) where['motoboy.id'] = queryParams.motoboyId;
    }

    // if (queryParams.hasOwnProperty('isActive')) {
    //   where['isActive'] = queryParams.isActive ? true : false;
    // }

    if (queryParams.createdIn && queryParams.createdUntil) {
      const createdAtDateFilter = {
        $gte: new Date(queryParams.createdIn),
        $lt: new Date(queryParams.createdUntil),
      };
      const createdAtStringFilter = {
        $gte: queryParams.createdIn,
        $lt: queryParams.createdUntil,
      };

      // Garante compatibilidade: aceita registros Date (novos) e string (legados).
      where['$or'] = [
        { createdAt: createdAtDateFilter },
        { createdAt: createdAtStringFilter },
      ];
    }

       try {
      deliveries = await this.deliveryRepository.find({
        relations: { motoboy: true, establishment: true },
        where,
        skip,
        take,
      });

      deliveries = deliveries.sort(
        (a, b) =>
          new Date(b.createdAt as any).getTime() -
          new Date(a.createdAt as any).getTime(),
      );

      count = await this.deliveryRepository.count(where);
    } catch (error) {
      return error;
    }

    return ListDeliverysResult.fromEntities(
      deliveries,
      deliveries.length,
      queryParams.page,
      count,
    );
  }

  async updateDelivery(
    deliveryId: string,
    deliveryData: UpdateDeliveryDto,
    user: UserRequest,
  ) {
    const userFinded = await this.findOneUserById(user.id);
    const deliveryFinded = await this.deliveryRepository.findOneByOrFail({
      id: deliveryId,
    });

    this.ensureCityAccess(
      userFinded,
      deliveryFinded.establishment?.cityId ?? userFinded.cityId,
    );

    let establishmentFinded;
    let motoboyFinded;

    let changedDelivery = {};

    if (userFinded.type === UserType.ADMIN || userFinded.type === UserType.SUPERADMIN) {
      changedDelivery = { ...deliveryFinded, ...deliveryData };

      if (deliveryData.establishmentId) {
        establishmentFinded = await this.findOneUserById(
          deliveryData.establishmentId,
        );
        this.ensureCityAccess(userFinded, establishmentFinded.cityId);
      }

      if (deliveryData.motoboyId) {
        motoboyFinded = await this.findOneUserById(deliveryData.motoboyId);
        this.ensureCityAccess(userFinded, motoboyFinded.cityId);
      }
    }

    if (userFinded.type === UserType.SHOPKEEPER) {
      changedDelivery = { ...deliveryFinded, ...deliveryData };
    }

    if (userFinded.type === UserType.MOTOBOY) {
      if (
        deliveryFinded.motoboy != null &&
        deliveryFinded.motoboy.id != userFinded.id
      ) {
        throw new BadRequestException(
          'Essá entrega ja foi atribuída a outro entregador.',
        );
      }

      changedDelivery = { ...deliveryFinded, ...deliveryData };

      if (
        deliveryData.status === StatusDelivery.ONCOURSE &&
        !deliveryData.motoboyId
      ) {
        throw new BadRequestException(
          'É necessario que você selecione a opção de motoboy.',
        );
      }

      if (deliveryData.motoboyId) {
        const where = {};
        where['motoboy.id'] = userFinded.id;
        where['isActive'] = true;
        where['status'] = {
          $in: [
            StatusDelivery.PENDING,
            StatusDelivery.ONCOURSE,
            StatusDelivery.COLLECTED,
          ],
        };
        where['establishment.cityId'] = userFinded.cityId;

        const deliveriesForMotoboy = await this.deliveryRepository.count(where);

        if (deliveriesForMotoboy >= this.motoboysDeliveriesAmount) {
          throw new BadRequestException(
            `Você não pode pegar mais do que ${this.motoboysDeliveriesAmount} solicitações.`,
          );
        }
        motoboyFinded = userFinded;
      }
    }

    if (establishmentFinded) {
      changedDelivery = {
        ...changedDelivery,
        establishment: establishmentFinded,
      };
    }

    if (motoboyFinded) {
      changedDelivery = {
        ...changedDelivery,
        motoboy: motoboyFinded,
      };
    }

    if (deliveryData.status) {
      const dateForUse = addHours(new Date(), -3);
      if (deliveryData.status === StatusDelivery.ONCOURSE) {
        changedDelivery['onCoursedAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.COLLECTED) {
        changedDelivery['collectedAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.FINISHED) {
        changedDelivery['finishedAt'] = dateForUse;
      }
    }

        const deliveryForSync = {
      ...changedDelivery,
      motoboy: motoboyFinded || changedDelivery['motoboy'],
      establishment: establishmentFinded || changedDelivery['establishment'],
    };

    await this.syncIfoodIfNeeded(
      deliveryFinded,
      deliveryForSync as DeliveryEntity,
      deliveryData,
    );

       let deliveryUpdated;
    try {
      deliveryUpdated = await this.deliveryRepository.save({
        ...changedDelivery,
        updatedAt: addHours(new Date(), -3),
      });

      this.ordersGateway.emitDeliveryUpdated(
        DeliveryResult.fromEntity(deliveryUpdated),
      );
    } catch (error) {
      return error;
    }
    if (
      deliveryFinded.establishment.notification &&
      deliveryFinded.establishment.notification.subscriptionId
    ) {
  if (
  deliveryData.status &&
  deliveryData.status === StatusDelivery.ONCOURSE
) {
  const motoboyName =
    motoboyFinded?.name ||
    changedDelivery['motoboy']?.name ||
    deliveryFinded.motoboy?.name ||
    'o motoboy';

  await sendNotificationsFor(
    [deliveryFinded.establishment.notification.subscriptionId],
    `O motoboy ${motoboyName} aceitou a entrega do pedido do(a) ${deliveryFinded.clientName} e está a caminho!`,
  );
} else if (deliveryData.status) {
  await sendNotificationsFor(
    [deliveryFinded.establishment.notification.subscriptionId],
    `Houve uma alteração no status da entrega do pedido do(a) ${deliveryFinded.clientName}`,
  );
}
    }

    return DeliveryResult.fromEntity(deliveryUpdated);
  }

  async createDelivery(
    deliveryData: CreateDeliveryDto,
    user: UserRequest,
  ): Promise<DeliveryResult> {
    const userFinded = await this.findOneUserById(user.id);
    let establishment;
    let motoboy = null;
    let onCoursedAt = null;
    const {
      clientName,
      clientPhone,
      status,
      value,
      payment,
      soda,
      observation,
    } = deliveryData;

    let deliveryStatus = status;

   if (
  this.blockDeliverys &&
  user.type !== UserType.ADMIN &&
  user.type !== UserType.SUPERADMIN
) {
  throw new BadRequestException(
    'Infelizmente as entregas foram encerradas por hoje.',
  );
}

    if (
      (userFinded.type === UserType.ADMIN ||
        userFinded.type === UserType.SUPERADMIN) &&
      deliveryData.establishmentId
    ) {
      establishment = await this.findOneUserById(deliveryData.establishmentId);
      this.ensureCityAccess(userFinded, establishment.cityId);
    } else {
      establishment = userFinded;
    }

    if (
      (userFinded.type === UserType.ADMIN ||
        userFinded.type === UserType.SUPERADMIN ||
        userFinded.type === UserType.SHOPKEEPERADMIN) &&
      deliveryData.motoboyId
    ) {
      motoboy = await this.findOneUserById(deliveryData.motoboyId);
      this.ensureCityAccess(userFinded, motoboy.cityId);
      deliveryStatus = StatusDelivery.ONCOURSE;
      onCoursedAt = addHours(new Date(), -3);
    }

    try {
            const newDelivery = await this.deliveryRepository.save({
        id: uuid(),
        clientName,
        clientPhone,
        status: deliveryStatus,
        establishment,
        motoboy,
        value,
        payment,
        soda,
        observation,
        isActive: true,
        createdBy: user.id,
        onCoursedAt,
        createdAt: addHours(new Date(), -3),
        updatedAt: addHours(new Date(), -3),
      });

      this.ordersGateway.emitDeliveryCreated(
        DeliveryResult.fromEntity(newDelivery),
      );

      const newLog = {
        id: uuid(),
        where: 'Criação de um delivery',
        type: 'Log para notificações',
        error: 'Sem error',
        user: userFinded,
        status: 'Notificação enviada.',
      };

      if (deliveryStatus != StatusDelivery.ONCOURSE) {
        try {
          await this.sendNotificationsToMotoboys(
            newDelivery.establishment.name,
            newDelivery.establishment.cityId,
          );
        } catch (error) {
          newLog.error = `${error}`;
          newLog.status = 'Notificação não enviada devido ao error';
          await this.logRepository.save(newLog);
        }
      } else {
        try {
          const subscriptionId = motoboy?.notification?.subscriptionId;

          if (subscriptionId) {
            await sendNotificationsFor(
              [subscriptionId],
              `Você foi atribuido a uma entrega no estabelecimento: ${establishment.name}`,
            );
          }
        } catch (error) {
          newLog.error = `${error}`;
          newLog.status = 'Notificação não enviada devido ao error';
          await this.logRepository.save(newLog);
        }
      }

      return DeliveryResult.fromEntity(newDelivery);
    } catch (error) {
      return error;
    }
  }

 async deleteDelivery(deliveryId: string, user: UserRequest) {
  const deliveryFinded = await this.deliveryRepository.findOne({
    where: {
      id: deliveryId,
      isActive: true,
    },
    relations: { establishment: true },
  });

  if (!deliveryFinded) {
    throw new BadRequestException('Entrega não encontrada.');
  }

  const userFinded = await this.userRepository.findOneBy({
    id: user.id,
  });

  if (
    (userFinded.type === UserType.SHOPKEEPER ||
      userFinded.type === UserType.SHOPKEEPERADMIN) &&
    deliveryFinded.establishment.id != userFinded.id
  ) {
    throw new BadRequestException('Você não é o dono dessa entrega.');
  }

  const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
    deliveryFinded.id,
  );

  if (ifoodLink) {
    await this.ifoodOrdersService.requestCancellation(
      ifoodLink.ifoodOrderId,
      'Cancelado no Rappidex pela exclusão da entrega.',
    );
  }

  try {
    await this.deliveryRepository.save({
      ...deliveryFinded,
      status: StatusDelivery.CANCELED,
      isActive: false,
      updatedAt: addHours(new Date(), -3),
    });

    this.ordersGateway.emitDeliveryDeleted(deliveryFinded.id);
  } catch (error) {
    return error;
  }

  return { status: 200, message: 'Entrega apagada com sucesso!' };
}

async cancelDeliveryFromIfood(orderId: string, event?: any) {
  const ifoodLink = await this.ifoodOrderLinkService.findByIfoodOrderId(
    orderId,
  );

  if (!ifoodLink) {
    return;
  }

  const deliveryFinded = await this.deliveryRepository.findOne({
    where: {
      id: ifoodLink.deliveryId,
    },
    relations: { establishment: true },
  });

  if (!deliveryFinded || !deliveryFinded.isActive) {
    return;
  }

  await this.deliveryRepository.save({
    ...deliveryFinded,
    status: StatusDelivery.CANCELED,
    isActive: false,
    updatedAt: addHours(new Date(), -3),
  });

  this.ordersGateway.emitDeliveryDeleted(deliveryFinded.id);

  this.logger.warn(
    `Entrega ${deliveryFinded.id} cancelada no Rappidex por evento ${event?.fullCode || event?.code || 'CANCELLED'} do iFood. OrderId: ${orderId}`,
  );
}

  async findOneUserById(userId: string) {
    const user = await this.userRepository.findOneBy({ id: userId });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    return user;
  }

  async findConfigs() {
    return {
      status: 200,
      amount: this.motoboysDeliveriesAmount,
      blockDeliverys: this.blockDeliverys,
    };
  }

  async changeConfigs(configs: ConfigsDto) {
    if (configs.amountDeliverys) {
      this.motoboysDeliveriesAmount = parseInt(configs.amountDeliverys);
    }

    if (configs.blockDeliverys) {
      this.blockDeliverys = !this.blockDeliverys;
    }

    return {
      status: 200,
      message: 'Configurações foram alterada com sucesso.',
    };
  }

    private ensureCityAccess(user: UserEntity, resourceCityId: string) {
    if (
      user.type !== UserType.SUPERADMIN &&
      user.cityId !== resourceCityId
    ) {
      throw new UnauthorizedException(
        'Você não tem permissão para acessar recursos de outra cidade.',
      );
    }
  }

  private async sendNotificationsToMotoboys(
    establishmentName: string,
    cityId: string,
  ) {
    console.log('=== INÍCIO NOTIFICAÇÃO DE NOVO PEDIDO ===');
    console.log('Estabelecimento:', establishmentName);
    console.log('Cidade do pedido:', cityId);

    const where: Record<string, unknown> = {
      type: UserType.MOTOBOY,
      isActive: true,
    };

    if (cityId) {
      where['cityId'] = cityId;
    }

    console.log('Filtro usado para buscar motoboys:', where);

    const motoboys = await this.userRepository.find({ where });

    console.log('Motoboys encontrados:', motoboys.length);

    const motoboysNotificationsIds = motoboys
      .map((motoboy: UserEntity) => {
        console.log('Motoboy:', {
          id: motoboy.id,
          name: motoboy.name,
          cityId: motoboy.cityId,
          isActive: motoboy.isActive,
          subscriptionId: motoboy.notification?.subscriptionId ?? null,
        });

        if (motoboy.notification && motoboy.notification.subscriptionId) {
          return motoboy.notification.subscriptionId;
        }

        return null;
      })
      .filter((i) => !!i);

    console.log('Subscription IDs encontrados:', motoboysNotificationsIds);

    await sendNotificationsFor(
      motoboysNotificationsIds,
      `Nova solicitação de entrega no estabelecimento: ${establishmentName}`,
    );

    console.log('=== FIM NOTIFICAÇÃO DE NOVO PEDIDO ===');
  }
}
