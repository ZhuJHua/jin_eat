/**
 * 签文 copy bank: 100% local, deterministic per (date, restaurant, level).
 *
 * Hard limits (enforced by fortunes.test.ts):
 * - every poem line is exactly 7 Han characters, no punctuation;
 * - 解曰 ≤ 30 characters after `{name}` is filled with an 8-character name;
 * - 宜 ≤ 8 characters, 忌 ≤ 10 characters.
 */
import type { DrawResult, FortuneCopy, LevelId, Restaurant } from '@/types';
import { CFG } from '@/config';
import { charLen, canonicalId } from '@/data/restaurants';
import { parseDayKey } from '@/lib/date';
import { sfc32FromString, uniformInt, uniformFloat, type RandomSource } from '@/lib/rng';

export const LEVELS: Record<LevelId, { label: string; short: string }> = {
  shangshang: { label: '上上签', short: '上上' },
  shang: { label: '上签', short: '上' },
  zhongji: { label: '中吉签', short: '中吉' },
  xiaoji: { label: '小吉签', short: '小吉' },
  xiaxia: { label: '下下签·但依然好吃', short: '下下' },
};

/** Fixed roll order for level picks (team-mode determinism depends on it). */
export const LEVEL_ORDER: readonly LevelId[] = ['shangshang', 'shang', 'zhongji', 'xiaoji', 'xiaxia'];

export interface RestaurantCopy {
  poems: string[][];
  jie: string[];
  yi?: string[];
  ji?: string[];
}

