'use strict';

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

// 在完整候选集上筛选、排序后分页。短词同样检索 FTS 中保存的中文标题、实体与公司。
function articleSearch(search, { like = false } = {}) {
  if (!search) return { sql: '1=1', params: [] };
  if (!like && [...search].length >= 3) {
    return {
      sql: 'a.analyzed >= 1 AND a.id IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?)',
      params: [`"${search.replace(/"/g, '""')}"`]
    };
  }
  const pattern = `%${escapeLikePattern(search)}%`;
  return {
    sql: `a.analyzed >= 1 AND a.id IN (SELECT rowid FROM articles_fts
      WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')`,
    params: [pattern, pattern]
  };
}

module.exports = { articleSearch };
