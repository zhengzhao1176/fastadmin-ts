// @NoNeedRight(['action1', 'action2']) or @NoNeedRight(['*']) declares actions
// (or '*' for the entire controller) that bypass per-rule RBAC enforcement.
// Mirrors PHP's `$noNeedRight` property on Backend subclasses.
import { SetMetadata } from '@nestjs/common'

export const NO_NEED_RIGHT_META = 'fastadmin:noNeedRight'

export const NoNeedRight = (actions: string[]): ClassDecorator & MethodDecorator =>
  SetMetadata(NO_NEED_RIGHT_META, actions) as ClassDecorator & MethodDecorator
