[English](ADDING_POKEMON.md) | **한국어**

# 포켓몬 추가하기

이 절차는 애플리케이션 코드를 변경하지 않고 새 펫 팩을 만드는 방법입니다.

## 에셋 번들 설치

공식 에셋 번들은 한 명령으로 생성, 검증, 임시 에셋 정리를 수행합니다.

```bash
unzip lucario-assets.zip -d .
npm run install:pet -- assets/lucario/lucario.bundle.json --force
```

옵션:

- `--force`: 기존 `pets/<id>` 폴더를 교체합니다.
- `--keep-assets`: 임시 `assets/<id>` 폴더를 남깁니다.
- `--activate`: 설치한 펫을 사용하도록 `config/setting.json`을 변경합니다.

생성 또는 검증에 실패하면 기존 펫 폴더를 복원합니다. 성공 후에는 생성된
`pets/<id>` 폴더를 커밋하면 됩니다. `assets/<id>` 아래의 임시 번들 원본과
디버그 파일은 무시되며 기본적으로 자동 삭제됩니다.

번들은 `formatVersion: 1`을 사용하며 완성된 `pet` 설정, `prompt`, 스프라이트
데이터 또는 생성 설정, 선택적 manifest를 포함하거나 파일로 참조합니다.
설치된 펫을 휴대 가능한 번들로 내보내려면:

```bash
npm run bundle:pet -- lucario
```

## 1. 팩 생성

소문자 알파벳, 숫자, 하이픈으로 구성된 ID를 사용하세요:

```bash
npm run create:pet -- pikachu "피카츄"
```

생성 결과:

```text
pets/pikachu/
  pet.json
  prompt.txt
  sprites.json
  sprites-manifest.json
  sprites/
```

## 2. 스프라이트 프레임 추가

투명 PNG 프레임을 `sprites` 디렉터리에 내보내세요:

```text
pets/pikachu/sprites/
  down-1.png
  down-2.png
  side-1.png
  side-2.png
  back-side-1.png
  back-up-1.png
```

모든 프레임에 일관된 투명 캔버스 크기를 사용하고 하단 정렬하세요. 앱이 옆면 프레임을 수평으로 뒤집을 수 있으므로 한 방향만 있으면 충분합니다.

`sprites.json` 수정:

```json
{
  "down": [
    "sprites/down-1.png",
    "sprites/down-2.png"
  ],
  "side": [
    "sprites/side-1.png",
    "sprites/side-2.png"
  ],
  "back_side": [
    "sprites/back-side-1.png"
  ],
  "back_up": [
    "sprites/back-up-1.png"
  ]
}
```

각 필수 애니메이션에는 최소 하나의 프레임이 있어야 합니다. Base64 데이터 URL도 허용되지만 상대 PNG 경로가 유지 관리에 더 편합니다.

## 3. 동작 설정

`pet.json`을 수정하세요.

주요 필드:

- `id`: 폴더 이름과 정확히 일치해야 합니다.
- `name`: 채팅 헤더에 표시되는 기본 이름.
- `promptFile`: 펫 폴더 기준 캐릭터 프롬프트 파일 경로.
- `spritesFile`: 펫 폴더 기준 스프라이트 맵 경로.
- `cryUrl`: 선택적 HTTPS 오디오 URL; 소리 없음은 빈 문자열.
- `recallText`: 단축키나 Tray 메뉴로 소환할 때 표시할 말풍선.
- `responseCryKeywords`: AI 응답에 포함되면 울음소리를 재생할 문자열 목록. 빈 배열이면 자동 재생하지 않음.
- `theme`: 채팅창 강조색, hover 색상, 응답 말풍선 색상.
- `appearance`: 이동 범위 및 렌더링 이미지 크기.
- `movement`: 속도, 점프, 애니메이션, 유휴 말풍선 타이밍.
- `idlePhrases`: 랜덤 말풍선 메시지 목록.

`spritesManifestFile`은 프로덕션 메타데이터 전용입니다. 런타임에는 필요하지 않지만, 소스 시트 좌표와 추출 메모를 기록해 두면 스프라이트 팩을 재현하기 쉬워집니다.

## 4. 캐릭터 프롬프트 작성

`prompt.txt`를 수정하세요. 다음 항목을 정의하세요:

- 정체성과 성격
- 언어와 말투
- 세계관 지식
- 응답 길이
- 모델이 임의로 만들어서는 안 되는 사실

## 5. 팩 유효성 검사

```bash
npm run validate:pet -- pikachu
```

펫을 선택하기 전에 보고된 모든 오류를 수정하세요.

## 6. 펫 선택

패키징된 앱에서는 완성한 펫 폴더를 README에 안내된 사용자 데이터
`pets/` 폴더에 넣으세요. 개발 중 `npm run create:pet` 명령은 프로젝트
`pets/` 폴더에 소스 팩을 생성합니다.

패키징된 앱은 사용자 데이터의 `setting.json`을 수정하고, 번들 기본값을
준비할 때는 `config/setting.json`을 수정하세요.

```json
{
  "pet": {
    "active": "pikachu"
  }
}
```

재시작:

```bash
npm start
```

## 7. 동작 확인

다음 사항을 모두 확인하세요:

1. 앞면, 옆면, 대각선 뒷면, 뒷면 이동이 올바른 프레임을 표시하는지.
2. 각 모니터에서, 그리고 모니터 경계를 넘어 드래그가 작동하는지.
3. 채팅창이 펫을 가리지 않고 열리는지.
4. 프롬프트가 의도한 캐릭터를 재현하는지.
5. 유휴 말풍선과 울음 소리가 작동하는지.
6. `npm run validate:pet -- pikachu`가 통과하는지.

## 파일 이름 규칙

`pet.json`과 `sprites.json`의 런타임 파일 이름은 대소문자를 포함하여 실제 파일과 정확히 일치해야 합니다. `sprites-manifest.json` 안의 `source_sheet.filename` 값은 문서용이며 런타임에 존재할 필요가 없습니다.
