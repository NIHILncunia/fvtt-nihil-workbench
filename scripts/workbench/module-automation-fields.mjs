// Midi-QOL 13 activity schema. Keep the dedicated scope separate from module internals.
export const MIDI_AUTOMATION_LABELS = Object.freeze({
  midiProperties: 'Midi-QOL 자동화', confirmTargets: '대상 확인',
  forceConsumeDialog: '자원 소모 확인창', forceRollDialog: '굴림 확인창', forceDamageDialog: '피해 확인창',
  autoConsume: '자원 자동 소모', chooseEffects: '적용할 효과 선택', toggleEffect: '기존 효과 켜기·끄기',
  ignoreFullCover: '완전 엄폐 무시', magicEffect: '마법 효과로 취급', magicDamage: '마법 피해로 취급',
  noConcentrationCheck: '집중 판정 생략', automationOnly: '자동화 연결에서만 사용', displayActivityName: '액티비티 이름 표시',
});

export const MIDI_AUTOMATION_CHOICES = Object.freeze({
  'midiProperties.confirmTargets': { default: '월드 설정 따르기', always: '항상 확인', never: '확인 생략' },
  'midiProperties.forceConsumeDialog': { default: '월드 설정 따르기', always: '항상 표시', never: '표시 생략' },
  'midiProperties.forceRollDialog': { default: '월드 설정 따르기', always: '항상 표시', never: '표시 생략' },
  'midiProperties.forceDamageDialog': { default: '월드 설정 따르기', always: '항상 표시', never: '표시 생략' },
});

export function isDedicatedMidiField(path) {
  return path.startsWith('midiProperties.') && Object.hasOwn(MIDI_AUTOMATION_LABELS, path.split('.')[1]);
}
