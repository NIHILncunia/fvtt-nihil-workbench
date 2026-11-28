// 하트 로그 형식(2026-11-28): 채팅 메시지를 RP 로그 게시용 하트백업 카드 HTML로 바꾼다.
// created-gallery의 변환을 참고해 새로 짰다. 메시지 문서(말한 이·귓속말·굴림)를 먼저 보고,
// 그려진 카드(DOM)는 dnd5e·midi-qol 카드의 결과를 읽을 때만 쓴다.
// 변환하지 못한 메시지도 「ERROR」 카드 대신 읽을 수 있는 글이나 시스템 줄로 남긴다.
import { escapeHtml, formatClock, formatShortClock } from './shared.mjs';

const FONT = 'font-family: Pretendard-Regular, sans-serif;';
const STYLE = {
  general: `${FONT} padding: 0px 5px 6px 45px; margin: 0px; border: none; outline: none; position: relative; line-height: 1.25em; color: #3f3f3f; font-size: 16px;`,
  gm: `${FONT} padding: 0px 5px 6px 45px; margin: 0px; border: none; outline: none; position: relative; line-height: 1.25em; background: #dddddd; color: #404040; font-size: 16px;`,
  whisper: `${FONT} padding: 0px 5px 6px 45px; margin: 0px; border: none; outline: none; position: relative; line-height: 1.25em; background-color: #f2f5d3; color: #404040; font-size: 16px;`,
  system: `${FONT} padding: 0px 5px 6px 45px; margin: 0px; border: none; outline: none; position: relative; line-height: 1.25em; background-color: rgba(45, 45, 45, 0); color: #9b9b9b; font-size: 16px;`,
  desc: `${FONT} padding: 0px 5px 6px 15px; margin: 0px; border: none; outline: none; position: relative; line-height: 1.25em; font-style: italic; font-weight: bold; text-align: center; background-color: rgba(241, 241, 241, 0); color: #404040; font-size: 16px;`,
  spacer: (color) => `${FONT} padding: 0px; margin: 0px -5px 8px -45px; border: none; outline: none; background-color: ${color}; height: 1px;`,
  descSpacer: `${FONT} padding: 0px; margin: 0px -5px 8px -15px; border: none; outline: none; background-color: #ddd; height: 1px;`,
  avatar: `${FONT} padding: 0px; margin: 0px; border: none; outline: none; position: absolute; top: 0.2rem; left: 5px; width: 28px; height: 28px; align-items: stretch;`,
  portrait: `${FONT} padding: 0px; margin: 0px; border: none; outline: none; width: 28px; height: 28px; object-fit: cover; border-radius: 0%;`,
  by: `${FONT} padding: 0px; margin: 0px; border: none; outline: none; font-weight: bold; position: relative; display: inline-block; left: -5px; vertical-align: top;`,
  inlineRoll: `${FONT} padding: 2px 5px; margin: 0px; border: 1px solid #999999; outline: none; background: rgba(255, 255, 255, 0.4); font-weight: bolder; cursor: help; font-size: 1.1em;`,
  template: `${FONT} padding: 0px; margin: 0px; border-width: 10px 0px; border-image: initial; outline: none; position: relative; width: 100%; max-width: 500px; box-sizing: border-box; border-color: transparent initial transparent initial; border-style: solid initial solid initial;`,
  templateWrap: `${FONT} padding: 12px; margin: 0px; border: none; outline: none; background-color: white; border-radius: 0px 20px;`,
  templateHead: `${FONT} padding: 0px; margin: 0px; border: none; outline: none;`,
  templateTitle: `${FONT} padding: 0px; margin: 0px; border: none; outline: none; display: block; font-size: 16px; font-weight: 800; line-height: 1.6;`,
  templateBody: `${FONT} padding: 0px; margin: 4px 0px 0px; border-top: 1px solid #dbdbdb; border-right: none; border-bottom: none; border-left: none; border-image: initial; outline: none;`,
  result: `${FONT} padding: 0px; margin: 0px; border: none; outline: none;`,
  resultValue: 'font-family: Fraunces, serif; padding: 2px 5px; margin: 0px; border: 0px; outline: none; background: transparent; font-weight: bold; cursor: help; font-size: 24px; text-align: center;',
  damage: `${FONT} padding: 3px; margin: 2px 0px 0px; border: none; outline: none; font-size: 14px; background-color: #eeeeee;`,
  damageValue: `${FONT} padding: 0px; margin: 0px; border: 0px; outline: none; background: transparent; font-weight: bold; cursor: help; text-align: center;`,
  sheetDesc: `${FONT} padding: 5px 0px 2px; margin: 0px; border: none; outline: none; color: #b2b2b2; font-size: 11px;`,
  tagDark: `${FONT} padding: 1px 5px; margin: 4px 0px 0px; border: none; outline: none; display: inline-block; background-color: #333333; border-radius: 2px; font-size: 11px; color: white;`,
  tagLight: `${FONT} padding: 1px 5px; margin: 4px 0px 0px; border: none; outline: none; display: inline-block; background-color: #dbdbdb; border-radius: 2px; font-size: 11px;`,
};