export const RESTAURANT_COPY: Record<string, RestaurantCopy> = {
  xiaogu: {
    poems: [
      ['小谷灶前烟火暖', '姐姐掌勺味道鲜', '一碗家常胜珍馐', '锦少点头众人前'],
      ['姐姐炒菜不看谱', '一把葱花一把盐', '吃出妈妈当年味', '工位思乡泪涟涟'],
      ['家常小炒最熨帖', '番茄炒蛋拌米饭', '姐姐笑问够不够', '锦少举手要加饭'],
    ],
    jie: [
      '姐姐的饭，吃的是人情味。',
      '家常菜治百病，尤其治周一。',
      '姐姐说多吃点，这是命令不是建议。',
      '今日宜回家，回不去就去{name}。',
      '吃完记得夸一句姐姐，下次肉多两块。',
      '外面山珍海味，不如姐姐一盘青菜。',
    ],
    yi: ['夸姐姐手艺', '添一碗饭', '吃到光盘'],
    ji: ['嫌菜太家常', '说外卖更香', '剩饭'],
  },
  hmj: {
    poems: [
      ['金汤一碗暖人心', '米饭三碗不嫌多', '锦少举筷众人随', '今日此签定乾坤'],
      ['砂锅咕嘟冒金泡', '土豆香菇陪鸡跳', '酱汁拌饭第三碗', '体重秤前莫要恼'],
      ['黄焖鸡米饭一份', '微辣中辣随你选', '青椒多放汤多给', '吃完开会不打盹'],
    ],
    jie: [
      '酱汁拌饭第三碗，锦少不负责体重。',
      '鸡是黄焖的，心情是晴朗的。',
      '汤汁要拌饭，这是祖训。',
      '一锅焖鸡，焖住了你所有的烦恼。',
      '微辣是谦虚，中辣是态度。',
      '吃黄焖鸡不加饭，等于白来。',
    ],
    yi: ['汤汁拌饭', '加土豆', '多要一碗饭'],
    ji: ['把汤剩下', '只吃鸡不吃饭'],
  },
  plaza: {
    poems: [
      ['百家摊档聚一堂', '南甜北咸任君尝', '选择困难今可解', '一层楼里有天堂'],
      ['转了三圈没决定', '锦少一签指迷津', '左手麻辣右手烫', '托盘端起即人生'],
      ['广场虽大胃有限', '档口阿姨认得你', '今日不问吃什么', '签到哪家坐哪家'],
    ],
    jie: [
      '签已替你选了楼层，摊位自己选。',
      '选择困难者的终极归宿，就是这里。',
      '每个档口都在等你，但你只有一个胃。',
      '先占座，再选饭，这是广场生存法则。',
      '转三圈还没决定的，回来再摇一签。',
      '各吃各的，同桌即是缘分。',
    ],
    yi: ['先占座', '拼桌', '各点各的'],
    ji: ['逛三圈不点', '排最长的队'],
  },
  datong: {
    poems: [
      ['大同世界饭香飘', '天下饥肠此处消', '锦少一声开炫令', '筷落盘空乐逍遥'],
      ['天下大同饭量同', '一桌八人一条心', '菜来先拍再动筷', '盘子见底才收工'],
      ['大同不分你我他', '转盘一转见真章', '抢菜要快夹要稳', '锦少只管点菜忙'],
    ],
    jie: [
      '此签主团结，一桌人一条心。',
      '天下大同，AA也同。',
      '转盘转到谁面前，谁就是今天的幸运儿。',
      '一桌人吃饭，吃的是团队凝聚力。',
      '大同之道：好菜共享，账单均分。',
      '人多点菜才有排面，去{name}。',
    ],
    yi: ['叫上全组', '转盘慢点转', '多点两个菜'],
    ji: ['独占转盘', '夹最后一块'],
  },
  gaima: {
    poems: [
      ['一勺浇头盖满碗', '汤汁渗饭粒粒香', '帮主今日亲赐座', '拌匀开吃莫彷徨'],
      ['辣椒炒肉盖码饭', '湘味一勺上天堂', '拌饭讲究底朝天', '一粒不剩是礼貌'],
      ['盖码帮里论英雄', '浇头厚薄见高低', '加个煎蛋添福气', '下午需求也能扛'],
    ],
    jie: [
      '浇头要拌匀，人生才圆满。',
      '一碗盖码饭，解决一切选择题。',
      '加个煎蛋，今天就是好日子。',
      '饭在下，菜在上，锦少在心中。',
      '入帮不问出处，只问要不要加辣。',
      '浇头盖得满，KPI完成得满。',
    ],
    yi: ['加个煎蛋', '拌匀再吃', '浇头多要'],
    ji: ['不拌就吃', '浇头分开放'],
  },
  jxxc: {
    poems: [
      ['江西辣椒不讲理', '小炒锅气冲九霄', '一口米饭一口辣', '下午开会不犯困'],
      ['锅气升腾满堂红', '辣椒炒肉是正宗', '嘴上喊辣筷不停', '一碗米饭不够用'],
      ['小炒一盘火候足', '辣得额头冒细珠', '纸巾备好莫慌张', '吃完灵感如泉涌'],
    ],
    jie: [
      '辣得清醒，下午需求一次过。',
      '辣是礼貌，不辣是见外。',
      '吃完嘴唇微肿，正是灵感充沛之相。',
      '江西人说微辣，你要做好心理准备。',
      '锅气即运气，今天手气不会差。',
      '辣到流泪不丢人，那是感动。',
    ],
    yi: ['备好纸巾', '点辣椒炒肉', '配冰豆浆'],
    ji: ['逞强说不辣', '吃完立刻开会'],
  },
  jianggu: {
    poems: [
      ['骨头越犟肉越香', '啃得满手是荣光', '锦少教你人生理', '硬骨头里藏柔肠'],
      ['一锅骨头堆成山', '手套一戴不顾颜', '吸管一插吸骨髓', '啃完才知人生甜'],
      ['产品需求犟又硬', '不如骨头来得香', '啃完满嘴油光亮', '回去优雅改方案'],
    ],
    jie: [
      '啃得越犟，下午越强。',
      '人生就是啃硬骨头，今天先啃这一锅。',
      '戴好手套，放下形象，开啃。',
      '骨头再犟也犟不过你，需求同理。',
      '吸到骨髓的那一刻，你就悟了。',
      '今天适合跟难题死磕，先从骨头开始。',
    ],
    yi: ['戴手套开啃', '吸骨髓', '放下形象'],
    ji: ['穿白衬衫', '约会前吃'],
  },
  daoxiang: {
    poems: [
      ['稻米飘香满庭前', '一桌好菜聚群贤', '锦少举杯说今日', '吃饱再把需求谈'],
      ['稻香一缕绕工位', '米饭晶莹似珍珠', '小菜几碟最下饭', '回味无穷到下午'],
      ['粒粒皆是辛苦来', '稻香饭香满楼台', '莫负锦少一番意', '吃饱喝足好发财'],
    ],
    jie: [
      '稻花香里说丰年，听取工资少一片。',
      '米饭是主角，菜是配角，你是主角的主人。',
      '今日饭香，宜慢慢吃，别想KPI。',
      '吃一口米饭，想一想年终奖。',
      '丰年不远，先把这顿吃好。',
      '稻香里没有加班，只有饭。',
    ],
    yi: ['慢慢吃', '多盛一碗', '饭后散步'],
    ji: ['狼吞虎咽', '边吃边回消息'],
  },
  xbf: {
    poems: [
      ['西北风起面条长', '羊肉泡馍满口香', '别人喝风我吃面', '锦少带队胃不慌'],
      ['一根面条长又长', '拉出西北好风光', '油泼辣子香满屋', '吃完回去写文档'],
      ['月底钱包空荡荡', '西北风里有面香', '肉夹馍加个鸡蛋', '喝风也能喝得爽'],
    ],
    jie: [
      '喝西北风？不，是吃西北风。',
      '月底了，喝西北风也要喝得体面。',
      '面条够长，下午的会议也不怕长。',
      '油泼辣子一勺，烦恼泼得干干净净。',
      '泡馍要自己掰，人生要自己选。',
      '别人喝风，你吃面，这就是差距。',
    ],
    yi: ['加一勺油泼辣子', '掰馍', '加个肉夹馍'],
    ji: ['嫌面太长', '穿浅色衣服'],
  },
};

