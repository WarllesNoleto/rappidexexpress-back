import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IfoodImportService } from './ifood-import.service';
import { IfoodPollingService } from './ifood-polling.service';

@Injectable()
export class IfoodAutoPollingService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IfoodAutoPollingService.name);
  private intervalRef: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly ifoodPollingService: IfoodPollingService,
    private readonly ifoodImportService: IfoodImportService,
  ) {}

  async onModuleInit() {
    const pollingEnabled =
      String(this.configService.get('IFOOD_POLLING_ENABLED')) === 'true';

    const pollingIntervalMs = Number(
      this.configService.get('IFOOD_POLLING_INTERVAL_MS') || 30000,
    );

    if (!pollingEnabled) {
      this.logger.warn('Polling automático do iFood está desativado.');
      return;
    }

    this.logger.log(
      `Polling automático do iFood ativado a cada ${pollingIntervalMs}ms.`,
    );

    await this.runPollingCycle();

    this.intervalRef = setInterval(async () => {
      await this.runPollingCycle();
    }, pollingIntervalMs);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async runPollingCycle() {
    try {
      const events = await this.ifoodPollingService.pollEvents();
      const totalEvents = Array.isArray(events) ? events.length : 0;

      this.logger.log(
        `Polling executado com sucesso. Eventos encontrados: ${totalEvents}`,
      );

      await this.ifoodImportService.importFromEvents(events);
    } catch (error: any) {
      this.logger.error(
        `Erro no polling automático do iFood: ${error?.message || error}`,
      );
    }
  }
}