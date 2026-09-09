type Copy = [string, string];
export interface BrandProfile {
  category: Copy;
  story: Copy;
  design: Copy;
  source: string;
  designSource?: string;
  officialDesign?: boolean;
}
// Concise paraphrases of the linked first-party sources. Visual readings are editorial, not claimed designer intent.
export const brandProfiles: Record<string, BrandProfile> = {
  replit: {
    category: ["Software creation", "软件创作"],
    story: [
      "Replit builds tools that make software creation accessible beyond professional programmers. Its company mission focuses on turning ideas into working software through approachable tools and AI assistance.",
      "Replit 希望让软件创作走出专业程序员的范围。其使命是借助易用的工具和 AI，把人们的想法变成可以运行的软件。",
    ],
    design: [
      "Repeated rounded modules form a compact, staggered silhouette. The consistent corner radius makes the mark feel friendly, while the orange gives it a strong focal point.",
      "重复的圆角模块组成紧凑、错位的轮廓。统一的圆角让图形显得亲和，橙色形成鲜明的视觉焦点。",
    ],
    source: "https://replit.com/about",
  },
  linear: {
    category: ["Product development", "产品研发"],
    story: [
      "Founded in 2019, Linear builds tools for teams to plan, build, and ship software. Its company story emphasizes clarity, coordination, and care for software craftsmanship.",
      "Linear 创立于 2019 年，为团队提供规划、构建和交付软件的工具。其品牌背景强调清晰的协作方式，以及对软件工艺的重视。",
    ],
    design: [
      "Linear recommends generous clear space and monochrome wordmark use. Its compact logomark is intended for tighter layouts, while the wordmark provides stronger brand recognition.",
      "Linear 的官方规范强调充足留白，并优先采用单色字标。紧凑图标适合空间有限的场景，而完整字标更有利于品牌识别。",
    ],
    source: "https://linear.app/about",
    designSource: "https://linear.app/brand",
    officialDesign: true,
  },
  figma: {
    category: ["Design collaboration", "协作设计"],
    story: [
      "Founded in 2012, Figma provides browser-based tools for brainstorming, designing, collaborating, and sharing interface work. The shared workspace is central to how the product brings designers together.",
      "Figma 创立于 2012 年，提供基于浏览器的界面设计工具，让用户构思、设计、协作和分享作品。共享工作空间是其协作方式的核心。",
    ],
    design: [
      "Circles and rounded blocks share a simple modular grid. Distinct colors separate the parts, while their arrangement creates a recognizable vertical letter-like mark.",
      "圆形与圆角模块共享简洁的网格。不同颜色区分各个部分，整体排列形成具有字母感的竖向标志。",
    ],
    source:
      "https://static.figma.com/uploads/8133c5a5be6f65235f7753dffd35d52b0b6c7616.pdf",
  },
  slack: {
    category: ["Team communication", "团队沟通"],
    story: [
      "In 2019, Slack introduced a more consistent visual identity with its in-house team and Pentagram. The earlier logo was difficult to reproduce reliably across backgrounds and applications.",
      "2019 年，Slack 与内部设计团队及 Pentagram 一起更新视觉形象。早期标志在不同背景和应用场景中难以保持一致，这是改版的重要原因。",
    ],
    design: [
      "Slack describes the redesign as a simpler palette and a more scalable, cohesive identity that retains the original mark’s spirit. Consistent recognition across products was the goal.",
      "Slack 官方将改版描述为更简洁的配色、更易扩展且一致的视觉系统，同时保留原标志的精神。让不同产品中的形象都能被认出，是此次改版的目标。",
    ],
    source: "https://slack.com/blog/news/say-hello-new-logo",
    designSource: "https://slack.com/blog/news/say-hello-new-logo",
    officialDesign: true,
  },
  notion: {
    category: ["Connected workspace", "协作工作空间"],
    story: [
      "Notion draws inspiration from early computing pioneers who imagined computers as tools for human creativity. Its flexible blocks let people assemble workspaces around the way they think and work.",
      "Notion 从早期计算机先驱的理念中获得启发：计算机可以成为增强人类创造力的工具。灵活的内容块让人们按照自己的思考与工作方式搭建空间。",
    ],
    design: [
      "A dark letter N sits inside a lightly dimensional block. The restrained black-and-white treatment and book-like serif create a connection to writing, notes, and personal work.",
      "深色字母 N 被放在略带立体感的方块中。克制的黑白配色与带有书籍感的衬线字，让人联想到写作、笔记和个人工作。",
    ],
    source: "https://www.notion.com/about",
  },
  vercel: {
    category: ["Web development", "网站开发"],
    story: [
      "Vercel provides infrastructure and tools for building and deploying web experiences. Its brand serves a developer audience that values a direct path from an idea to a live website.",
      "Vercel 为构建和部署网站体验提供基础设施与工具，面向希望把创意快速变成可访问网站的开发者。",
    ],
    design: [
      "The filled triangle uses a very small visual vocabulary: one silhouette, three edges, and strong contrast. This simplicity makes it recognizable even at small sizes.",
      "实心三角形只使用一种轮廓、三条边和强烈对比。极少的视觉元素，使它在很小的尺寸下仍然容易辨认。",
    ],
    source: "https://vercel.com/about",
  },
  airbnb: {
    category: ["Travel & hospitality", "旅行与住宿"],
    story: [
      "Airbnb’s identity project explored the experience of belonging while traveling. DesignStudio developed the Belong Anywhere positioning around people, places, and the experiences hosts make possible.",
      "Airbnb 的品牌项目围绕旅行中的归属感展开。DesignStudio 从人、地点以及房东带来的体验出发，形成了“Belong Anywhere”的品牌定位。",
    ],
    design: [
      "The identity’s Bélo symbol represents belonging. The design team describes it as a mark that crosses language boundaries and is simple enough for anyone to draw.",
      "Bélo 符号表达归属感。设计团队将其描述为一种能够跨越语言边界、简单到任何人都可以画出来的标志。",
    ],
    source: "https://www.further.group/work/airbnb",
    designSource: "https://www.further.group/work/airbnb",
    officialDesign: true,
  },
  stripe: {
    category: ["Financial infrastructure", "金融基础设施"],
    story: [
      "Stripe builds financial infrastructure for businesses, including tools to accept payments and manage online revenue. Its brand appears at the point where digital products connect with commerce.",
      "Stripe 为企业构建金融基础设施，包括收款和管理线上收入的工具。它的品牌经常出现在数字产品与商业交易交汇的位置。",
    ],
    design: [
      "The compact lowercase wordmark uses a steady rhythm and closely related letter shapes. Its few distinctive cuts give a simple word a recognizable silhouette.",
      "紧凑的小写字标采用稳定的节奏和彼此呼应的字形。少量有辨识度的切口，让一个简单单词形成独特的轮廓。",
    ],
    source: "https://stripe.com/about",
  },
  dropbox: {
    category: ["Files & collaboration", "文件与协作"],
    story: [
      "Dropbox builds tools for storing, sharing, and working with content. Its company story centers on helping people organize their digital work and collaborate more easily.",
      "Dropbox 提供存储、分享和处理内容的工具，其公司背景围绕整理数字工作内容与降低协作成本展开。",
    ],
    design: [
      "Repeated diamond-like planes suggest an open box. The mark turns a familiar storage metaphor into a small set of flat, repeatable geometric pieces.",
      "重复的菱形平面让人联想到打开的盒子。标志把熟悉的存储意象，转化成少量可重复的扁平几何组件。",
    ],
    source: "https://www.dropbox.com/about",
  },
  github: {
    category: ["Software collaboration", "软件协作"],
    story: [
      "GitHub supports software development from planning to deployment. Repositories, collaboration, and an open-source community connect people around shared code and projects.",
      "GitHub 支持从规划到部署的软件开发流程。代码仓库、协作机制与开源社区，把人们连接在共同的代码和项目周围。",
    ],
    design: [
      "A character silhouette adds personality to a technical product. Strong figure–ground contrast and a recognizable head shape make the mascot work as a compact icon.",
      "角色剪影为技术产品加入了个性。鲜明的正负形对比与易识别的头部轮廓，让吉祥物也能作为紧凑图标使用。",
    ],
    source:
      "https://docs.github.com/en/get-started/start-your-journey/what-is-github",
  },
  discord: {
    category: ["Communities & conversation", "社群与交流"],
    story: [
      "Discord’s visual identity includes a named character, Clyde, alongside its wordmark and color system. Its published brand guidelines explain how these assets should remain recognizable across contexts.",
      "Discord 的视觉形象包含名为 Clyde 的角色图标，以及字标与色彩系统。公开的品牌规范说明了如何让这些元素在不同场景中保持识别度。",
    ],
    design: [
      "The Clyde icon pairs a broad, rounded contour with two simple eyes. This creates a friendly character with enough visual weight to remain legible at small sizes.",
      "Clyde 图标把宽阔、圆润的轮廓与两只简单的眼睛组合起来，形成亲和的角色形象，同时保留小尺寸所需的视觉分量。",
    ],
    source: "https://discord.com/branding",
  },
  claude: {
    category: ["AI assistant", "AI 助手"],
    story: [
      "Claude is developed by Anthropic, whose work focuses on reliable, interpretable, and steerable AI systems. The product brings that research into an assistant people can work with.",
      "Claude 由 Anthropic 开发。该公司的研究关注可靠、可解释、可控的 AI 系统，Claude 将这些研究带入人们可以协作使用的助手产品。",
    ],
    design: [
      "Uneven radiating strokes create a hand-drawn, star-like form. Their variation softens the geometry and gives the mark a warmer, less mechanical character.",
      "不完全均匀的放射线条构成手绘般的星形。线条的变化弱化了机械的几何感，让标志更温暖、更具人性。",
    ],
    source: "https://www.anthropic.com/company",
  },
};
