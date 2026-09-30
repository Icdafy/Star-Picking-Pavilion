'use strict';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfLocalDayIso(date = new Date()) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  ).toISOString();
}

function localDateTimeToIso(dateString, hour) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

// 报道时间不可能晚于采集时刻：列表页把报名截止日当成发布日、交易所公告按次一交易日零点标注，
// 都会写出“未来时间”，让条目在时间轴上排到最前并显示成下个月的日期。晚于采集时刻的一律以采集时刻为准。
function clampPublishedAt(publishedAt, fetchedAt) {
  const published = Date.parse(publishedAt);
  if (!publishedAt || !Number.isFinite(published)) return publishedAt || null;
  const fetched = Date.parse(fetchedAt);
  if (!Number.isFinite(fetched) || published <= fetched) return publishedAt;
  return new Date(fetched).toISOString();
}

module.exports = { localDateString, localDateTimeToIso, startOfLocalDayIso, clampPublishedAt };
