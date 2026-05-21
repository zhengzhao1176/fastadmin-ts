// index/Index — single anonymous HTML page. Mirrors index/Index.php (which
// just calls $this->view->fetch()).
import { Controller, Get, Header, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ViewService } from '../../services/view.service.ts'
import { BackendConfigService } from '../../services/backend-config.service.ts'

@Controller('index')
export class FrontendIndexController {
  constructor(
    private readonly view: ViewService,
    private readonly backendConfig: BackendConfigService,
  ) {}

  @Get('index/index')
  @Header('Content-Type', 'text/html; charset=utf-8')
  index(@Req() req: Request): string {
    return this.render(req)
  }

  @Get('index')
  @Header('Content-Type', 'text/html; charset=utf-8')
  indexShort(@Req() req: Request): string {
    return this.render(req)
  }

  private render(req: Request): string {
    return this.view.render({
      module: 'index',
      template: 'index/index',
      data: {
        title: 'FastAdmin',
        requireConfig: JSON.stringify(this.backendConfig.buildSync(req, {
          controllername: 'index',
          actionname: 'index',
        })),
      },
    })
  }
}
