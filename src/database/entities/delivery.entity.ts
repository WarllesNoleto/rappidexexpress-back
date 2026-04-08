import { ObjectId } from 'mongodb';
import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import {
  PaymentType,
  StatusDelivery,
} from '../../shared/constants/enums.constants';
import { UserEntity } from './user.entity';

@Entity()
@Index(['isActive', 'status', 'createdAt'])
export class DeliveryEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  @Index({ unique: true })
  id: string;

  @Column()
  clientName: string;

  @Column()
  clientPhone: string;

  @Index()
  @Column({ type: 'enum', enum: StatusDelivery })
  status: StatusDelivery;

  @Column({ unique: false })
  establishment: UserEntity;

  @Column({ unique: false, nullable: true })
  motoboy: UserEntity;

  @Column()
  value: string;

  @Column()
  observation: string;

  @Column()
  soda: string;

  @Column({ type: 'enum', enum: PaymentType })
  payment: PaymentType;

  @Index()
  @Column()
  isActive: boolean;

  @Index()
  @Column()
  createdAt: Date;

  @Index()
  @Column({ nullable: true })
  createdBy: string;

  @Column()
  updatedAt: Date;

  @Column()
  onCoursedAt: Date;

  @Column()
  collectedAt: Date;

  @Index()
  @Column()
  finishedAt: Date;
}