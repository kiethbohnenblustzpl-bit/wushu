/* 数据来源：《武术量化考核评分标准（中期考核试行版）》2026.9 制表
   文字与原表逐条一致，未作改写。 */
window.WUSHU_DATA = {
  meta: {
    title: "武术量化考核评分标准",
    edition: "中期考核试行版",
    issued: "2026.9 制表",
    total: 160,
    breakdown: [
      { name: "基本功", score: 120, note: "腿法、跳跃共 12 项，每项 10 分" },
      { name: "套路演练", score: 30, note: "五步拳、器械套路、拳术套路，每项 10 分" },
      { name: "平时分", score: 10, note: "训练出勤率、训练积极性，每项 5 分" }
    ],
    notes: [
      { source: "总表", text: "总分（160分）=基本功（120分）+套路演练（30分）+平时分（10分）。根据总分排名减免校园跑次数。" },
      { source: "表2 跳跃动作", text: "动作未完成按2分计算；外摆莲、旋风脚达540°加3分，达630°加5分。" }
    ]
  },

  categories: [
    { id: "leg", name: "腿法", table: "表1 基本功评分标准考核表", desc: "每项 10 分，共 6 项" },
    { id: "jump", name: "跳跃", table: "表2 跳跃动作评分标准表", desc: "每项 10 分，共 6 项" },
    { id: "routine", name: "套路演练", table: "总表", desc: "每项 10 分，共 3 项" },
    { id: "daily", name: "平时分", table: "总表", desc: "每项 5 分，共 2 项" }
  ],

  actions: [
    {
      name: "正踢腿",
      category: "leg",
      score: 10,
      reps: "8次（左右各4次）",
      alias: ["正踢", "zhengtitui", "ztt"],
      levels: [
        { score: 10, points: ["起踢腿跟过头顶或触额头，节奏分明，爆发力强"] },
        { score: 8, points: ["起踢腿跟过下巴，有较强爆发力与协调力"] },
        { score: 6, points: ["起踢腿尖过肩，有一定的节奏与爆发"] },
        { score: 4, points: ["踢腿未过肩，且无节奏感与力感"] }
      ],
      deduct: { rule: "每项1分，不累计扣分", items: ["支撑腿弯曲或脚跟离地", "踢击腿弯曲", "手臂弯曲", "掌型不达标", "未连续踢腿"] },
      note: ""
    },
    {
      name: "侧踢腿",
      category: "leg",
      score: 10,
      reps: "8次（左右各4次）",
      alias: ["侧踢", "cetitui", "ctt"],
      levels: [
        { score: 10, points: ["起踢腿跟过头顶或触额头，节奏分明，爆发力强"] },
        { score: 8, points: ["起踢腿跟过下巴，有较强爆发力与协调力"] },
        { score: 6, points: ["起踢腿尖过肩，有一定的节奏与爆发"] },
        { score: 4, points: ["踢腿未过肩，且无节奏感与力感"] }
      ],
      deduct: { rule: "每项1分，不累计扣分", items: ["支撑腿弯曲或脚跟离地", "踢击腿弯曲", "手臂弯曲", "掌型不达标", "未连续踢腿"] },
      note: ""
    },
    {
      name: "里合腿",
      category: "leg",
      score: 10,
      reps: "8次（左右各4次）",
      alias: ["里合", "lihetui", "lht"],
      levels: [
        { score: 10, points: ["起踢腿跟过下巴且抡腿明显，节奏分明，爆发力强"] },
        { score: 8, points: ["起踢腿跟过下巴且抡腿明显，有较强爆发力与协调力"] },
        { score: 6, points: ["起踢腿尖过肩且抡腿（向内）明显，有一定的节奏与爆发"] },
        { score: 4, points: ["踢腿未过肩或抡腿不明显，且无节奏感与力感"] }
      ],
      deduct: { rule: "每项1分，不累计扣分", items: ["支撑腿弯曲或脚跟离地", "踢击腿弯曲", "手臂弯曲", "掌型不达标", "未击响", "未连续踢腿", "摆腿幅度过小"] },
      note: ""
    },
    {
      name: "外摆腿",
      category: "leg",
      score: 10,
      reps: "8次（左右各4次）",
      alias: ["外摆", "waibaitui", "wbt"],
      levels: [
        { score: 10, points: ["起踢腿跟过下巴且抡腿明显，爆发力强"] },
        { score: 8, points: ["起踢腿跟过下巴且抡腿明显，有较强爆发力与协调力"] },
        { score: 6, points: ["起踢腿尖过肩且抡腿（向外）明显，有一定的节奏与爆发"] },
        { score: 4, points: ["踢腿未过肩或抡腿不明显，且无节奏感与力感"] }
      ],
      deduct: { rule: "每项1分，不累计扣分", items: ["支撑腿弯曲或脚跟离地", "踢击腿弯曲", "手臂弯曲", "掌型不达标", "未击响", "未连续踢腿", "摆腿幅度过小"] },
      note: ""
    },
    {
      name: "单拍脚+翻身拍地",
      category: "leg",
      score: 10,
      reps: "2次",
      alias: ["单拍脚", "翻身拍地", "拍脚", "danpaijiao", "dpj", "fanshenpaidi"],
      levels: [
        { score: 10, points: ["动作流畅，爆发强，节奏分明", "抡臂充分", "单拍击响脚尖过下巴"] },
        { score: 8, points: ["动作较流畅，爆发较强或节奏较分明", "抡臂较充分", "单拍击响脚尖过肩"] },
        { score: 6, points: ["动作演练一般"] },
        { score: 4, points: ["动作演练差，爆发弱，或明显卡顿；倒地2分"] }
      ],
      deduct: { rule: "每项1分，不累计扣分", items: ["支撑腿弯曲或脚跟离地", "踢击腿弯曲", "手臂弯曲", "抡臂不圆", "未击响", "砸臂失误"] },
      note: ""
    },
    {
      name: "后扫腿",
      category: "leg",
      score: 10,
      reps: "3次",
      alias: ["后扫", "housaotui", "hst"],
      levels: [
        { score: 10, points: ["扫腿360°且动作稳定流畅，且美观"] },
        { score: 8, points: ["扫腿达360°，扫腿较流畅流畅"] },
        { score: 6, points: ["扫腿达180°，扫腿较流畅稳定"] },
        { score: 4, points: ["扫腿未达180°，动作不流畅"] }
      ],
      deduct: { rule: "", items: ["定势未两秒", "扫转腿弯曲超45°", "晃动", "扶地过久或多次扶地", "扫腿脚掌离地"] },
      note: ""
    },
    {
      name: "腾空飞脚",
      category: "jump",
      score: 10,
      reps: "2次",
      alias: ["飞脚", "tengkongfeijiao", "tkfj"],
      levels: [
        { score: 10, points: ["动作连贯，节奏分明，有强爆发力（起跳腿落地）"] },
        { score: 8, points: ["动作连贯，节奏分明，有较强爆发力（双腿落地）"] },
        { score: 6, points: ["动作连贯，节奏分明，有一定爆发力（双腿依次落地）"] },
        { score: 4, points: ["动作完成度差"] }
      ],
      deduct: { rule: "每次扣1分，扣至0分", items: ["击响时脚尖未过下巴", "上步超过四步", "未击响"] },
      note: ""
    },
    {
      name: "外摆莲（定势可接马步或左盘）",
      shortName: "外摆莲",
      category: "jump",
      score: 10,
      reps: "2次",
      alias: ["外摆莲腿", "摆莲", "waibailian", "wbl"],
      levels: [
        { score: 10, points: ["超过450°，落地平稳，且有高爆发力与协调力"] },
        { score: 8, points: ["超过360°，落地平稳，且有较高爆发力与协调力"] },
        { score: 6, points: ["超过270°，落地平稳，且有一定爆发力与协调力"] },
        { score: 4, points: ["未超270°，落地平稳"] }
      ],
      deduct: { rule: "每挪动扣1", items: ["晃动", "马步或坐盘不合规范", "挪动", "未击响", "击响未过下巴", "落地先后脚", "上步超过四步"] },
      note: "连接分：马步或坐盘。达540°加3分，达630°加5分。"
    },
    {
      name: "旋风脚（定势可接马步或左盘）",
      shortName: "旋风脚",
      category: "jump",
      score: 10,
      reps: "2次",
      alias: ["旋风", "xuanfengjiao", "xfj"],
      levels: [
        { score: 10, points: ["超过450°，落地平稳"] },
        { score: 8, points: ["超过360°，落地平稳"] },
        { score: 6, points: ["超过270°，落地平稳"] },
        { score: 4, points: ["未超270°，落地平稳"] }
      ],
      deduct: { rule: "每挪动扣1", items: ["晃动", "马步或坐盘不合规范", "挪动", "未击响", "击响未过肩", "落地先后脚", "上步超过四步"] },
      note: "达540°加3分，达630°加5分。"
    },
    {
      name: "旋子",
      category: "jump",
      score: 10,
      reps: "2次",
      alias: ["xuanzi", "xz"],
      levels: [
        { score: 10, points: ["腾空高，落地稳，体态自如，上步连贯"] },
        { score: 8, points: ["腾空较高，落地稳，体态较自如，上步较连贯"] },
        { score: 6, points: ["腾空一般，落地较稳，体态拘束，上步不连贯"] },
        { score: 4, points: ["倒地或未完全腾空"] }
      ],
      deduct: { rule: "", items: ["弯腿超过45°", "上步超过四步"] },
      note: ""
    },
    {
      name: "腾空正踢腿",
      category: "jump",
      score: 10,
      reps: "2次",
      alias: ["腾空正踢", "tengkongzhengtitui", "tkztt"],
      levels: [
        { score: 10, points: ["踢击额头或超过头顶且两腿幅度超135°"] },
        { score: 8, points: ["脚跟超过耳朵且两腿幅度超135°"] },
        { score: 6, points: ["脚跟过肩且两腿幅度超135°"] },
        { score: 4, points: ["下腿弯曲，两腿未超135°"] }
      ],
      deduct: { rule: "", items: ["踢击腿弯曲"] },
      note: ""
    },
    {
      name: "侧手翻",
      category: "jump",
      score: 10,
      reps: "3次",
      alias: ["ceshoufan", "csf"],
      levels: [
        { score: 10, points: ["侧翻圆，速度快且连续完成"] },
        { score: 8, points: ["侧翻圆，速度快"] },
        { score: 6, points: ["侧翻较圆，速度一般"] },
        { score: 4, points: ["侧翻倒地"] }
      ],
      deduct: { rule: "", items: ["动作不连贯", "屈髋或冲肩", "手臂弯曲", "伸腿展髋不充分"] },
      note: ""
    },
    {
      name: "五步拳",
      category: "routine",
      score: 10,
      reps: "",
      alias: ["五步", "wubuquan", "wbq"],
      levels: [],
      deduct: null,
      note: "原表仅列出分值，未列出分档细则。"
    },
    {
      name: "器械套路",
      category: "routine",
      score: 10,
      reps: "",
      alias: ["器械", "qixietaolu", "qxtl"],
      levels: [],
      deduct: null,
      note: "原表仅列出分值，未列出分档细则。"
    },
    {
      name: "拳术套路",
      category: "routine",
      score: 10,
      reps: "",
      alias: ["拳术", "quanshutaolu", "qstl"],
      levels: [],
      deduct: null,
      note: "原表仅列出分值，未列出分档细则。"
    },
    {
      name: "训练出勤率",
      category: "daily",
      score: 5,
      reps: "",
      alias: ["出勤", "考勤", "chuxiaolv", "cql"],
      levels: [],
      deduct: null,
      note: "原表仅列出分值，未列出分档细则。"
    },
    {
      name: "训练积极性",
      category: "daily",
      score: 5,
      reps: "",
      alias: ["积极性", "态度", "jijixing", "jjx"],
      levels: [],
      deduct: null,
      note: "原表仅列出分值，未列出分档细则。"
    }
  ]
};
