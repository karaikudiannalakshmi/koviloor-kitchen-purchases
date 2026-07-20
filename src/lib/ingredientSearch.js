import { INGREDIENT_ALIASES, INGREDIENT_PHONETIC } from './ingredientAliases';

// Dynamic Tamil → Latin romanizer, so ANY name (incl. renamed/transliterated items not in the
// static table) is searchable by English-phonetic typing. e.g. "சுவீட் கார்ன்" → "suviit kaarn".
const TA_V = { 'அ': 'a', 'ஆ': 'aa', 'இ': 'i', 'ஈ': 'ii', 'உ': 'u', 'ஊ': 'uu', 'எ': 'e', 'ஏ': 'ee', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'oo', 'ஔ': 'au' };
const TA_C = { 'க': 'k', 'ங': 'ng', 'ச': 's', 'ஜ': 'j', 'ஞ': 'nj', 'ட': 't', 'ண': 'n', 'த': 'th', 'ந': 'n', 'ன': 'n', 'ப': 'p', 'ம': 'm', 'ய': 'y', 'ர': 'r', 'ற': 'r', 'ல': 'l', 'ள': 'l', 'ழ': 'zh', 'வ': 'v', 'ஷ': 'sh', 'ஸ': 's', 'ஶ': 's', 'ஹ': 'h', 'ஃ': 'h' };
const TA_M = { 'ா': 'aa', 'ி': 'i', 'ீ': 'ii', 'ு': 'u', 'ூ': 'uu', 'ெ': 'e', 'ே': 'ee', 'ை': 'ai', 'ொ': 'o', 'ோ': 'oo', 'ௌ': 'au' };
const TA_VIRAMA = '்';

export function romanizeTamil(s) {
  const ch = [...(s || '')];
  let out = '';
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (TA_C[c] !== undefined) {
      const n = ch[i + 1];
      if (n === TA_VIRAMA) { out += TA_C[c]; i++; }
      else if (TA_M[n] !== undefined) { out += TA_C[c] + TA_M[n]; i++; }
      else { out += TA_C[c] + 'a'; }
    } else if (TA_V[c] !== undefined) out += TA_V[c];
    else if (TA_M[c] !== undefined) out += TA_M[c];
    else if (c === TA_VIRAMA) { /* drop */ }
    else out += c; // latin / digits / spaces pass through
  }
  return out;
}

// Fuzzy-normalize so spelling variants collapse together:
// lowercase, drop 'h' (th=t, sh=s), zh/z -> l, w -> v, simplify Tamil clusters, squash repeats.
export function norm(x) {
  return (x || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0B80-\u0BFF ]+/g, ' ')
    .replace(/h/g, '')
    .replace(/z/g, 'l')
    .replace(/w/g, 'v')
    .replace(/ngk/g, 'ng').replace(/nk/g, 'ng')
    .replace(/njs/g, 'nj')
    .replace(/nt/g, 'nd')
    .replace(/(.)\1+/g, '$1')
    .trim();
}

// All searchable text for an ingredient: Tamil name + dynamic romanization + static phonetic/alias + per-item keyword.
export function ingredientHaystack(i) {
  return norm(`${i.name} ${romanizeTamil(i.name)} ${INGREDIENT_PHONETIC[i.name] || ''} ${INGREDIENT_ALIASES[i.name] || ''} ${i.search || ''}`);
}

export function ingredientMatches(i, term) {
  const t = norm(term);
  if (!t) return true;
  return ingredientHaystack(i).includes(t);
}

export function phoneticOf(i) {
  return i.searchPhonetic || INGREDIENT_PHONETIC[i.name] || romanizeTamil(i.name);
}
