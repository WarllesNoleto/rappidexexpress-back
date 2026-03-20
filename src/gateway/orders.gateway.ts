import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { DeliveryResult } from '../delivery/dto';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrdersGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(@ConnectedSocket() client: Socket) {
    this.logger.log(`Socket conectado: ${client.id}`);
  }

  handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.log(`Socket desconectado: ${client.id}`);
  }

  emitDeliveryCreated(delivery: DeliveryResult) {
    this.logger.log(`Emitindo delivery:created -> ${delivery.id}`);
    this.server.emit('delivery:created', delivery);
  }

  emitDeliveryUpdated(delivery: DeliveryResult) {
    this.logger.log(`Emitindo delivery:updated -> ${delivery.id}`);
    this.server.emit('delivery:updated', delivery);
  }

  emitDeliveryDeleted(deliveryId: string) {
    this.logger.log(`Emitindo delivery:deleted -> ${deliveryId}`);
    this.server.emit('delivery:deleted', { id: deliveryId });
  }
}