/** 7-character lines for custom restaurants (and variety). */
export const GENERIC_POEM_LINES: string[] = [
  '饥肠辘辘问苍天',
  '锦少掐指算一番',
  '莫问前程问午餐',
  '一签在手胃无忧',
  '人间烟火最抚心',
  '筷落之处皆是福',
  '吃饱方能写需求',
  '此去饭香三百里',
  '十一点半心已飞',
  '工位饥饿难思考',
  '午饭乃是头等事',
  '锦少一签解千愁',
  '莫让纠结饿肚肠',
  '天机已泄在签中',
  '群里吵了半小时',
  '不如签筒摇一摇',
  '签筒一摇万事定',
  '饭点不等犹豫人',
  '吃完再把代码敲',
  '人生苦短先吃饭',
  '减肥计划明天说',
  '一顿好饭顶三天',
  '会议纪要先放下',
  '打卡之后先觅食',
  '电梯排队莫着急',
  '钱包虽瘦心不瘦',
  '米饭管够是真爱',
  '天意如此莫抗拒',
  '筷子已在手中握',
  '一口热饭暖心田',
  '周报写完再加餐',
  '锦少点名你别躲',
  '摸鱼不如去吃鱼',
  '需求再多也得吃',
  '早饭没吃午饭补',
  '咕噜一声肚在喊',
  '老板画饼不顶饿',
  '真饼还得自己吃',
  '今日运势在饭碗',
  '香气飘过三条街',
  '同事已在电梯口',
  '外卖软件先关掉',
  '纠结十分不如签',
  '一签既出驷马追',
  '吃饭不忘锦少恩',
  '饭后一觉似神仙',
  '午后需求一次过',
  '人是铁来饭是钢',
];

/** Level-specific closing line (generic poems always end with one). */
export const LEVEL_CLOSERS: Record<LevelId, string[]> = {
  shangshang: ['上上大吉开炫时', '此签上上福满盈', '天时地利饭也香', '上上之签必加饭', '今日运势饭碗旺'],
  shang: ['上签在手莫迟疑', '此去必得好滋味', '吉签一出饭自香', '一路顺风到饭堂'],
  zhongji: ['中吉中吉刚刚好', '不咸不淡也是福', '中庸之道在饭中', '平平稳稳吃一顿'],
  xiaoji: ['小吉亦吉莫嫌少', '小小确幸在碗中', '吃饱就是小确幸', '小吉在手饭照香'],
  xiaxia: ['签虽下下饭照香', '下下签挡不住馋', '下下之签依然香', '运势虽低胃口高'],
};

