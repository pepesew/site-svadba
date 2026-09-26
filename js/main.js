(function () {
  'use strict';

  var C = window.WEDDING;
  var START = new Date(C.start);
  var END = new Date(C.end);

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Склонение: plural(5, ['день', 'дня', 'дней']) → 'дней'
  function plural(n, forms) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
    return forms[2];
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  // 20261031T103000Z — формат дат для Google Календаря
  function toCalendarUtc(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  /* ------------------------------------------------------------------
     Ссылки и тексты из конфига
     ------------------------------------------------------------------ */
  function initLinks() {
    var v = C.venue;
    var coords = v.lon + ',' + v.lat; // у Яндекса и 2ГИС сначала долгота

    $$('[data-venue-name]').forEach(function (el) { el.textContent = v.name; });
    $$('[data-venue-address]').forEach(function (el) { el.textContent = v.address; });

    var latlon = v.lat + ',' + v.lon; // Google, Apple и маршрут Яндекса — наоборот, широта первая

    $$('[data-link="yandex-point"]').forEach(function (el) {
      el.href = 'https://yandex.ru/maps/?pt=' + coords + '&z=17&l=map';
    });
    // Маршрут от текущего местоположения гостя
    $$('[data-link="yandex"]').forEach(function (el) {
      el.href = 'https://yandex.ru/maps/?rtext=~' + encodeURIComponent(latlon) + '&rtt=auto';
    });
    $$('[data-link="2gis"]').forEach(function (el) {
      el.href = 'https://2gis.ru/geo/' + coords;
    });
    $$('[data-link="google"]').forEach(function (el) {
      el.href = 'https://www.google.com/maps/dir/?api=1&destination=' + latlon;
    });
    $$('[data-link="apple"]').forEach(function (el) {
      el.href = 'https://maps.apple.com/?daddr=' + latlon + '&q=' + encodeURIComponent(v.name.replace(/[«»]/g, ''));
    });
    $$('[data-map]').forEach(function (el) {
      var src = 'https://yandex.ru/map-widget/v1/?ll=' + encodeURIComponent(coords) +
        '&z=16&pt=' + encodeURIComponent(coords + ',pm2dgl');
      if (el.src !== src) el.src = src;
    });
    $$('[data-link="gcal"]').forEach(function (el) {
      el.href = 'https://calendar.google.com/calendar/render?' + [
        'action=TEMPLATE',
        'text=' + encodeURIComponent('Свадьба: ' + C.couple),
        'dates=' + toCalendarUtc(START) + '/' + toCalendarUtc(END),
        'location=' + encodeURIComponent(v.name + ', ' + v.address),
        // ссылку на сайт добавляем, только когда он открыт через интернет (не file://)
        'details=' + encodeURIComponent('Ждём вас!' +
          (/^https?:/.test(location.protocol) ? ' ' + location.origin + location.pathname : '')),
      ].join('&');
    });

    $$('[data-link="max"]').forEach(function (el) { el.href = C.maxGroupUrl; });
    // Длинную ссылку показываем коротко; «Скопировать» копирует ее целиком
    var maxText = C.maxGroupUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (maxText.length > 24) maxText = maxText.slice(0, 20) + '…';
    $$('[data-max-text]').forEach(function (el) {
      el.textContent = maxText;
      el.title = C.maxGroupUrl;
    });
  }

  /* ------------------------------------------------------------------
     Таймер обратного отсчета
     ------------------------------------------------------------------ */
  function initCountdown() {
    var root = $('[data-countdown]');
    if (!root) return;

    var units = {
      days: { el: $('[data-timer="days"]', root), forms: ['день', 'дня', 'дней'] },
      hours: { el: $('[data-timer="hours"]', root), forms: ['час', 'часа', 'часов'] },
      minutes: { el: $('[data-timer="minutes"]', root), forms: ['минута', 'минуты', 'минут'] },
      seconds: { el: $('[data-timer="seconds"]', root), forms: ['секунда', 'секунды', 'секунд'] },
    };

    function set(unit, value, padded) {
      var u = units[unit];
      u.el.textContent = padded ? pad(value) : value;
      u.el.nextElementSibling.textContent = plural(value, u.forms);
    }

    function tick() {
      var diff = START - Date.now();

      if (diff <= 0) {
        $('[data-countdown-running]', root).hidden = true;
        $('[data-countdown-done]', root).hidden = false;
        return;
      }

      var s = Math.floor(diff / 1000);
      set('days', Math.floor(s / 86400), false);
      set('hours', Math.floor(s % 86400 / 3600), true);
      set('minutes', Math.floor(s % 3600 / 60), true);
      set('seconds', s % 60, true);

      // выравниваем обновление по началу следующей секунды
      setTimeout(tick, diff % 1000 || 1000);
    }

    tick();
  }

  /* ------------------------------------------------------------------
     Копирование ссылки на группу MAX
     ------------------------------------------------------------------ */
  function initCopy() {
    $$('[data-copy]').forEach(function (btn) {
      var label = btn.textContent;
      var timer;

      function done(text) {
        btn.textContent = text;
        clearTimeout(timer);
        timer = setTimeout(function () { btn.textContent = label; }, 2000);
      }

      // Запасной вариант: выделяем адрес, чтобы гость скопировал его сам
      function fallback() {
        var target = $('[data-max-text]');
        var range = document.createRange();
        range.selectNodeContents(target);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done('Выделено — скопируйте');
      }

      btn.addEventListener('click', function () {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(C.maxGroupUrl)
            .then(function () { done('Скопировано ✓'); }, fallback);
        } else {
          fallback();
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     Форма RSVP
     ------------------------------------------------------------------ */
  var STORAGE_KEY = 'wedding-rsvp';
  var STATUS_TEXT = {
    alone: 'Приду один',
    plus: 'Буду с парой / семьей',
    decline: 'Не смогу прийти',
  };

  function storage(method, value) {
    try {
      if (method === 'get') return JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (method === 'set') localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (e) { /* приватный режим, заблокированное хранилище */ }
    return null;
  }

  function initRsvp() {
    var form = $('#rsvp-form');
    if (!form) return;

    var thanks = $('[data-rsvp-thanks]');
    var formError = $('[data-form-error]', form);
    var submit = $('button[type="submit"]', form);
    var submitLabel = submit.textContent;

    function fieldError(name, message) {
      var el = $('[data-error="' + name + '"]', form);
      el.textContent = message || '';
      $$('[name="' + name + '"]', form).forEach(function (input) {
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      });
    }

    function read() {
      var status = (form.elements.status.value || '');
      var count = { alone: 1, decline: 0 }[status];
      if (status === 'plus') count = parseInt(form.elements.count.value, 10);
      return {
        name: form.elements.name.value.trim().replace(/\s+/g, ' '),
        status: status,
        count: count,
        comment: form.elements.comment.value.trim(),
        website: form.elements.website.value, // honeypot
      };
    }

    function validate(data) {
      var ok = true;
      fieldError('name', '');
      fieldError('status', '');
      fieldError('count', '');

      if (data.name.length < 2) {
        fieldError('name', 'Укажите имя и фамилию');
        ok = false;
      }
      if (!STATUS_TEXT[data.status]) {
        fieldError('status', 'Выберите один из вариантов');
        ok = false;
      }
      if (data.status === 'plus' && !(data.count >= 2 && data.count <= 10)) {
        fieldError('count', 'Укажите число от 2 до 10');
        ok = false;
      }

      if (!ok) {
        var first = $('[aria-invalid="true"]', form);
        if (first) first.focus();
      }
      return ok;
    }

    function send(data) {
      var online = /^https?:$/.test(location.protocol);
      if (!C.rsvpEndpoint || !online) {
        // Демо-режим до появления бэкенда
        console.info('[RSVP demo] отправка пропущена:', data);
        return new Promise(function (resolve) { setTimeout(resolve, 600); });
      }

      var controller = window.AbortController ? new AbortController() : null;
      var timeout = setTimeout(function () { if (controller) controller.abort(); }, 15000);

      return fetch(C.rsvpEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller ? controller.signal : undefined,
      }).then(function (res) {
        clearTimeout(timeout);
        if (res.ok) return;
        // Сервер объясняет отказ понятным текстом — покажем его гостю
        return res.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error('HTTP ' + res.status);
          err.userMessage = body && body.error;
          throw err;
        });
      }, function (err) {
        clearTimeout(timeout);
        throw err;
      });
    }

    function showThanks(answer) {
      var going = answer.status !== 'decline';
      $('[data-thanks-title]', thanks).textContent = going ? 'Спасибо!' : 'Спасибо, что сообщили';
      $('[data-thanks-text]', thanks).textContent = going
        ? 'Мы получили ваш ответ и очень ждём вас 31 октября.'
        : 'Очень жаль, что вы не сможете прийти. Мы будем думать о вас в этот день.';
      $('[data-thanks-summary]', thanks).textContent = answer.name + ' · ' + STATUS_TEXT[answer.status] +
        (answer.status === 'plus' ? ' · ' + answer.count + ' ' + plural(answer.count, ['человек', 'человека', 'человек']) : '');

      form.hidden = true;
      thanks.hidden = false;
    }

    function showForm(answer) {
      if (answer) {
        form.elements.name.value = answer.name;
        form.elements.comment.value = answer.comment || '';
        var radio = $('input[name="status"][value="' + answer.status + '"]', form);
        if (radio) radio.checked = true;
        if (answer.status === 'plus') form.elements.count.value = answer.count;
      }
      thanks.hidden = true;
      form.hidden = false;
      form.elements.name.focus();
    }

    // Сброс ошибки поля при исправлении
    form.addEventListener('input', function (e) {
      if (e.target.name) fieldError(e.target.name, '');
      formError.textContent = '';
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = read();
      formError.textContent = '';
      if (!validate(data)) return;

      var answer = {
        name: data.name,
        status: data.status,
        count: data.count,
        comment: data.comment,
        answeredAt: new Date().toISOString(),
      };

      // Honeypot заполнен — делаем вид, что всё хорошо, но ничего не отправляем
      if (data.website) {
        showThanks(answer);
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Отправляем…';

      send(data).then(function () {
        storage('set', answer);
        showThanks(answer);
        // Для будущей 3D-анимации сердца
        document.dispatchEvent(new CustomEvent('rsvp:success', { detail: { status: answer.status } }));
      }, function (err) {
        console.error('[RSVP]', err);
        formError.textContent = err.userMessage ||
          'Не удалось отправить ответ. Проверьте интернет и попробуйте ещё раз.';
      }).then(function () {
        submit.disabled = false;
        submit.textContent = submitLabel;
      });
    });

    $('[data-rsvp-edit]', thanks).addEventListener('click', function () {
      showForm(storage('get'));
    });

    // Гость уже отвечал с этого устройства
    var saved = storage('get');
    if (saved && STATUS_TEXT[saved.status]) showThanks(saved);
  }

  initLinks();
  initCountdown();
  initCopy();
  initRsvp();
})();
