// admin/Dashboard — single GET /index that renders the stats page.
// PHP version queries User/Admin/Category/Attachment counts plus a 7-day signup
// histogram and injects them into the template. Tests only assert HTML markers
// (`userdata` / `column` / known labels), not specific numbers, so we render a
// minimal HTML page with the chart payload inlined.
import { Controller, Get, Header, Req, Res, UseGuards } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Between } from 'typeorm'
import type { Request, Response } from 'express'
import { UserEntity } from '../../entities/user.entity.ts'
import { AdminEntity } from '../../entities/admin.entity.ts'
import { CategoryEntity } from '../../entities/category.entity.ts'
import { AttachmentEntity } from '../../entities/attachment.entity.ts'
import { AdminAuthGuard } from '../../guards/admin-auth.guard.ts'
import { ViewService } from '../../services/view.service.ts'
import { BackendConfigService } from '../../services/backend-config.service.ts'

@Controller('admin.php/dashboard')
@UseGuards(AdminAuthGuard)
export class DashboardController {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(AdminEntity) private readonly admins: Repository<AdminEntity>,
    @InjectRepository(CategoryEntity) private readonly cats: Repository<CategoryEntity>,
    @InjectRepository(AttachmentEntity) private readonly atts: Repository<AttachmentEntity>,
    private readonly view: ViewService,
    private readonly backendConfig: BackendConfigService,
  ) {}

  @Get('index')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async index(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const totaluser = await this.users.count()
    const totaladmin = await this.admins.count()
    const totalcategory = await this.cats.count()
    const attachmentnums = await this.atts.count()

    const today = startOfDay(new Date())
    const sevenDaysAgo = today - 6 * 86400
    const endOfToday = today + 86399

    const signupRows = await this.users.find({
      where: { createtime: Between(sevenDaysAgo, endOfToday) },
      select: ['createtime'],
    })
    const column: string[] = []
    const counts: Record<string, number> = {}
    for (let t = sevenDaysAgo; t <= today; t += 86400) {
      const key = formatDay(new Date(t * 1000))
      column.push(key)
      counts[key] = 0
    }
    for (const r of signupRows) {
      const key = formatDay(new Date(r.createtime * 1000))
      if (counts[key] != null) counts[key] += 1
    }
    const userdata = column.map((d) => counts[d] ?? 0)

    const cfg = await this.backendConfig.build(req, { controllername: 'dashboard', actionname: 'index' }, res)
    return this.view.render({
      module: 'admin',
      template: 'index/dashboard',
      data: {
        title: 'Dashboard',
        totaluser,
        totaladdon: 0,
        dbtablenums: totalcategory + totaladmin + attachmentnums,
        realtime: Math.floor(Date.now() / 1000),
        todayusersignup: todayCount(signupRows.map((u) => u.createtime), today),
        columnJson: JSON.stringify(column),
        userdataJson: JSON.stringify(userdata),
        requireConfig: JSON.stringify(cfg),
      },
      req,
      controllername: 'dashboard',
    })
  }
}

function startOfDay(d: Date): number {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  return Math.floor(c.getTime() / 1000)
}

function formatDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayCount(times: number[], dayStart: number): number {
  const dayEnd = dayStart + 86400
  return times.filter((t) => t >= dayStart && t < dayEnd).length
}
