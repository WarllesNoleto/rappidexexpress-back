import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { DeliveryResult } from '../delivery/dto';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class OrdersGateway {
  @WebSocketServer()
  server: Server;

  emitDeliveryCreated(delivery: DeliveryResult) {
    this.server.emit('delivery:created', delivery);
  }

  emitDeliveryUpdated(delivery: DeliveryResult) {
    this.server.emit('delivery:updated', delivery);
  }

  emitDeliveryDeleted(deliveryId: string) {
    this.server.emit('delivery:deleted', { id: deliveryId });
  }
}