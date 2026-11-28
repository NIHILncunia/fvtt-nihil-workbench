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

## 채팅 로그 내보내기

created-gallery 채팅 아카이브의 「맵 포함 HTML」을 대신하는 자체 기능입니다. 채팅을 RP 로그(하트 형식) HTML 파일 하나로 받습니다. GM만 씁니다.

- 사이드바 설정 탭의 `채팅 로그 내보내기` 단추나 `api.openChatLogExport()`로 창을 엽니다. 코드에서 바로 받으려면 `api.exportChatLog({ start, end, title, publicCopy, includeWhispers, withScenes, withCombats, maxImageSize, filename })`를 씁니다.
- 창에서는 로그 제목, 날짜(가장 최근 날이 기본이고 전체·직접 지정도 있음), 시작·끝 시각, 공개판 여부, 귓속말 포함, 장면 지도, 전투 요약·리플레이, 큰 그림 최대 크기를 고릅니다.
- 기본 파일 이름은 `제목 날짜.html`입니다. 여러 날이면 `제목 2026-11-27~2026-11-28.html`, 공개판이면 끝에 ` 공개판`이 붙습니다.
- 받은 HTML에 들어가는 것:
  - 하트 로그 본문. 같은 사람이 이어 말하면 머리를 생략하고, GM 진행·귓속말·시스템 줄은 형식대로 칠합니다.
  - 날짜 구분 줄, 메시지마다 한국 표준시 시각, 목차(날짜·장면·전투), 이름·대사 찾기(Enter로 다음), 귓속말 숨기기
  - 장면 지도: 장면이 바뀌거나 화면 자리를 크게 옮길 때마다 그 대화 앞에 그때 화면에 보이던 지도 부분을 넣습니다. 넓은 화면에서는 왼쪽 패널에 지금 읽는 장면이 따라오고 휠로 확대, 끌기로 이동할 수 있습니다.
  - 전투: 시작 표시와 종료 요약 표(준 피해·받은 피해·회복·끝 HP·20/1)와 리플레이가 들어갑니다. 리플레이는 라운드 건너뛰기, 차례 목록(HP 막대), 최근 사건 목록, 피격 표시, 상태 표시를 지원하고, 이름표가 겹치지 않게 놓습니다. 키보드 ←·→·Space로도 조작합니다.
  - 그림은 WebP로 줄여 파일 안에 넣습니다. 같은 초상은 한 번만 넣으므로 Foundry 서버 없이도 열립니다.
- ERROR 카드가 없습니다. 메시지는 문서 자료(말한 이·귓속말·굴림)를 먼저 읽고, 읽지 못한 카드는 글자나 시스템 줄로 남깁니다. 피해 적용 카드와 중복 내성 카드는 뺍니다.
- 공개판은 플레이어에게 보이지 않던 메시지(GM에게만 간 귓속말, 블라인드 굴림)를 빼고, 숨긴 전투원은 요약과 리플레이에서 뺍니다. 숨긴 전투원은 공개판이 아니어도 늘 뺍니다.
- 기록:
  - 메시지를 만들 때 말한 장면·화면 위치·토큰 위치를 `flags.nihil-compendium-module.scene`에 적습니다. created-gallery가 남긴 같은 플래그도 읽습니다.
  - 전투는 활성 GM 한 사람이 기록해 `worlds/<월드>/nihil-chat-log/combat/`에 JSON으로 남깁니다(월드 설정 `전투 기록`, 기본 켜짐). 채팅에는 글을 올리지 않습니다. created-gallery의 「전투 종료」 메시지가 가리키는 기록도 읽고, 같은 전투는 하나로 합칩니다.
- 다운로드 링크를 문서에 붙이지 않고 누릅니다. 붙이면 Foundry 문서 클릭 처리기가 링크를 새 탭으로 엽니다.
- 원본 메시지는 바꾸지 않습니다.

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
