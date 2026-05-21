// Port of `fast\Pinyin` from extend/fast/Pinyin.php — Chinese-to-pinyin.
// PHP delegates to the Overtrue\Pinyin library; here we use a compact
// built-in map covering a few hundred common GB2312 characters. Characters
// not in the map pass through unchanged (also matching the library's
// behaviour for non-CJK input).

// Common-character → pinyin map. Tone marks are dropped (toned syllables are
// reduced to their plain ASCII form), which is what `permalink()`/`abbr()`
// effectively produce. Keep this list small but practical: digits of the
// FastAdmin UI strings, surnames and high-frequency words are covered.
const PINYIN_MAP: Record<string, string> = {
  中: 'zhong', 国: 'guo', 人: 'ren', 大: 'da', 小: 'xiao', 上: 'shang',
  下: 'xia', 左: 'zuo', 右: 'you', 天: 'tian', 地: 'di', 日: 'ri',
  月: 'yue', 年: 'nian', 时: 'shi', 分: 'fen', 秒: 'miao', 我: 'wo',
  你: 'ni', 他: 'ta', 她: 'ta', 们: 'men', 的: 'de', 是: 'shi',
  在: 'zai', 有: 'you', 不: 'bu', 了: 'le', 和: 'he', 与: 'yu',
  好: 'hao', 一: 'yi', 二: 'er', 三: 'san', 四: 'si', 五: 'wu',
  六: 'liu', 七: 'qi', 八: 'ba', 九: 'jiu', 十: 'shi', 零: 'ling',
  百: 'bai', 千: 'qian', 万: 'wan', 个: 'ge', 多: 'duo', 少: 'shao',
  名: 'ming', 字: 'zi', 号: 'hao', 码: 'ma', 密: 'mi', 用: 'yong',
  户: 'hu', 登: 'deng', 录: 'lu', 注: 'zhu', 册: 'ce', 退: 'tui',
  出: 'chu', 入: 'ru', 管: 'guan', 理: 'li', 员: 'yuan', 系: 'xi',
  统: 'tong', 设: 'she', 置: 'zhi', 添: 'tian', 加: 'jia', 删: 'shan',
  除: 'chu', 修: 'xiu', 改: 'gai', 编: 'bian', 辑: 'ji', 查: 'cha',
  看: 'kan', 搜: 'sou', 索: 'suo', 列: 'lie', 表: 'biao', 详: 'xiang',
  情: 'qing', 操: 'cao', 作: 'zuo', 保: 'bao', 存: 'cun', 取: 'qu',
  消: 'xiao', 确: 'que', 认: 'ren', 提: 'ti', 交: 'jiao', 返: 'fan',
  回: 'hui', 首: 'shou', 页: 'ye', 内: 'nei', 容: 'rong', 标: 'biao',
  题: 'ti', 文: 'wen', 章: 'zhang', 类: 'lei', 别: 'bie', 状: 'zhuang',
  态: 'tai', 创: 'chuang', 建: 'jian', 更: 'geng', 新: 'xin', 数: 'shu',
  据: 'ju', 库: 'ku', 信: 'xin', 息: 'xi', 通: 'tong', 知: 'zhi',
  消息: 'xiaoxi', 邮: 'you', 件: 'jian', 发: 'fa', 送: 'song', 收: 'shou',
  到: 'dao', 成: 'cheng', 功: 'gong', 失: 'shi', 败: 'bai', 错: 'cuo',
  误: 'wu', 警: 'jing', 告: 'gao', 请: 'qing', 求: 'qiu', 响: 'xiang',
  应: 'ying', 服: 'fu', 务: 'wu', 客: 'ke', 端: 'duan', 网: 'wang',
  站: 'zhan', 链: 'lian', 接: 'jie', 地址: 'dizhi', 路: 'lu', 径: 'jing',
  参: 'can', 配: 'pei', 项: 'xiang', 值: 'zhi', 默: 'mo', 选: 'xuan',
  必: 'bi', 填: 'tian', 空: 'kong', 间: 'jian', 图: 'tu', 片: 'pian',
  视: 'shi', 频: 'pin', 音: 'yin', 声: 'sheng', 颜: 'yan', 色: 'se',
  红: 'hong', 黄: 'huang', 蓝: 'lan', 绿: 'lv', 黑: 'hei', 白: 'bai',
  开: 'kai', 关: 'guan', 启: 'qi', 停: 'ting', 止: 'zhi', 始: 'shi',
  结: 'jie', 束: 'shu', 前: 'qian', 后: 'hou', 中间: 'zhongjian',
  东: 'dong', 西: 'xi', 南: 'nan', 北: 'bei', 高: 'gao', 低: 'di',
  长: 'chang', 短: 'duan', 宽: 'kuan', 窄: 'zhai', 厚: 'hou', 薄: 'bao',
  快: 'kuai', 慢: 'man', 早: 'zao', 晚: 'wan', 现: 'xian', 今: 'jin',
  昨: 'zuo', 明: 'ming', 周: 'zhou', 季: 'ji', 度: 'du', 期: 'qi',
  生: 'sheng', 死: 'si', 活: 'huo', 动: 'dong', 静: 'jing', 工: 'gong',
  司: 'si', 部: 'bu', 门: 'men', 组: 'zu', 团: 'tuan', 队: 'dui',
  会: 'hui', 议: 'yi', 主: 'zhu', 副: 'fu', 总: 'zong', 经: 'jing',
  助: 'zhu', 学: 'xue', 校: 'xiao', 师: 'shi', 教: 'jiao', 课: 'ke',
  班: 'ban', 级: 'ji', 试: 'shi', 考: 'kao', 成绩: 'chengji', 题目: 'timu',
  答: 'da', 案: 'an', 问: 'wen', 卷: 'juan', 评: 'ping', 论: 'lun',
  分享: 'fenxiang', 喜: 'xi', 欢: 'huan', 爱: 'ai', 恨: 'hen', 笑: 'xiao',
  哭: 'ku', 钱: 'qian', 价: 'jia', 格: 'ge', 买: 'mai', 卖: 'mai',
  商: 'shang', 品: 'pin', 订: 'ding', 单: 'dan', 购: 'gou', 物: 'wu',
  车: 'che', 库存: 'kucun', 货: 'huo', 仓: 'cang', 运: 'yun', 输: 'shu',
  快递: 'kuaidi', 包: 'bao', 裹: 'guo', 退货: 'tuihuo', 换: 'huan',
  支: 'zhi', 付: 'fu', 款: 'kuan', 微: 'wei', 宝: 'bao', 银: 'yin',
  行: 'hang', 卡: 'ka', 转: 'zhuan', 账: 'zhang', 余: 'yu', 额: 'e',
  充: 'chong', 值钱: 'zhiqian', 积: 'ji', 分类: 'fenlei', 优: 'you',
  惠: 'hui', 券: 'quan', 折: 'zhe', 扣: 'kou', 活动: 'huodong',
  权: 'quan', 限: 'xian', 限制: 'xianzhi', 角: 'jue', 验: 'yan',
  证: 'zheng', 安: 'an', 全: 'quan', 锁: 'suo', 解: 'jie',
  备: 'bei', 注释: 'zhushi', 描: 'miao', 述: 'shu', 显: 'xian',
  示: 'shi', 隐: 'yin', 藏: 'cang', 排: 'pai', 序: 'xu', 选项: 'xuanxiang',
}

