/*
 * Единый источник данных о событии.
 * Всё, что помечено «уточнить», заменить на реальные значения.
 * После изменения даты/адреса обновить и wedding.ics, после изменения
 * maxGroupUrl — перегенерировать QR: `npm run qr`.
 */
window.WEDDING = {
  couple: 'Иван & София',

  // Начало и окончание по времени Оренбурга (UTC+5)
  start: '2026-10-31T14:00:00+05:00',
  end: '2026-10-31T22:00:00+05:00',

  venue: {
    name: 'Ресторан «Royal Palace»',
    address: 'г. Оренбург, ул. Одесская, д. 45',
    // Координаты по OpenStreetMap (объект «Royal Palace», Одесская, 45)
    lat: 51.785757,
    lon: 55.130891,
  },

  // Ссылка-приглашение в группу гостей в MAX (после изменения: npm run qr)
  maxGroupUrl: 'https://max.ru/join/REfVLjOK4RTUHF-mxE3IAqj9a-WZarRionDvn5-hqUE',

  // Обработчик RSVP на том же сервере (server/bot.py за nginx).
  // При открытии index.html с диска (file://) форма работает в демо-режиме.
  rsvpEndpoint: '/api/rsvp',
};
