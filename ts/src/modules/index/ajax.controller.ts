// index/Ajax — frontend utility endpoints: lang, icon, upload (forwards to /api/common/upload).
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request } from 'express'
import { apiErr, apiOk, type ApiEnvelope } from '../../common/envelope.ts'
import { UploadService } from '../../services/upload.service.ts'
import { AuthService } from '../../services/auth.service.ts'
import { I18nService } from '../../services/i18n.service.ts'
import { FrontendAuthGuard } from '../../guards/frontend-auth.guard.ts'

type MulterFile = { buffer: Buffer; originalname: string; mimetype: string; size: number }

const ALLOWED_LANGS = new Set(['zh-cn', 'en'])

@Controller('index/ajax')
export class FrontendAjaxController {
  constructor(
    private readonly upload: UploadService,
    private readonly auth: AuthService,
    private readonly i18n: I18nService,
  ) {}

  // /lang — anonymous, JSONP wrapped (always hardcoded callback 'define').
  @Get('lang')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  lang(@Query() q: Record<string, string>): string {
    const controllername = String(q.controllername ?? '')
    const lang = String(q.lang ?? '')
    if (!lang || !ALLOWED_LANGS.has(lang) || !controllername || !/^[a-z0-9_.]+$/i.test(controllername)) {
      return `define({"errmsg":"参数错误"});`
    }
    const dict = this.i18n.load(lang, 'index', controllername)
    return `define(${JSON.stringify(dict)});`
  }

  // /icon — protected (frontend session).
  @Get('icon')
  @UseGuards(FrontendAuthGuard)
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'public')
  icon(@Query('suffix') suffixQ?: string): string {
    const suffix = String(suffixQ ?? 'FILE').replace(/[^A-Z0-9a-z]/g, '').slice(0, 8) || 'FILE'
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="6" fill="#eee"/>
  <text x="32" y="36" text-anchor="middle" font-size="14" fill="#333" font-family="sans-serif">${suffix}</text>
</svg>`
  }

  // /upload — forwards to api/common/upload (api-token auth via Authorization-style "token" header).
  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async upload_(
    @Req() req: Request,
    @UploadedFile() file: MulterFile | undefined,
  ): Promise<ApiEnvelope<unknown>> {
    const token = String(req.headers['token'] ?? req.cookies?.['token'] ?? '')
    const user = token ? await this.auth.getUserByToken(token) : null
    if (!user) return apiErr('请登录', null, 401)
    if (!file) return apiErr('文件不能为空')
    const res = await this.upload.save({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      userId: user.id,
    })
    if (!res.ok) {
      const msg = res.error === 'mimetype_denied' ? 'File extension is not allowed' : 'Upload failed'
      return apiErr(msg)
    }
    const host = req.protocol + '://' + (req.get('host') ?? '127.0.0.1')
    return apiOk('上传成功', { url: res.url, fullurl: host + res.url })
  }
}