/** Pinyin of one character, or `undefined` if not in the map. */
function charPinyin(ch: string): string | undefined {
  return PINYIN_MAP[ch]
}

/** True for a character in the CJK Unified Ideographs block. */
function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return code >= 0x4e00 && code <= 0x9fff
}

/**
 * Tokenise a string into pinyin syllables. Each mapped Chinese character
 * becomes one token; a run of contiguous non-CJK characters (e.g. an ASCII
 * word) is kept together as a single token. Unmapped CJK / whitespace is
 * dropped, like the library's `permalink()`.
 */
function tokenize(chinese: string): string[] {
  const out: string[] = []
  let buffer = ''
  const flush = () => {
    if (buffer.trim() !== '') out.push(buffer)
    buffer = ''
  }
  for (const ch of chinese) {
    const py = charPinyin(ch)
    if (py) {
      flush()
      out.push(py)
    } else if (isCjk(ch)) {
      // Unmapped Chinese char: acts as a separator.
      flush()
    } else if (/\s/.test(ch)) {
      flush()
    } else {
      buffer += ch
    }
  }
  flush()
  return out
}

/**
 * Convert Chinese characters to delimiter-joined pinyin. Mapped characters
 * are replaced with their syllable; contiguous non-CJK text passes through
 * as a single token.
 *
 *   toPinyin('中国')   // 'zhong guo'
 *   toPinyin('abc中')  // 'abc zhong'
 */
export function toPinyin(chinese: string, delimiter = ' '): string {
  return tokenize(chinese).join(delimiter)
}

/**
 * First letter of each token's pinyin (an "abbreviation").
 * Non-CJK words contribute their own first character.
 *
 *   firstLetter('中国') // 'zg'
 */
export function firstLetter(chinese: string, delimiter = ''): string {
  return tokenize(chinese)
    .map((t) => t.charAt(0))
    .filter(Boolean)
    .join(delimiter)
}

/**
 * General-purpose entry point mirroring PHP `Pinyin::get()`.
 * @param onlyFirst return first-letter abbreviation instead of full pinyin
 * @param ucfirst   capitalise the first letter of each syllable
 */
export function get(
  chinese: string,
  onlyFirst = false,
  delimiter = '',
  ucfirst = false,
): string {
  let result = onlyFirst
    ? firstLetter(chinese, delimiter)
    : toPinyin(chinese, delimiter)
  if (ucfirst) {
    result = result
      .split(delimiter || ' ')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(delimiter || ' ')
  }
  return result
}
