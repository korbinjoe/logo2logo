import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state";
import type { HeroScene } from "../lib/hero-scene";

export function HeroAtmosphere() {
  const { preferences, update, theme, t } = useAppState();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HeroScene | null>(null);
  const sync = useRef(() => {});
  const motion = useRef(preferences.heroMotion);
  motion.current = preferences.heroMotion;
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const surface = node.closest<HTMLElement>(".studio")!;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let alive = true,
      visible = false,
      loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const synchronize = () => {
      setReduced(media.matches);
      scene.current?.setRunning(
        visible && !document.hidden && motion.current && !media.matches,
      );
    };
    sync.current = synchronize;
    const load = () => {
      if (loading || scene.current || !visible || document.hidden) return;
      loading = true;
      void import("../lib/hero-scene")
        .then(({ createHeroScene }) => {
          if (!alive) return;
          scene.current = createHeroScene(node, surface);
          synchronize();
        })
        .catch(() => {
          node.dataset.rendered = "false";
        });
    };
    const visibility = () => {
      synchronize();
      if (!document.hidden) load();
    };
    let observer: IntersectionObserver;
    const header = document.querySelector(".masthead");
    const observe = () => {
      observer?.disconnect();
      observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting && entry.intersectionRatio >= 0.05;
          synchronize();
          clearTimeout(timer);
          if (visible) timer = setTimeout(load, 180);
        },
        {
          threshold: 0.05,
          rootMargin: `-${header?.getBoundingClientRect().height || 0}px 0px 0px`,
        },
      );
      observer.observe(surface);
    };
    const headerSize = new ResizeObserver(observe);
    if (header) headerSize.observe(header);
    observe();
    media.addEventListener("change", synchronize);
    document.addEventListener("visibilitychange", visibility);
    synchronize();
    return () => {
      alive = false;
      clearTimeout(timer);
      observer.disconnect();
      headerSize.disconnect();
      media.removeEventListener("change", synchronize);
      document.removeEventListener("visibilitychange", visibility);
      scene.current?.dispose();
      scene.current = null;
      sync.current = () => {};
    };
  }, []);
  useEffect(() => sync.current(), [preferences.heroMotion]);
  useEffect(() => scene.current?.updatePalette(), [theme]);

  return (
    <>
      <div ref={host} className="hero-atmosphere" aria-hidden="true">
        <div className="atmosphere-glow" />
        <div className="atmosphere-grain" />
      </div>
      <button
        type="button"
        className="atmosphere-motion"
        disabled={reduced}
        aria-pressed={!preferences.heroMotion || reduced}
        onClick={() => update("heroMotion", !preferences.heroMotion)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          {preferences.heroMotion && !reduced ? (
            <path d="M2 1h2v10H2zM8 1h2v10H8z" />
          ) : (
            <path d="M3 1v10l8-5Z" />
          )}
        </svg>
        {t(
          reduced
            ? "hero.still"
            : preferences.heroMotion
              ? "hero.pause"
              : "hero.play",
        )}
      </button>
    </>
  );
}
