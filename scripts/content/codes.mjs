// Canonical D&D5e 5.2.4 identifiers. Values are checked against runtime schemas.
export const DamageType = Object.freeze({
  ACID: 'acid',
  BLUDGEONING: 'bludgeoning',
  COLD: 'cold',
  FIRE: 'fire',
  FORCE: 'force',
  LIGHTNING: 'lightning',
  NECROTIC: 'necrotic',
  PIERCING: 'piercing',
  POISON: 'poison',
  PSYCHIC: 'psychic',
  RADIANT: 'radiant',
  SLASHING: 'slashing',
  THUNDER: 'thunder',
});

export const HealingType = Object.freeze({
  HEALING: 'healing',
  TEMPHP: 'temphp',
});

export const Condition = Object.freeze({
  BLEEDING: 'bleeding',
  BLINDED: 'blinded',
  BURNING: 'burning',
  CHARMED: 'charmed',
  CURSED: 'cursed',
  DEHYDRATION: 'dehydration',
  DEAFENED: 'deafened',
  DISEASED: 'diseased',
  EXHAUSTION: 'exhaustion',
  FALLING: 'falling',
  FRIGHTENED: 'frightened',
  GRAPPLED: 'grappled',
  INCAPACITATED: 'incapacitated',
  INVISIBLE: 'invisible',
  MALNUTRITION: 'malnutrition',
  PARALYZED: 'paralyzed',
  PETRIFIED: 'petrified',
  POISONED: 'poisoned',
  PRONE: 'prone',
  RESTRAINED: 'restrained',
  SILENCED: 'silenced',
  STUNNED: 'stunned',
  SUFFOCATION: 'suffocation',
  SURPRISED: 'surprised',
  TRANSFORMED: 'transformed',
  UNCONSCIOUS: 'unconscious',
});

export const Status = Object.freeze({
  BURROWING: 'burrowing',
  CONCENTRATING: 'concentrating',
  COVER_HALF: 'coverHalf',
  COVER_THREE_QUARTERS: 'coverThreeQuarters',
  COVER_TOTAL: 'coverTotal',
  DEAD: 'dead',
  DODGING: 'dodging',
  ETHEREAL: 'ethereal',
  FLYING: 'flying',
  HIDING: 'hiding',
  HOVERING: 'hovering',
  MARKED: 'marked',
  SLEEPING: 'sleeping',
  STABLE: 'stable',
});

export const SpecialStatus = Object.freeze({
  BLOODIED: 'bloodied',
});

export const CreatureType = Object.freeze({
  ABERRATION: 'aberration',
  BEAST: 'beast',
  CELESTIAL: 'celestial',
  CONSTRUCT: 'construct',
  DRAGON: 'dragon',
  ELEMENTAL: 'elemental',
  FEY: 'fey',
  FIEND: 'fiend',
  GIANT: 'giant',
  HUMANOID: 'humanoid',
  MONSTROSITY: 'monstrosity',
  OOZE: 'ooze',
  PLANT: 'plant',
  UNDEAD: 'undead',
});

export const Size = Object.freeze({
  TINY: 'tiny',
  SM: 'sm',
  MED: 'med',
  LG: 'lg',
  HUGE: 'huge',
  GRG: 'grg',
});

export const Ability = Object.freeze({
  STR: 'str',
  DEX: 'dex',
  CON: 'con',
  INT: 'int',
  WIS: 'wis',
  CHA: 'cha',
  HON: 'hon',
  SAN: 'san',
});

export const Skill = Object.freeze({
  ACR: 'acr',
  ANI: 'ani',
  ARC: 'arc',
  ATH: 'ath',
  DEC: 'dec',
  HIS: 'his',
  INS: 'ins',
  ITM: 'itm',
  INV: 'inv',
  MED: 'med',
  NAT: 'nat',
  PRC: 'prc',
  PRF: 'prf',
  PER: 'per',
  REL: 'rel',
  SLT: 'slt',
  STE: 'ste',
  SUR: 'sur',
});

export const Movement = Object.freeze({
  WALK: 'walk',
  BURROW: 'burrow',
  CLIMB: 'climb',
  FLY: 'fly',
  SWIM: 'swim',
});

export const Sense = Object.freeze({
  BLINDSIGHT: 'blindsight',
  DARKVISION: 'darkvision',
  TREMORSENSE: 'tremorsense',
  TRUESIGHT: 'truesight',
});

export const Activation = Object.freeze({
  ACTION: 'action',
  BONUS: 'bonus',
  REACTION: 'reaction',
  MINUTE: 'minute',
  HOUR: 'hour',
  DAY: 'day',
  LONG_REST: 'longRest',
  SHORT_REST: 'shortRest',
  ENCOUNTER: 'encounter',
  TURN_START: 'turnStart',
  TURN_END: 'turnEnd',
  LEGENDARY: 'legendary',
  MYTHIC: 'mythic',
  LAIR: 'lair',
  CREW: 'crew',
  SPECIAL: 'special',
});

export const Target = Object.freeze({
  SELF: 'self',
  ALLY: 'ally',
  ENEMY: 'enemy',
  CREATURE: 'creature',
  OBJECT: 'object',
  SPACE: 'space',
  CREATURE_OR_OBJECT: 'creatureOrObject',
  ANY: 'any',
  WILLING: 'willing',
});

export const Area = Object.freeze({
  CIRCLE: 'circle',
  CONE: 'cone',
  CUBE: 'cube',
  CYLINDER: 'cylinder',
  LINE: 'line',
  RADIUS: 'radius',
  SPHERE: 'sphere',
  SQUARE: 'square',
  WALL: 'wall',
});

export const Recovery = Object.freeze({
  LR: 'lr',
  SR: 'sr',
  DAY: 'day',
  DAWN: 'dawn',
  DUSK: 'dusk',
  INITIATIVE: 'initiative',
  TURN_START: 'turnStart',
  TURN_END: 'turnEnd',
  TURN: 'turn',
});

export const MonsterRole = Object.freeze({
  NORMAL: 'normal',
  ELITE: 'elite',
  BOSS: 'boss',
});

// Foundry v14: 효과 변경값의 적용 방식은 문자열 type이다. 예전 숫자 mode(0~5)도 builders가 받아 바꾼다.
export const EffectMode = Object.freeze({
  CUSTOM: 'custom',
  MULTIPLY: 'multiply',
  ADD: 'add',
  SUBTRACT: 'subtract',
  DOWNGRADE: 'downgrade',
  UPGRADE: 'upgrade',
  OVERRIDE: 'override',
});

export const codes = Object.freeze({
  DamageType,
  HealingType,
  Condition,
  Status,
  SpecialStatus,
  CreatureType,
  Size,
  Ability,
  Skill,
  Movement,
  Sense,
  Activation,
  Target,
  Area,
  Recovery,
  MonsterRole,
  EffectMode,
});
export const ITEM_TYPES = Object.freeze([
  'weapon',
  'equipment',
  'consumable',
  'tool',
  'loot',
  'race',
  'background',
  'class',
  'subclass',
  'spell',
  'feat',
  'container',
  'facility',
]);
export const ACTIVITY_TYPES = Object.freeze([
  'attack',
  'cast',
  'check',
  'damage',
  'enchant',
  'forward',
  'heal',
  'save',
  'summon',
  'transform',
  'utility',
]);
export const ADVANCEMENT_TYPES = Object.freeze([
  'AbilityScoreImprovement',
  'HitPoints',
  'ItemChoice',
  'ItemGrant',
  'ScaleValue',
  'Size',
  'Subclass',
  'Trait',
]);
