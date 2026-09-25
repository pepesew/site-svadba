/*
 * Прелоадер, плавный скролл (Lenis) и анимации появления (GSAP + ScrollTrigger).
 * См. docs_design_06_interactive_components и 05_scroll_and_layout.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  var hasGsap = !!(gsap && ScrollTrigger);
  // Анимации только если GSAP загрузился и гость не просил их убрать
  var motion = hasGsap && root.classList.contains('has-motion');
  var lenis = null;

  var MIN_PRELOADER_MS = 1000;
  var MAX_PRELOADER_MS = 8000;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  if (hasGsap) gsap.registerPlugin(ScrollTrigger);
  if (!motion) root.classList.remove('has-motion');

  /* ------------------------------------------------------------------
     Плавный скролл
     ------------------------------------------------------------------ */
  function initLenis() {
    if (!motion || !window.Lenis) return;

    // На тач-экранах Lenis по умолчанию оставляет нативный скролл (syncTouch: false)
    lenis = new window.Lenis({
      duration: 1.3,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
    lenis.stop();

    window.WEDDING_LENIS = lenis; // пригодится 3D-сценам
  }

  /* ------------------------------------------------------------------
     Прелоадер
     ------------------------------------------------------------------ */
  function track(promise, onSettle) {
    return Promise.resolve(promise).then(onSettle, onSettle);
  }

  function collectTasks() {
    var tasks = [];

    if (document.fonts && document.fonts.ready) tasks.push(document.fonts.ready);

    tasks.push(new Promise(function (resolve) {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve, { once: true });
    }));

    $$('img').forEach(function (img) {
      if (img.loading === 'lazy' || img.complete) return;
      tasks.push(new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      }));
    });

    return tasks.concat(window.WEDDING_PRELOAD || []);
  }

  function runPreloader(onExit) {
    var el = $('[data-preloader]');
    var countEl = $('[data-preloader-count]');
    var started = Date.now();
    var shown = { value: 0 };
    var finished = false;

    function render() { countEl.textContent = Math.round(shown.value); }

    function showProgress(target, duration) {
      if (!hasGsap) {
        shown.value = target;
        render();
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        gsap.to(shown, {
          value: target,
          duration: duration,
          ease: 'power2.out',
          overwrite: true,
          onUpdate: render,
          onComplete: resolve,
        });
      });
    }

    var tasks = collectTasks();
    var done = 0;

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(window.__preloaderFailsafe);

      var wait = Math.max(0, MIN_PRELOADER_MS - (Date.now() - started));
      setTimeout(function () {
        showProgress(100, 0.3).then(function () { hidePreloader(el, onExit); });
      }, wait);
    }

    Promise.all(tasks.map(function (t) {
      return track(t, function () {
        done++;
        if (!finished) showProgress(done / tasks.length * 100, 0.6);
      });
    })).then(finish);

    // Медленный интернет — не держим гостя дольше 8 секунд
    setTimeout(finish, MAX_PRELOADER_MS);
  }

  function unlock() {
    root.classList.remove('is-loading');
    if (lenis) lenis.start();
    if (hasGsap) ScrollTrigger.refresh();
  }

  function hidePreloader(el, onExit) {
    window.scrollTo(0, 0);

    function done() {
      root.classList.add('is-loaded');
      el.remove();
    }

    if (!hasGsap) {
      unlock();
      done();
      onExit();
      return;
    }

    if (!motion) {
      gsap.to(el, {
        opacity: 0,
        duration: 0.4,
        onStart: unlock,
        onComplete: function () { done(); onExit(); },
      });
      return;
    }

    gsap.timeline({ onComplete: done })
      .to(el.firstElementChild, { y: -24, opacity: 0, duration: 0.5, ease: 'power2.in' })
      .to(el, { yPercent: -100, duration: 1.1, ease: 'power4.inOut', onStart: unlock })
      .add(onExit, '-=0.55');
  }

  /* ------------------------------------------------------------------
     Главный экран
     ------------------------------------------------------------------ */
  function prepareHero() {
    if (!motion) return function () {};

    var items = [
      $('.hero .eyebrow'),
      $$('.hero__line')[0],
      $('.hero .amp'),
      $$('.hero__line')[1],
      $('.hero__date'),
    ];
    gsap.set(items, { opacity: 0, y: 40 });
    gsap.set('.hero__scroll', { opacity: 0 });

    return function play() {
      gsap.timeline()
        .to(items, { opacity: 1, y: 0, duration: 1.3, ease: 'power3.out', stagger: 0.12 })
        .to('.hero__scroll', { opacity: 1, duration: 1 }, '-=0.6');
    };
  }

  /* ------------------------------------------------------------------
     Появление секций
     ------------------------------------------------------------------ */
  var SPECIAL = '.gallery, .timeline, .max__stack, .max__link, .scene-slot, .palette';

  function initReveals() {
    $$('.section > .container').forEach(function (container) {
      var items = $$(':scope > *', container).filter(function (el) {
        return !el.matches(SPECIAL) && !el.hidden;
      });
      if (!items.length) return;

      var tl = gsap.timeline({
        scrollTrigger: { trigger: container, start: 'top 80%', once: true },
      });

      items.forEach(function (el, i) {
        var at = i * 0.1;
        if (el.classList.contains('divider')) {
          tl.from(el, { scaleX: 0, duration: 1, ease: 'power3.inOut' }, at);
        } else {
          tl.from(el, { opacity: 0, y: 30, duration: 1.1, ease: 'power3.out' }, at);
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     Фото: раскрытие маски + «наезд» изображения
     ------------------------------------------------------------------ */
  function initPhotos() {
    $$('.photo').forEach(function (photo) {
      gsap.timeline({
        scrollTrigger: { trigger: photo, start: 'top 85%', once: true },
      })
        .fromTo($('.photo__frame', photo),
          { clipPath: 'inset(100% 0% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'power3.inOut' })
        .fromTo($('.photo__img', photo),
          { scale: 1.25 },
          { scale: 1, duration: 1.8, ease: 'power3.out' }, 0);
    });
  }

  /* ------------------------------------------------------------------
     Дресс-код: кружки «выкатываются» навстречу друг другу
     ------------------------------------------------------------------ */
  function initPalette() {
    var palette = $('.palette');
    if (!palette) return;

    var dots = $$('.swatch__dot', palette);
    var labels = $$('.swatch__name, .swatch__hex', palette);

    gsap.timeline({
      scrollTrigger: { trigger: palette, start: 'top 80%', once: true },
    })
      .from(dots[0], { x: -40, scale: 0.4, opacity: 0, duration: 1.2, ease: 'back.out(1.6)' })
      .from(dots[1], { x: 40, scale: 0.4, opacity: 0, duration: 1.2, ease: 'back.out(1.6)' }, 0.12)
      .from(labels, { opacity: 0, y: 10, duration: 0.8, stagger: 0.06, ease: 'power2.out' }, 0.5)
      .add(function () { gsap.set(dots, { clearProps: 'transform' }); }); // вернуть CSS-hover
  }

  /* ------------------------------------------------------------------
     Таймлайн программы дня
     ------------------------------------------------------------------ */
  function initTimeline() {
    var list = $('.timeline');
    if (!list) return;

    list.style.setProperty('--progress', 0);
    ScrollTrigger.create({
      trigger: list,
      start: 'top 60%',
      end: 'bottom 60%',
      scrub: true,
      onUpdate: function (self) { list.style.setProperty('--progress', self.progress.toFixed(4)); },
    });

    $$('.timeline__item', list).forEach(function (item) {
      gsap.from(item, {
        opacity: 0,
        y: 20,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: item, start: 'top 90%', once: true },
      });
      // Точка «зажигается», когда до нее докрасилась линия
      ScrollTrigger.create({
        trigger: item,
        start: 'top+=26 60%', // центр точки
        end: 'max',
        toggleClass: 'is-active',
      });
    });
  }

  /* ------------------------------------------------------------------
     Блок MAX: контур, построчное появление QR, линия сканирования
     ------------------------------------------------------------------ */
  function initQr() {
    var stack = $('.max__stack');
    if (!stack) return;

    var frame = $('.qr__frame', stack);
    var code = $('.qr__code', stack);
    var scan = $('.qr__scan', stack);
    var rest = [$('.qr__caption', stack), $('.max__btn', stack), $('.max__link')];

    gsap.timeline({
      scrollTrigger: { trigger: stack, start: 'top 75%', once: true },
    })
      .fromTo(frame, { '--draw': 1 }, { '--draw': 0, duration: 1.2, ease: 'power2.inOut' })
      .from($$('.qr__corner', frame), { opacity: 0, scale: 0.4, duration: 0.5, stagger: 0.08, ease: 'back.out(2)' }, 0.6)
      // 37 рядов = 29 модулей + по 4 модуля тихой зоны сверху и снизу
      .fromTo(code,
        { clipPath: 'inset(0% 0% 100% 0%)' },
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'steps(37)' }, 0.8)
      .fromTo(scan,
        { y: 0, opacity: 1 },
        { y: function () { return code.offsetHeight; }, duration: 1.1, ease: 'power1.inOut' }, 1.8)
      .to(scan, { opacity: 0, duration: 0.3 }, '-=0.3')
      .from(rest, { opacity: 0, y: 20, duration: 0.9, stagger: 0.1, ease: 'power3.out' }, 1.2);
  }

  /* ------------------------------------------------------------------
     RSVP: высота блока меняется — пересчитываем триггеры
     ------------------------------------------------------------------ */
  function initRsvpHooks() {
    var refresh = function () { requestAnimationFrame(function () { ScrollTrigger.refresh(); }); };

    document.addEventListener('rsvp:success', function () {
      gsap.from('[data-rsvp-thanks]', { opacity: 0, y: 20, duration: 0.9, ease: 'power3.out' });
      refresh();
    });

    var form = $('#rsvp-form');
    if (form) form.addEventListener('change', refresh);
    var edit = $('[data-rsvp-edit]');
    if (edit) edit.addEventListener('click', refresh);
  }

  /* ------------------------------------------------------------------
     Запуск
     ------------------------------------------------------------------ */
  initLenis();
  var playHero = prepareHero();

  if (motion) {
    initReveals();
    initPhotos();
    initPalette();
    initTimeline();
    initQr();
  }
  if (hasGsap) initRsvpHooks();

  runPreloader(function () {
    playHero();
    document.dispatchEvent(new CustomEvent('preloader:done')); // сигнал 3D-сцене
  });
})();
