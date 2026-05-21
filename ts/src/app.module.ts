import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SentryModule } from '@sentry/nestjs/setup'
import { loadDbConfig } from './common/env.ts'
import { UserEntity } from './entities/user.entity.ts'
import { UserTokenEntity } from './entities/user-token.entity.ts'
import { UserMoneyLogEntity } from './entities/user-money-log.entity.ts'
import { UserScoreLogEntity } from './entities/user-score-log.entity.ts'
import { SmsEntity } from './entities/sms.entity.ts'
import { EmsEntity } from './entities/ems.entity.ts'
import { AttachmentEntity } from './entities/attachment.entity.ts'
import { AdminEntity } from './entities/admin.entity.ts'
import { AdminLogEntity } from './entities/admin-log.entity.ts'
import { CategoryEntity } from './entities/category.entity.ts'
import { ConfigEntity } from './entities/config.entity.ts'
import { AuthGroupEntity } from './entities/auth-group.entity.ts'
import { AuthGroupAccessEntity } from './entities/auth-group-access.entity.ts'
import { AuthRuleEntity } from './entities/auth-rule.entity.ts'
import { UserGroupEntity } from './entities/user-group.entity.ts'
import { UserRuleEntity } from './entities/user-rule.entity.ts'
import { AreaEntity } from './entities/area.entity.ts'
import { TestEntity } from './entities/test.entity.ts'
import { ApiModule } from './modules/api/api.module.ts'
import { AdminModule } from './modules/admin/admin.module.ts'
import { FrontendModule } from './modules/index/index.module.ts'
import { HealthModule } from './modules/health/health.module.ts'
import { InfraModule } from './modules/infra/infra.module.ts'

const db = loadDbConfig()

@Module({
  imports: [
    // SentryModule.forRoot() — registers Sentry's NestJS adapter (interceptors
    // for unhandled exceptions, automatic span instrumentation for handlers
    // and providers). It's a no-op when `Sentry.init` wasn't called (i.e. no
    // SENTRY_DSN env), so safe to keep in the static module graph.
    SentryModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: db.host,
      port: db.port,
      username: db.user,
      password: db.password,
      database: db.database,
      entities: [UserEntity, UserTokenEntity, UserMoneyLogEntity, UserScoreLogEntity, SmsEntity, EmsEntity, AttachmentEntity, AdminEntity, AdminLogEntity, CategoryEntity, ConfigEntity, AuthGroupEntity, AuthGroupAccessEntity, AuthRuleEntity, UserGroupEntity, UserRuleEntity, AreaEntity, TestEntity],
      synchronize: false,
      logging: false,
    }),
    InfraModule,
    ApiModule,
    AdminModule,
    FrontendModule,
    HealthModule,
  ],
})
export class AppModule {}
