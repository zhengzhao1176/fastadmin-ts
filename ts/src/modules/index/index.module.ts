import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserEntity } from '../../entities/user.entity.ts'
import { UserTokenEntity } from '../../entities/user-token.entity.ts'
import { AttachmentEntity } from '../../entities/attachment.entity.ts'
import { AuthService } from '../../services/auth.service.ts'
import { UploadService } from '../../services/upload.service.ts'
import { CsrfService } from '../../services/csrf.service.ts'
import { HookService } from '../../services/hook.service.ts'
import { I18nService } from '../../services/i18n.service.ts'
import { ViewService } from '../../services/view.service.ts'
import { BackendConfigService } from '../../services/backend-config.service.ts'
import { ConfigEntity } from '../../entities/config.entity.ts'
import { FrontendAuthGuard } from '../../guards/frontend-auth.guard.ts'
import { FrontendIndexController } from './index.controller.ts'
import { FrontendAjaxController } from './ajax.controller.ts'
import { FrontendUserController } from './user.controller.ts'

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, UserTokenEntity, AttachmentEntity, ConfigEntity])],
  controllers: [FrontendIndexController, FrontendAjaxController, FrontendUserController],
  providers: [AuthService, UploadService, CsrfService, HookService, I18nService, ViewService, BackendConfigService, FrontendAuthGuard],
  exports: [HookService, I18nService, ViewService, BackendConfigService],
})
export class FrontendModule {}
