# 컨펜디움 팩 관리

v14 판(2026-11-21~)의 `common-monsters`는 Foundry 14.370·dnd5e 6.1.1 월드에서 코어 이관(`pack.migrate()`)과 dnd5e 이관(`dnd5e.migrations.migrateCompendium`)을 돌린 문서를 내보내 `tools/rebuild-pack.mjs`로 다시 만들었습니다. 이관 전 v13 데이터베이스는 비공개 원본 저장소에 남아 있습니다.

아래는 v13 판에서 팩을 처음 만든 방법입니다. 실제 컨펜디움 데이터베이스는 빈 파일을 수동 생성하지 않고 Foundry VTT 13.351의 Module Maker에서 만듭니다.

1. 모듈을 Foundry 사용자 데이터의 `Data/modules/nihil-compendium-module`에 둡니다.
2. D&D5e 5.2.4 월드에서 Module Maker를 열고 이 모듈을 선택합니다.
3. 현재 등록 목록의 팩을 생성합니다. 기존 데이터베이스가 있으면 재사용합니다.
4. 생성된 팩의 `name`, `path`, `type`, `system`을 `module.json`의 `packs`에 기록합니다.
5. 현재 `BaseActor` 팩만 `NCM` `packFolders`에 직접 등록하며 하위 폴더는 두지 않습니다. 새 팩은 수록 범위가 확정된 뒤 등록합니다.

## 현재 등록된 베이스 액터 컴펜디움

최상위 `NCM` 폴더 바로 아래에 `BaseActor` 컴펜디움 하나만 둡니다. `Base Compendium`, `공통 데이터`, `크리처` 중간 폴더는 사용하지 않습니다.

| 팩 ID | 표시명 | 문서 유형 | 수록 범위 |
| --- | --- | --- | --- |
| `common-monsters` | BaseActor | Actor | CR 1~30 일반·엘리트·보스 베이스 액터 90개 |

Actor 팩의 식별자와 데이터 경로는 유지합니다. 기존 `common-feats`, `common-items` 팩은 모듈 등록에서 제외하고 데이터베이스는 보존합니다. 현재 베이스 아이템·베이스 피트 팩은 제공하지 않습니다. 세부 결정은 콘텐츠 제작 결정 기록(비공개 원본 저장소 `docs/project-design/2026-10-12-compendium-content-decisions.md`)을 따릅니다.

## 초기 설계의 확장 후보

아래 목록은 초기 설계의 팩 후보이며, 현재 등록된 팩이나 추가 제작이 확정된 목록은 아닙니다.

| 팩 ID | 문서 유형 | 범위 |
| --- | --- | --- |
| `common-monsters` | Actor | 세계관 비종속 몬스터 |
| `common-items` | Item | 세계관 비종속 아이템 |
| `common-spells` | Item | 세계관 비종속 주문 |
| `common-species` | Item | 세계관 비종속 종족과 종족 특성 |
| `common-rolltables` | RollTable | 세계관 비종속 무작위 표 |
| `luxterra-monsters` | Actor | 룩스테라 고유 몬스터 |
| `luxterra-npcs` | Actor | 룩스테라 NPC |
| `luxterra-items` | Item | 룩스테라 고유 아이템 |
| `luxterra-spells` | Item | 룩스테라 고유 주문 |
| `luxterra-species` | Item | 룩스테라 고유 종족과 종족 특성 |
| `luxterra-journals` | JournalEntry | 설정·장소·NPC 설명 |
| `luxterra-scenes` | Scene | 전투·탐사 장면 |
| `luxterra-rolltables` | RollTable | 룩스테라 전용 무작위 표 |

Actor와 Item 팩에는 `system: "dnd5e"`를 설정합니다. MIDI-QOL과 DAE는 이 기본 모듈의 필수 의존성이 아닙니다.
