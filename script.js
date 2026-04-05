/* ========================================
   NAVBAR SCROLL EFFECT
   ======================================== */
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  if (window.scrollY > 40) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
}, { passive: true });

/* ========================================
   MOBILE NAV TOGGLE
   ======================================== */
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');

navToggle.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  const isOpen = navLinks.classList.contains('open');
  navToggle.setAttribute('aria-label', isOpen ? 'メニューを閉じる' : 'メニューを開く');
});

// Close on link click
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
  });
});

/* ========================================
   INTERSECTION OBSERVER (REVEAL)
   ======================================== */
const revealElements = document.querySelectorAll('.reveal');

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.12,
  rootMargin: '0px 0px -40px 0px'
});

revealElements.forEach(el => revealObserver.observe(el));

/* ========================================
   ADD REVEAL CLASSES DYNAMICALLY
   ======================================== */
function addRevealClasses() {
  // Section headers
  document.querySelectorAll('.section-header').forEach((el, i) => {
    el.classList.add('reveal');
  });

  // About text & cards
  const aboutText = document.querySelector('.about-text');
  if (aboutText) aboutText.classList.add('reveal');

  document.querySelectorAll('.activity-card').forEach((el, i) => {
    el.classList.add('reveal', `reveal-delay-${(i % 4) + 1}`);
  });

  // Stat cards
  document.querySelectorAll('.stat-card').forEach((el, i) => {
    el.classList.add('reveal', `reveal-delay-${i + 1}`);
  });

  // Activity cards (活動紹介)
  document.querySelectorAll('.act-card').forEach((el, i) => {
    el.classList.add('reveal', `reveal-delay-${(i % 2) + 1}`);
  });

  // Link cards
  document.querySelectorAll('.link-card').forEach((el, i) => {
    el.classList.add('reveal', `reveal-delay-${(i % 3) + 1}`);
  });

  // Re-observe all new reveal elements
  document.querySelectorAll('.reveal').forEach(el => {
    if (!el.classList.contains('visible')) {
      revealObserver.observe(el);
    }
  });
}

addRevealClasses();

/* ========================================
   ACTIVE NAV LINK ON SCROLL
   ======================================== */
const sections = document.querySelectorAll('section[id]');
const navLinkEls = document.querySelectorAll('.nav-link');

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinkEls.forEach(link => link.style.color = '');
      const activeLink = document.querySelector(`.nav-link[href="#${entry.target.id}"]`);
      if (activeLink) {
        activeLink.style.color = 'var(--clr-text)';
      }
    }
  });
}, { threshold: 0.4 });

sections.forEach(sec => sectionObserver.observe(sec));

/* ========================================
   COUNTER ANIMATION (STATS)
   ======================================== */
function animateCounter(numEl, target, duration = 1400) {
  // 数字部分のテキストノードだけ更新する（span.stat-unitを保持）
  const unitEl = numEl.querySelector('.stat-unit');
  const unitHTML = unitEl ? unitEl.outerHTML : '';
  let startTime = null;
  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    numEl.innerHTML = Math.floor(eased * target) + unitHTML;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

const statObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const numEl = entry.target.querySelector('.stat-num');
      if (numEl) animateCounter(numEl, 40);
      statObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

const statYears = document.querySelector('#stat-years');
if (statYears) statObserver.observe(statYears);