/** Generic 解曰 templates; `{name}` is the restaurant name (≤ 8 chars). */
export const GENERIC_JIE: string[] = [
  '此签大吉，宜加饭，忌减肥。',
  '锦少已替你算过：吃完不困。',
  '去{name}，路上别犹豫。',
  '天意难违，{name}在召唤你。',
  '饭点已到，{name}的门为你开着。',
  '纠结是最大的浪费，去{name}吧。',
  '锦少夜观天象，今日宜{name}。',
  '此签一出，群聊可以安静了。',
  '吃饱了才有力气改需求。',
  '今日{name}，明日再议。',
  '少问几句吃什么，多吃几口饭。',
  '{name}与你有缘，莫辜负。',
  '午饭定了，下午的锅也就不怕了。',
  '吃饭要趁热，决定要趁早。',
  '锦少说了算，散会，去{name}。',
  '此签无解，唯有开炫。',
  '心中所想，正是{name}。',
  '签中自有黄金屋，签中自有{name}。',
  '你的胃已经替你投了票。',
  '不要问锦少为什么，问就是天意。',
  '去{name}的路上，记得叫上同事。',
  '饭吃七分饱，需求做十分。',
  '今天中午，{name}就是答案。',
  '吃完记得在群里汇报，锦少要验收。',
  '此签宜早不宜迟，再晚就排队了。',
  '锦少掐指一算：你饿了。',
  '吃饭不积极，下午没力气。',
  '选择已做，剩下的交给筷子。',
  '会议可以改期，午饭不行。',
  '吃饱了，世界都温柔了。',
  '今日锦少不坑你，放心去{name}。',
  '这一签，是你上周的福报。',
  '{name}今天出餐快，天助你也。',
  '吃完不准喊困，锦少看着呢。',
  '人生没有标准答案，午饭有：{name}。',
  '跟着签走，胃不会骗人。',
  '此签主口福，宜呼朋引伴。',
  '打工人的快乐，就是按时开饭。',
  '天上不会掉馅饼，但{name}有饭。',
  '少看一眼外卖软件，多走两步到店。',
];

/** Prepended for 上上签 (only when the result still fits 30 chars). */
export const SHANGSHANG_PREFIX: string[] = ['上上大吉！', '鸿运当头，', '锦少亲批：', '大吉大利，'];

/** 解曰 for 下下签 (replaces the normal pool). */
export const XIAXIA_JIE: string[] = [
  '签虽下下，饭照样香。',
  '此签不宜外出，建议点外卖（但还是去{name}吧）。',
  '下下签？锦少说了，好吃不看签。',
  '运势触底，只能反弹，先吃饱再说。',
  '下下签保底机制已触发：依然好吃。',
  '签运一般，饭运满分。',
  '下下签也要吃饭，这叫逆天改命。',
];

/** Weekday-flavoured extras (0 = Sunday … 6 = Saturday) mixed into the generic pool. */
export const WEEKDAY_JIE: Partial<Record<number, string[]>> = {
  1: ['周一综合症，一顿{name}可解。', '周一宜吃好，一周才有盼头。'],
  3: ['周三过半，奖励自己一顿{name}。'],
  5: ['周五了，{name}配奶茶，罪恶感减半。', '周五宜放纵，减肥下周一再说。'],
};

/** 锦少请客签 overrides. */
export const TREAT_COPY = { jie: '今日锦少买单（解释权归锦少所有）', yi: '点贵的' } as const;

export const YI_POOL: string[] = [
  '加饭',
  '加辣',
  '拍照发群',
  '让锦少买单',
  '多叫一个人',
  '饭后散步',
  '点招牌菜',
  '光盘行动',
  '慢慢吃',
  '准时下楼',
  '加个蛋',
  '夸老板手艺',
  '带上饭搭子',
  '饭后奶茶',
  '大声说好吃',
  '吃完午睡',
  '再来一碗',
  '分享给邻座',
  '坐窗边',
  '给锦少带一份',
];

export const JI_POOL: string[] = [
  '减肥',
  '下午开会前吃蒜',
  '说「随便」',
  '饭后立刻开会',
  '边吃边改需求',
  '吃饭看工作群',
  '纠结超过五分钟',
  '一个人偷偷吃',
  '剩饭',
  '跟锦少抢菜',
  '空腹喝奶茶',
  '饭后剧烈运动',
  '点了又说不饿',
  '吃到一半回工位',
  '质疑签文',
  '说「都行」',
  '饿着肚子写周报',
  '点外卖等一小时',
  '跟老板拼桌',
  '在群里问吃什么',
];

// ───────────────────────────── composition ─────────────────────────────

const fill = (tpl: string, name: string): string => tpl.split('{name}').join(name);

