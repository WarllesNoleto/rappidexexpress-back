import { Expose } from 'class-transformer';

export class DeliveryDashboardCountsResult {
  @Expose()
  pendingCount: number;

  @Expose()
  assignedCount: number;
}