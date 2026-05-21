// Port of `fast\Tree` from extend/fast/Tree.php. Only the slice the Category
// controller needs: init(), getChild(), getChildren(), getChildrenIds(),
// getTreeArray() and getTreeList(). Box-drawing chars + &nbsp; spacer match
// PHP byte-for-byte so the rendered name strings are identical.

export interface TreeNode {
  id: number
  pid?: number
  parent_id?: number
  [k: string]: unknown
}

export interface TreeListItem extends TreeNode {
  spacer: string
  haschild: 0 | 1
}

const ICON = ['│', '├', '└'] as const
const NBSP = '&nbsp;'

export class Tree<T extends TreeNode = TreeNode> {
  private arr: T[] = []
  private pidname: string = 'pid'

  init(arr: T[], pidname: string = 'pid'): this {
    this.arr = arr
    this.pidname = pidname
    return this
  }

  getChild(myid: number): T[] {
    return this.arr.filter((r) => Number((r as Record<string, unknown>)[this.pidname]) === Number(myid))
  }

  getChildren(myid: number, withself = false): T[] {
    const out: T[] = []
    for (const v of this.arr) {
      if (String((v as Record<string, unknown>)[this.pidname]) === String(myid)) {
        out.push(v)
        out.push(...this.getChildren(v.id, false))
      } else if (withself && String(v.id) === String(myid)) {
        out.push(v)
      }
    }
    return out
  }

  getChildrenIds(myid: number, withself = false): number[] {
    return this.getChildren(myid, withself).map((v) => v.id)
  }

  /**
   * Build the nested {node, childlist: [...]} array used to drive
   * indentation-aware flat rendering.
   */
  getTreeArray(myid: number, itemprefix: string = ''): Array<T & { spacer: string; childlist: unknown[] }> {
    const childs = this.getChild(myid)
    const total = childs.length
    const data: Array<T & { spacer: string; childlist: unknown[] }> = []
    let number = 1
    for (const value of childs) {
      let j: string
      let k: string
      if (number === total) {
        j = ICON[2]
        k = itemprefix ? NBSP : ''
      } else {
        j = ICON[1]
        k = itemprefix ? ICON[0] : ''
      }
      const spacer = itemprefix ? itemprefix + j : ''
      const nextPrefix = itemprefix + k + NBSP
      data.push({
        ...value,
        spacer,
        childlist: this.getTreeArray(value.id, nextPrefix),
      })
      number++
    }
    return data
  }

  /**
   * Flatten getTreeArray output: prepend the spacer to <field> and add
   * haschild=1 when childlist is non-empty.
   */
  getTreeList(
    data: ReturnType<Tree<T>['getTreeArray']>,
    field: string = 'name',
  ): TreeListItem[] {
    const out: TreeListItem[] = []
    for (const v of data) {
      const { childlist, ...rest } = v
      const indented = String((rest as Record<string, unknown>)[field] ?? '')
      const haschild: 0 | 1 = (childlist as unknown[]).length > 0 ? 1 : 0
      const item: TreeListItem = {
        ...(rest as TreeNode),
        spacer: rest.spacer,
        haschild,
      }
      ;(item as Record<string, unknown>)[field] = rest.spacer + ' ' + indented
      if (rest.id) out.push(item)
      if ((childlist as unknown[]).length > 0) {
        out.push(...this.getTreeList(childlist as ReturnType<Tree<T>['getTreeArray']>, field))
      }
    }
    return out
  }
}
