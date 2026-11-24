import {
  bindWorkbenchLayout,
  WorkbenchLayoutMixin,
  focusWorkbenchPath,
  restoreWorkbenchOnClose,
  showWorkbenchForm,
  workbenchFolderPath,
} from './workbench-layout.mjs';
import { openImageGallery } from '../gallery/image-gallery-app.mjs';

// 시험에서는 globalThis.__ncmImageGalleryOpener로 갤러리 창 대신 다른 열기 함수를 끼운다.
function itemImageGalleryOpener(options) {
  return (globalThis.__ncmImageGalleryOpener ?? openImageGallery)(options);
}
import { isWorkbenchUser } from '../shared/workbench-access.mjs';
import { advancementSourceList, hasAdvancementSource } from '../shared/advancement-source.mjs';
import { loadPackDocuments, packEditAllowed, requireModulePack, rootDocument } from './compendium-adapter.mjs';
import {
  buildActivityExtraDamageUpdate,
  createOnHitStatusEffect,
  createPassiveEffect,
  deleteOnHitEffect,
  formatDamagePartFormula,
  readItemWorkbenchModel,
  setActivityEffectAttached,
} from './item-adapter.mjs';
import {
  createEmbeddedItemContext,
  createPackItemContext,
  createWorldItemContext,
} from './item-document-context.mjs';
import { createItemWorkbenchPanel } from './item-workbench-panel.mjs';
import { editEffect } from './effect-workbench-app.mjs';
import { effectChangeTypeOptions } from '../shared/effect-change-types.mjs';
import { editOwnership } from './ownership-workbench-app.mjs';
import { requireWriteResult, requireWritableItem } from './write-result.mjs';
import { lockWorkbenchControls, rebaseItemDraftSnapshot } from './save-state.mjs';
import { editDocument } from './document-workbench-app.mjs';
import { itemEditSnapshot } from './document-fields.mjs';
import { createFolderInWorkbench, createItemInWorkbench } from './item-library.mjs';
import { formInputEntries, restoreFormInputs } from './form-inputs.mjs';
import { buildTypeFieldUpdate, displayTypeLabel, readTypeFields } from './type-field-adapter.mjs';
import { changeComplexList, changeComplexMapping, complexEditor, syncComplexInputs, toggleComplexObject } from './type-complex-fields.mjs';
import {
  availableActivityTypes,
  createActivity,
  deleteActivity,
  duplicateActivity,
  moveActivity,
  renameActivity,
} from './activity-adapter.mjs';
import { CORE_ACTIVITY_TYPES, activityFieldEditsFromForm, readActivityCommonFields, readActivitySpecificFields } from './activity-field-adapter.mjs';
import { buildActivityTabs } from './activity-tabs.mjs';
import {
  containerItems,
  containerDestinationOptions,
  moveContainerItem,
  readContainerManagement,
  validateContainerMove,
} from './container-adapter.mjs';
import {
  ACTIVITY_PURPOSES,
  activityTypeLabel,
  appendQuickDamage,
  buildQuickActivityData,
} from './purpose-activity-adapter.mjs';
import {
  activityWorkspaceSupportsDamage,
  activityWorkspaceSupportsHealing,
  buildActivityWorkspaceCreateData,
  buildActivityWorkspaceUpdate,
  readActivityWorkspace,
} from './activity-workspace-adapter.mjs';
import {
  availableAdvancementTypes,
  buildAdvancementFieldUpdate,
  createAdvancement,
  deleteAdvancement,
  duplicateAdvancement,
  getAdvancement,
  readAdvancementFields,
} from './advancement-adapter.mjs';

