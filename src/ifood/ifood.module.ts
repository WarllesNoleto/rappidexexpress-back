import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IfoodOrderLinkEntity } from '../database/entities';
import { DeliveryModule } from '../delivery/delivery.module';
import { IfoodAdminController } from './ifood-admin.controller';
import { IfoodAuthService } from './ifood-auth.service';
import { IfoodAutoPollingService } from './ifood-auto-polling.service';
import { IfoodImportService } from './ifood-import.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';

@Module({
  imports: [
    ConfigModule,
    DeliveryModule,
    TypeOrmModule.forFeature([IfoodOrderLinkEntity]),
  ],
  controllers: [IfoodAdminController],
  providers: [
    IfoodAuthService,
    IfoodOrdersService,
    IfoodPollingService,
    IfoodOrderLinkService,
    IfoodImportService,
    IfoodAutoPollingService,
  ],
  exports: [
    IfoodAuthService,
    IfoodOrdersService,
    IfoodPollingService,
    IfoodOrderLinkService,
    IfoodImportService,
  ],
})
export class IfoodModule {}