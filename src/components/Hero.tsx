import { useAppState } from "../state";
import { HeroAtmosphere } from "./HeroAtmosphere";
import { CreativeScenes } from "./CreativeScenes";
export function Hero({ selected }: { selected: boolean }) {
  const { t } = useAppState();
  return (
    <section
      className="studio has-atmosphere"
      aria-label={t("Logo 设计工作台")}
    >
      <HeroAtmosphere />
      <div className="hero">
        <p className="eyebrow">
          <span className="hero-pill">{t("你的下一个品牌，从这里开始")}</span>
        </p>
        <h1>
          {t("找到灵感，")}
          <br />
          <span className="serif-word">{t("创造你的标志。")}</span>
        </h1>
        <p className="intro">
          {t("先挑选喜欢的 Logo，再告诉我们你的想法。")}
          <br />
          {t("从参考风格出发，探索三个属于你的设计方向。")}
        </p>
        <a href="#inspiration" className="hero-start">
          <span>{t("选择一个参考 Logo")}</span>
          <span>↗</span>
        </a>
      </div>
      <CreativeScenes />
      <ol className="workflow" aria-label={t("设计步骤")}>
        {[
          ["选择参考 Logo", "先确定喜欢的视觉风格"],
          ["描述你的品牌", "将参考风格转化为自己的表达"],
          ["探索并微调", "比较三个方向，选中后继续打磨"],
        ].map(([title, description], i) => (
          <li
            key={title}
            id={i === 0 ? "referenceStep" : i === 1 ? "briefStep" : undefined}
            className={
              (i === 0 && !selected) || (i === 1 && selected) ? "current" : ""
            }
          >
            <span>0{i + 1}</span>
            <div>
              <b>{t(title)}</b>
              <small>{t(description)}</small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
