import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserEntity } from '../../entities/user.entity.ts'
import { UserTokenEntity } from '../../entities/user-token.entity.ts'
import { SmsEntity } from '../../entities/sms.entity.ts'
import { EmsEntity } from '../../entities/ems.entity.ts'
import { AttachmentEntity } from '../../entities/attachment.entity.ts'
import { AuthService } from '../../services/auth.service.ts'
import { CaptchaService } from '../../services/captcha.service.ts'
import { CaptchaImageService } from '../../services/captcha-image.service.ts'
import { SmsService } from '../../services/sms.service.ts'
import { MailerService } from '../../services/mailer.service.ts'
import { UploadService } from '../../services/upload.service.ts'
import { ApiAuthGuard } from '../../guards/api-auth.guard.ts'
import { ApiCommonController } from './common.controller.ts'
import { ApiDemoController } from './demo.controller.ts'
import { ApiEmsController } from './ems.controller.ts'
import { ApiIndexController } from './index.controller.ts'
import { ApiSmsController } from './sms.controller.ts'
import { ApiTokenController } from './token.controller.ts'
import { ApiUserController } from './user.controller.ts'
import { ApiValidateController } from './validate.controller.ts'

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, UserTokenEntity, SmsEntity, EmsEntity, AttachmentEntity]),
  ],
  controllers: [
    ApiIndexController,
    ApiCommonController,
    ApiDemoController,
    ApiEmsController,
    ApiSmsController,
    ApiTokenController,
    ApiUserController,
    ApiValidateController,
  ],
  providers: [
    AuthService,
    CaptchaService,
    CaptchaImageService,
    SmsService,
    MailerService,
    UploadService,
    ApiAuthGuard,
  ],
  exports: [AuthService, CaptchaService, CaptchaImageService, SmsService, MailerService, UploadService, ApiAuthGuard],
})
export class ApiModule {}
