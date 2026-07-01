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
   VIDEO PLAYLIST (loop through clips forever)
   ======================================== */
document.querySelectorAll('video[data-playlist]').forEach(video => {
  const clips = video.dataset.playlist.split(',').map(s => s.trim()).filter(Boolean);
  if (!clips.length) return;

  let index = 0;
  const play = () => { video.play().catch(() => {}); };

  video.src = clips[0];
  play();

  video.addEventListener('ended', () => {
    index = (index + 1) % clips.length;
    video.src = clips[index];
    play();
  });
});


