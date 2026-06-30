/* ========================================
   SIGNATURE MOTION (Hirao-style)
   GSAP + ScrollTrigger + Lenis
   - Client-side only, progressive enhancement
   - Fully disabled under prefers-reduced-motion
   ======================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return; // honour reduced-motion: keep the static (IO-reveal) experience

  function start() {
    if (!window.gsap || !window.ScrollTrigger) return; // CDN failed -> graceful fallback to CSS reveal
    var gsap = window.gsap;
    gsap.registerPlugin(window.ScrollTrigger);

    // Hand all entrance motion over to GSAP; neutralise the IntersectionObserver reveal.
    document.documentElement.classList.add('gsap-active');

    /* ---- Lenis smooth scroll, wired into ScrollTrigger ---- */
    if (window.Lenis) {
      var lenis = new window.Lenis({ duration: 1.1, smoothWheel: true, wheelMultiplier: 1 });
      lenis.on('scroll', window.ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);

      // keep in-page anchor links working with smooth scroll
      document.querySelectorAll('a[href^="#"]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          var id = a.getAttribute('href');
          if (id.length > 1 && document.querySelector(id)) {
            e.preventDefault();
            lenis.scrollTo(id, { offset: -70 });
          }
        });
      });
    }

    /* ---- 1. Heading / text mask reveal ---- */
    function maskReveal(el, vars) {
      var inner = document.createElement('span');
      inner.style.display = 'block';
      inner.style.willChange = 'transform';
      while (el.firstChild) inner.appendChild(el.firstChild);
      el.appendChild(inner);
      el.style.overflow = 'hidden';
      gsap.from(inner, Object.assign({
        yPercent: 120,
        duration: 1,
        ease: 'power4.out',
        scrollTrigger: { trigger: el, start: 'top 88%' }
      }, vars || {}));
    }

    document.querySelectorAll('.section-eyebrow').forEach(function (el) { maskReveal(el); });
    document.querySelectorAll('.about-lead').forEach(function (el) { maskReveal(el); });
    document.querySelectorAll('.work-title').forEach(function (el) { maskReveal(el, { duration: 0.9 }); });

    /* ---- 2. Card entrance with elastic "bounce" ---- */
    gsap.utils.toArray('.activity-card').forEach(function (card, i) {
      gsap.from(card, {
        y: 48,
        opacity: 0,
        duration: 1.1,
        ease: 'elastic.out(0.55, 0.5)',
        delay: (i % 4) * 0.06,
        scrollTrigger: { trigger: card, start: 'top 90%' }
      });
    });

    gsap.utils.toArray('.act-card').forEach(function (card) {
      gsap.from(card, {
        y: 64,
        opacity: 0,
        duration: 1.15,
        ease: 'elastic.out(0.5, 0.45)',
        scrollTrigger: { trigger: card, start: 'top 88%' }
      });
    });

    gsap.utils.toArray('.work-card').forEach(function (card) {
      gsap.from(card, {
        y: 56,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: card, start: 'top 88%' }
      });
    });

    /* ---- 3. Image "boyon" — scroll-linked bounce with per-item speed differences ---- */
    gsap.utils.toArray('.act-card-img, .work-thumb-img').forEach(function (img, i) {
      var amt = 5 + (i % 3) * 1.5; // speed / amplitude differences per element (max ~8%)
      // constant upscale gives the slack so the vertical drift never exposes a gap
      gsap.fromTo(img,
        { yPercent: -amt, scale: 1.2 },
        {
          yPercent: amt,
          scale: 1.2,
          ease: 'none',
          scrollTrigger: {
            trigger: img.closest('.act-card, .work-card') || img,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1
          }
        }
      );
    });

    /* ---- 4. Horizontal-flow section (desktop only): About activity cards ----
       Non-pinned: as the card row transits the viewport vertically, the track
       slides sideways. No document-height manipulation -> robust with Lenis. */
    var aboutCards = document.querySelector('.about-cards');
    var aboutContainer = document.querySelector('.about-section .container');
    var horizST = null;

    function travel() {
      return Math.max(0, aboutCards.scrollWidth - aboutContainer.clientWidth);
    }

    function buildHorizontal() {
      if (horizST) return;
      if (window.innerWidth <= 900 || !aboutCards || !aboutContainer) return;
      aboutCards.classList.add('h-track');
      horizST = gsap.fromTo(aboutCards,
        { x: 0 },
        {
          x: function () { return -travel(); },
          ease: 'none',
          scrollTrigger: {
            trigger: aboutCards,
            start: 'top 85%',
            end: 'bottom 15%',
            scrub: 1,
            invalidateOnRefresh: true
          }
        }
      );
    }

    function teardownHorizontal() {
      if (!horizST) return;
      if (horizST.scrollTrigger) horizST.scrollTrigger.kill();
      horizST.kill();
      horizST = null;
      gsap.set(aboutCards, { x: 0 });
      aboutCards.classList.remove('h-track');
    }

    buildHorizontal();

    // rebuild on breakpoint cross
    var wasDesktop = window.innerWidth > 900;
    window.addEventListener('resize', function () {
      var isDesktop = window.innerWidth > 900;
      if (isDesktop !== wasDesktop) {
        wasDesktop = isDesktop;
        if (isDesktop) buildHorizontal();
        else teardownHorizontal();
        window.ScrollTrigger.refresh();
      }
    });
  }

  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start);
  }
})();
