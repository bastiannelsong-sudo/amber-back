import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async logAudit(entity: string, action: string, changes: { order: EntityChanges }): Promise<void> {
    const auditLog = this.auditLogRepository.create({
      entity,
      action,
      changes,
    });

    await this.auditLogRepository.save(auditLog);
  }
}
