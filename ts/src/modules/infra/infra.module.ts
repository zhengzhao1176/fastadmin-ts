// Infrastructure module — process-wide services that aren't tied to any one
// HTTP route: the async job queue, the cron scheduler, and the member
// balance/points ledger service.
//
// Marked `@Global()` so any controller/service can inject `QueueService` /
// `SchedulerService` / `UserBalanceService` without re-importing this module.
// The queue/scheduler providers are NO-OP safe: no Redis → in-memory queue;
// no registered tasks → idle ticker.
import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { QueueService } from '../../services/queue.service.ts'
import { SchedulerService } from '../../services/scheduler.service.ts'
import { UserBalanceService } from '../../services/user-balance.service.ts'
import { UserEntity } from '../../entities/user.entity.ts'
import { UserMoneyLogEntity } from '../../entities/user-money-log.entity.ts'
import { UserScoreLogEntity } from '../../entities/user-score-log.entity.ts'

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, UserMoneyLogEntity, UserScoreLogEntity])],
  providers: [QueueService, SchedulerService, UserBalanceService],
  exports: [QueueService, SchedulerService, UserBalanceService],
})
export class InfraModule {}
