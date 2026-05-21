import {
  All,
  Body,
  Controller,
  Header,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request, Response } from 'express'
import { apiErr, apiOk, type ApiEnvelope } from '../../common/envelope.ts'
import { ApiAuthGuard } from '../../guards/api-auth.guard.ts'
import { UploadService } from '../../services/upload.service.ts'
import { CaptchaImageService, type SessionCaptcha } from '../../services/captcha-image.service.ts'
import type { UserEntity } from '../../entities/user.entity.ts'

// Mirrors application/api/controller/Common.php — three actions:
//   init     — bootstrap config (no auth)
//   upload   — multipart upload (auth required)
//   captcha  — PNG image (no auth)

interface InitData {
  citydata: unknown
  versiondata: unknown
  uploaddata: Record<string, unknown>
  coverdata: unknown
}

interface UploadResponseData {
  url: string
  fullurl: string
}

@Controller('api/common')
export class ApiCommonController {
  constructor(
    private readonly uploader: UploadService,
    private readonly captchaImg: CaptchaImageService,
  ) {}

  @All('init')
  init(@Body() body?: Record<string, unknown>): ApiEnvelope<InitData | null> {
    const version = String((body ?? {})['version'] ?? '').trim()
    if (!version) return apiErr('Invalid parameters')
    return apiOk('', {
      citydata: null,
      versiondata: null,
      uploaddata: {
        cdnurl: '',
        uploadurl: '/api/common/upload',
        maxsize: '10mb',
        mimetype: '*',
        storage: 'local',
        uploadmode: 'server',
        savekey: '/uploads/{topic}/{year}{mon}{day}/{filename}{.suffix}',
      },
      coverdata: null,
    })
  }

  @Post('upload')
  @UseGuards(ApiAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    @Req() req: Request & { user?: UserEntity },
  ): Promise<ApiEnvelope<UploadResponseData | null>> {
    if (!file || !file.buffer || file.size === 0) {
      return apiErr('No file upload or server upload limit exceeded')
    }
    const r = await this.uploader.save({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      userId: req.user?.id ?? 0,
    })
    if (!r.ok) {
      const msg = r.error === 'mimetype_denied' ? 'Uploaded file format is limited'
        : r.error === 'no_file' ? 'No file upload or server upload limit exceeded'
        : 'File write error'
      return apiErr(msg)
    }
    return apiOk('Uploaded successful', { url: r.url!, fullurl: r.fullurl! })
  }

  // Captcha image — distorted SVG with rotation + noise via svg-captcha lib.
  // Stores the canonical lowercase answer in `session.captcha` with a 5-minute
  // TTL so other endpoints (sms/check, ems/check, frontend register) can verify
  // via `CaptchaImageService.verify(session, submitted)`.
  @All('captcha')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  captcha(
    @Req() req: Request & { session?: { captcha?: SessionCaptcha } & Record<string, unknown> },
    @Res() res: Response,
  ): void {
    const { svg, code } = this.captchaImg.issue()
    if (req.session) {
      req.session.captcha = { code, expiretime: Math.floor(Date.now() / 1000) + 5 * 60 }
    }
    res.setHeader('Cache-Control', 'no-store')
    res.send(svg)
  }
}