function pickOne<T>(arr: readonly T[], src: RandomSource): T {
  return arr[uniformInt(arr.length, src)]!;
}

/** Pick k distinct items (partial Fisher–Yates on a copy). */
function pickDistinct<T>(arr: readonly T[], k: number, src: RandomSource): T[] {
  const a = arr.slice();
  const n = Math.min(k, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + uniformInt(a.length - i, src);
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a.slice(0, n);
}

function avoidRecent(pool: string[], recent: ReadonlySet<string>): string[] {
  const kept = pool.filter((s) => !recent.has(s));
  return kept.length > 0 ? kept : pool;
}

const fits = (s: string, max: number): boolean => charLen(s) <= max;

const normalizeCopyName = (name: string): string => name.replace(/\s+/g, ' ').trim();

/**
 * Deterministic local copy. Seeded by `date|restaurantId|level`, so the same draw shows the same
 * copy all day and team mode (callers pass `recentJie: []`) is identical on every device.
 */
export function composeLocalCopy(args: { draw: DrawResult; restaurant: Restaurant; recentJie: string[] }): FortuneCopy {
  const { draw, restaurant } = args;
  const name = restaurant.name;
  const level = draw.level;
  // Team mode seeds from the name (which the team signature hashes), not the device-local id, so
  // hand-added restaurants read the same on every colleague's phone.
  const key = draw.team ? normalizeCopyName(draw.restaurantName) : draw.restaurantId;
  const src = sfc32FromString(`${draw.date}|${key}|${level}`);
  const rc = RESTAURANT_COPY[canonicalId(restaurant)];
  const recent = new Set(args.recentJie);

  // Poem: the restaurant's own (most of the time), or 3 generic lines + a level closer.
  let poem: [string, string, string, string];
  const useOwn = rc !== undefined && rc.poems.length > 0 && uniformFloat(src) < 0.8;
  const own = rc ? pickOne(rc.poems, src) : null;
  const generic = pickDistinct(GENERIC_POEM_LINES, 3, src);
  const closer = pickOne(LEVEL_CLOSERS[level], src);
  if (useOwn && own && own.length === 4) {
    poem = [own[0]!, own[1]!, own[2]!, own[3]!];
  } else {
    poem = [generic[0]!, generic[1]!, generic[2]!, closer];
  }

  // 解曰
  const weekday = parseDayKey(draw.date).getDay();
  const genericPool = [...GENERIC_JIE, ...(WEEKDAY_JIE[weekday] ?? [])].map((t) => fill(t, name));
  const ownPool = (rc?.jie ?? []).map((t) => fill(t, name));
  const preferOwn = uniformFloat(src) < 0.6;
  const prefixRoll = pickOne(SHANGSHANG_PREFIX, src);
  let jie: string;
  if (level === 'xiaxia') {
    const pool = avoidRecent(
      XIAXIA_JIE.map((t) => fill(t, name)).filter((s) => fits(s, CFG.limits.jieMax)),
      recent,
    );
    jie = pool.length > 0 ? pickOne(pool, src) : '签虽下下，饭照样香。';
  } else {
    const ownOk = avoidRecent(
      ownPool.filter((s) => fits(s, CFG.limits.jieMax)),
      recent,
    );
    const genOk = avoidRecent(
      genericPool.filter((s) => fits(s, CFG.limits.jieMax)),
      recent,
    );
    const pool = preferOwn && ownOk.length > 0 ? ownOk : genOk.length > 0 ? genOk : ownOk;
    jie = pool.length > 0 ? pickOne(pool, src) : '此签大吉，宜加饭，忌减肥。';
    if (level === 'shangshang' && fits(prefixRoll + jie, CFG.limits.jieMax)) jie = prefixRoll + jie;
  }

  // 宜 / 忌
  const yiPool = [...(rc?.yi ?? []), ...YI_POOL].filter((s) => fits(s, CFG.limits.yiMax));
  const jiPool = [...(rc?.ji ?? []), ...JI_POOL].filter((s) => fits(s, CFG.limits.jiMax));
  let yi = pickOne(yiPool, src);
  const ji = pickOne(jiPool, src);

  if (draw.treat) {
    jie = TREAT_COPY.jie;
    yi = TREAT_COPY.yi;
  }

  return { poem, jie, yi, ji, source: 'local' };
}
