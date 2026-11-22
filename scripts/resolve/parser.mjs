import {
  TABLES
} from './tables.mjs';

export const GROUPS = [ '투지 차감', '투지 향상', '의지 차감', '의지 향상' ];

const MINION = {
  '투지 차감': [ 7, 8, 9, 11, 12 ],
  '투지 향상': [ 1, 2, 5, 6, 7, 11, 12 ],
  '의지 차감': [ 5, 8, 9, 12 ],
  '의지 향상': [ 4, 7, 8, 12 ]
};
/** DOM 없이 SBI의 p/br/ul/li와 Markdown 불릿을 같은 줄 구조로 읽는다. */

export function descriptionText(value = '') {
  return String(value).replace(
    /<li\b[^>]*>/gi,
    '\n- '
  ).replace(
    /<\/(?:p|li|ul|div|h[1-6])\s*>|<br\s*\/?>/gi,
    '\n'
  ).replace(
    /<[^>]*>/g,
    ''
  ).replace(
    /&nbsp;|&#160;/gi,
    ' '
  ).replace(
    /&lt;/g,
    '<'
  ).replace(
    /&gt;/g,
    '>'
  ).replace(
    /&quot;/g,
    '"'
  ).replace(
    /&#0?39;|&apos;/g,
    '\''
  ).replace(
    /&amp;/g,
    '&'
  ).replace(
    /&#(x[0-9a-f]+|\d+);/gi,
    (
      _,
      code
    ) => {
      return String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(
        code.slice(1),
        16
      ) : Number(code));
    }
  );
}

export function parseResolveFeats(items = []) {
  const feats = Array.from(items).filter(item => {
    return item.type === 'feat';
  });
  const source = feats.find(item => {
    return /^\s*투지\s*(\d+|—)\s*[·ㆍ・∙⋅]\s*의지\s*(\d+|—)\s*[.]?\s*$/.test(item.name);
  });
  const reactions = {};
  for (const item of feats) {
    const match = item.name?.match(/^\s*\((버팀|무너짐|폭주|붕괴|각성)\)/);
    if (!match) continue;
    const html = item.system?.description?.value ?? '';
    const text = descriptionText(html).trim();
    const type = text.match(new RegExp(`\\(${match[1]}\\s+(\\d+)`));
    reactions[match[1]] = {
      name: item.name,
      html: html,
      text: text,
      type: type ? Number(type[1]) : null
    };
  }
  if (!source) return {
    source: null,
    reactions: reactions
  };
  const values = source.name.match(/투지\s*(\d+|—)\s*[·ㆍ・∙⋅]\s*의지\s*(\d+|—)/);
  const text = descriptionText(source.system?.description?.value);
  const introduction = text.split(/(?:투지|의지)\s*(?:차감|향상)\s*\(/)[0];
  const conditions = Object.fromEntries(GROUPS.map(group => {
    return [ group, [] ];
  }));
  let group = null;
  let numbers = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(
      /^\s*>\s?/,
      ''
    ).replace(
      /\*\*/g,
      ''
    ).trim();
    const heading = line.match(/^(투지|의지)\s*(차감|향상)\s*[(:：]/);
    if (heading) {
      group = `${heading[1]} ${heading[2]}`;
      // 근원 12 맞수 등 뒤의 숫자는 원래 조건 번호에 포함하지 않는다.
      const list = line.match(new RegExp(`${heading[1]}\\s*${heading[2]}\\s+(\\d+(?:\\s*[·ㆍ・∙⋅,]\\s*\\d+)*)`));
      numbers = list ? list[1].split(/[·ㆍ・∙⋅,]/).map(Number) : [];
      continue;
    }
    if (!group || !line) continue;
    const slots = line.match(/\((?:(성공)\s*1칸\s*[,，]\s*큰\s*성공\s*2칸|(\d+)칸)\)\s*$/);
    if (!slots) continue;
    const number = numbers[conditions[group].length];
    if (!number || number < 1 || number > 12) continue;
    conditions[group].push({
      group: group,
      number: number,
      text: line.replace(
        /^[-*•]\s*/,
        ''
      ),
      amount: slots[1] ? 1 : Number(slots[2]),
      choice: Boolean(slots[1])
    });
  }
  return {
    source: source.id ?? source.name,
    max: {
      '투지': values[1] === '—' ? null : Number(values[1]),
      '의지': values[2] === '—' ? null : Number(values[2])
    },
    grade: introduction.match(/잡졸|일반|엘리트|보스/)?.[0] ?? '일반',
    named: /이름\s*있음/.test(introduction),
    leader: /우두머리/.test(introduction) && !/우두머리\s*아님/.test(introduction),
    basis: introduction.match(/근거[^.\n]*/)?.[0] ?? '',
    origin: introduction.match(/근원[^.\n]*/)?.[0] ?? '',
    conditions: conditions,
    reactions: reactions
  };
}

export function resolveProfile(
  items,
  stored = {}
) {
  const parsed = parseResolveFeats(items);
  const settings = stored.settings ?? {};
  const grade = parsed.source ? parsed.grade : settings.grade ?? '일반';
  const baseMax = {};
  const max = {};
  for (const axis of [ '투지', '의지' ]) {
    const base = parsed.source ? parsed.max[axis] : Number(settings[axis]) || null;
    baseMax[axis] = base;
    max[axis] = base == null ? null : Math.max(
      1,
      Math.min(
        6,
        base
      ) - (stored.reduction?.[axis] ?? 0)
    );
  }
  const conditions = parsed.source ? parsed.conditions : Object.fromEntries(GROUPS.map(group => {
    return [ group, TABLES[group].filter(row => {
      return grade !== '잡졸' || MINION[group].includes(row.number);
    }).map(row => {
      return {
        ...row,
        group: group,
        choice: /성공/.test(row.slots),
        amount: /^2$/.test(row.slots) ? 2 : 1
      };
    }) ];
  }));
  return {
    ...parsed,
    baseMax: baseMax,
    max: max,
    grade: grade,
    named: parsed.source ? parsed.named : Boolean(settings.named),
    kind: settings.kind ?? '사람',
    group: Boolean(settings.group),
    conditions: conditions
  };
}