const MODULE_ID = 'nihil-compendium-module';
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/workbench/item-workbench.hbs`;
const PRIVILEGED_USER_IDS = new Set(['rDepyiOStMqbIYMg', 'rXB1GcSui4mDsgAn']);
const ITEM_TYPE_FALLBACK_LABELS = Object.freeze({
  base: '기본', weapon: '무기', equipment: '장비', consumable: '소모품', tool: '도구', loot: '전리품',
  race: '종족', background: '배경', class: '클래스', subclass: '서브클래스', spell: '주문', feat: '피트',
  container: '보관용품', backpack: '배낭', facility: '시설',
});

const QUICK_TARGET_LABELS = Object.freeze({ self: '자신', ally: '아군', enemy: '적', creature: '생물', object: '물체', space: '공간', creatureOrObject: '생물 또는 물체', any: '모든 대상', willing: '자발적 생물' });
const QUICK_AREA_LABELS = Object.freeze({ circle: '원형', cone: '원뿔', cube: '정육면체', cylinder: '원기둥', radius: '방사형', line: '선형', sphere: '구형', square: '사각형', wall: '벽' });
const ACTIVATION_TYPE_LABELS = Object.freeze({
  action: '행동', bonus: '보너스 행동', reaction: '반응', minute: '분', hour: '시간', day: '일',
  longRest: '긴 휴식 종료 시', shortRest: '짧은 휴식 종료 시', encounter: '전투 시작 시',
  turnStart: '턴 시작 시', turnEnd: '턴 종료 시', legendary: '전설 행동', mythic: '신화 행동',
  lair: '둥지 행동', crew: '승무원 행동', special: '특수',
});
const ADVANCEMENT_TYPE_LABELS = Object.freeze({
  AbilityScoreImprovement: '능력치 향상', HitPoints: '체력 증가', ItemChoice: '아이템 선택', ItemGrant: '아이템 부여',
  ScaleValue: '단계별 값', Size: '크기', Subclass: '서브클래스', Trait: '특성',
});
const RECOVERY_PERIOD_LABELS = Object.freeze({
  sr: '짧은 휴식', lr: '긴 휴식', day: '하루', dawn: '새벽', dusk: '황혼', initiative: '전투 시작',
  turnStart: '턴 시작', turnEnd: '턴 종료', turn: '턴', recharge: '재충전',
});
const WEIGHT_UNIT_LABELS = Object.freeze({ lb: '파운드 (lb)', tn: '톤 (tn)', kg: '킬로그램 (kg)', Mg: '메가그램 (Mg)' });
const CURRENCY_LABELS = Object.freeze({ pp: '백금화 (pp)', gp: '금화 (gp)', ep: '호박금화 (ep)', sp: '은화 (sp)', cp: '동화 (cp)' });
const STATUS_LABELS = Object.freeze({
  dead: '사망', coverHalf: '절반 엄폐', coverThreeQuarters: '3/4 엄폐', coverTotal: '완전 엄폐', burrowing: '굴착 중', concentrating: '집중 중', dodging: '회피 중', ethereal: '에테르 상태', flying: '비행 중', hiding: '은신 중', hovering: '공중 정지', marked: '표시됨', sleeping: '수면 중', stable: '안정화', bleeding: '출혈', blinded: '실명', burning: '연소', charmed: '매혹', cursed: '저주', dehydration: '탈수', deafened: '실청', diseased: '질병', exhaustion: '탈진', falling: '낙하 중', frightened: '공포', grappled: '속박', incapacitated: '행동불능', invisible: '투명', malnutrition: '영양실조', paralyzed: '마비', petrified: '석화', poisoned: '중독', prone: '넘어짐', restrained: '포박', silenced: '침묵', stunned: '충격', suffocation: '질식', surprised: '놀람', transformed: '변형 중', unconscious: '의식불명', encumbered: '과중량', heavilyEncumbered: '심한 과중량', exceedingCarryingCapacity: '소지 중량 초과', flanking: '협공 중', flanked: '협공당함', exhausted: '탈진', hasted: '가속', slowed: '감속', concentration: '집중 중', rage: '격노', distracted: '산만', disengage: '이탈 중', cover: '엄폐', turned: '퇴치됨',
});

const SECTION_GUIDES = Object.freeze({
  basic: '아이템의 기본 정보를 관리합니다. 세부 항목의 사용법은 아래 하위 섹션 가이드를 확인하십시오.',
  'basic.identity': '아이템을 구분하는 이름, 아이콘 경로와 내부 식별자를 설정합니다.',
  'basic.source': '원전, 페이지, 규칙 연도 같은 출처 정보를 기록합니다. 직접 만든 아이템이면 비워도 됩니다.',
  'basic.description': '아이템 시트와 채팅 등에 표시할 설명을 작성합니다.',
  type: '이 아이템 유형에만 존재하는 고유 설정입니다. 의미를 모르는 고급 값은 기본값 유지가 안전합니다.',
  properties: '아이템의 규칙상 속성을 선택합니다. 기존 확장 속성도 손실하지 않고 유지합니다.',
  equip: '장착 여부와 조율 필요 여부를 설정합니다. 장비가 아닌 아이템에는 보통 필요하지 않습니다.',
  inventory: '수량, 무게, 가격, 희귀도와 보관 위치 같은 인벤토리 정보를 설정합니다.',
  container: '같은 월드 또는 같은 액터의 아이템을 넣고 꺼내거나 다른 보관용품으로 이동합니다. 중첩 목록과 용량을 함께 확인할 수 있습니다.',
  'container.contents': '넣기·이동·꺼내기는 즉시 저장됩니다. 다른 입력을 수정 중이면 먼저 저장하거나 버릴지 선택합니다. 보관용품을 이동하면 내용물도 함께 따라갑니다.',
  'container.capacity': '개수·무게·부피 한도를 설정합니다. 개수 한도가 있으면 시스템은 개수로 용량을 판단합니다. 초과 상태도 보관할 수 있습니다.',
  'container.currency': '이 보관용품에 들어 있는 화폐를 관리합니다. 시스템의 화폐 무게 설정에 따라 내용물 무게 계산에도 반영됩니다.',
  identification: '미식별 상태에서 보일 이름과 설명을 설정합니다. 감정이 필요 없는 아이템은 건드리지 않아도 됩니다.',
  'quick-effects': '자주 쓰는 효과를 내부 구조를 몰라도 빠르게 추가하는 기본 사용 영역입니다.',
  'quick-effects.damage': '선택한 공격·피해·내성 액티비티에 피해 한 줄을 더합니다. 기존 사거리와 대상은 그대로 사용합니다.',
  'quick-effects.heal': '새 회복 액티비티를 만듭니다. 회복식과 사거리·대상만 정하면 대부분 충분합니다.',
  'quick-effects.save': '내성 굴림으로 피해를 처리하는 새 액티비티를 만듭니다. 난이도와 성공 시 피해 처리도 함께 정합니다.',
  'quick-effects.status': '선택한 액티비티에 중독·넘어짐 같은 상태 효과를 연결합니다.',
  'activity-guide': '빠른 추가 기능을 언제 사용하면 되는지 예시와 함께 설명합니다.',
  activities: '아이템에 포함된 액티비티를 선택·정리하고, 빠른 추가로 만들기 어려운 특수 액티비티를 관리합니다.',
  'activities.workspace': '액티비티를 만들거나 고칠 때 필요한 핵심 규칙 값을 한곳에서 설정합니다.',
  'activities.create': '새 액티비티 유형을 고른 뒤 같은 작업 영역에서 내용을 입력합니다.',
  'activities.list': '현재 아이템에 들어 있는 액티비티 목록입니다. 항목을 누르면 펼쳐지고 관련 설정을 탭으로 편집합니다. 다시 누르면 접힙니다.',
  'activities.manage': '작성 중인 액티비티를 저장하거나, 선택한 액티비티를 복제·삭제합니다.',
  'external-activity': '외부 모듈 액티비티의 공통 설정을 편집합니다. 모듈 고유 설정은 워크벤치 내부 전체 설정에서 확인할 수 있습니다. 일반 폼이 없는 설정은 전용 UI 지원 범위에 포함하지 않습니다.',
  'activity-common': '액티비티의 소모 대상, 연결 효과, 지속시간과 조건을 편집합니다. 액티비티 저장 또는 변경사항 저장으로 반영합니다.',
  'activity-specific': '선택한 액티비티 유형의 추가 설정입니다. 소환·변신 후보와 사용자 설정은 행으로 추가하고 편집합니다.',
  advancement: '레벨 상승이나 아이템 부여처럼 캐릭터 성장 시 자동 적용할 내용을 정의합니다.',
  'advancement.create': '새 성장 항목을 추가합니다. 클래스·종족·배경의 레벨별 보상을 만들 때 사용합니다.',
  'advancement.list': '이 아이템에 포함된 성장 항목 목록입니다.',
  'advancement.manage': '선택한 성장 항목을 복제·삭제하거나 워크벤치 내부 전체 성장 설정을 엽니다.',
  'advancement.fields': '성장 항목의 세부 데이터입니다. 고급 규칙 제작 시 사용합니다.',
  damage: '아이템 또는 선택한 액티비티가 주는 기본 피해와 추가 피해를 설정합니다.',
  'damage.base': '아이템 자체의 기본 피해식을 설정합니다. 무기처럼 기본 피해가 있는 유형에서 사용합니다.',
  'damage.extra': '선택한 액티비티에 추가로 적용할 피해를 여러 줄로 관리합니다.',
  uses: '아이템의 사용 횟수와 언제 회복되는지를 설정합니다.',
  'uses.count': '현재 소모량과 최대 사용 횟수 수식을 설정합니다.',
  'uses.recovery': '짧은 휴식, 긴 휴식, 재충전 등 사용 횟수 회복 조건을 설정합니다.',
  'on-hit': '액티비티가 대상에게 적용될 때 함께 적용할 활성 효과를 관리합니다.',
  'on-hit.linked': '현재 선택한 액티비티에 이미 연결된 대상 효과 목록입니다.',
  'on-hit.existing': '아이템에 이미 존재하는 대상 효과를 선택한 액티비티에 연결합니다.',
  'on-hit.create': '새 상태 효과를 만들어 선택한 액티비티에 바로 연결합니다.',
  passive: '아이템을 소유하거나 장착하는 동안 적용되는 지속 효과를 관리합니다.',
  'passive.list': '현재 아이템의 전이형 지속 효과 목록입니다.',
  'passive.create': '시스템 데이터 변경 경로와 값을 지정해 새 지속 효과를 만듭니다.',
});

const BUTTON_GUIDES = Object.freeze({
  expandAllSections: '모든 설정 영역을 한 번에 펼칩니다.', collapseAllSections: '모든 설정 영역을 한 번에 접습니다.', openAdvanced: '워크벤치 내부 전체 아이템 설정을 엽니다. 일반 폼의 편집 범위를 벗어난 설정은 구조를 확인한 뒤 수정하십시오.',
  selectItem: '이 아이템을 Workbench 편집 대상으로 선택합니다.', openFolder: '이 폴더 안으로 이동합니다.', goParentFolder: '상위 폴더로 이동합니다.', goBreadcrumb: '선택한 상위 경로로 이동합니다.',
  createActivity: '원본 액티비티 유형을 직접 생성합니다. 일반적인 효과는 빠른 추가를 권장합니다.', selectActivity: '이 액티비티를 편집 대상으로 선택합니다.', newActivityWorkspace: '선택한 유형의 새 액티비티 작성 폼을 엽니다.', saveActivityWorkspace: '이 액티비티의 표준 입력값을 저장합니다.', cancelActivityWorkspace: '새 액티비티 작성 중인 입력을 버리고 현재 선택 액티비티로 돌아갑니다.', addActivityWorkspaceDamage: '피해 행을 하나 더 추가합니다.', removeActivityWorkspaceDamage: '이 피해 행을 삭제합니다.', addActivityWorkspaceRecovery: '사용 횟수 회복 규칙을 하나 더 추가합니다.', removeActivityWorkspaceRecovery: '이 회복 규칙을 삭제합니다.', renameActivity: '선택한 액티비티의 이름을 변경합니다.', duplicateActivity: '선택한 액티비티를 같은 설정으로 복제합니다.', deleteActivity: '선택한 액티비티를 삭제합니다.', moveActivity: '액티비티의 표시 순서를 위나 아래로 이동합니다.', openActivityAdvanced: '워크벤치 내부 전체 액티비티 설정을 엽니다.',
  createQuickActivity: '입력한 빠른 설정으로 새 액티비티를 생성합니다.', addQuickDamage: '선택한 액티비티에 입력한 추가 피해를 붙입니다.', addQuickStatus: '선택한 액티비티에 상태 효과를 생성하여 연결합니다.',
  createAdvancement: '새 성장 항목을 생성합니다.', selectAdvancement: '이 성장 항목을 편집 대상으로 선택합니다.', duplicateAdvancement: '선택한 성장 항목을 복제합니다.', deleteAdvancement: '선택한 성장 항목을 삭제합니다.', openAdvancementAdvanced: '워크벤치 내부 전체 성장 설정을 엽니다.',
  addExtraDamage: '추가 피해 행을 하나 더 만듭니다.', removeExtraDamage: '이 추가 피해 행을 삭제합니다.', addRecovery: '사용 횟수 회복 규칙을 하나 더 추가합니다.', removeRecovery: '이 회복 규칙을 삭제합니다.',
  attachEffect: '기존 대상 효과를 선택한 액티비티에 연결합니다.', detachEffect: '선택한 액티비티에서 이 효과 연결을 해제합니다.', deleteOnHitEffect: '효과 자체와 이 아이템 액티비티의 모든 연결을 삭제합니다.', addOnHitStatus: '새 상태 효과를 만들고 선택한 액티비티에 연결합니다.', addPassiveEffect: '새 지속 효과를 아이템에 추가합니다.',
  createFolder: '현재 위치에 새 아이템 폴더를 만듭니다.', createItem: '현재 폴더에 새 아이템을 만듭니다.', duplicateItem: '현재 선택한 아이템을 복제합니다.',
});

const FIELD_GUIDES = Object.freeze({
  itemName: '사용자에게 표시되는 아이템 이름입니다.', itemImg: '아이템 아이콘 이미지의 경로입니다.', identifier: '자동화와 참조에 사용하는 내부 식별자입니다. 특별한 이유가 없으면 현재 값을 유지해도 됩니다.',
  sourceBook: '아이템이 수록된 책이나 자료의 이름입니다.', sourcePage: '원전의 페이지 번호입니다.', sourceCustom: '공식 책이 아닌 사용자 정의 출처를 기록합니다.', sourceLicense: '자료의 라이선스 정보를 기록합니다.', sourceRules: '2014 또는 2024 규칙 기준을 지정합니다.', sourceRevision: '출처 데이터의 개정 번호입니다.', description: '아이템의 상세 설명입니다.',
  properties: '아이템에 적용할 규칙 속성입니다. 여러 개를 동시에 선택할 수 있습니다.', equipped: '현재 장착 중인지 표시합니다.', attunement: '이 아이템이 조율을 요구하는지 정합니다.', attuned: '현재 소유자가 조율을 완료했는지 표시합니다.',
  quantity: '보유 수량입니다.', rarity: '아이템의 희귀도입니다.', weightValue: '아이템 한 단위의 무게입니다.', weightUnits: '무게에 사용할 단위입니다.', priceValue: '아이템의 가격 수치입니다.', priceDenomination: '가격에 사용할 화폐 단위입니다.', containerId: '이 아이템이 들어 있는 보관용품을 지정합니다.',
  identified: '체크하면 아이템이 식별된 상태로 취급됩니다.', unidentifiedName: '미식별 상태에서 대신 표시할 이름입니다.', unidentifiedDescription: '미식별 상태에서 대신 표시할 설명입니다.',
  quickDamageFormula: '추가할 피해 주사위식입니다. 예: 2d6 + 3', quickDamageType: '추가 피해의 피해 유형입니다.',
  quickHealName: '새 회복 액티비티의 이름입니다.', quickHealFormula: '회복량 주사위식입니다. 예: 2d8 + 3', quickHealType: '일반 체력 회복인지 임시 체력 부여인지 선택합니다.', quickHealRangeType: '자신·접촉·거리 지정 등 회복이 닿는 방식을 정합니다.', quickHealRangeValue: '거리 지정일 때의 최대 사거리입니다.', quickHealRangeSpecial: '일반 거리로 표현할 수 없는 특수 사거리 설명입니다.', quickHealTargetType: '회복할 수 있는 대상의 종류입니다.', quickHealTargetCount: '한 번에 지정할 대상 수입니다.', quickHealAreaType: '원형·원뿔 등 범위 템플릿 형태입니다.', quickHealAreaSize: '범위 템플릿의 크기입니다.',
  quickSaveName: '새 내성 공격 액티비티의 이름입니다.', quickSaveFormula: '내성 실패 시 적용할 피해 주사위식입니다.', quickSaveDamageType: '내성 공격의 피해 유형입니다.', quickSaveAbility: '대상이 굴릴 내성 능력치입니다.', quickSaveDc: '대상이 넘어야 하는 내성 난이도입니다.', quickSaveOnSave: '내성에 성공했을 때 피해를 절반·없음·전체 중 어떻게 처리할지 정합니다.', quickSaveRangeType: '내성 공격의 사거리 방식을 정합니다.', quickSaveRangeValue: '거리 지정일 때의 최대 사거리입니다.', quickSaveRangeSpecial: '특수한 사거리 규칙을 설명합니다.', quickSaveTargetType: '내성 공격이 대상으로 삼을 수 있는 종류입니다.', quickSaveTargetCount: '직접 지정할 대상 수입니다. 범위 전체를 쓰면 비워둘 수 있습니다.', quickSaveAreaType: '효과 범위의 형태입니다.', quickSaveAreaSize: '효과 범위의 크기입니다.',
  quickStatusName: '새 상태 효과의 표시 이름입니다. 비우면 상태 이름을 사용합니다.', quickStatus: '대상에게 적용할 상태를 선택합니다.', quickStatusRounds: '상태가 유지될 라운드 수입니다.',
  newActivityType: '빠른 추가로 만들 수 없는 고급 액티비티의 원본 유형을 선택합니다.', newActivityName: '새 고급 액티비티의 이름입니다. 비워도 생성할 수 있습니다.', activityName: '현재 선택한 액티비티의 표시 이름입니다.', activityWorkspaceNewType: '새로 작성할 액티비티의 유형입니다. 선택한 뒤 작성 폼을 엽니다.', activityWorkspaceName: '액티비티의 표시 이름입니다.', activityWorkspaceActivationType: '액티비티를 발동하는 방식입니다.', activityWorkspaceActivationValue: '발동에 필요한 행동 횟수나 수치입니다.', activityWorkspaceActivationCondition: '발동에 필요한 추가 조건입니다.', activityWorkspaceUsesSpent: '이미 소모한 액티비티 사용 횟수입니다.', activityWorkspaceUsesMax: '액티비티의 최대 사용 횟수입니다. 숫자나 수식을 사용할 수 있습니다.', activityWorkspaceRangeValue: '액티비티가 닿는 거리입니다.', activityWorkspaceRangeUnits: '사거리에 사용하는 단위입니다.', activityWorkspaceRangeSpecial: '일반 거리로 표현할 수 없는 특수 사거리입니다.', activityWorkspaceTargetType: '직접 지정할 대상의 종류입니다.', activityWorkspaceTargetCount: '직접 지정할 대상 수입니다.', activityWorkspaceTargetSpecial: '일반 대상 유형으로 표현할 수 없는 대상 규칙입니다.', activityWorkspaceTemplateType: '범위 템플릿의 형태입니다.', activityWorkspaceTemplateSize: '범위 템플릿의 크기입니다.', activityWorkspaceTemplateUnits: '범위 템플릿의 단위입니다.', activityWorkspaceHealingFormula: '회복량 주사위식입니다.', activityWorkspaceAttackAbility: '공격에 사용할 능력치입니다.', activityWorkspaceAttackBonus: '공격 굴림에 더할 보너스입니다.', activityWorkspaceSaveDc: '대상이 넘어야 하는 내성 난이도입니다.', activityWorkspaceSaveCalculation: '내성 난이도의 계산 방식을 지정합니다.', activityWorkspaceSaveOnSave: '내성에 성공했을 때의 피해 처리입니다.',
  newAdvancementType: '추가할 성장 항목의 종류를 선택합니다.', newAdvancementTitle: '새 성장 항목의 제목입니다.',
  baseDamageFormula: '아이템의 기본 피해 주사위식입니다.', baseDamageTypes: '기본 피해에 적용할 피해 유형입니다.', usesSpent: '이미 소모한 사용 횟수입니다.', usesMax: '최대 사용 횟수입니다. 숫자나 @prof 같은 수식을 사용할 수 있습니다.', usesAutoDestroy: '사용 횟수를 모두 쓰면 아이템을 자동으로 삭제합니다.',
  onHitName: '새 명중 시 효과의 이름입니다.', onHitStatus: '명중 시 적용할 상태입니다.', onHitRounds: '효과가 지속될 라운드 수입니다.', passiveName: '새 지속 효과의 이름입니다.', passiveKey: '변경할 시스템 데이터의 내부 경로입니다. 고급 기능입니다.', passiveMode: '기존 값에 새 값을 어떤 방식으로 적용할지 정합니다.', passiveValue: '지속 효과가 적용할 값입니다.',
  browserSearch: '이름, 유형, 폴더 이름으로 아이템을 검색합니다.', browserType: '표시할 아이템 유형만 골라 봅니다.',
});


function itemTypeLabel(type) {
  if (ITEM_TYPE_FALLBACK_LABELS[type]) return ITEM_TYPE_FALLBACK_LABELS[type];
  const key = `TYPES.Item.${type}`;
  const localized = globalThis.game?.i18n?.localize?.(key);
  if (localized && localized !== key) return localized;
  return String(type ?? '');
}


function canManageWorkbenchItems() {
  return PRIVILEGED_USER_IDS.has(globalThis.game?.user?.id) || isWorkbenchUser();
}

let WorkbenchClass = null;
let workbenchInstance = null;

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Array.from(collection);
}

function damageFormula(part) {
  return formatDamagePartFormula(part);
}

function localize(label) {
  if (!label) return '';
  return globalThis.game?.i18n?.localize?.(label) ?? String(label);
}

function formValue(form, name, fallback = '') {
  const field = form?.elements?.namedItem?.(name);
  if (!field) return fallback;
  return field.value ?? fallback;
}

function numericFormValue(form, name, fallback = 0) {
  const value = formValue(form, name, '');
  if (value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function checkboxFormValue(form, name, fallback = false) {
  const field = form?.elements?.namedItem?.(name);
  if (!field) return fallback;
  return Boolean(field.checked);
}

function formValues(form, name) {
  const checkboxes = Array.from(form?.querySelectorAll?.(`input[type="checkbox"][name="${name}"]`) ?? []);
  if (checkboxes.length) {
    return checkboxes.filter((input) => input.checked).map((input) => input.value).filter(Boolean);
  }
  const field = form?.elements?.namedItem?.(name);
  if (!field) return [];
  if (field.multiple && field.selectedOptions) {
    return Array.from(field.selectedOptions, (option) => option.value).filter(Boolean);
  }
  const value = field.value;
  return value ? [String(value)] : [];
}

function pressedDamageTypes(root, selector) {
  return Array.from(
    root?.querySelectorAll?.(`${selector}[aria-pressed="true"]`) ?? [],
    (element) => element.dataset.damageType,
  ).filter(Boolean);
}

function recoveryRowsFromForm(form) {
  return Array.from(form?.querySelectorAll?.('[data-recovery-row]') ?? []).map((row) => {
    const period = row.querySelector('[data-recovery-period]')?.value || 'lr';
    const type = period === 'recharge'
      ? 'recoverAll'
      : (row.querySelector('[data-recovery-type]')?.value || 'recoverAll');
    return {
      period,
      type,
      formula: row.querySelector('[data-recovery-formula]')?.value ?? '',
    };
  });
}

function sameStringSet(left = [], right = []) {
  const a = [...left].map(String).sort();
  const b = [...right].map(String).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameDamageRows(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((row, index) => (
    String(row.formula ?? '').trim() === String(right[index]?.formula ?? '').trim()
    && sameStringSet(row.types ?? [], right[index]?.types ?? [])
  ));
}

const ACTIVITY_WORKSPACE_STANDARD_PATHS = new Set([
  'activation.type', 'activation.value', 'activation.condition',
  'uses.spent', 'uses.max', 'uses.recovery',
  'range.value', 'range.units', 'range.special',
  'target.affects.type', 'target.affects.count', 'target.affects.special',
  'target.template.type', 'target.template.size', 'target.template.units',
  'damage.parts', 'damage.onSave',
  'healing.custom.enabled', 'healing.custom.formula', 'healing.types',
  'attack.ability', 'attack.bonus',
  'save.ability', 'save.dc.formula', 'save.dc.calculation',
]);

function emptyActivityWorkspace(type = '') {
  return {
    id: null,
    type,
    name: '',
    activation: { type: '', value: '', condition: '' },
    uses: { spent: '', max: '', recovery: [] },
    range: { value: '', units: '', special: '' },
    target: {
      type: '',
      count: '',
      special: '',
      template: { type: '', size: '', units: '' },
    },
    damageRows: [],
    healing: { formula: '', types: [] },
    attack: { ability: '', bonus: '' },
    save: { abilities: [], dc: '', calculation: '', onSave: '' },
  };
}

function activityWorkspaceRecoveryRowsFromForm(form) {
  return Array.from(form?.querySelectorAll?.('[data-activity-workspace-recovery-row]') ?? []).map((row) => ({
    period: row.querySelector('[data-activity-workspace-recovery-period]')?.value ?? '',
    type: row.querySelector('[data-activity-workspace-recovery-type]')?.value ?? '',
    formula: row.querySelector('[data-activity-workspace-recovery-formula]')?.value ?? '',
  }));
}

function activityWorkspaceDamageRowsFromForm(form) {
  return Array.from(form?.querySelectorAll?.('[data-activity-workspace-damage-row]') ?? []).map((row) => ({
    formula: row.querySelector('[data-activity-workspace-damage-formula]')?.value ?? '',
    types: pressedDamageTypes(row, '[data-activity-workspace-damage-type]'),
  }));
}

function activityWorkspaceFormFromElement(form, draft) {
  return {
    ...draft,
    name: formValue(form, 'activityWorkspaceName', draft.name),
    activation: {
      type: formValue(form, 'activityWorkspaceActivationType', draft.activation.type),
      value: formValue(form, 'activityWorkspaceActivationValue', draft.activation.value),
      condition: formValue(form, 'activityWorkspaceActivationCondition', draft.activation.condition),
    },
    uses: {
      spent: formValue(form, 'activityWorkspaceUsesSpent', draft.uses.spent),
      max: formValue(form, 'activityWorkspaceUsesMax', draft.uses.max),
      recovery: activityWorkspaceRecoveryRowsFromForm(form),
    },
    range: {
      value: formValue(form, 'activityWorkspaceRangeValue', draft.range.value),
      units: formValue(form, 'activityWorkspaceRangeUnits', draft.range.units),
      special: formValue(form, 'activityWorkspaceRangeSpecial', draft.range.special),
    },
    target: {
      type: formValue(form, 'activityWorkspaceTargetType', draft.target.type),
      count: formValue(form, 'activityWorkspaceTargetCount', draft.target.count),
      special: formValue(form, 'activityWorkspaceTargetSpecial', draft.target.special),
      template: {
        type: formValue(form, 'activityWorkspaceTemplateType', draft.target.template.type),
        size: formValue(form, 'activityWorkspaceTemplateSize', draft.target.template.size),
        units: formValue(form, 'activityWorkspaceTemplateUnits', draft.target.template.units),
      },
    },
    damageRows: activityWorkspaceDamageRowsFromForm(form),
    healing: {
      formula: formValue(form, 'activityWorkspaceHealingFormula', draft.healing.formula),
      types: formValues(form, 'activityWorkspaceHealingTypes'),
    },
    attack: {
      ability: formValue(form, 'activityWorkspaceAttackAbility', draft.attack.ability),
      bonus: formValue(form, 'activityWorkspaceAttackBonus', draft.attack.bonus),
    },
    save: {
      abilities: formValues(form, 'activityWorkspaceSaveAbilities'),
      dc: formValue(form, 'activityWorkspaceSaveDc', draft.save.dc),
      calculation: formValue(form, 'activityWorkspaceSaveCalculation', draft.save.calculation),
      onSave: formValue(form, 'activityWorkspaceSaveOnSave', draft.save.onSave),
    },
  };
}

function activityWorkspaceOptions(options, selected, preserveValue = false) {
  const result = options.map((option) => ({
    ...option,
    selected: String(option.value) === String(selected ?? ''),
  }));
  if (preserveValue && !result.some(option => option.selected)) {
    const value = String(selected ?? '');
    result.unshift({ value, label: value ? `기존 값: ${value}` : '기본값 사용', selected: true });
  }
  return result;
}

function filterActivityWorkspaceFields(fields) {
  return fields.filter((field) => !ACTIVITY_WORKSPACE_STANDARD_PATHS.has(field.path));
}

function getItemActivity(item, activityId) {
  if (!item || !activityId) return null;
  return item.system?.activities?.get?.(activityId)
    ?? values(item.system?.activities).find((activity) => activity.id === activityId)
    ?? null;
}

function nativeActivityClass(type) {
  return Object.values(globalThis.dnd5e?.documents?.activity ?? {})
    .find((candidate) => typeof candidate === 'function' && candidate?.metadata?.type === type)
    ?? null;
}

function effectModeOptions(selectedType = 'add') {
  return effectChangeTypeOptions(selectedType);
}

const FIELD_GROUP_LABELS = Object.freeze({
  activation: '발동', consumption: '소모', description: '설명', duration: '지속시간', effects: '효과', flags: '플래그',
  range: '사거리', target: '대상 / 범위', uses: '사용 횟수', visibility: '표시 조건', damage: '피해', save: '내성 굴림',
  healing: '회복', attack: '공격', check: '능력 판정', summon: '소환', transform: '변신', order: '시설 명령',
  configuration: '설정', value: '값', title: '제목', level: '레벨', icon: '아이콘', type: '유형',
  cover: '엄폐', crewed: '승무원 필요', enchant: '마법 부여', prerequisites: '선행 조건', requirements: '요구 조건',
  effectConditionText: '효과 조건', img: '아이콘', macroData: '매크로 데이터', useConditionReason: '사용 조건 사유', useConditionText: '사용 조건',
  profiles: '소환·변신 후보', bonuses: '소환 보정', match: '소환자와 맞추기', creatureSizes: '허용 크기', creatureTypes: '허용 크리처 종류', settings: '변신 사용자 설정',
});

function fieldGroupLabel(key) {
  return FIELD_GROUP_LABELS[key] ?? String(key ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function groupFieldsByRoot(fields = []) {
  const groups = new Map();
  for (const field of fields) {
    const key = String(field.path ?? '').split('.')[0] || 'other';
    const derivedLabel = String(field.label ?? '').split(/\s+(?:\/|›)\s+/)[0].trim();
    const groupLabel = FIELD_GROUP_LABELS[key] ?? (derivedLabel && derivedLabel !== key ? derivedLabel : fieldGroupLabel(key));
    if (!groups.has(key)) groups.set(key, { key, label: groupLabel, fields: [] });
    groups.get(key).fields.push({
      ...field,
      options: (field.options ?? []).map((option) => ({ ...option, label: localize(option.label) })),
    });
  }
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

function advancementTypeLabel(type) {
  return ADVANCEMENT_TYPE_LABELS[type] ?? String(type ?? '');
}

function guideForSection(key) {
  if (SECTION_GUIDES[key]) return SECTION_GUIDES[key];
  if (String(key).startsWith('type.')) return '이 아이템 유형의 세부 고급 설정입니다. 의미를 모르는 값은 기본값을 유지하는 것을 권장합니다.';
  if (String(key).startsWith('activity-common.')) return '모든 액티비티에 공통으로 적용되는 설정입니다. 필요한 값과 연결 항목만 수정합니다.';
  if (String(key).startsWith('activity-specific.')) return '선택한 액티비티 유형에 적용되는 설정입니다. 목록은 항목 추가·삭제로 관리하고 참조는 선택하거나 직접 입력합니다.';
  if (String(key).startsWith('advancement.')) return '성장 항목의 세부 설정입니다. 클래스·종족·배경의 성장 규칙을 만들 때 사용합니다.';
  return '이 설정 묶음에서 필요한 값만 수정합니다.';
}

export async function renderWorkbenchPreservingScroll(
  workbench,
  render = (options) => workbench.render(options),
  options = { force: true },
) {
  const scrollTop = workbench?.element
    ?.querySelector?.('.ncm-workbench__scroll')
    ?.scrollTop ?? 0;
  const result = await render(options);
  const scroll = workbench?.element?.querySelector?.('.ncm-workbench__scroll');
  if (scroll) scroll.scrollTop = scrollTop;
  return result;
}

export function shouldRefreshAfterItemUpdate(workbench, item) {
  return !(
    (workbench?.isSavingActivityWorkspace || workbench?.savingForm)
    && item?.id
    && workbench.selectedItemId === item.id
  );
}

function getWorkbenchClass() {
  if (WorkbenchClass) return WorkbenchClass;

  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry?.applications?.api ?? {};
  if (!ApplicationV2 || !HandlebarsApplicationMixin) {
    throw new Error('Foundry ApplicationV2 API is not available.');
  }

  class NihilItemWorkbench extends WorkbenchLayoutMixin(HandlebarsApplicationMixin(ApplicationV2)) {
    static DEFAULT_OPTIONS = {
      id: 'ncm-item-workbench',
      classes: ['ncm-workbench'],
      tag: 'form',
      window: {
        title: 'Nihil Workbench · 아이템 편집기',
        icon: 'fa-solid fa-hammer',
        resizable: true,
      },
      position: {
        width: 1200,
        height: 820,
      },
      actions: {
        selectItem: NihilItemWorkbench._selectItemAction,
        openFolder: NihilItemWorkbench._openFolderAction,
        goParentFolder: NihilItemWorkbench._goParentFolderAction,
        goBreadcrumb: NihilItemWorkbench._goBreadcrumbAction,
        selectActivity: NihilItemWorkbench._selectActivityAction,
        createActivity: NihilItemWorkbench._createActivityAction,
        newActivityWorkspace: NihilItemWorkbench._newActivityWorkspaceAction,
        saveActivityWorkspace: NihilItemWorkbench._saveActivityWorkspaceAction,
        cancelActivityWorkspace: NihilItemWorkbench._cancelActivityWorkspaceAction,
        addActivityWorkspaceDamage: NihilItemWorkbench._addActivityWorkspaceDamageAction,
        removeActivityWorkspaceDamage: NihilItemWorkbench._removeActivityWorkspaceDamageAction,
        addActivityWorkspaceRecovery: NihilItemWorkbench._addActivityWorkspaceRecoveryAction,
        removeActivityWorkspaceRecovery: NihilItemWorkbench._removeActivityWorkspaceRecoveryAction,
        createQuickActivity: NihilItemWorkbench._createQuickActivityAction,
        addQuickDamage: NihilItemWorkbench._addQuickDamageAction,
        addQuickStatus: NihilItemWorkbench._addQuickStatusAction,
        renameActivity: NihilItemWorkbench._renameActivityAction,
        duplicateActivity: NihilItemWorkbench._duplicateActivityAction,
        deleteActivity: NihilItemWorkbench._deleteActivityAction,
        moveActivity: NihilItemWorkbench._moveActivityAction,
        openActivityAdvanced: NihilItemWorkbench._openActivityAdvancedAction,
        selectAdvancement: NihilItemWorkbench._selectAdvancementAction,
        createAdvancement: NihilItemWorkbench._createAdvancementAction,
        duplicateAdvancement: NihilItemWorkbench._duplicateAdvancementAction,
        deleteAdvancement: NihilItemWorkbench._deleteAdvancementAction,
        openAdvancementAdvanced: NihilItemWorkbench._openAdvancementAdvancedAction,
        openAdvanced: NihilItemWorkbench._openAdvancedAction,
        editOwnership: NihilItemWorkbench._editOwnershipAction,
        expandAllSections: NihilItemWorkbench._expandAllSectionsAction,
        collapseAllSections: NihilItemWorkbench._collapseAllSectionsAction,
        addExtraDamage: NihilItemWorkbench._addExtraDamageAction,
        removeExtraDamage: NihilItemWorkbench._removeExtraDamageAction,
        toggleDamageType: NihilItemWorkbench._toggleDamageTypeAction,
        addRecovery: NihilItemWorkbench._addRecoveryAction,
        addTypeEntry: NihilItemWorkbench._changeTypeEntryAction,
        removeTypeEntry: NihilItemWorkbench._changeTypeEntryAction,
        addAdvancementEntry: NihilItemWorkbench._changeAdvancementEntryAction,
        removeAdvancementEntry: NihilItemWorkbench._changeAdvancementEntryAction,
        addAdvancementMapping: NihilItemWorkbench._changeAdvancementEntryAction,
        removeAdvancementMapping: NihilItemWorkbench._changeAdvancementEntryAction,
        toggleAdvancementObject: NihilItemWorkbench._changeAdvancementEntryAction,
        addActivityEntry: NihilItemWorkbench._changeActivityEntryAction,
        removeActivityEntry: NihilItemWorkbench._changeActivityEntryAction,
        addActivityMapping: NihilItemWorkbench._changeActivityEntryAction,
        removeActivityMapping: NihilItemWorkbench._changeActivityEntryAction,
        toggleActivityObject: NihilItemWorkbench._changeActivityEntryAction,
        selectActivityTab: NihilItemWorkbench._selectActivityTabAction,
        removeRecovery: NihilItemWorkbench._removeRecoveryAction,
        attachEffect: NihilItemWorkbench._attachEffectAction,
        detachEffect: NihilItemWorkbench._detachEffectAction,
        deleteOnHitEffect: NihilItemWorkbench._deleteOnHitEffectAction,
        addOnHitStatus: NihilItemWorkbench._addOnHitStatusAction,
        addPassiveEffect: NihilItemWorkbench._addPassiveEffectAction,
        createFolder: NihilItemWorkbench._createFolderAction,
        createItem: NihilItemWorkbench._createItemAction,
        duplicateItem: NihilItemWorkbench._duplicateItemAction,
        deleteItem: NihilItemWorkbench._deleteItemAction,
        editFolder: NihilItemWorkbench._editFolderAction,
        deleteFolder: NihilItemWorkbench._deleteFolderAction,
        editEffect: NihilItemWorkbench._editEffectAction,
        toggleEffect: NihilItemWorkbench._toggleEffectAction,
        duplicateEffect: NihilItemWorkbench._duplicateEffectAction,
        deleteEffect: NihilItemWorkbench._deleteEffectAction,
        createEffect: NihilItemWorkbench._createEffectAction,
        returnToActor: NihilItemWorkbench._returnToActorAction,
        pickItemImage: NihilItemWorkbench._pickItemImageAction,
        addContainerItem: NihilItemWorkbench._moveContainerItemAction,
        moveContainerItem: NihilItemWorkbench._moveContainerItemAction,
        removeContainerItem: NihilItemWorkbench._moveContainerItemAction,
        openContainerItem: NihilItemWorkbench._openContainerItemAction,
      },
      form: {
        closeOnSubmit: false,
        submitOnChange: false,
        handler: NihilItemWorkbench._submitForm,
      },
    };

    static PARTS = {
      main: { template: TEMPLATE_PATH },
    };

    packId = null;

    get itemCollection() {
      return this.packId ? globalThis.game?.packs?.get?.(this.packId) : globalThis.game?.items;
    }

    get itemFolders() {
      return this.packId ? this.itemCollection?.folders : globalThis.game?.folders;
    }

    canManageItems() {
      const root = rootDocument(this.selectedItem);
      const packId = this.packId ?? root?.pack;
      return canManageWorkbenchItems() && (!packId || packEditAllowed(
        packId,
        root?.documentName ?? 'Item',
      ));
    }

    selectedItemId = null;
    documentContext = null;
    currentFolderId = null;
    sectionOpenState = new Map();
    sectionGuideOpenState = new Map();
    selectedActivityId = null;
    activityEditorOpen = false;
    selectedActivityTab = 'identity';
    selectedAdvancementId = null;
    extraDamageDraft = null;
    usesRecoveryDraft = null;
    activityWorkspaceMode = 'edit';
    activityWorkspaceDraft = null;
    isSavingActivityWorkspace = false;
    initialInputs = new Map();
    inputDraft = new Map();
    renderedSource = null;
    draftSource = null;
    renderedInputKey = null;
    savingForm = false;
    submissionSucceeded = false;

    get inputKey() {
      return `${this.packId ?? this.documentContext?.actor?.uuid ?? this.documentContext?.actor?.id ?? 'world'}:${this.selectedItemId}:${this.selectedActivityId}:${this.selectedAdvancementId}:${this.activityWorkspaceMode}`;
    }

    captureInputs() {
      if (this.savingForm) return;
      syncComplexInputs(this.form);
      for (const { key, value } of formInputEntries(this.form)) {
        if (this.initialInputs.has(key) && JSON.stringify(value) !== JSON.stringify(this.initialInputs.get(key))) this.inputDraft.set(
          key,
          value
        );
        else this.inputDraft.delete(key);
      }
      if (this.inputDraft.size) this.draftSource ??= this.renderedSource;
      else this.draftSource = null;
    }

    async guardItemTransition(ignoreNames = []) {
      if (this.savingForm || this.isSavingActivityWorkspace) return false;
      if (this.transitionGuardPending) return false;
      this.captureInputs();
      if (!Array.from(this.inputDraft.keys()).some((key) => !ignoreNames.some((name) => key.startsWith(`${name}:`)))) return true;
      const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
      if (!Dialog) return false;
      this.transitionGuardPending = true;
      try {
        const choice = await Dialog.wait({
          window: { title: '저장하지 않은 아이템 입력' },
          content: '<p>현재 아이템에 저장 전 입력이 있습니다. 변경사항 저장은 아이템 필드를 저장합니다. 작성 중인 새 액티비티·효과는 해당 추가 버튼으로 먼저 적용하십시오.</p>',
          buttons: [
            { action: 'save', label: '변경사항 저장', callback: () => 'save' },
            { action: 'discard', label: '입력 버리기', callback: () => 'discard' },
            { action: 'cancel', label: '계속 편집', default: true, callback: () => 'cancel' },
          ], rejectClose: false,
        });
        if (!choice || choice === 'cancel') return false;
        if (choice === 'save') {
          await this.constructor._submitForm.call(
            this,
            { preventDefault() {} },
            this.form
          );
          if (!this.submissionSucceeded) return false;
        }
        this.inputDraft.clear();
        this.initialInputs.clear();
        this.draftSource = null;
        return true;
      } finally {
        this.transitionGuardPending = false;
      }
    }

    async close(options = {}) {
      if (!await this.guardItemTransition()) return this;
      const closed = await super.close(options);
      globalThis.Hooks?.callAll('ncmWorkbenchStateChanged');
      return closed;
    }

    async render(options = {}) {
      if (this.savingForm || this.isSavingActivityWorkspace) return this;
      this.captureInputs();
      return renderWorkbenchPreservingScroll(
        this,
        (renderOptions) => super.render(renderOptions),
        options,
      );
    }

    get selectedItem() {
      if (this.documentContext?.kind === 'embedded') {
        return this.documentContext.actor.items?.get?.(this.selectedItemId) ?? null;
      }
      if (this.documentContext?.item) return this.documentContext.item;
      return this.selectedItemId ? this.itemCollection?.get?.(this.selectedItemId) ?? null : null;
    }

    selectItem(itemId) {
      if (this.savingForm || this.isSavingActivityWorkspace) return this.selectedItem;
      if (this.documentContext?.kind === 'embedded') {
        const actor = this.documentContext.actor;
        const item = actor.items?.get?.(itemId);
        return item ? this.selectEmbeddedItem(
          actor,
          item
        ) : this.selectedItem;
      }
      const item = itemId ? this.itemCollection?.get?.(itemId) : null;
      const nextItemId = item?.id ?? null;
      if (nextItemId !== this.selectedItemId) {
        this.sectionOpenState.clear();
        this.sectionGuideOpenState.clear();
      }
      this.documentContext = item?.pack && !item.parent ? createPackItemContext(item) : null;
      this.selectedItemId = nextItemId;
      this.currentFolderId = item?.folder?.id ?? null;
      this.selectedActivityId = null;
      this.activityEditorOpen = false;
      this.selectedActivityTab = 'identity';
      this.selectedAdvancementId = null;
      this.extraDamageDraft = null;
      this.usesRecoveryDraft = null;
      this.activityWorkspaceMode = 'edit';
      this.activityWorkspaceDraft = null;
      return item;
    }

    selectEmbeddedItem(actor, item) {
      if (this.savingForm || this.isSavingActivityWorkspace) return this.selectedItem;
      const context = createEmbeddedItemContext(actor, item);
      if (item.id !== this.selectedItemId) {
        this.sectionOpenState.clear();
        this.sectionGuideOpenState.clear();
      }
      this.documentContext = context;
      this.selectedItemId = item.id;
      this.currentFolderId = null;
      this.selectedActivityId = null;
      this.activityEditorOpen = false;
      this.selectedActivityTab = 'identity';
      this.selectedAdvancementId = null;
      this.extraDamageDraft = null;
      this.usesRecoveryDraft = null;
      this.activityWorkspaceMode = 'edit';
      this.activityWorkspaceDraft = null;
      return item;
    }

    get currentFolder() {
      return this.currentFolderId ? this.itemFolders?.get?.(this.currentFolderId) ?? null : null;
    }

    setCurrentFolder(folderId) {
      const folder = folderId ? this.itemFolders?.get?.(folderId) : null;
      this.currentFolderId = folder?.type === 'Item' ? folder.id : null;
      return folder;
    }

    async _prepareContext(options) {
      const base = await super._prepareContext(options);
      if (this.packId) await loadPackDocuments(requireModulePack(
        this.packId,
        'Item',
      ));
      const isEmbeddedItem = this.documentContext?.kind === 'embedded';
      const worldItems = (isEmbeddedItem ? values(this.documentContext.actor.items) : values(this.itemCollection))
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
      const itemFolders = (isEmbeddedItem ? [] : values(this.itemFolders))
        .filter((folder) => folder?.type === 'Item')
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));

      if (!isEmbeddedItem && this.currentFolderId && !itemFolders.some((folder) => folder.id === this.currentFolderId)) {
        this.currentFolderId = null;
      }

      const currentFolder = this.currentFolder;
      const childFolders = itemFolders.filter((folder) => (folder?.folder?.id ?? null) === this.currentFolderId);
      const currentItems = isEmbeddedItem ? worldItems : worldItems.filter((worldItem) => (worldItem.folder?.id ?? null) === this.currentFolderId);

      let item = this.selectedItem;
      if (this.selectedItemId && !item && !this.inputDraft.size) {
        this.selectedItemId = null;
        item = null;
      }

      const model = item ? readItemWorkbenchModel(item, this.selectedActivityId) : null;
      const draftType = this.renderedInputKey === this.inputKey ? this.inputDraft.get('type.value:SELECT:0') : undefined;
      const fieldItem = item && draftType !== undefined ? {
        type: item.type,
        system: { schema: item.system.schema, type: { value: draftType } },
        toObject: () => item.toObject(),
      } : item;
      const typeFields = item ? readTypeFields(fieldItem) : [];
      if (this.renderedInputKey === this.inputKey) {
        for (const field of typeFields.filter((entry) => entry.isComplex)) {
          const draft = this.inputDraft.get(`${field.path}:INPUT:0`);
          if (draft === undefined) continue;
          field.editor = complexEditor(
            field.schema,
            JSON.parse(draft),
            field.path,
            item,
            displayTypeLabel,
          );
        }
      }
      if (this.activityWorkspaceMode !== 'create' && model?.selectedActivityId) {
        this.selectedActivityId = model.selectedActivityId;
      }
      const selectedActivityDocument = item ? getItemActivity(item, model?.selectedActivityId) : null;
      if (this.activityWorkspaceMode !== 'create' && selectedActivityDocument
        && this.activityWorkspaceDraft?.id !== selectedActivityDocument.id) {
        this.activityWorkspaceDraft = readActivityWorkspace(selectedActivityDocument);
      }
      const activityDraft = this.renderedInputKey === this.inputKey
        ? Object.fromEntries(Array.from(this.inputDraft).map(([key, value]) => [key.replace(/:(INPUT|TEXTAREA|SELECT):\d+$/, ''), value]))
        : {};
      const activityCommonFields = selectedActivityDocument ? readActivityCommonFields(
        selectedActivityDocument,
        activityDraft,
      ) : [];
      const activityNativeClass = selectedActivityDocument ? nativeActivityClass(selectedActivityDocument.type) : null;
      const activitySpecificFields = selectedActivityDocument ? readActivitySpecificFields(
        selectedActivityDocument,
        activityNativeClass,
        activityDraft,
      ) : [];
      const rawAdvancement = advancementSourceList(item?.toObject?.()?.system?.advancement);
      if (item && this.selectedAdvancementId && !getAdvancement(item, this.selectedAdvancementId)) this.selectedAdvancementId = null;
      if (!this.selectedAdvancementId && rawAdvancement.length) this.selectedAdvancementId = rawAdvancement[0]?._id ?? null;
      const selectedAdvancementDocument = item ? getAdvancement(item, this.selectedAdvancementId) : null;
      const advancementDraft = this.renderedInputKey === this.inputKey
        ? Object.fromEntries(Array.from(this.inputDraft).filter(
          ([key]) => /^(configuration|value)[.:]/.test(key),
        ).map(([key, value]) => [key.replace(/:(INPUT|TEXTAREA|SELECT):\d+$/, ''), value]))
        : {};
      const advancementFields = selectedAdvancementDocument ? readAdvancementFields(
        selectedAdvancementDocument,
        advancementDraft,
      ) : [];
      const advancementFieldGroups = groupFieldsByRoot(advancementFields);
      const typeFieldGroups = groupFieldsByRoot(typeFields);
      const isExternalActivity = Boolean(selectedActivityDocument && !CORE_ACTIVITY_TYPES.has(selectedActivityDocument.type));
      const isCreatingActivityWorkspace = this.activityWorkspaceMode === 'create';
      const activityAdvancedFields = isExternalActivity || isCreatingActivityWorkspace
        ? (isExternalActivity ? activityCommonFields : [])
        : filterActivityWorkspaceFields(activityCommonFields);
      const activityWorkspaceTypeFields = isExternalActivity || isCreatingActivityWorkspace
        ? []
        : filterActivityWorkspaceFields(activitySpecificFields);
      const activityCommonFieldGroups = groupFieldsByRoot(activityAdvancedFields);
      const activitySpecificFieldGroups = groupFieldsByRoot(activityWorkspaceTypeFields);
      const externalActivitySource = isExternalActivity ? JSON.stringify(selectedActivityDocument.toObject?.() ?? {}, null, 2) : '';

      const damageTypes = Object.entries(globalThis.CONFIG?.DND5E?.damageTypes ?? {})
        .map(([value, data]) => ({
          value,
          label: value === 'none' ? '유형 없음' : (value === 'midi-none' ? '피해 없음' : localize(data?.label ?? data)),
          icon: data?.icon ?? '',
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
      const defaultDamageType = damageTypes[0]?.value ?? '';

      const modelExtraRows = (model?.selectedActivity?.extraDamage ?? []).map((part, index) => ({
        index,
        formula: damageFormula(part),
        types: [...part.types],
      }));
      if (this.extraDamageDraft == null) this.extraDamageDraft = modelExtraRows;
      const extraRows = this.extraDamageDraft.map((row, index) => ({
        ...row,
        index,
        damageTypes: damageTypes.map((option) => ({
          ...option,
          selected: (row.types ?? []).includes(option.value),
        })),
      }));

      const baseTypes = model?.selectedActivity?.baseDamage?.types ?? [];
      if (this.usesRecoveryDraft == null) {
        this.usesRecoveryDraft = (model?.uses?.recovery ?? []).map((row) => ({ ...row }));
      }
      const recoveryPeriods = globalThis.CONFIG?.DND5E?.limitedUsePeriods?.recoveryOptions ?? [];
      const recoveryTypes = [
        { value: 'recoverAll', label: '전부 회복' },
        { value: 'loseAll', label: '전부 소모' },
        { value: 'formula', label: '수식으로 계산' },
      ];
      const recoveryRows = this.usesRecoveryDraft.map((row, index) => ({
        ...row,
        index,
        periodOptions: recoveryPeriods.map((option) => ({
          ...option,
          label: RECOVERY_PERIOD_LABELS[option.value] ?? localize(option.label ?? option.value),
          selected: option.value === row.period,
        })),
        typeOptions: recoveryTypes.map((option) => ({
          ...option,
          selected: option.value === (row.period === 'recharge' ? 'recoverAll' : row.type),
        })),
      }));
      const quickHealingTypes = Object.entries(globalThis.CONFIG?.DND5E?.healingTypes ?? {}).map(([value, data]) => ({ value, label: localize(data?.label ?? value) }));
      const quickAbilityOptions = Object.entries(globalThis.CONFIG?.DND5E?.abilities ?? {}).map(([value, data]) => ({ value, label: localize(data?.label ?? value) }));
      const quickTargetTypes = Object.entries(globalThis.CONFIG?.DND5E?.individualTargetTypes ?? {}).map(([value, data]) => ({ value, label: QUICK_TARGET_LABELS[value] ?? localize(data?.label ?? value) }));
      const quickAreaTypes = [{ value: '', label: '범위 없음' }, ...Object.entries(globalThis.CONFIG?.DND5E?.areaTargetTypes ?? {}).filter(([value]) => Object.hasOwn(QUICK_AREA_LABELS, value)).map(([value, data]) => ({ value, label: QUICK_AREA_LABELS[value] ?? localize(data?.label ?? value) }))];
      const quickRangeTypes = [
        { value: 'self', label: '자신' }, { value: 'touch', label: '접촉' }, { value: 'distance', label: '거리 지정' },
        { value: 'any', label: '모든 거리' }, { value: 'special', label: '특수' },
      ];
      const quickOnSaveOptions = [
        { value: 'half', label: '성공 시 절반 피해' }, { value: 'none', label: '성공 시 피해 없음' }, { value: 'full', label: '성공해도 전체 피해' },
      ];
      const itemTypes = Array.from(new Set(worldItems.map((worldItem) => worldItem.type))).sort();
      const statusOptions = values(globalThis.CONFIG?.statusEffects).map((status) => ({
        value: status.id,
        label: STATUS_LABELS[status.id] ?? localize(status.name ?? status.label ?? status.id),
      })).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
      const weightUnits = Object.entries(globalThis.CONFIG?.DND5E?.weightUnits ?? {}).map(([value, data]) => ({ value, label: WEIGHT_UNIT_LABELS[value] ?? localize(data?.label ?? value) }));
      const currencies = Object.entries(globalThis.CONFIG?.DND5E?.currencies ?? {}).map(([value, data]) => ({ value, label: CURRENCY_LABELS[value] ?? localize(data?.label ?? value) }));
      const rarities = [{ value: '', label: '희귀도 없음' }, ...Object.entries(globalThis.CONFIG?.DND5E?.itemRarity ?? {}).map(([value, label]) => ({ value, label: localize(label) }))];
      const containerOptions = item ? containerDestinationOptions(
        item,
        worldItems,
      ) : [];
      const containerManagement = item ? await readContainerManagement(
        item,
        worldItems,
      ) : null;
      const containerFieldGroups = containerManagement
        ? typeFieldGroups.filter((group) => ['capacity', 'currency'].includes(group.key)) : [];
      const remainingTypeFieldGroups = containerManagement
        ? typeFieldGroups.filter((group) => !['capacity', 'currency'].includes(group.key)) : typeFieldGroups;
      const attunementTypes = [{ value: '', label: '조율 없음' }, ...Object.entries(globalThis.CONFIG?.DND5E?.attunementTypes ?? {}).map(([value, label]) => ({ value, label: value === 'required' ? '조율 필요' : (value === 'optional' ? '조율 선택' : localize(label)) }))];
      const propertyMetadata = globalThis.CONFIG?.DND5E?.itemProperties ?? {};
      const activityTypeOptions = item
        ? availableActivityTypes(item, globalThis.CONFIG?.DND5E?.activityTypes ?? {})
          .filter((option) => CORE_ACTIVITY_TYPES.has(option.value))
          .map((option) => ({
            ...option, label: activityTypeLabel(option.value) === option.value ? localize(option.label) : activityTypeLabel(option.value),
          }))
        : [];
      if (this.activityWorkspaceMode === 'create' && !this.activityWorkspaceDraft) {
        this.activityWorkspaceDraft = emptyActivityWorkspace(activityTypeOptions[0]?.value ?? '');
      }
      const activityWorkspace = this.activityWorkspaceDraft
        ?? (selectedActivityDocument ? readActivityWorkspace(selectedActivityDocument) : emptyActivityWorkspace(activityTypeOptions[0]?.value ?? ''));
      const workspaceRecoveryPeriods = recoveryPeriods.map((option) => ({
        ...option,
        label: RECOVERY_PERIOD_LABELS[option.value] ?? localize(option.label ?? option.value),
      }));
      const workspaceActivationTypes = Object.entries(
        globalThis.CONFIG?.DND5E?.activityActivationTypes
          ?? globalThis.CONFIG?.DND5E?.activationTypes
          ?? {},
      ).map(([value, data]) => ({
        value,
        label: ACTIVATION_TYPE_LABELS[value] ?? localize(data?.label ?? data ?? value),
      }));
      const workspaceRangeUnits = Object.entries(
        globalThis.CONFIG?.DND5E?.distanceUnits ?? globalThis.CONFIG?.DND5E?.rangeUnits ?? {},
      ).map(([value, data]) => ({
        value,
        label: localize(data?.label ?? data ?? value),
      }));
      const activityWorkspaceDamageRows = (activityWorkspace.damageRows.length
        ? activityWorkspace.damageRows
        : [{ formula: '', types: [] }]).map((row, index) => ({
        ...row,
        index,
        damageTypes: damageTypes.map((option) => ({
          ...option,
          selected: (row.types ?? []).includes(option.value),
        })),
      }));
      const activityWorkspaceRecoveryRows = activityWorkspace.uses.recovery.map((row, index) => ({
        ...row,
        index,
        periodOptions: activityWorkspaceOptions(workspaceRecoveryPeriods, row.period),
        typeOptions: activityWorkspaceOptions(recoveryTypes, row.type),
      }));
      const workspaceTypeOptions = activityTypeOptions.some((option) => option.value === activityWorkspace.type)
        ? activityWorkspaceOptions(activityTypeOptions, activityWorkspace.type)
        : [{
            value: activityWorkspace.type,
            label: activityTypeLabel(activityWorkspace.type),
            selected: true,
          }];
      const activityWorkspaceContext = {
        ...activityWorkspace,
        mode: this.activityWorkspaceMode,
        isCreate: this.activityWorkspaceMode === 'create',
        isEdit: this.activityWorkspaceMode !== 'create',
        isNative: CORE_ACTIVITY_TYPES.has(activityWorkspace.type),
        isSystemManaged: activityWorkspace.type === 'order',
        isAttack: activityWorkspace.type === 'attack',
        isSave: activityWorkspace.type === 'save',
        typeLabel: activityTypeLabel(activityWorkspace.type),
        typeOptions: workspaceTypeOptions,
        supportsDamage: activityWorkspaceSupportsDamage(activityWorkspace.type),
        supportsHealing: activityWorkspaceSupportsHealing(activityWorkspace.type),
        damageRows: activityWorkspaceDamageRows,
        recoveryRows: activityWorkspaceRecoveryRows,
        activationOptions: activityWorkspaceOptions(workspaceActivationTypes, activityWorkspace.activation.type, true),
        rangeUnitOptions: activityWorkspaceOptions(workspaceRangeUnits, activityWorkspace.range.units, true),
        targetOptions: activityWorkspaceOptions(quickTargetTypes, activityWorkspace.target.type, true),
        templateOptions: activityWorkspaceOptions(quickAreaTypes, activityWorkspace.target.template.type, true),
        templateUnitOptions: activityWorkspaceOptions(workspaceRangeUnits, activityWorkspace.target.template.units, true),
        healingTypes: quickHealingTypes.map((option) => ({
          ...option,
          selected: activityWorkspace.healing.types.includes(option.value),
        })),
        attackAbilityOptions: activityWorkspaceOptions(quickAbilityOptions, activityWorkspace.attack.ability, true),
        saveAbilityOptions: [...quickAbilityOptions, ...activityWorkspace.save.abilities.filter(value => !quickAbilityOptions.some(option => option.value === value)).map(value => ({ value, label: `기존 값: ${value}` }))].map((option) => ({
          ...option,
          selected: activityWorkspace.save.abilities.includes(option.value),
        })),
        saveOnSaveOptions: activityWorkspaceOptions(quickOnSaveOptions, activityWorkspace.save.onSave, true),
        recoveryTypeOptions: recoveryTypes,
      };
      const sortedActivities = (model?.activities ?? []).slice().sort((a, b) => a.sort - b.sort);
      const advancementTypeOptions = item
        ? availableAdvancementTypes(item, globalThis.CONFIG?.DND5E?.advancementTypes ?? {}).map((option) => ({
            ...option,
            label: ADVANCEMENT_TYPE_LABELS[option.value] ?? localize(option.label),
          }))
        : [];
      const advancementRows = rawAdvancement.map((source) => {
        const runtime = getAdvancement(item, source._id);
        const config = globalThis.CONFIG?.DND5E?.advancementTypes?.[source.type];
        return {
          id: source._id,
          type: source.type,
          typeLabel: advancementTypeLabel(source.type),
          title: source.title || localize(config?.documentClass?.metadata?.title ?? source.type),
          level: source.level ?? '',
          icon: source.icon || config?.documentClass?.metadata?.typeIcon || config?.documentClass?.metadata?.icon || '',
          selected: source._id === this.selectedAdvancementId,
          hasSheet: Boolean(runtime?.sheet),
        };
      });

      return {
        ...base,
        isEmbeddedItem,
        missingTargetDraft: !item && this.inputDraft.size ? Array.from(this.inputDraft, ([key, value], index) => ({ name: key.startsWith('itemName:') ? '이름' : `보관 입력 ${index + 1}`, value: typeof value === 'string' ? value : JSON.stringify(value) })) : null,
        items: currentItems.map((worldItem) => ({
          id: worldItem.id,
          name: worldItem.name,
          type: worldItem.type,
          typeLabel: itemTypeLabel(worldItem.type),
          img: worldItem.img,
          folder: worldItem.folder?.name ?? '',
          selected: worldItem.id === this.selectedItemId,
          searchText: `${worldItem.name} ${worldItem.type}`.toLowerCase(),
        })),
        folders: childFolders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          searchText: String(folder.name).toLowerCase(),
        })),
        path: workbenchFolderPath(currentFolder),
        currentFolder: currentFolder ? { id: currentFolder.id, name: currentFolder.name } : null,
        canGoParent: Boolean(currentFolder),
        browserItemCount: currentItems.length,
        itemTypes: itemTypes.map((type) => ({ value: type, label: itemTypeLabel(type) })),
        selected: model ? {
          ...model,
          isEmbeddedItem,
          typeLabel: itemTypeLabel(model.type),
          quickPurposeOptions: ACTIVITY_PURPOSES,
          quickDamageTypes: damageTypes,
          quickHealingTypes,
          quickAbilityOptions,
          quickTargetTypes,
          quickAreaTypes,
          quickRangeTypes,
          quickOnSaveOptions,
          typeFields,
          typeFieldGroups: remainingTypeFieldGroups,
          hasTypeFields: remainingTypeFieldGroups.length > 0,
          baseDamageFormula: damageFormula(model.selectedActivity?.baseDamage),
          baseDamageTypes: damageTypes.map((option) => ({
            ...option,
            selected: baseTypes.includes(option.value),
          })),
          recoveryRows,
          sourceRuleOptions: [
            { value: '', label: '규칙 미지정', selected: !model.source.rules },
            { value: '2024', label: '2024 규칙', selected: model.source.rules === '2024' },
            { value: '2014', label: '2014 레거시', selected: model.source.rules === '2014' },
          ],
          weightUnitOptions: weightUnits.map((option) => ({ ...option, selected: option.value === model.inventory.weight.units })),
          currencyOptions: currencies.map((option) => ({ ...option, selected: option.value === model.inventory.price.denomination })),
          rarityOptions: rarities.map((option) => ({ ...option, selected: option.value === model.inventory.rarity })),
          containerOptions,
          containerFieldGroups,
          containerManagement: containerManagement ? {
            ...containerManagement,
            entries: containerManagement.entries.map((entry) => ({ ...entry, typeLabel: itemTypeLabel(entry.type), parentPath: entry.path.join(' / ') })),
          } : null,
          attunementOptions: attunementTypes.map((option) => ({ ...option, selected: option.value === model.equipAttunement.attunement })),
          propertyOptions: Array.from(new Set([...model.validProperties, ...model.properties])).map((value) => ({
            value,
            label: localize(propertyMetadata[value]?.label ?? value),
            selected: model.properties.includes(value),
            legacy: !model.validProperties.includes(value),
          })).sort((a, b) => a.label.localeCompare(b.label, 'ko')),
          activityTypeOptions,
          activityWorkspace: activityWorkspaceContext,
          activityTabs: buildActivityTabs(
            activityWorkspace.type,
            activityAdvancedFields,
            activityWorkspaceTypeFields,
            this.selectedActivityTab,
          ).map((tab) => ({ ...tab, groups: groupFieldsByRoot(tab.fields) })),
          activityEditorOpen: this.activityEditorOpen,
          activityWorkspaceNewTypeOptions: activityWorkspaceOptions(activityTypeOptions, activityWorkspace.type),
          activityCommonFields: activityAdvancedFields,
          activityCommonFieldGroups,
          hasActivityCommonFields: activityAdvancedFields.length > 0,
          activitySpecificFields: activityWorkspaceTypeFields,
          activitySpecificFieldGroups,
          hasActivitySpecificFields: activityWorkspaceTypeFields.length > 0,
          hasActivityWorkspaceTypeFields: activityWorkspaceTypeFields.length > 0,
          advancementTypeOptions,
          advancements: advancementRows,
          selectedAdvancementId: this.selectedAdvancementId,
          selectedAdvancement: selectedAdvancementDocument ? {
            id: selectedAdvancementDocument.id ?? selectedAdvancementDocument._id,
            type: selectedAdvancementDocument.constructor?.typeName ?? selectedAdvancementDocument.type,
            typeLabel: advancementTypeLabel(selectedAdvancementDocument.constructor?.typeName ?? selectedAdvancementDocument.type),
            title: selectedAdvancementDocument.toObject?.().title ?? '',
            hasSheet: Boolean(selectedAdvancementDocument.sheet),
          } : null,
          advancementFields,
          advancementFieldGroups,
          hasAdvancementFields: advancementFields.length > 0,
          hasAdvancementSystem: hasAdvancementSource(item?.toObject?.()?.system?.advancement),
          isExternalActivity,
          externalActivitySource,
          selectedActivityTypeLabel: selectedActivityDocument ? activityTypeLabel(selectedActivityDocument.type) : '',
          activities: sortedActivities.map((activity, index, list) => ({
            ...activity,
            typeLabel: activityTypeLabel(activity.type),
            selected: activity.id === model.selectedActivityId,
            expanded: activity.id === model.selectedActivityId && this.activityEditorOpen && !isCreatingActivityWorkspace,
            canMoveUp: index > 0,
            canMoveDown: index < list.length - 1,
          })),
          canEditExtraDamage: Boolean(model.selectedActivity && ['attack', 'damage', 'save'].includes(model.selectedActivity.type)),
          extraDamageRows: extraRows,
        } : null,
        statusOptions,
        effectModes: effectModeOptions('add'),
        defaultDamageType,
        packTarget: this.packId || rootDocument(item)?.pack ? {
          id: this.packId ?? rootDocument(item).pack,
          label: globalThis.game?.packs?.get?.(this.packId ?? rootDocument(item).pack)?.title,
          locked: globalThis.game?.packs?.get?.(this.packId ?? rootDocument(item).pack)?.locked,
        } : null,
        canManageItems: this.canManageItems(),
        managedEffects: values(item?.effects).map((effect) => ({ id: effect.id, name: effect.name, disabled: effect.disabled, transfer: effect.transfer })),
      };
    }

    _attachSectionGuides() {
      for (const details of this.element?.querySelectorAll?.('details[data-section-key]') ?? []) {
        const key = details.dataset.sectionKey ?? '';
        const summary = details.querySelector(':scope > summary');
        if (!key || !summary || details.querySelector(':scope > .ncm-workbench__section-guide')) continue;
        const guide = document.createElement('details');
        guide.className = 'ncm-workbench__section-guide';
        guide.open = this.sectionGuideOpenState.get(key) ?? true;
        const guideSummary = document.createElement('summary');
        guideSummary.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i><strong>사용 가이드</strong>';
        const guideContent = document.createElement('p');
        guideContent.textContent = guideForSection(key);
        guide.append(guideSummary, guideContent);
        guide.addEventListener('toggle', () => this.sectionGuideOpenState.set(key, guide.open));
        details.insertBefore(guide, summary.nextSibling);
      }
    }

    _onRender(context, options) {
      super._onRender(context, options);
      if (this.renderedInputKey !== this.inputKey) { this.inputDraft.clear(); this.draftSource = null; }
      this.renderedInputKey = this.inputKey;
      this.renderedSource = itemEditSnapshot(this.selectedItem);
      this.initialInputs = new Map(formInputEntries(this.form).map(({ key, value }) => [key, value]));
      globalThis.Hooks?.callAll('ncmWorkbenchStateChanged');
      restoreFormInputs(
        this.form,
        this.inputDraft
      );
      this.form?.querySelector?.('.ncm-workbench__activity-tabs')?.addEventListener(
        'keydown',
        (event) => {
          const buttons = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
          const index = buttons.indexOf(event.target);
          if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          let next = index;
          if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = buttons.length - 1;
          else next = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.click();
        },
      );
      for (const control of this.form?.querySelectorAll?.('[data-activity-complex-root] [data-complex-refresh]') ?? []) {
        control.addEventListener(
          'change',
          () => { this.render({ force: true }); },
        );
      }
      for (const control of this.form?.querySelectorAll?.('select[data-advancement-path="configuration.type"]') ?? []) {
        control.addEventListener(
          'change',
          () => {
            this.render({ force: true });
          },
        );
      }
      for (const control of this.form?.querySelectorAll?.('[data-type-complex-root] select[data-complex-control]') ?? []) {
        if (!control.dataset.complexAddress.endsWith('"type"]')) continue;
        control.addEventListener(
          'change',
          () => {
            this.render({ force: true });
          },
        );
      }
      this.form?.querySelector?.('[data-type-path="type.value"]')?.addEventListener(
        'change',
        () => {
          this.render({ force: true });
        },
      );
      this._attachSectionGuides();
      for (const details of this.element?.querySelectorAll?.('details[data-section-key]') ?? []) {
        const key = details.dataset.sectionKey;
        if (!key) continue;
        if (this.sectionOpenState.has(key)) details.open = this.sectionOpenState.get(key);
        const summary = details.querySelector(':scope > summary');
        if (summary && !summary.querySelector('.ncm-workbench__toggle-icon')) {
          const icon = document.createElement('span');
          icon.className = 'ncm-workbench__toggle-icon';
          icon.innerHTML = '<i class="fa-solid fa-chevron-right is-closed"></i><i class="fa-solid fa-chevron-down is-open"></i>';
          summary.append(icon);
        }
        details.addEventListener('toggle', () => this.sectionOpenState.set(key, details.open));
      }
      const search = this.element?.querySelector?.('[name="browserSearch"]');
      const type = this.element?.querySelector?.('[name="browserType"]');
      const applyFilter = () => {
        const query = String(search?.value ?? '').trim().toLowerCase();
        const itemType = String(type?.value ?? '');
        for (const row of this.element?.querySelectorAll?.('[data-browser-item]') ?? []) {
          const matchesText = !query || String(row.dataset.search ?? '').includes(query);
          const matchesType = !itemType || row.dataset.itemType === itemType;
          row.hidden = !(matchesText && matchesType);
        }
        for (const row of this.element?.querySelectorAll?.('[data-browser-folder]') ?? []) {
          row.hidden = Boolean(query) && !String(row.dataset.search ?? '').includes(query);
        }
      };
      search?.addEventListener('input', applyFilter);
      type?.addEventListener('change', applyFilter);

      const updateRecoveryVisibility = (row) => {
        const period = row.querySelector('[data-recovery-period]')?.value ?? 'lr';
        const typeSelect = row.querySelector('[data-recovery-type]');
        if (period === 'recharge' && typeSelect) typeSelect.value = 'recoverAll';
        const recoveryType = period === 'recharge' ? 'recoverAll' : (typeSelect?.value ?? 'recoverAll');
        const typeField = row.querySelector('[data-recovery-type-field]');
        const formulaField = row.querySelector('[data-recovery-formula-field]');
        if (typeField) typeField.hidden = period === 'recharge';
        if (formulaField) formulaField.hidden = !(period === 'recharge' || recoveryType === 'formula');
      };
      for (const row of this.element?.querySelectorAll?.('[data-recovery-row]') ?? []) {
        updateRecoveryVisibility(row);
        row.querySelector('[data-recovery-period]')?.addEventListener('change', () => updateRecoveryVisibility(row));
        row.querySelector('[data-recovery-type]')?.addEventListener('change', () => updateRecoveryVisibility(row));
      }
      bindWorkbenchLayout(this);
    }

    static async _selectItemAction(event, target) {
      event.preventDefault();
      if (!await this.guardItemTransition()) return;
      this.selectItem(target.dataset.itemId);
      showWorkbenchForm(this);
      await this.render({ force: true });
    }

    static async _openContainerItemAction(
      event,
      target,
    ) {
      event.preventDefault();
      const item = containerItems(this.selectedItem).find((entry) => entry.id === target.dataset.itemId);
      if (!item || !await this.guardItemTransition()) return;
      this.selectItem(item.id);
      await this.render({ force: true });
    }

    static async _moveContainerItemAction(
      event,
      target,
    ) {
      event.preventDefault();
      const container = this.selectedItem;
      if (!this.canManageItems() || container?.type !== 'container' || container.isOwner === false) return;
      const adding = target.dataset.action === 'addContainerItem';
      const removing = target.dataset.action === 'removeContainerItem';
      const control = adding ? target.parentElement.querySelector('[data-container-candidate]')
        : target.closest('[data-container-row]')?.querySelector('[data-container-destination]');
      const id = adding ? control?.value : target.dataset.itemId;
      if (!id) return ui.notifications.warn('넣을 아이템을 선택하십시오.');
      const destination = adding ? container.id : removing ? null : control?.value;
      if (!adding && !removing && destination === undefined) return;
      const expectedParent = adding ? control.selectedOptions[0]?.dataset.parentId : target.dataset.parentId;
      if (!await this.guardItemTransition()) return;
      const items = containerItems(container);
      const item = items.find((entry) => entry.id === id);
      try {
        await moveContainerItem(
          item,
          destination,
          { items, expectedParent },
        );
        ui.notifications.info(`${item.name}: 보관 위치를 변경했습니다.`);
        await this.render({ force: true });
      } catch (error) {
        ui.notifications.error(error.message);
      }
    }

    static async _openFolderAction(event, target) {
      event.preventDefault();
      this.setCurrentFolder(target.dataset.folderId || null);
      await this.render({ force: true });
    }

    static async _goParentFolderAction(event) {
      event.preventDefault();
      const parentId = this.currentFolder?.folder?.id ?? null;
      this.setCurrentFolder(parentId);
      focusWorkbenchPath(this);
      await this.render({ force: true });
    }

    static async _goBreadcrumbAction(event, target) {
      event.preventDefault();
      this.setCurrentFolder(target.dataset.folderId || null);
      focusWorkbenchPath(this);
      await this.render({ force: true });
    }

    static async _selectActivityAction(event, target) {
      event.preventDefault();
      if (target.dataset.activityId === this.selectedActivityId && this.activityWorkspaceMode !== 'create') {
        this.activityEditorOpen = !this.activityEditorOpen;
        await this.render({ force: true });
        return;
      }
      if (!await this.guardItemTransition()) return;
      this.selectedActivityId = target.dataset.activityId || null;
      this.activityEditorOpen = true;
      this.selectedActivityTab = 'identity';
      this.extraDamageDraft = null;
      this.activityWorkspaceMode = 'edit';
      this.activityWorkspaceDraft = null;
      await this.render({ force: true });
    }

    static async _selectActivityTabAction(
      event,
      target,
    ) {
      event.preventDefault();
      const tab = target.dataset.activityTab;
      if (!['identity', 'activation', 'targets', 'type', 'effects', 'automation'].includes(tab)) return;
      this.selectedActivityTab = tab;
      await this.render({ force: true });
      this.form?.querySelector?.(`[data-activity-tab="${tab}"]`)?.focus();
    }

    static async _newActivityWorkspaceAction(event) {
      event.preventDefault();
      if (!await this.guardItemTransition(['activityWorkspaceNewType'])) return;
      const type = formValue(this.form, 'activityWorkspaceNewType', '');
      if (!type) return ui.notifications.warn('새 액티비티 유형을 선택하십시오.');
      this.activityWorkspaceMode = 'create';
      this.selectedActivityTab = 'identity';
      this.activityWorkspaceDraft = emptyActivityWorkspace(type);
      await this.render({ force: true });
    }

    static async _saveActivityWorkspaceAction(event) {
      event.preventDefault();
      if (this.savingForm || this.isSavingActivityWorkspace) return;
      const item = this.selectedItem;
      this.captureInputs();
      try { requireWritableItem(item, this.canManageItems()); }
      catch (error) { globalThis.ui?.notifications?.error?.(error.message); return; }
      if (this.draftSource && this.draftSource !== itemEditSnapshot(item)) {
        return ui.notifications.error('아이템이 편집 중 다른 곳에서 변경되었습니다. 입력을 보존했습니다.');
      }
      const scrollTop = this.element?.querySelector?.('.ncm-workbench__scroll')?.scrollTop ?? 0;
      const selectedActivity = getItemActivity(item, this.selectedActivityId);
      const fallback = this.activityWorkspaceDraft
        ?? (selectedActivity ? readActivityWorkspace(selectedActivity) : emptyActivityWorkspace(''));

      this.isSavingActivityWorkspace = true;
      this.savingForm = true;
      const unlock = lockWorkbenchControls(this);
      try {
        const form = activityWorkspaceFormFromElement(this.form, fallback);
        if (this.activityWorkspaceMode === 'create') {
          const created = await createActivity(
            item,
            form.type,
            buildActivityWorkspaceCreateData(form.type, form),
          );
          if (created?.id) this.selectedActivityId = created.id;
        } else {
          if (!selectedActivity) return ui.notifications.warn('수정할 액티비티를 선택하십시오.');
          if (!CORE_ACTIVITY_TYPES.has(selectedActivity.type)) {
            return ui.notifications.warn('외부 액티비티는 표준 작성 폼으로 저장할 수 없습니다. 추가 설정을 사용하십시오.');
          }
          const update = {
            ...buildActivityWorkspaceUpdate(
              selectedActivity,
              form,
            ),
            ...activityFieldEditsFromForm(
              selectedActivity,
              nativeActivityClass(selectedActivity.type),
              this.form,
            ),
          };
          if (Object.keys(update).length) requireWriteResult(await selectedActivity.update(update), '액티비티 저장');
        }
      } catch (error) {
        ui.notifications.error(error.message);
        return;
      } finally {
        unlock();
        this.isSavingActivityWorkspace = false;
        this.savingForm = false;
      }

      for (const { key, control, value } of formInputEntries(this.form)) {
        if (control.name?.startsWith('activityWorkspace') || control.hasAttribute?.('data-activity-common-field') || control.hasAttribute?.('data-activity-specific-field')) {
          this.inputDraft.delete(key);
          this.initialInputs.set(
            key,
            value,
          );
        }
      }
      this.draftSource = this.inputDraft.size ? itemEditSnapshot(item) : null;
      this.activityWorkspaceMode = 'edit';
      this.activityEditorOpen = true;
      this.activityWorkspaceDraft = null;
      this.extraDamageDraft = null;
      await this.render({ force: true });
      const scroll = this.element?.querySelector?.('.ncm-workbench__scroll');
      if (scroll) scroll.scrollTop = scrollTop;
    }

    static async _cancelActivityWorkspaceAction(event) {
      event.preventDefault();
      if (!await this.guardItemTransition()) return;
      this.activityWorkspaceMode = 'edit';
      this.activityWorkspaceDraft = null;
      await this.render({ force: true });
    }

    static async _addActivityWorkspaceDamageAction(event) {
      event.preventDefault();
      const fallback = this.activityWorkspaceDraft ?? emptyActivityWorkspace('');
      const draft = activityWorkspaceFormFromElement(this.form, fallback);
      draft.damageRows = [...draft.damageRows, { formula: '', types: [] }];
      this.activityWorkspaceDraft = draft;
      await this.render({ force: true });
    }

    static async _removeActivityWorkspaceDamageAction(event, target) {
      event.preventDefault();
      const fallback = this.activityWorkspaceDraft ?? emptyActivityWorkspace('');
      const draft = activityWorkspaceFormFromElement(this.form, fallback);
      const index = Number(target.dataset.activityWorkspaceDamageIndex);
      draft.damageRows = draft.damageRows.filter((_, currentIndex) => currentIndex !== index);
      this.activityWorkspaceDraft = draft;
      await this.render({ force: true });
    }

    static async _addActivityWorkspaceRecoveryAction(event) {
      event.preventDefault();
      const fallback = this.activityWorkspaceDraft ?? emptyActivityWorkspace('');
      const draft = activityWorkspaceFormFromElement(this.form, fallback);
      draft.uses = {
        ...draft.uses,
        recovery: [...draft.uses.recovery, { period: 'lr', type: 'recoverAll', formula: '' }],
      };
      this.activityWorkspaceDraft = draft;
      await this.render({ force: true });
    }

    static async _removeActivityWorkspaceRecoveryAction(event, target) {
      event.preventDefault();
      const fallback = this.activityWorkspaceDraft ?? emptyActivityWorkspace('');
      const draft = activityWorkspaceFormFromElement(this.form, fallback);
      const index = Number(target.dataset.activityWorkspaceRecoveryIndex);
      draft.uses = {
        ...draft.uses,
        recovery: draft.uses.recovery.filter((_, currentIndex) => currentIndex !== index),
      };
      this.activityWorkspaceDraft = draft;
      await this.render({ force: true });
    }

    static async _createActivityAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item) return;
      const scrollTop = this.element?.querySelector?.('.ncm-workbench__scroll')?.scrollTop ?? 0;
      const type = formValue(this.form, 'newActivityType', '');
      if (!type) return ui.notifications.warn('액티비티 유형을 선택하십시오.');
      const name = formValue(this.form, 'newActivityName', '').trim();
      const created = await createActivity(item, type, name ? { name } : {});
      if (created?.id) this.selectedActivityId = created.id;
      this.extraDamageDraft = null;
      this.activityWorkspaceMode = 'edit';
      this.activityWorkspaceDraft = null;
      await this.render({ force: true });
      const scroll = this.element?.querySelector?.('.ncm-workbench__scroll');
      if (scroll) scroll.scrollTop = scrollTop;
    }

    static async _createQuickActivityAction(event, target) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item) return;
      const purpose = target?.dataset?.purpose ?? '';
      const prefix = purpose === 'heal' ? 'quickHeal' : 'quickSave';
      const scrollTop = this.element?.querySelector?.('.ncm-workbench__scroll')?.scrollTop ?? 0;
      const values = {
        name: formValue(this.form, `${prefix}Name`, ''),
        rangeType: formValue(this.form, `${prefix}RangeType`, 'self'),
        rangeValue: formValue(this.form, `${prefix}RangeValue`, ''),
        rangeUnits: 'ft',
        rangeSpecial: formValue(this.form, `${prefix}RangeSpecial`, ''),
        targetType: formValue(this.form, `${prefix}TargetType`, 'creature'),
        targetCount: formValue(this.form, `${prefix}TargetCount`, ''),
        areaType: formValue(this.form, `${prefix}AreaType`, ''),
        areaSize: formValue(this.form, `${prefix}AreaSize`, ''),
        areaUnits: 'ft',
        formula: formValue(this.form, `${prefix}Formula`, ''),
        healingType: formValue(this.form, 'quickHealType', 'healing'),
        damageType: formValue(this.form, 'quickSaveDamageType', ''),
        saveAbility: formValue(this.form, 'quickSaveAbility', ''),
        saveDc: formValue(this.form, 'quickSaveDc', ''),
        onSave: formValue(this.form, 'quickSaveOnSave', 'half'),
      };
      try {
        const plan = buildQuickActivityData(purpose, values);
        const created = await createActivity(item, plan.type, plan.data);
        if (created?.id) this.selectedActivityId = created.id;
        this.extraDamageDraft = null;
        this.activityWorkspaceMode = 'edit';
        this.activityWorkspaceDraft = null;
        await this.render({ force: true });
        const scroll = this.element?.querySelector?.('.ncm-workbench__scroll');
        if (scroll) scroll.scrollTop = scrollTop;
        ui.notifications.info(`${activityTypeLabel(plan.type)} 액티비티를 추가했습니다.`);
      } catch (error) {
        ui.notifications.error(error?.message ?? '빠른 액티비티 추가에 실패했습니다.');
      }
    }

    static async _addQuickDamageAction(event) {
      event.preventDefault();
      const activity = getItemActivity(this.selectedItem, this.selectedActivityId);
      if (!activity) return ui.notifications.warn('먼저 피해를 추가할 액티비티를 선택하십시오.');
      const scrollTop = this.element?.querySelector?.('.ncm-workbench__scroll')?.scrollTop ?? 0;
      try {
        await appendQuickDamage(activity, {
          formula: formValue(this.form, 'quickDamageFormula', ''),
          damageType: formValue(this.form, 'quickDamageType', ''),
        });
        this.extraDamageDraft = null;
        this.activityWorkspaceDraft = null;
        await this.render({ force: true });
        const scroll = this.element?.querySelector?.('.ncm-workbench__scroll');
        if (scroll) scroll.scrollTop = scrollTop;
        ui.notifications.info('추가 피해를 적용했습니다.');
      } catch (error) {
        ui.notifications.error(error?.message ?? '추가 피해 적용에 실패했습니다.');
      }
    }

    static async _addQuickStatusAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      const activity = getItemActivity(item, this.selectedActivityId);
      if (!item || !activity) return ui.notifications.warn('먼저 액티비티를 선택하십시오.');
      const statusId = formValue(this.form, 'quickStatus', '');
      if (!statusId) return ui.notifications.warn('상태를 선택하십시오.');
      const select = this.form?.elements?.namedItem?.('quickStatus');
      const statusName = select?.selectedOptions?.[0]?.textContent?.trim() || statusId;
      const scrollTop = this.element?.querySelector?.('.ncm-workbench__scroll')?.scrollTop ?? 0;
      await createOnHitStatusEffect(item, activity, {
        name: formValue(this.form, 'quickStatusName', '') || statusName,
        statusId,
        rounds: numericFormValue(this.form, 'quickStatusRounds', 1),
      });
      await this.render({ force: true });
      const scroll = this.element?.querySelector?.('.ncm-workbench__scroll');
      if (scroll) scroll.scrollTop = scrollTop;
      ui.notifications.info(`${statusName} 상태 효과를 추가했습니다.`);
    }

    static async _renameActivityAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item || !this.selectedActivityId) return;
      const name = formValue(this.form, 'activityName', '').trim();
      if (!name) return ui.notifications.warn('액티비티 이름을 입력하십시오.');
      await renameActivity(item, this.selectedActivityId, name);
      await this.render({ force: true });
    }

    static async _duplicateActivityAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item || !this.selectedActivityId) return;
      const created = await duplicateActivity(item, this.selectedActivityId);
      if (created?.id) this.selectedActivityId = created.id;
      this.extraDamageDraft = null;
      this.activityWorkspaceMode = 'edit';
      this.activityWorkspaceDraft = null;
      await this.render({ force: true });
    }

    static async _deleteActivityAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item || !this.selectedActivityId) return;
      const selectedId = this.selectedActivityId;
      const selected = getItemActivity(item, selectedId);
      const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
      const confirmed = DialogV2?.confirm
        ? await DialogV2.confirm({
            window: { title: '액티비티 삭제' },
            content: `<p><strong>${selected?.name || '액티비티'}</strong>를 삭제하시겠습니까?</p>`,
            modal: true,
          })
        : true;
      if (!confirmed) return;
      const ids = values(item.system?.activities).map((activity) => activity.id);
      const index = ids.indexOf(selectedId);
      await deleteActivity(item, selectedId);
      const remaining = values(item.system?.activities);
      this.selectedActivityId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
      this.extraDamageDraft = null;
      this.activityWorkspaceMode = 'edit';
      this.activityWorkspaceDraft = null;
      await this.render({ force: true });
    }

    static async _moveActivityAction(event, target) {
      event.preventDefault();
      const item = this.selectedItem;
      const activityId = target.dataset.activityId || this.selectedActivityId;
      const direction = Number(target.dataset.direction || 0);
      if (!item || !activityId || !direction) return;
      await moveActivity(item, activityId, direction);
      this.selectedActivityId = activityId;
      this.activityWorkspaceMode = 'edit';
      this.activityWorkspaceDraft = null;
      await this.render({ force: true });
    }

    static async _selectAdvancementAction(event, target) {
      event.preventDefault();
      if (!await this.guardItemTransition()) return;
      this.selectedAdvancementId = target?.dataset?.advancementId ?? null;
      await this.render({ force: true });
    }

    static async _createAdvancementAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item || item.isOwner === false || !this.canManageItems()) return;
      const form = this.element;
      const type = form?.querySelector?.('[name="newAdvancementType"]')?.value;
      if (!type) return;
      const title = String(form?.querySelector?.('[name="newAdvancementTitle"]')?.value ?? '').trim();
      if (!await this.guardItemTransition(['newAdvancementType', 'newAdvancementTitle'])) return;
      this.savingForm = true;
      try {
        const created = await createAdvancement(
          item,
          type,
          title ? { title } : {},
        );
        this.selectedAdvancementId = created?.id ?? created?._id ?? null;
      } finally { this.savingForm = false; }
      await this.render({ force: true });
    }

    static async _duplicateAdvancementAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item || item.isOwner === false || !this.canManageItems() || !this.selectedAdvancementId || !await this.guardItemTransition()) return;
      this.savingForm = true;
      try {
        const copy = await duplicateAdvancement(
          item,
          this.selectedAdvancementId,
        );
        this.selectedAdvancementId = copy?.id ?? copy?._id ?? null;
      } finally { this.savingForm = false; }
      await this.render({ force: true });
    }

    static async _deleteAdvancementAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item || item.isOwner === false || !this.canManageItems() || !this.selectedAdvancementId || !await this.guardItemTransition()) return;
      const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
      const confirmed = DialogV2?.confirm
        ? await DialogV2.confirm({ window: { title: '성장 항목 삭제' }, content: '<p>선택한 성장 항목을 삭제하시겠습니까?</p>' })
        : true;
      if (!confirmed) return;
      this.savingForm = true;
      try {
        await deleteAdvancement(
          item,
          this.selectedAdvancementId,
        );
        this.selectedAdvancementId = null;
      } finally { this.savingForm = false; }
      await this.render({ force: true });
    }

    static async _openAdvancementAdvancedAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!this.canManageItems() || item?.isOwner === false || !await this.guardItemTransition()) return;
      const advancement = getAdvancement(
        item,
        this.selectedAdvancementId
      );
      if (advancement) editDocument(
        advancement,
        {
          roots: Object.keys(advancement.toObject()),
          save: (patch) => item.updateAdvancement(
            advancement.id,
            patch
          ),
          afterSave: () => this.render({ force: true }),
        },
      );
    }

    static async _openActivityAdvancedAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!this.canManageItems() || item?.isOwner === false || !await this.guardItemTransition()) return;
      const activity = getItemActivity(
        item,
        this.selectedActivityId
      );
      if (activity) editDocument(
        activity,
        { roots: Object.keys(activity.toObject()), afterSave: () => this.render({ force: true }) },
      );
    }

    _setAllSectionsOpen(open) {
      for (const details of this.element?.querySelectorAll?.('details[data-section-key]') ?? []) {
        details.open = open;
        const key = details.dataset.sectionKey;
        if (key) this.sectionOpenState.set(key, open);
      }
    }

    static async _expandAllSectionsAction(event) {
      event.preventDefault();
      this._setAllSectionsOpen(true);
    }

    static async _collapseAllSectionsAction(event) {
      event.preventDefault();
      this._setAllSectionsOpen(false);
    }

    static async _openAdvancedAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!this.canManageItems() || !item || item.isOwner === false || !await this.guardItemTransition()) return;
      editDocument(
        item,
        { afterSave: () => this.render({ force: true }) },
      );
    }

    static async _addRecoveryAction(event) {
      event.preventDefault();
      this.usesRecoveryDraft = recoveryRowsFromForm(this.form);
      this.usesRecoveryDraft.push({ period: 'lr', type: 'recoverAll', formula: '' });
      await this.render({ force: true });
    }

    static async _changeTypeEntryAction(
      event,
      target,
    ) {
      if (!this.selectedItem || this.selectedItem.isOwner === false || !this.canManageItems()) return;
      try {
        this.captureInputs();
        const root = target.closest('[data-type-complex-root]');
        const hidden = root.querySelector('[data-type-field]');
        const field = readTypeFields(this.selectedItem).find((entry) => entry.path === hidden.dataset.typePath);
        const value = changeComplexList(
          field.schema,
          JSON.parse(hidden.value),
          JSON.parse(target.dataset.complexListAddress),
          target.dataset.action === 'removeTypeEntry' ? Number(target.dataset.complexIndex) : null,
        );
        hidden.value = JSON.stringify(value);
        await this.render({ force: true });
      } catch (error) {
        globalThis.ui?.notifications?.error?.(error.message);
      }
    }

    static async _changeAdvancementEntryAction(
      event,
      target,
    ) {
      if (!this.selectedItem || this.selectedItem.isOwner === false || !this.canManageItems()) return;
      try {
        this.captureInputs();
        const root = target.closest('[data-advancement-complex-root]');
        const hidden = root.querySelector('[data-advancement-field]');
        const advancement = getAdvancement(
          this.selectedItem,
          this.selectedAdvancementId,
        );
        const draft = Object.fromEntries(Array.from(this.form.querySelectorAll('[data-advancement-field]')).map(
          (control) => [control.dataset.advancementPath, control.value],
        ));
        const field = readAdvancementFields(
          advancement,
          draft,
        ).find((entry) => entry.path === hidden.dataset.advancementPath);
        const value = JSON.parse(hidden.value);
        const address = JSON.parse(target.dataset.complexListAddress ?? target.dataset.complexAddress);
        const action = target.dataset.action;
        let next;
        if (action === 'toggleAdvancementObject') next = toggleComplexObject(
          field.schema,
          value,
          address,
        );
        else if (action.endsWith('Mapping')) next = changeComplexMapping(
          field.schema,
          value,
          address,
          target.dataset.complexKey ?? target.parentElement.querySelector('[data-complex-new-key]')?.value,
          action === 'removeAdvancementMapping',
        );
        else next = changeComplexList(
          field.schema,
          value,
          address,
          action === 'removeAdvancementEntry' ? Number(target.dataset.complexIndex) : null,
        );
        hidden.value = JSON.stringify(next);
        await this.render({ force: true });
      } catch (error) {
        globalThis.ui?.notifications?.error?.(error.message);
      }
    }

    static async _changeActivityEntryAction(
      event,
      target,
    ) {
      event.preventDefault();
      if (!this.selectedItem || this.selectedItem.isOwner === false || !this.canManageItems()) return;
      try {
        this.captureInputs();
        const root = target.closest('[data-activity-complex-root]');
        const hidden = root.querySelector('[data-activity-common-field], [data-activity-specific-field]');
        const activity = getItemActivity(
          this.selectedItem,
          this.selectedActivityId,
        );
        const field = [
          ...readActivityCommonFields(activity),
          ...readActivitySpecificFields(
            activity,
            nativeActivityClass(activity.type),
          ),
        ].find((entry) => entry.path === (hidden.dataset.activityPath ?? hidden.dataset.activitySpecificPath));
        const value = JSON.parse(hidden.value);
        const address = JSON.parse(target.dataset.complexListAddress ?? target.dataset.complexAddress);
        const action = target.dataset.action;
        let next;
        if (action === 'toggleActivityObject') next = toggleComplexObject(
          field.schema,
          value,
          address,
        );
        else if (action.endsWith('Mapping')) next = changeComplexMapping(
          field.schema,
          value,
          address,
          target.dataset.complexKey ?? target.parentElement.querySelector('[data-complex-new-key]')?.value,
          action === 'removeActivityMapping',
        );
        else next = changeComplexList(
          field.schema,
          value,
          address,
          action === 'removeActivityEntry' ? Number(target.dataset.complexIndex) : null,
        );
        hidden.value = JSON.stringify(next);
        await this.render({ force: true });
      } catch (error) {
        globalThis.ui?.notifications?.error?.(error.message);
      }
    }

    static async _removeRecoveryAction(event, target) {
      event.preventDefault();
      this.usesRecoveryDraft = recoveryRowsFromForm(this.form);
      const index = Number(target.dataset.index);
      if (Number.isInteger(index)) this.usesRecoveryDraft.splice(index, 1);
      await this.render({ force: true });
    }

    static async _addExtraDamageAction(event) {
      event.preventDefault();
      this.extraDamageDraft ??= [];
      this.extraDamageDraft.push({ formula: '1d4', types: [] });
      await this.render({ force: true });
    }

    static async _removeExtraDamageAction(event, target) {
      event.preventDefault();
      const index = Number(target.dataset.index);
      if (Number.isInteger(index) && this.extraDamageDraft) this.extraDamageDraft.splice(index, 1);
      await this.render({ force: true });
    }

    static _toggleDamageTypeAction(event, target) {
      event.preventDefault();
      target.setAttribute(
        'aria-pressed',
        target.getAttribute('aria-pressed') === 'true' ? 'false' : 'true',
      );
    }

    static async _attachEffectAction(event, target) {
      event.preventDefault();
      const item = this.selectedItem;
      const activity = getItemActivity(item, this.selectedActivityId);
      if (!activity) return ui.notifications.warn('먼저 액티비티를 선택하십시오.');
      try { await setActivityEffectAttached(activity, target.dataset.effectId, true); }
      catch (error) { ui.notifications.error(error.message); }
      await this.render({ force: true });
    }

    static async _detachEffectAction(event, target) {
      event.preventDefault();
      const item = this.selectedItem;
      const activity = getItemActivity(item, this.selectedActivityId);
      if (!activity) return;
      try { await setActivityEffectAttached(activity, target.dataset.effectId, false); }
      catch (error) { ui.notifications.error(error.message); }
      await this.render({ force: true });
    }

    static async _deleteOnHitEffectAction(event, target) {
      event.preventDefault();
      const item = this.selectedItem;
      const effectId = target.dataset.effectId;
      if (!item || !effectId) return;
      try {
        await deleteOnHitEffect(item, effectId);
        ui.notifications.info('명중 시 효과와 모든 액티비티 연결을 삭제했습니다.');
      } catch (error) { ui.notifications.error(error.message); }
      await this.render({ force: true });
    }

    static async _addOnHitStatusAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      const activity = getItemActivity(item, this.selectedActivityId);
      if (!item || !activity) return ui.notifications.warn('먼저 아이템과 액티비티를 선택하십시오.');
      const statusId = formValue(this.form, 'onHitStatus', '');
      if (!statusId) return ui.notifications.warn('상태를 선택하십시오.');
      const select = this.form?.elements?.namedItem?.('onHitStatus');
      const statusName = select?.selectedOptions?.[0]?.textContent?.trim() || statusId;
      await createOnHitStatusEffect(item, activity, {
        name: formValue(this.form, 'onHitName', '') || statusName,
        statusId,
        rounds: numericFormValue(this.form, 'onHitRounds', 1),
      });
      ui.notifications.info(`${statusName} 명중 시 효과를 추가했습니다.`);
      await this.render({ force: true });
    }

    static async _addPassiveEffectAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!item) return;
      const key = formValue(this.form, 'passiveKey', '').trim();
      if (!key) return ui.notifications.warn('활성 효과 변경 경로를 입력하십시오.');
      await createPassiveEffect(item, {
        name: formValue(this.form, 'passiveName', '').trim() || '워크벤치 지속 효과',
        key,
        type: formValue(this.form, 'passiveMode', 'add'),
        value: formValue(this.form, 'passiveValue', ''),
      });
      ui.notifications.info('지속 효과를 추가했습니다.');
      await this.render({ force: true });
    }

    static async _createFolderAction(event) {
      event.preventDefault();
      if (!this.canManageItems()) return;
      if (this.documentContext?.kind === 'embedded') return;
      createFolderInWorkbench({
        parent: this.currentFolderId, type: 'Item', pack: this.packId,
        afterCreate: async (created) => {
          this.setCurrentFolder(created.id);
          await this.render({ force: true });
        },
      });
    }

    static async _createItemAction(event) {
      event.preventDefault();
      if (!this.canManageItems()) return;
      if (!await this.guardItemTransition()) return;
      const actor = this.documentContext?.kind === 'embedded' ? this.documentContext.actor : null;
      createItemInWorkbench({
        actor,
        pack: this.packId,
        folder: this.currentFolderId,
        afterCreate: async (created) => {
          if (actor) this.selectEmbeddedItem(
            actor,
            created
          );
          else { this.documentContext = null; this.selectItem(created.id); }
          await this.render({ force: true });
        },
      });
    }

    static async _returnToActorAction(event) {
      event.preventDefault();
      const actor = this.documentContext?.actor;
      if (!actor || !await this.guardItemTransition()) return;
      const { openActorWorkbench } = await import('./actor-workbench-app.mjs');
      if (actor.pack) {
        const { openPackActorWorkbench } = await import('./actor-workbench-app.mjs');
        await openPackActorWorkbench(
          actor.pack,
          actor.id,
          { restoreWorkbenchFocus: true },
        );
      } else openActorWorkbench({ actorId: actor.id, type: actor.type, restoreWorkbenchFocus: true });
    }

    static async _pickItemImageAction(event) {
      event.preventDefault();
      const apply = (path) => {
        const input = this.form?.querySelector('[name=itemImg]');
        if (input) { input.value = path; input.dispatchEvent(new Event(
          'input',
          { bubbles: true }
        )); }
      };
      const pickLocal = async () => {
        const Picker = globalThis.CONFIG?.ux?.FilePicker ?? globalThis.foundry?.applications?.apps?.FilePicker;
        if (!Picker) return;
        await new Picker({ type: 'image', current: this.form?.querySelector('[name=itemImg]')?.value, callback: apply }).browse();
      };
      // 아이템 아이콘은 기록보관소의 정사각 설정화만 보여 주는 갤러리에서 고른다(2026-11-21).
      itemImageGalleryOpener({
        kind: 'item',
        current: this.form?.querySelector('[name=itemImg]')?.value ?? '',
        targetLabel: `${this.selectedItem?.name ?? '아이템'} · 아이콘`,
        onSelect: (url) => apply(url),
        onPickLocal: pickLocal,
      });
    }

    static async _deleteItemAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!this.canManageItems() || !item || item.isOwner === false || !await this.guardItemTransition()) return;
      if (!await globalThis.foundry.applications.api.DialogV2.confirm({
        window: { title: '아이템 삭제' }, content: '<p>선택한 아이템을 삭제하시겠습니까? 소유 아이템은 해당 액터에서만 삭제됩니다.</p>',
      })) return;
      try {
        requireWriteResult(
          await (this.documentContext?.kind === 'embedded' ? this.documentContext.remove() : item.delete()),
          '아이템 삭제',
        );
      } catch (error) {
        globalThis.ui?.notifications?.error?.(error.message);
        return;
      }
      this.documentContext = this.documentContext?.kind === 'embedded' ? this.documentContext : null;
      this.selectedItemId = null;
      await this.render({ force: true });
    }

    static async _editFolderAction(event) {
      event.preventDefault();
      if (!this.canManageItems() || this.documentContext?.kind === 'embedded') return;
      const folder = this.itemFolders.get(this.currentFolderId);
      if (folder) editDocument(
        folder,
        { roots: ['name', 'color', 'folder', 'sorting', 'flags'], afterSave: () => this.render({ force: true }) }
      );
    }

    static async _deleteFolderAction(event) {
      event.preventDefault();
      if (!this.canManageItems() || this.documentContext?.kind === 'embedded') return;
      const folder = this.itemFolders.get(this.currentFolderId);
      if (!folder || !await globalThis.foundry.applications.api.DialogV2.confirm({
        window: { title: '폴더 삭제' }, content: '<p>폴더를 삭제하고 내용은 상위 폴더로 옮기시겠습니까?</p>',
      })) return;
      await folder.delete({ deleteSubfolders: false, deleteContents: false });
    }

    static async _editOwnershipAction(event) {
      event.preventDefault();
      this.captureInputs();
      const item = this.selectedItem;
      if (item) editOwnership(item, { canEdit: () => this.canManageItems(), afterSave: () => this.render({ force: true }) });
    }

    static async _editEffectAction(
      event,
      target
    ) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!this.canManageItems() || item?.isOwner === false) return;
      const effect = item?.effects?.get(target.dataset.effectId);
      if (effect) {
        const child = editEffect(
          effect,
          { canEdit: () => this.canManageItems(), afterSave: () => this.render({ force: true }) },
        );
        restoreWorkbenchOnClose(
          this,
          child,
          target,
        );
      }
    }

    static async _toggleEffectAction(
      event,
      target
    ) {
      event.preventDefault();
      const item = this.selectedItem;
      const effect = item?.effects?.get(target.dataset.effectId);
      if (!this.canManageItems() || item?.isOwner === false || !effect) return;
      await effect.update({ disabled: !effect.disabled });
      await this.render({ force: true });
    }

    static async _duplicateEffectAction(
      event,
      target
    ) {
      event.preventDefault();
      const item = this.selectedItem;
      const effect = item?.effects?.get(target.dataset.effectId);
      if (!this.canManageItems() || item?.isOwner === false || !effect) return;
      const source = effect.toObject();
      delete source._id;
      delete source._stats;
      await item.createEmbeddedDocuments(
        'ActiveEffect',
        [{ ...source, name: `${effect.name} (복제)` }]
      );
      await this.render({ force: true });
    }

    static async _deleteEffectAction(
      event,
      target
    ) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!this.canManageItems() || item?.isOwner === false || !item?.effects?.get(target.dataset.effectId)) return;
      if (!await globalThis.foundry.applications.api.DialogV2.confirm({ window: { title: '효과 삭제' }, content: '<p>효과와 액티비티 연결을 삭제하시겠습니까?</p>' })) return;
      try { await deleteOnHitEffect(item, target.dataset.effectId); }
      catch (error) { ui.notifications.error(error.message); }
      await this.render({ force: true });
    }

    static async _createEffectAction(event) {
      event.preventDefault();
      const item = this.selectedItem;
      if (!this.canManageItems() || !item || item.isOwner === false) return;
      const [effect] = await item.createEmbeddedDocuments(
        'ActiveEffect',
        [{ name: '새 아이템 효과', img: 'icons/svg/aura.svg', transfer: true, system: { changes: [] } }]
      );
      if (effect) editEffect(
        effect,
        { canEdit: () => this.canManageItems(), afterSave: () => this.render({ force: true }) }
      );
      await this.render({ force: true });
    }

    static async _duplicateItemAction(event) {
      event.preventDefault();
      if (!this.canManageItems()) return;
      if (!await this.guardItemTransition()) return;
      const selectedItem = this.selectedItem;
      if (!selectedItem || selectedItem.canDuplicate === false) return;
      if (this.documentContext?.kind === 'embedded') {
        const clone = await this.documentContext.duplicate();
        if (clone) this.selectEmbeddedItem(this.documentContext.actor, clone);
        await this.render({ force: true });
        return;
      }
      const clone = await selectedItem.clone({ name: `${selectedItem.name} (복제)` }, { save: true });
      this.selectItem(clone.id);
      ui.notifications.info(`${clone.name} 복제 완료.`);
      await this.render({ force: true });
    }

    static async _submitForm(event, form) {
      event.preventDefault();
      if (this.savingForm || this.isSavingActivityWorkspace) return;
      this.submissionSucceeded = false;
      const item = this.selectedItem;
      this.captureInputs();
      try { requireWritableItem(item, this.canManageItems()); }
      catch (error) { globalThis.ui?.notifications?.error?.(error.message); return; }
      if (this.draftSource && this.draftSource !== itemEditSnapshot(item)) {
        globalThis.ui?.notifications?.error?.('아이템이 편집 중 다른 곳에서 변경되었습니다. 입력을 보존했습니다. 입력을 버린 뒤 최신 값으로 다시 편집하십시오.');
        return;
      }
      this.savingForm = true;
      this.lastSavedSteps = [];
      const unlock = lockWorkbenchControls(this);
      try { await this.constructor._saveFormData.call(
        this,
        event,
        form
      ); }
      catch (error) {
        const partial = this.lastSavedSteps.length
          ? `일부 변경(${this.lastSavedSteps.join(', ')})은 저장되었습니다. 남은 입력을 같은 화면에서 다시 저장할 수 있습니다. `
          : '';
        globalThis.ui?.notifications?.error?.(`${partial}${error.message}`);
      } finally {
        unlock();
        this.savingForm = false;
      }
      if (this.submissionSucceeded) await this.render({ force: true });
    }

    static async _saveFormData(
      event,
      form
    ) {
      event.preventDefault();
      this.submissionSucceeded = false;
      const item = this.selectedItem;
      if (!item) return;

      // Validate the complete type edit before any basic-field writes.
      syncComplexInputs(form);
      const typeFieldEdits = readTypeFields(item).map((field) => {
        const element = form.querySelector(`[data-type-field][data-type-path="${CSS.escape(field.path)}"]`);
        if (!element) return field;
        return {
          ...field,
          value: field.kind === 'boolean' ? Boolean(element.checked) : element.value,
        };
      });
      const typeUpdate = buildTypeFieldUpdate(typeFieldEdits);
      const advancement = getAdvancement(
        item,
        this.selectedAdvancementId,
      );
      const advancementDraft = Object.fromEntries(Array.from(form.querySelectorAll('[data-advancement-field]')).map(
        (control) => [control.dataset.advancementPath, control.type === 'checkbox' ? control.checked : control.value],
      ));
      const advancementUpdate = buildAdvancementFieldUpdate(readAdvancementFields(
        advancement,
        advancementDraft,
      ).map((field) => ({ ...field, value: advancementDraft[field.path] ?? field.value })));
      const activity = getItemActivity(
        item,
        this.selectedActivityId,
      );
      const activityUpdate = activity ? activityFieldEditsFromForm(
        activity,
        nativeActivityClass(activity.type),
        form,
      ) : {};
      if (activity && this.activityWorkspaceMode !== 'create' && CORE_ACTIVITY_TYPES.has(activity.type)
        && form.querySelector('[name="activityWorkspaceName"]')) {
        Object.assign(
          activityUpdate,
          buildActivityWorkspaceUpdate(
            activity,
            activityWorkspaceFormFromElement(
              form,
              readActivityWorkspace(activity),
            ),
          ),
        );
      }

      const model = readItemWorkbenchModel(item, this.selectedActivityId);
      const destinationId = formValue(
        form,
        'containerId',
        model.inventory.containerId ?? '',
      );
      if ((destinationId || null) !== model.inventory.containerId) validateContainerMove(
        item,
        destinationId,
      );
      const basicChanges = {};
      const name = formValue(form, 'itemName', item.name);
      const img = formValue(form, 'itemImg', item.img);
      const description = formValue(form, 'description', model.description);
      const identifier = formValue(form, 'identifier', model.identifier);
      if (name !== model.name) basicChanges.name = name;
      if (img !== model.img) basicChanges.img = img;
      if (description !== model.description) basicChanges.description = description;
      if (identifier !== model.identifier) basicChanges.identifier = identifier;

      const source = {
        book: formValue(form, 'sourceBook', model.source.book),
        page: formValue(form, 'sourcePage', model.source.page),
        custom: formValue(form, 'sourceCustom', model.source.custom),
        license: formValue(form, 'sourceLicense', model.source.license),
        rules: formValue(form, 'sourceRules', model.source.rules),
        revision: numericFormValue(form, 'sourceRevision', model.source.revision),
      };
      const sourceChanges = {};
      for (const key of ['book', 'page', 'custom', 'license', 'rules', 'revision']) {
        if (source[key] !== model.source[key]) sourceChanges[key] = source[key];
      }
      if (Object.keys(sourceChanges).length) basicChanges.source = sourceChanges;

      if (model.hasIdentification) {
        const identification = {
          identified: checkboxFormValue(form, 'identified', model.identification.identified),
          name: formValue(form, 'unidentifiedName', model.identification.name),
          description: formValue(form, 'unidentifiedDescription', model.identification.description),
        };
        const identificationChanges = {};
        for (const key of ['identified', 'name', 'description']) if (identification[key] !== model.identification[key]) identificationChanges[key] = identification[key];
        if (Object.keys(identificationChanges).length) basicChanges.identification = identificationChanges;
      }

      if (model.hasInventory) {
        const inventory = {
          quantity: numericFormValue(form, 'quantity', model.inventory.quantity),
          weight: { value: numericFormValue(form, 'weightValue', model.inventory.weight.value), units: formValue(form, 'weightUnits', model.inventory.weight.units) },
          price: { value: numericFormValue(form, 'priceValue', model.inventory.price.value), denomination: formValue(form, 'priceDenomination', model.inventory.price.denomination) },
          rarity: formValue(form, 'rarity', model.inventory.rarity),
          containerId: formValue(form, 'containerId', model.inventory.containerId ?? '') || null,
        };
        const inventoryChanges = {};
        if (inventory.quantity !== model.inventory.quantity) inventoryChanges.quantity = inventory.quantity;
        if (inventory.weight.value !== model.inventory.weight.value || inventory.weight.units !== model.inventory.weight.units) inventoryChanges.weight = inventory.weight;
        if (inventory.price.value !== model.inventory.price.value || inventory.price.denomination !== model.inventory.price.denomination) inventoryChanges.price = inventory.price;
        if (inventory.rarity !== model.inventory.rarity) inventoryChanges.rarity = inventory.rarity;
        if (inventory.containerId !== model.inventory.containerId) inventoryChanges.containerId = inventory.containerId;
        if (Object.keys(inventoryChanges).length) basicChanges.inventory = inventoryChanges;
      }

      if (model.hasEquipAttunement) {
        const equipAttunement = {
          equipped: checkboxFormValue(form, 'equipped', model.equipAttunement.equipped),
          attunement: formValue(form, 'attunement', model.equipAttunement.attunement),
          attuned: checkboxFormValue(form, 'attuned', model.equipAttunement.attuned),
        };
        const equipChanges = {};
        for (const key of ['equipped', 'attunement', 'attuned']) if (equipAttunement[key] !== model.equipAttunement[key]) equipChanges[key] = equipAttunement[key];
        if (Object.keys(equipChanges).length) basicChanges.equipAttunement = equipChanges;
      }

      if (model.hasProperties) {
        const properties = formValues(form, 'properties').sort();
        if (!sameStringSet(properties, model.properties)) basicChanges.properties = properties;
      }

      const usesChanges = {};
      if (model.hasUses) {
        const usesSpent = numericFormValue(form, 'usesSpent', model.uses.spent);
        const usesMax = formValue(form, 'usesMax', model.uses.max);
        const recovery = recoveryRowsFromForm(form);
        if (usesSpent !== model.uses.spent) usesChanges.spent = usesSpent;
        if (usesMax !== model.uses.max) usesChanges.max = usesMax;
        if (JSON.stringify(recovery) !== JSON.stringify(model.uses.recovery)) usesChanges.recovery = recovery;
        if (model.uses.hasAutoDestroy) {
          const autoDestroy = checkboxFormValue(form, 'usesAutoDestroy', model.uses.autoDestroy);
          if (autoDestroy !== model.uses.autoDestroy) usesChanges.autoDestroy = autoDestroy;
        }
        if (Object.keys(usesChanges).length) basicChanges.uses = usesChanges;
      }


      if (model.hasBaseDamage) {
        const baseDamageFormula = formValue(form, 'baseDamageFormula', '');
        const baseDamageTypes = pressedDamageTypes(form, '[data-base-damage-type]');
        const originalFormula = formatDamagePartFormula(model.selectedActivity?.baseDamage);
        const originalTypes = model.selectedActivity?.baseDamage?.types ?? [];
        if (baseDamageFormula.trim() !== originalFormula.trim()
          || !sameStringSet(baseDamageTypes, originalTypes)) {
          basicChanges.baseDamageFormula = baseDamageFormula;
          basicChanges.baseDamageTypes = baseDamageTypes;
        }
      }

      // Build and validate every planned write before sending the first one.
      if (activity && ['attack', 'damage', 'save'].includes(activity.type)) {
        const rows = Array.from(form.querySelectorAll('[data-extra-damage-row]')).map((row) => ({
          formula: row.querySelector('[data-extra-damage-formula]')?.value ?? '',
          types: pressedDamageTypes(row, '[data-extra-damage-type]'),
        }));
        const originalRows = (model.selectedActivity?.extraDamage ?? []).map((part) => ({
          formula: formatDamagePartFormula(part),
          types: [...part.types],
        }));
        if (!sameDamageRows(rows, originalRows)) Object.assign(
          activityUpdate,
          buildActivityExtraDamageUpdate(
            activity,
            rows,
          ),
        );
      }

      const itemPanel = createItemWorkbenchPanel({
        context: this.documentContext ?? createWorldItemContext(item),
      });
      const itemUpdate = { ...itemPanel.buildBasicUpdate(basicChanges), ...typeUpdate };
      const saveStep = async (
        label,
        paths,
        write,
      ) => {
        requireWritableItem(
          item,
          this.canManageItems(),
        );
        if (this.draftSource && this.draftSource !== itemEditSnapshot(item)) {
          throw new Error('저장 중 다른 곳에서 변경되었습니다. 입력을 보존했습니다. 최신 값을 확인하십시오.');
        }
        const baseline = this.draftSource ?? itemEditSnapshot(item);
        requireWriteResult(
          await write(),
          `${label} 저장`,
        );
        this.lastSavedSteps ??= [];
        this.lastSavedSteps.push(label);
        this.draftSource = rebaseItemDraftSnapshot(
          baseline,
          item,
          paths,
        );
        if (this.draftSource !== itemEditSnapshot(item)) {
          throw new Error('저장 중 다른 필드가 외부에서 변경되었습니다. 남은 입력을 보존했습니다. 최신 값을 확인하십시오.');
        }
      };
      if (Object.keys(itemUpdate).length) await saveStep(
        '아이템 기본·유형',
        Object.keys(itemUpdate),
        () => itemPanel.saveBasic(
          basicChanges,
          typeUpdate,
        ),
      );
      if (activity && Object.keys(activityUpdate).length) await saveStep(
        '액티비티',
        Object.keys(activityUpdate).map(path => `system.activities.${activity.id}.${path}`),
        () => activity.update(activityUpdate),
      );
      if (advancement && Object.keys(advancementUpdate).length) await saveStep(
        '성장',
        [{ advancementId: this.selectedAdvancementId }],
        () => item.updateAdvancement(
          this.selectedAdvancementId,
          advancementUpdate,
        ),
      );

      this.extraDamageDraft = null;
      this.usesRecoveryDraft = null;
      this.inputDraft.clear();
      this.initialInputs.clear();
      this.draftSource = null;
      this.submissionSucceeded = true;
      ui.notifications.info(`${item.name} Workbench 저장 완료.`);
    }
  }

  WorkbenchClass = NihilItemWorkbench;
  return WorkbenchClass;
}

export function syncUpdatedItemEffect(item) {
  if (!workbenchInstance) return false;
  const Class = getWorkbenchClass();
  if (workbenchInstance.state === Class.RENDER_STATES?.CLOSED) return false;
  const selected = workbenchInstance.selectedItem;
  // Embedded IDs can be shared by copies in different Actors or a compendium.
  if (!selected || (selected !== item && (!selected.uuid || selected.uuid !== item?.uuid))) return false;
  return syncUpdatedItem(item);
}

export function syncUpdatedItem(item) {
  if (!workbenchInstance) return false;
  if (rootDocument(item)?.pack && rootDocument(item)?.uuid !== rootDocument(workbenchInstance.selectedItem)?.uuid) return false;
  const Class = getWorkbenchClass();
  if (workbenchInstance.state === Class.RENDER_STATES?.CLOSED) return false;
  if (workbenchInstance.selectedItemId === item?.id) {
    workbenchInstance.currentFolderId = item?.folder?.id ?? null;
  }
  if (!shouldRefreshAfterItemUpdate(workbenchInstance, item)) return true;
  workbenchInstance.render({ force: true });
  return true;
}

export function syncDeletedFolder(folderId, parentFolderId = null) {
  if (!workbenchInstance) return false;
  const Class = getWorkbenchClass();
  if (workbenchInstance.state === Class.RENDER_STATES?.CLOSED) return false;
  if (workbenchInstance.currentFolderId === folderId) {
    workbenchInstance.setCurrentFolder(parentFolderId);
  }
  workbenchInstance.render({ force: true });
  return true;
}

export function refreshWorkbench() {
  if (!workbenchInstance) return false;
  const Class = getWorkbenchClass();
  if (workbenchInstance.state === Class.RENDER_STATES?.CLOSED) return false;
  workbenchInstance.render({ force: true });
  return true;
}

export function openWorkbench(itemId = null) {
  const Class = getWorkbenchClass();
  if (!workbenchInstance || workbenchInstance.state === Class.RENDER_STATES?.CLOSED) {
    workbenchInstance = new Class();
  }
  const app = workbenchInstance;
  if (app.savingForm || app.isSavingActivityWorkspace) return app;
  const show = () => {
    app.documentContext = null;
    if (itemId) app.selectItem(itemId);
    else app.selectItem(null);
    app.render({ force: true });
  };
  app.captureInputs();
  if (app.inputDraft.size) app.guardItemTransition().then(allowed => { if (allowed) show(); });
  else show();
  return workbenchInstance;
}

export function isWorkbenchOpen() {
  return Boolean(workbenchInstance?.rendered);
}

export async function toggleWorkbench() {
  if (isWorkbenchOpen()) await workbenchInstance.close();
  else {
    openWorkbench();
    await workbenchInstance.render({ force: true });
  }
  return isWorkbenchOpen();
}

export function openEmbeddedItemWorkbench(actor, item) {
  const Class = getWorkbenchClass();
  if (!workbenchInstance || workbenchInstance.state === Class.RENDER_STATES?.CLOSED) {
    workbenchInstance = new Class();
  }
  const app = workbenchInstance;
  if (app.savingForm || app.isSavingActivityWorkspace) return app;
  const show = async () => {
    app.selectEmbeddedItem(
      actor,
      item
    );
    showWorkbenchForm(app, { force: true });
    await app.render({ force: true });
    app.bringToFront?.();
  };
  app.captureInputs();
  if (app.inputDraft.size) app.guardItemTransition().then(allowed => { if (allowed) show(); });
  else show();
  return workbenchInstance;
}

export async function prepareItemWorkbenchTransition() {
  if (!workbenchInstance?.rendered) return true;
  return workbenchInstance.guardItemTransition();
}

const packItemWorkbenches = new Map();

export async function openPackItemWorkbench(
  packId,
  itemId = null,
) {
  if (!canManageWorkbenchItems()) return null;
  const pack = requireModulePack(
    packId,
    'Item',
  );
  await loadPackDocuments(pack);
  const Class = getWorkbenchClass();
  let app = packItemWorkbenches.get(packId);
  if (!app || app.state === Class.RENDER_STATES?.CLOSED) {
    app = new Class({ id: `ncm-pack-item-${packId.replaceAll('.', '-')}` });
    app.packId = packId;
    packItemWorkbenches.set(
      packId,
      app,
    );
  }
  if (app.savingForm || app.isSavingActivityWorkspace) return app;
  app.captureInputs();
  if (!await app.guardItemTransition()) return app;
  app.selectItem(itemId);
  await app.render({ force: true });
  app.bringToFront?.();
  return app;
}

export function refreshPackItemWorkbenches() {
  for (const app of packItemWorkbenches.values()) {
    if (app.rendered) app.render({ force: true });
  }
}
