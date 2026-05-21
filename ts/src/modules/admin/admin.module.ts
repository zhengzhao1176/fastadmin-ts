import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AdminEntity } from '../../entities/admin.entity.ts'
import { AdminLogEntity } from '../../entities/admin-log.entity.ts'
import { CategoryEntity } from '../../entities/category.entity.ts'
import { ConfigEntity } from '../../entities/config.entity.ts'
import { UserEntity } from '../../entities/user.entity.ts'
import { AttachmentEntity } from '../../entities/attachment.entity.ts'
import { AuthGroupEntity } from '../../entities/auth-group.entity.ts'
import { AuthGroupAccessEntity } from '../../entities/auth-group-access.entity.ts'
import { AuthRuleEntity } from '../../entities/auth-rule.entity.ts'
import { UserGroupEntity } from '../../entities/user-group.entity.ts'
import { UserRuleEntity } from '../../entities/user-rule.entity.ts'
import { AreaEntity } from '../../entities/area.entity.ts'
import { TestEntity } from '../../entities/test.entity.ts'
import { AdminAuthService } from '../../services/admin-auth.service.ts'
import { AdminAuthLibrary } from '../../services/admin-auth-library.service.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { CsrfService } from '../../services/csrf.service.ts'
import { MailerService } from '../../services/mailer.service.ts'
import { ViewService } from '../../services/view.service.ts'
import { BackendConfigService } from '../../services/backend-config.service.ts'
import { AdminIndexController } from './index.controller.ts'
import { AdminRootController } from './admin-root.controller.ts'
import { CategoryController } from './category.controller.ts'
import { DashboardController } from './dashboard.controller.ts'
import { GeneralProfileController } from './general-profile.controller.ts'
import { GeneralConfigController } from './general-config.controller.ts'
import { GeneralAttachmentController } from './general-attachment.controller.ts'
import { AuthAdminController } from './auth-admin.controller.ts'
import { AuthGroupController } from './auth-group.controller.ts'
import { AuthRuleController } from './auth-rule.controller.ts'
import { AuthAdminlogController } from './auth-adminlog.controller.ts'
import { UserUserController } from './user-user.controller.ts'
import { UserGroupController } from './user-group.controller.ts'
import { UserRuleController } from './user-rule.controller.ts'
import { AdminAjaxController, AdminAjaxLangController } from './ajax.controller.ts'
import { AdminAddonController } from './addon.controller.ts'
import { TestController } from './test.controller.ts'
import { UploadService } from '../../services/upload.service.ts'
import { HookService } from '../../services/hook.service.ts'
import { AddonService } from '../../services/addon.service.ts'
import { CacheService } from '../../services/cache.service.ts'
import { I18nService } from '../../services/i18n.service.ts'
import { AdminLogInterceptor } from '../../interceptors/admin-log.interceptor.ts'
import { MultitabInterceptor } from '../../interceptors/multitab.interceptor.ts'
import { AdminMultipartErrorFilter, AdminInternalErrorFilter } from '../../filters/admin-error.filter.ts'
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core'

@Module({
  imports: [TypeOrmModule.forFeature([
    AdminEntity, AdminLogEntity, CategoryEntity, ConfigEntity, UserEntity, AttachmentEntity,
    AuthGroupEntity, AuthGroupAccessEntity, AuthRuleEntity,
    UserGroupEntity, UserRuleEntity, AreaEntity, TestEntity,
  ])],
  controllers: [
    AdminRootController,
    AdminIndexController, CategoryController, DashboardController,
    GeneralProfileController, GeneralConfigController, GeneralAttachmentController,
    AuthAdminController, AuthGroupController, AuthRuleController, AuthAdminlogController,
    UserUserController, UserGroupController, UserRuleController,
    AdminAjaxLangController, AdminAjaxController,
    AdminAddonController, TestController,
  ],
  providers: [
    AdminAuthService, AdminAuthLibrary, CsrfService, AdminAuthGuard, MailerService, UploadService, ViewService,
    HookService, AddonService, CacheService, I18nService, BackendConfigService,
    { provide: APP_INTERCEPTOR, useClass: MultitabInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AdminLogInterceptor },
    // Filter precedence: NestJS picks the most specific @Catch first. So
    // BadRequest/PayloadTooLarge → MultipartFilter → 4xx envelope; everything
    // else (5xx, unhandled) → InternalErrorFilter → Sentry + admin envelope.
    { provide: APP_FILTER, useClass: AdminMultipartErrorFilter },
    { provide: APP_FILTER, useClass: AdminInternalErrorFilter },
  ],
  exports: [AdminAuthService, AdminAuthLibrary, CsrfService, AdminAuthGuard, ViewService, HookService, AddonService, CacheService, I18nService, BackendConfigService],
})
export class AdminModule {}
