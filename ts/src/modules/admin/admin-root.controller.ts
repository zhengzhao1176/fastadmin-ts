// Catch the bare `/admin.php` and `/admin.php/` URLs and forward to
// `/admin.php/index/index`. PHP's index.php does this implicitly because the
// front controller routes empty path to the index module's default action;
// NestJS needs an explicit handler.
import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'

@Controller('admin.php')
export class AdminRootController {
  @Get()
  rootBare(@Res() res: Response): void {
    res.redirect(302, '/admin.php/index/index')
  }

  @Get('/')
  rootSlash(@Res() res: Response): void {
    res.redirect(302, '/admin.php/index/index')
  }
}
