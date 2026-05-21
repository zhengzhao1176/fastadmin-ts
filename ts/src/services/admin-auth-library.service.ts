// Centralizes admin role/rule lookups previously duplicated across the
// auth/* controllers + AdminAuthGuard. Mirrors the PHP `app\admin\library\Auth`
// + `fast\Auth` surface (only the methods we need today).
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, In } from 'typeorm'
import { AdminEntity } from '../entities/admin.entity.ts'
import { AuthGroupEntity } from '../entities/auth-group.entity.ts'
import { AuthGroupAccessEntity } from '../entities/auth-group-access.entity.ts'
import { AuthRuleEntity } from '../entities/auth-rule.entity.ts'

export interface SidebarPayload {
  menulist: Array<Record<string, unknown>>
  navlist: Array<Record<string, unknown>>
}

@Injectable()
export class AdminAuthLibrary {
  constructor(
    @InjectRepository(AdminEntity) private readonly admins: Repository<AdminEntity>,
    @InjectRepository(AuthGroupEntity) private readonly groups: Repository<AuthGroupEntity>,
    @InjectRepository(AuthGroupAccessEntity) private readonly access: Repository<AuthGroupAccessEntity>,
    @InjectRepository(AuthRuleEntity) private readonly rules: Repository<AuthRuleEntity>,
  ) {}

  /** True iff any of the admin's groups has `rules = '*'`. */
  async isSuperAdmin(adminId: number): Promise<boolean> {
    const groupIds = await this.getGroupIds(adminId)
    if (groupIds.length === 0) return false
    const grp = await this.groups.findOne({ where: { id: In(groupIds), rules: '*' } })
    return !!grp
  }

  /** Group rows the admin belongs to (filtered to status=normal). */
  async getGroups(adminId: number): Promise<AuthGroupEntity[]> {
    const groupIds = await this.getGroupIds(adminId)
    if (groupIds.length === 0) return []
    return this.groups.find({ where: { id: In(groupIds), status: 'normal' } })
  }

  async getGroupIds(adminId: number): Promise<number[]> {
    const rows = await this.access.find({ where: { uid: adminId } })
    return rows.map((r) => r.group_id)
  }

  /** Raw rule IDs (strings) collected across the admin's groups, with '*' kept verbatim. */
  async getRuleIds(adminId: number): Promise<string[]> {
    const groups = await this.getGroups(adminId)
    const out = new Set<string>()
    for (const g of groups) {
      for (const part of (g.rules ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
        out.add(part)
      }
    }
    return Array.from(out)
  }

  /** Rule NAMES (lowercased) the admin can hit. Returns ['*'] for super. */
  async getRuleList(adminId: number): Promise<string[]> {
    const ids = await this.getRuleIds(adminId)
    if (ids.includes('*')) return ['*']
    const numeric = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    if (numeric.length === 0) return []
    const rows = await this.rules.find({ where: { id: In(numeric), status: 'normal' } })
    return rows.map((r) => (r.name ?? '').toLowerCase())
  }

  /** Admin ids visible/manageable by `adminId`. Super → all admins. Non-super → admins in the same descending group tree (optionally excluding self). */
  async getChildrenAdminIds(adminId: number, withself = false): Promise<number[]> {
    if (await this.isSuperAdmin(adminId)) {
      const all = await this.admins.find({ select: ['id'] })
      return all.map((a) => a.id)
    }
    const groupIds = await this.getChildrenGroupIds(adminId, true)
    if (groupIds.length === 0) return []
    const access = await this.access.find({ where: { group_id: In(groupIds) } })
    const ids = Array.from(new Set(access.map((a) => a.uid)))
    return withself ? ids : ids.filter((id) => id !== adminId)
  }

  /** Group ids descending from the caller's groups. Super → all groups. */
  async getChildrenGroupIds(adminId: number, withself = false): Promise<number[]> {
    if (await this.isSuperAdmin(adminId)) {
      const all = await this.groups.find({ select: ['id'] })
      return all.map((g) => g.id)
    }
    const myGroupIds = await this.getGroupIds(adminId)
    if (myGroupIds.length === 0) return []
    const allGroups = await this.groups.find()
    const out = new Set<number>(withself ? myGroupIds : [])
    let frontier = [...myGroupIds]
    while (frontier.length > 0) {
      const next: number[] = []
      for (const g of allGroups) {
        if (frontier.includes(g.pid) && !out.has(g.id)) {
          out.add(g.id)
          next.push(g.id)
        }
      }
      frontier = next
    }
    return Array.from(out)
  }

  /** PHP-style URL/rule check: walk the rule-name set, return true if `name` is in it. */
  async check(name: string, adminId: number): Promise<boolean> {
    const list = await this.getRuleList(adminId)
    if (list.includes('*')) return true
    return list.includes(name.toLowerCase())
  }

  /** Build {menulist, navlist} for the dashboard refreshmenu action. */
  async getSidebar(adminId: number): Promise<SidebarPayload> {
    const ruleNames = await this.getRuleList(adminId)
    const isSuper = ruleNames.includes('*')
    const all = await this.rules.find({ where: { status: 'normal', ismenu: 1 }, order: { weigh: 'DESC' } })
    const visible = isSuper ? all : all.filter((r) => ruleNames.includes((r.name ?? '').toLowerCase()))
    const menulist = visible.map((r) => ({
      id: r.id,
      pid: r.pid,
      name: r.name,
      title: r.title,
      icon: r.icon,
      url: r.url,
      ismenu: r.ismenu,
    }))
    const navlist = menulist.filter((m) => Number(m.pid) === 0)
    return { menulist, navlist }
  }
}
