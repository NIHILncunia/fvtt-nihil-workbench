# Nihil Workbench (Foundry v14)

Foundry VTT v14 · D&D5e 6.1용 개인 콘텐츠 모듈입니다. 모듈 ID는 `nihil-compendium-module`입니다.

- 아이템 워크벤치, 액터 워크벤치, 효과·권한·컴펜디움 편집, 콘텐츠 제작 API(`game.modules.get('nihil-compendium-module').api`)
- 호환: Foundry 14(검증 14.370), D&D5e 6.1.x(검증 6.1.1)

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
