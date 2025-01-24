import { Injectable } from '@nestjs/common';
@Injectable()
export class AuditService {
    auditLogRepository;
    constructor(
    @InjectRepository(AuditLog)
    auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }
    async logAudit(entity, action, changes) {
        const auditLog = this.auditLogRepository.create({
            entity,
            action,
            changes,
        });
        await this.auditLogRepository.save(auditLog);
    }
}