const SPACER_COLORS = { whisper: '#f0f092' };
const ROLL_WORDS_TO_DROP = new Set([
  '(Intelligence)', '(건강)', '(Dexterity)', 'Check', '(민첩)', '기술', '(Strength)',
  'Ability', '(매력)', '(지혜)', 'Skill', '(Wisdom)', '판정', '(Charisma)', '(지능)',
  '(Constitution)', '(근력)', '굴림',
]);
const MYSTERY = /icons\/svg\/mystery-man\.svg$/;

function textOf(
  node,
  separator = '',
) {
  if (!node) return '';
  const parts = [];
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const text = current.nodeValue.replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }
  return parts.join(separator);
}

/** 글 내용을 게시용 HTML로: 단락·줄바꿈과 굵게·기울임만 남기고, 인라인 굴림은 결과 칸으로. */
export function simpleContentHtml(node) {
  if (!node) return '';
  const blocks = new Set(['P', 'DIV', 'SECTION', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR']);
  const keep = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's' };
  const walk = (current) => {
    if (current.nodeType === Node.TEXT_NODE) return escapeHtml(current.nodeValue.replace(/\s+/g, ' '));
    if (current.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = current.tagName;
    if (tag === 'BR') return '<br>';
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'BUTTON') return '';
    if (tag === 'IMG') return '';
    if (current.matches?.('a.inline-roll')) {
      const result = textOf(current);
      return result ? `<span style="${STYLE.inlineRoll}" class="inlinerollresult showtip tipsy-n-right">${escapeHtml(result)}</span>` : '';
    }
    const inner = [...current.childNodes].map(walk).join('');
    if (keep[tag]) return inner.trim() ? `<${keep[tag]}>${inner}</${keep[tag]}>` : inner;
    if (blocks.has(tag)) return `\n${inner}\n`;
    if (tag === 'TD' || tag === 'TH') return `${inner} `;
    return inner;
  };
  return [...node.childNodes].map(walk).join('')
    .split('\n')
    .map((line) => line.replace(/^(\s|&nbsp;)+|(\s|&nbsp;)+$/g, ''))
    .filter(Boolean)
    .join('<br>');
}

/** 메시지를 말한 이·초상·종류. 문서 자료가 정본이다. */
function speakerOf(
  message,
  element,
) {
  const game = globalThis.game;
  const speaker = message.speaker ?? {};
  const author = message.author ?? game?.users?.get(message._source?.author ?? message.user);
  const actor = speaker.actor ? game?.actors?.get(speaker.actor) : null;
  const scene = speaker.scene ? game?.scenes?.get(speaker.scene) : null;
  const token = speaker.token ? scene?.tokens?.get(speaker.token) : null;
  const name = String(message.alias || speaker.alias || token?.name || actor?.name || author?.name || '').trim();
  const rendered = element?.querySelector?.('.message-sender img, header img.message-portrait, .avatar img')?.getAttribute('src');
  const candidates = [rendered, token?.texture?.src, actor?.img, author?.avatar];
  const portrait = candidates.find((src) => src && !MYSTERY.test(src)) ?? null;
  const isGm = Boolean(author?.isGM && !speaker.actor && !speaker.token);
  return { name, portrait, isGm, authorName: author?.name ?? '' };
}

function whisperTargets(message) {
  const users = globalThis.game?.users;
  return (message.whisper ?? []).map((id) => users?.get(id)?.name).filter(Boolean);
}

function isWhisper(message) {
  return Boolean(message.whisper?.length);
}

/** 플레이어에게 보였는지. 공개판은 이것만 남긴다. */
export function visibleToPlayers(message) {
  if (!isWhisper(message)) return true;
  const users = globalThis.game?.users;
  return message.whisper.some((id) => users?.get(id) && !users.get(id).isGM) && !message.blind;
}

function rollState(roll) {
  if (!roll) return 'normal';
  if (roll.isCritical === true) return 'crit';
  if (roll.isFumble === true) return 'fumble';
  const target = Number(roll.options?.target);
  if (Number.isFinite(target) && Number.isFinite(roll.total)) return roll.total >= target ? 'success' : 'fail';
  for (const die of roll.dice ?? []) {
    if (Number(die.faces) !== 20) continue;
    const active = (die.results ?? []).filter((result) => result.active !== false && !result.discarded);
    if (active.some((result) => result.result === 20)) return 'crit';
    if (active.length && active.every((result) => result.result === 1)) return 'fumble';
  }
  return 'normal';
}

function cleanRollTitle(text) {
  return String(text ?? '')
    .split(/\s+/)
    .filter((word) => word && !ROLL_WORDS_TO_DROP.has(word))
    .join(' ')
    .replace('캐릭터가 우선권을 굴립니다!', '우선권')
    .replace('rolls for Initiative!', '우선권')
    .trim();
}

function domRollState(totalElement) {
  const classes = String(totalElement?.getAttribute?.('class') ?? '');
  if (/critical/.test(classes)) return 'crit';
  if (/fumble/.test(classes)) return 'fumble';
  if (/failure/.test(classes)) return 'fail';
  if (/success/.test(classes)) return 'success';
  return 'normal';
}

/** 그려진 카드에서 건너뛸 것: 피해 적용 카드, 중복 내성 카드. */
function skipReason(element) {
  const text = element?.textContent ?? '';
  if (text.includes('HP 업데이트 되지 않음') || text.includes('HP 업데이트 됨')) return 'damage-application';
  if (element?.querySelector?.('.midi-qol-damage-card, .damage-application')) return 'damage-application';
  if (element?.querySelector?.('.monks-tokenbar.savingthrow.chat-card')) return 'duplicate-save';
  return null;
}

const HM_PATTERNS = [
  [/(.+) takes (\d+) damage/, '$1 HP -$2'],
  [/(.+) gains (\d+) temp HP/, '$1 임시HP +$2'],
  [/(.+) heals (\d+) HP/, '$1 HP +$2'],
  [/(.+) gains (\d+) max HP/, '$1 최대HP +$2'],
  [/(.+) loses (\d+) max HP/, '$1 최대HP -$2'],
];

function systemLine(element) {
  const health = element?.querySelector?.('[class*="hm-message"]');
  if (health) {
    const original = textOf(health.querySelector('span') ?? health, ' ');
    for (const [pattern, replacement] of HM_PATTERNS) {
      if (pattern.test(original)) return original.replace(pattern, replacement);
    }
    return original;
  }
  const flavor = textOf(element?.querySelector?.('.flavor-text'));
  const content = element?.querySelector?.('.message-content');
  if (['긴 휴식', '짧은 휴식', 'Long Rest', 'Short Rest'].some((phrase) => flavor.includes(phrase))) {
    return `${flavor}${content ? ` — ${textOf(content, ' ')}` : ''}`;
  }
  if (content && content.textContent.includes('3회의 죽음 내성 굴림에')) return textOf(content, ' ');
  return null;
}

function descLine(element) {
  const announcer = element?.querySelector?.('.turn-announcer');
  if (announcer) {
    const actor = textOf(announcer.querySelector('h2.actor, .actor') ?? announcer);
    return actor ? `${actor}의 차례` : textOf(announcer, ' ');
  }
  const round = element?.querySelector?.('h3.round-message');
  if (round) return textOf(round);
  const nameBox = element?.querySelector?.('span.name-box');
  if (nameBox) return textOf(nameBox);
  return null;
}

/** 굴림 정보: 제목·결과·피해·대상 AC·내성. dnd5e 굴림 자료가 정본, midi 카드는 DOM으로 보탠다. */
function rollInfo(
  message,
  element,
) {
  const rolls = message.rolls ?? [];
  const card = element?.querySelector?.('.chat-card');
  const midiAttack = element?.querySelector?.('.midi-qol-attack-roll');
  const midiDamage = element?.querySelector?.('.midi-qol-damage-roll');
  const hasDiceRoll = Boolean(element?.querySelector?.('.dice-roll'));
  if (!rolls.length && !card && !hasDiceRoll) return null;

  const cardTitle = textOf(card?.querySelector('.card-header .title, span.title'));
  const subtitle = textOf(card?.querySelector('.card-header .subtitle'));
  const flavor = textOf(element?.querySelector?.('.flavor-text')) || String(message.flavor ?? '').replace(/<[^>]+>/g, ' ').trim();
  let title = cleanRollTitle(cardTitle || flavor);

  const typeOf = (roll) => roll?.options?.type ?? roll?.constructor?.name ?? '';
  const isDamage = (roll) => /damage/i.test(typeOf(roll)) || roll?.constructor?.name === 'DamageRoll';
  const d20Rolls = rolls.filter((roll) => !isDamage(roll) && (roll.dice ?? []).some((die) => Number(die.faces) === 20));
  const damageRolls = rolls.filter(isDamage);

  let result = null;
  if (midiAttack) {
    const total = [...midiAttack.querySelectorAll('h4.dice-total')].at(-1);
    const value = textOf(total);
    if (/^-?\d+$/.test(value)) result = { value, state: domRollState(total) };
    const bonus = [...midiAttack.querySelectorAll('div[style]')].find((div) => (div.getAttribute('style') ?? '').includes('text-align:center'));
    if (bonus && textOf(bonus)) title = `${title} (${textOf(bonus)})`;
  } else if (d20Rolls.length) {
    const roll = d20Rolls.at(-1);
    result = { value: String(roll.total), state: rollState(roll) };
  } else if (rolls.length && !damageRolls.length) {
    const roll = rolls.at(-1);
    result = { value: String(roll.total), state: rollState(roll) };
    if (!title) title = cleanRollTitle(roll.formula);
  } else if (!rolls.length && hasDiceRoll && !card) {
    const total = element.querySelector('h4.dice-total');
    const value = textOf(total);
    if (value) result = { value, state: domRollState(total) };
    if (!title) title = textOf(element.querySelector('.dice-formula'));
  }
  // dnd5e 우선권의 동점 깨기 소수(18.1)는 버린다.
  if (result && (message.flags?.core?.initiative || title.includes('우선권')) && /^-?\d+\.\d+$/.test(result.value)) {
    result.value = String(Math.floor(Number(result.value)));
  }
  if (title.includes('죽음 내성') && result && /^-?\d+$/.test(result.value) && Number(result.value) < 10) result.state = 'fail';

  let damage = null;
  if (midiDamage) {
    const totals = [...midiDamage.querySelectorAll('h4.dice-total')].map((total) => textOf(total)).filter(Boolean);
    if (totals.length) damage = totals.join(' + ');
  } else if (damageRolls.length) {
    damage = damageRolls.map((roll) => {
      const types = [...new Set((roll.terms ?? []).map((term) => term.flavor || term.options?.flavor).filter(Boolean))];
      const typeText = types.length ? ` ${types.map((type) => globalThis.CONFIG?.DND5E?.damageTypes?.[type]?.label ?? type).join('·')}` : '';
      return `${roll.total}${typeText}`;
    }).join(' + ');
  }

  const targets = [];
  const hits = element?.querySelector?.('.midi-qol-hits-display');
  if (hits) {
    const names = [...hits.querySelectorAll('div.name-stacked, .target-name')];
    const acs = [...hits.querySelectorAll('div.midi-qol-ac, .ac')];
    names.slice(0, acs.length).forEach((name, index) => targets.push(`${textOf(name)} AC: ${textOf(acs[index])}`));
  }
  const saves = [];
  let saveDc = '';
  const saveDisplay = element?.querySelector?.('.midi-qol-saves-display');
  if (saveDisplay) {
    saveDc = textOf(saveDisplay.querySelector('label.midi-qol-saveDC'));
    for (const target of [...saveDisplay.querySelectorAll('div')].filter((div) => /midi-qol/.test(div.className) && /target/.test(div.className))) {
      const name = textOf(target.querySelector('.midi-qol-gmTokenName, .name-stacked'));
      const value = textOf(target.querySelector('h4.dice-total'));
      if (name || value) saves.push(`${name}: 내성 굴림 ${value}`);
    }
  }

  if (!title && !result && !damage) return null;
  return { title: title || '굴림', subtitle, result, damage, targets, saveDc, saves };
}

function imagesOf(element) {
  const content = element?.querySelector?.('.message-content');
  if (!content) return { sources: [], caption: '' };
  const sources = [...content.querySelectorAll('img')]
    .filter((img) => img.getAttribute('src') && !/icon/i.test(img.getAttribute('class') ?? '') && !img.closest('header, .card-header, .item-icon'))
    .map((img) => img.getAttribute('src'));
  const paragraphs = [...content.querySelectorAll('p')]
    .map((paragraph) => textOf(paragraph, ' '))
    .filter(Boolean);
  return { sources, caption: paragraphs.join('\n') };
}

/**
 * 메시지 하나를 로그 항목으로. null이면 건너뛴다(사유는 skipped에).
 * 항목: { kind: 'say'|'gm'|'whisper'|'system'|'desc'|'roll'|'image', speaker, portrait, html?, roll?, images?, caption?, timestamp }
 */
export function messageToEntry(
  message,
  element,
  { publicCopy = false } = {},
) {
  const skip = skipReason(element);
  if (skip) return { skipped: skip };
  if (publicCopy && !visibleToPlayers(message)) return { skipped: 'not-public' };
  const timestamp = Number(message.timestamp);
  const who = speakerOf(message, element);
  const base = { speaker: who.name, portrait: who.portrait, timestamp, id: message.id };

  const desc = descLine(element);
  if (desc) return { ...base, kind: 'desc', html: escapeHtml(desc) };
  const system = systemLine(element);
  if (system) return { ...base, kind: 'system', html: escapeHtml(system) };

  if (isWhisper(message)) {
    const content = element?.querySelector?.('.message-content');
    const roll = rollInfo(message, element);
    const targets = whisperTargets(message);
    return {
      ...base,
      kind: 'whisper',
      speaker: `${who.name || who.authorName}${targets.length ? ` > ${targets.join(', ')}` : ''}`,
      html: simpleContentHtml(content) || (roll ? escapeHtml(`${roll.title}${roll.result ? ` ${roll.result.value}` : ''}`) : ''),
    };
  }

  const roll = rollInfo(message, element);
  if (roll) return { ...base, kind: 'roll', roll };

  const { sources, caption } = imagesOf(element);
  if (sources.length) return { ...base, kind: 'image', images: sources, caption };

  const content = element?.querySelector?.('.message-content');
  let html = simpleContentHtml(content);
  if (!html) html = escapeHtml(String(message.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (!html) return { skipped: 'empty' };
  const style = Number(message.style);
  const emote = style === globalThis.CONST?.CHAT_MESSAGE_STYLES?.EMOTE;
  return { ...base, kind: who.isGm ? 'gm' : 'say', html: emote ? `<i>${html}</i>` : html, speaker: who.name || who.authorName || '이름 없음' };
}

function portraitHtml(
  entry,
  portraitRef,
) {
  const ref = entry.portrait ? portraitRef(entry.portrait) : null;
  if (!ref) return `<div class="avatar" style="${STYLE.avatar}" aria-hidden="true">&nbsp;</div>`;
  return `<div class="avatar" style="${STYLE.avatar}" aria-hidden="true">\n<span class="cgx-img" role="img" style="${STYLE.portrait}background-image:var(${ref});"></span>\n</div>`;
}

function timeHtml(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  return `<time class="hx-time" title="${formatClock(timestamp)}">${formatShortClock(timestamp)}</time>`;
}

function headerHtml(
  entry,
  { spacerColor = '#e1e1e1', withPortrait = true, colon = true },
  portraitRef,
) {
  const avatar = withPortrait ? portraitHtml(entry, portraitRef) : `<div class="avatar" style="${STYLE.avatar}" aria-hidden="true">&nbsp;</div>`;
  return `\n<div class="spacer" style="${STYLE.spacer(spacerColor)}">&nbsp;</div>\n${avatar}\n<span style="${STYLE.by}" class="by">${escapeHtml(entry.speaker)}${colon ? ':' : ''}</span>${timeHtml(entry.timestamp)}\n`;
}

function rollTemplateHtml(roll) {
  const tags = [
    ...roll.targets.map((text) => `<span style="${STYLE.tagDark}" class="sheet-tag">${escapeHtml(text)}</span>`),
    roll.saveDc ? `<span style="${STYLE.tagDark}" class="sheet-tag sheet-hl">${escapeHtml(roll.saveDc)}</span>` : '',
    ...roll.saves.map((text) => `&nbsp;<span style="${STYLE.tagLight}" class="sheet-tag">${escapeHtml(text)}</span>`),
  ].filter(Boolean).join('&nbsp;');
  const color = roll.result?.state === 'fail' || roll.result?.state === 'fumble'
    ? 'color: #830101;'
    : roll.result?.state === 'crit' ? 'color: #3fb315;' : '';
  const result = roll.result
    ? `<div class="sheet-result" style="${STYLE.result}"><span style="${STYLE.resultValue} ${color}" class="inlinerollresult showtip tipsy-n-right">${escapeHtml(roll.result.value)}</span></div>`
    : '';
  const damage = roll.damage
    ? `<div class="sheet-dmg" style="${STYLE.damage}"> 피해:&nbsp;<span style="${STYLE.damageValue}" class="inlinerollresult showtip tipsy-n-right">${escapeHtml(roll.damage)}</span></div>`
    : '';
  const subtitle = roll.subtitle ? `<div class="sheet-desc" style="${STYLE.sheetDesc}">${escapeHtml(roll.subtitle)}</div>` : '';
  return `\n<div class="sheet-rolltemplate-custom" style="${STYLE.template}">\n<div class="sheet-rtw" style="${STYLE.templateWrap}">\n<div class="sheet-rth" style="${STYLE.templateHead}">\n<span style="${STYLE.templateTitle}">${escapeHtml(roll.title)}</span>\n${tags}\n</div>\n<div class="sheet-rtb" style="${STYLE.templateBody}">\n${result}\n${damage}\n${subtitle}\n</div>\n</div>\n</div>\n`;
}

function sameSpeaker(
  previous,
  entry,
) {
  if (!previous || previous.kind === 'desc' || entry.kind === 'desc') return false;
  const group = (kind) => (kind === 'roll' || kind === 'image' ? 'say' : kind);
  return group(previous.kind) === group(entry.kind) && previous.speaker === entry.speaker;
}

/**
 * 항목 하나를 카드 HTML로. previous가 같은 말한 이면 머리(구분선·초상·이름)를 생략한다.
 * imageRef(src) → 넣을 그림 자리표, portraitRef(src) → CSS 변수 이름.
 */
export function entryToHeartHtml(
  entry,
  previous,
  { imageRef, portraitRef },
) {
  const same = sameSpeaker(previous, entry);
  const attributes = `data-time="${Number.isFinite(entry.timestamp) ? entry.timestamp : ''}"`;
  switch (entry.kind) {
    case 'desc':
      return `\n<div class="message desc" ${attributes} style="${STYLE.desc}">\n<div class="spacer" style="${STYLE.descSpacer}">&nbsp;</div>\n${entry.html}\n</div>\n`;
    case 'system':
      return `<div class="message general system" ${attributes} style="${STYLE.system}">${same ? '' : headerHtml({ ...entry, speaker: '시스템' }, { withPortrait: false }, portraitRef)}${entry.html}</div>`;
    case 'whisper':
      return `<div class="message private whisper" ${attributes} style="${STYLE.whisper}">${same ? '' : headerHtml(entry, { spacerColor: SPACER_COLORS.whisper }, portraitRef)}${entry.html}</div>`;
    case 'gm':
      return `<div class="message general you" ${attributes} style="${STYLE.gm}">${same ? '' : headerHtml(entry, {}, portraitRef)}${entry.html}</div>`;
    case 'roll':
      return `<div class="message general" ${attributes} style="${STYLE.general}">${same ? '' : headerHtml(entry, { colon: false }, portraitRef)}${rollTemplateHtml(entry.roll)}</div>`;
    case 'image': {
      const images = entry.images.map((src) => `<img class="scene-img" src="${imageRef(src)}" alt="">`).join('');
      const caption = entry.caption ? `<div class="scene-caption">${escapeHtml(entry.caption).replace(/\n/g, '<br>')}</div>` : '';
      return `<div class="message general" ${attributes} style="${STYLE.general}">${same ? '' : headerHtml(entry, {}, portraitRef)}<div class="scene-card">${images}${caption}</div></div>`;
    }
    default:
      return `<div class="message general" ${attributes} style="${STYLE.general}">${same ? '' : headerHtml(entry, {}, portraitRef)}${entry.html}</div>`;
  }
}

/** 날짜 구분 줄(게시 형식의 desc 카드 모양). */
export function dayDividerHtml(
  dateKey,
  label,
) {
  return `\n<div class="message desc hx-day" id="d-${dateKey}" style="${STYLE.desc}">\n<div class="spacer" style="${STYLE.descSpacer}">&nbsp;</div>\n📅 ${escapeHtml(label)}\n</div>\n`;
}
