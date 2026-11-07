[English](ARCHITECTURE.md) | **한국어**

# 아키텍처

## 런타임 경계

- `main.js`: Electron 부트스트랩 전용.
- `src/main/window`: 투명 데스크탑 창 및 디스플레이 배치.
- `src/main/ipc`: 유일한 IPC 채널 등록 지점.
- `src/main/services`: 영속성 및 펫 팩 로딩.
- `src/main/ai`: 프로바이더 레지스트리 및 프로바이더 구현체.
- `src/preload`: 렌더러에 노출되는 제한된 API.
- `src/renderer`: DOM UI, 이동, 애니메이션, 채팅 표시.
- `pets/<id>`: 캐릭터 매니페스트, 프롬프트, 스프라이트, 사운드, 대사.
- `config/setting.json`: 활성 펫 및 AI 프로바이더/모델 설정.

## AI 프로바이더 추가

설정 및 사용 방법: `docs/AI_PROVIDERS.ko.md`.

다음 메서드를 가진 프로바이더를 `id`와 함께 생성하세요:

```js
async streamChat({ messages, model }, { onChunk }) {}
```

`src/main/index.js`에 등록한 뒤, `config/setting.json`의 `ai` 항목 아래에 설정을 추가하세요. 렌더러는 설정된 프로바이더 ID만 전송하고 프로바이더별 응답 형식에 의존하지 않습니다.

## 펫 추가

재현 가능한 절차: `docs/ADDING_POKEMON.ko.md`.

`pets/riolu`를 `pets/<new-id>`로 복사한 뒤 다음 파일을 수정하세요:

- `pet.json`: 외관, 이동, 텍스트, 에셋 경로.
- `prompt.txt`: 캐릭터 시스템 프롬프트.
- `sprites.json`: 애니메이션 프레임 맵.
- `sprites-manifest.json`: 소스 시트 및 스프라이트 생성 메타데이터.

`config/setting.json`의 `pet.active`를 새 펫 ID로 설정하세요.

스프라이트 맵은 현재 `down`, `side`, `back_side`, `back_up`을 지원합니다.
