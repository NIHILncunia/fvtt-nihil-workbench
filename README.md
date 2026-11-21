# Nihil Workbench (Foundry v14)

Foundry VTT v14 · D&D5e 6.1용 개인 콘텐츠 모듈입니다. 모듈 ID는 `nihil-compendium-module`입니다.

- 아이템 워크벤치, 액터 워크벤치, 효과·권한·컴펜디움 편집, 콘텐츠 제작 API(`game.modules.get('nihil-compendium-module').api`)
- 호환: Foundry 14(검증 14.370), D&D5e 6.1.x(검증 6.1.1)

## HP 비밀 변경

v13 `nihil-secret-hp` 0.2.0을 옮긴 기능입니다. GM이 플레이어 소유자가 없는 액터(적·NPC)의 HP를 액터 시트나 히트 포인트 창에서 직접 고치거나, 어떤 방법으로든 최대 HP를 바꾸면 비밀 변경이 됩니다.

- Health Monitor 채팅 메시지(설치돼 있을 때), 토큰 위에 떠오르는 HP 숫자, 집중 내성 요구, `dnd5e.damageActor`·`dnd5e.healActor` 훅을 건너뜁니다(dnd5e의 `isRest` 옵션).
- Bloodied 상태는 그대로 붙고 떨어지지만 떠오르는 글자는 띄우지 않습니다.
- 현재 HP는 최대 HP를 따라 오르지 않습니다. 새 최대가 현재 HP보다 작으면 현재 HP를 새 최대로 낮춥니다.
- 공격 자동화, 매크로, 토큰 HUD처럼 시트를 거치지 않는 현재 HP 변경과 PC의 변경은 평소대로 기록됩니다. HP 막대, Health Estimate, Bloodied 아이콘은 값이 바뀌었으므로 함께 바뀝니다.
- 설정 `HP 비밀 변경`(월드, 기본 켜짐)을 끄면 아무것도 하지 않습니다.

## 캐릭터 자원 관리

v13 `luxterra-resource-manager` 1.1.1의 자원 관리 기능만 옮겼습니다. 앙그라·위그드라실 피해 타입과 Dice So Nice 색상은 이 모듈에 없습니다.

- 사이드바 설정 탭의 `자원 관리` 단추, 워크벤치 실행기의 `캐릭터 자원 관리 열기`, `api.openResourceManager()`로 GM 전용 관리 창을 엽니다.
- 자원 생성(자원명, 최대치, 0부터 시작 여부), 자원별 PC 현황(개별·일괄 증감, 직접 입력, 설정 저장, 비활성화), 관리 대상 PC 선택.
- 모든 활성 자원은 기존 PC와 새 PC에 자동으로 붙습니다. 자원값은 GM만 바꿀 수 있습니다.
- 플레이어는 자기 캐릭터 시트 머리 메뉴의 `이 액터의 자원 확인`으로 읽기 전용 현황을 봅니다.
- 저장: 월드 설정 `nihil-compendium-module.resourceDefinitions`·`managedActorUuids`, Actor flag `flags.nihil-compendium-module.resources`.
- 이관: 활성 GM이 월드를 열 때 한 번, 옛 `luxterra-resource-manager`의 월드 설정과 Actor flag에서 이 모듈에 없는 정의·관리 대상·값만 복사합니다. 옛 자료는 지우지 않습니다.

## 설치

Foundry의 모듈 설치 화면에서 아래 manifest 주소를 넣습니다.

```
https://github.com/NIHILncunia/fvtt-nihil-workbench/releases/latest/download/module.json
```

## 배포

```
pnpm test
pnpm release 0.2.1
```

`pnpm release <판>`은 `module.json`의 판과 다운로드 주소를 바꾸고 시험을 돌린 뒤 커밋·태그·푸시합니다. `v*` 태그를 받으면 GitHub Actions가 `module.json`·`module.zip` 릴리스를 만들고, Foundry는 manifest 주소로 새 판을 확인합니다.
