/**
 * サイト全体のモーション基盤。
 * - Lenis スムーススクロール × GSAP ScrollTrigger 同期
 * - スクロールリビール（[data-reveal]）
 * - 巨大見出しの velocity-skew（[data-skew]）
 * - Bento カードの tilt（[data-tilt]）
 * - ナビバーのスクロール状態
 *
 * prefers-reduced-motion 時は一切初期化しない
 * （要素は素の状態で見えるので、静的な体験にフォールバックする）。
 */
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function initMotion(): void {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- ナビバー（reduced-motion でも機能として動かす） ---- */
  const navbar = document.getElementById("navbar");
  const updateNav = (y: number) => navbar?.classList.toggle("scrolled", y > 40);
  window.addEventListener("scroll", () => updateNav(window.scrollY), { passive: true });
  updateNav(window.scrollY);

  if (reduceMotion) return;

  gsap.registerPlugin(ScrollTrigger);

  const supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---- Lenis × ScrollTrigger 同期（必須パターン） ---- */
  const lenis = new Lenis({ anchors: { offset: -80 } });
  // デバッグ・外部連携用（コンソールから window.lenis で触れる）
  (window as unknown as { lenis: Lenis }).lenis = lenis;
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  /* ---- スクロールリビール ---- */
  gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
    gsap.from(el, {
      y: 42,
      opacity: 0,
      duration: 1,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 88%" },
    });
  });

  /* ---- 巨大セクションタイポ: マスク入場 + スクロール連動の横パララックス ---- */
  gsap.utils.toArray<HTMLElement>("[data-type-parallax]").forEach((el) => {
    gsap.from(el, {
      yPercent: 105,
      duration: 1.1,
      ease: "power4.out",
      scrollTrigger: { trigger: el, start: "top 92%" },
    });
    gsap.fromTo(
      el,
      { xPercent: 3 },
      {
        xPercent: -3,
        ease: "none",
        scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.6 },
      },
    );
  });

  /* ---- メディアのクリップワイプ・リビール（下から開く） ---- */
  gsap.utils.toArray<HTMLElement>(".act-media .act-img, .work-img").forEach((el) => {
    gsap.from(el, {
      clipPath: "inset(100% 0 0 0)",
      duration: 1.2,
      ease: "power4.out",
      scrollTrigger: { trigger: el, start: "top 88%" },
    });
  });

  /* ---- 見出し velocity-skew: スクロール速度に応じて英字が歪む ---- */
  const skewEls = gsap.utils.toArray<HTMLElement>("[data-skew]");
  if (skewEls.length) {
    const skewSetters = skewEls.map((el) => gsap.quickTo(el, "skewX", { duration: 0.5, ease: "power3.out" }));
    lenis.on("scroll", () => {
      const skew = gsap.utils.clamp(-8, 8, lenis.velocity * 0.28);
      skewSetters.forEach((set) => set(skew));
    });
  }

  /* ---- Bento tilt ---- */
  if (supportsHover) {
    gsap.utils.toArray<HTMLElement>("[data-tilt]").forEach((card) => {
      const rx = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power2.out" });
      const ry = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power2.out" });
      gsap.set(card, { transformPerspective: 900 });

      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        rx((0.5 - py) * 3.5);
        ry((px - 0.5) * 3.5);
      });

      card.addEventListener("pointerleave", () => {
        rx(0);
        ry(0);
      });
    });

    /* ---- マグネティックボタン（上品に・移動量は控えめ） ---- */
    gsap.utils.toArray<HTMLElement>("[data-magnetic]").forEach((el) => {
      const mx = gsap.quickTo(el, "x", { duration: 0.4, ease: "power3.out" });
      const my = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3.out" });

      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        mx((e.clientX - (r.left + r.width / 2)) * 0.18);
        my((e.clientY - (r.top + r.height / 2)) * 0.18);
      });

      el.addEventListener("pointerleave", () => {
        mx(0);
        my(0);
      });
    });

    /* ---- ヒーロー背景の微パララックス ---- */
    const heroImg = document.querySelector<HTMLElement>("#hero .hero-img");
    if (heroImg) {
      const hx = gsap.quickTo(heroImg, "xPercent", { duration: 1.2, ease: "power2.out" });
      const hy = gsap.quickTo(heroImg, "yPercent", { duration: 1.2, ease: "power2.out" });
      window.addEventListener("pointermove", (e) => {
        hx((e.clientX / window.innerWidth - 0.5) * -1.2);
        hy((e.clientY / window.innerHeight - 0.5) * -1.2);
      });
    }
  }
}
