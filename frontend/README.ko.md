[English](README.md) | **한국어**

# Pokemon Pet

LLM으로 구동되는 투명 데스크탑 펫입니다. 포켓몬이 화면을 돌아다니고, 채팅창을 열어 대화할 수 있습니다.

# 미리보기
<img width="448" height="506" alt="스크린샷 2026-06-10 오후 4 16 17" src="https://github.com/user-attachments/assets/2ebfed14-913c-4eeb-92f7-58657df8ae9d" />

## 기능

- **자유 이동:** 포켓몬이 화면을 혼자 돌아다닙니다!
- **채팅:** 포켓몬을 클릭하면 대화 가능한 채팅창이 열립니다.
- **혼잣말:** 아무 동작도 하지 않는 경우, 사용자에게 먼저 말을 걸기도 합니다. `pet.json`의 `idlePhrases`에 원하는 문구를 추가하세요.
- **드래그 앤 드롭:**  포켓몬을 드래그 할 수 있습니다.
- **소환 단축키:** 어느 앱에서나 `Ctrl+Shift+R` (macOS는 `Cmd+Shift+R`)을 누르면 커서 위치로 소환
- **닉네임 변경:**  채팅창 타이틀바의 이름을 클릭하면 닉네임을 설정할 수 있습니다.
- **포켓몬 선택:** 채팅창 타이틀바의 드롭다운으로 기본 제공 포켓몬을 바꿀 수 있습니다.
- **펫별 프로필:** 닉네임과 채팅 내역이 펫마다 별도로 저장됩니다.
- **메시지 메뉴:** 메시지를 우클릭하면 복사·삭제·재전송이 가능합니다.

## 기본 제공 포켓몬

| 포켓몬 | 펫 ID | 개발 실행 |
|---|---|---|
| 리오르 | `riolu` | `npm start -- riolu` |
| 루카리오 | `lucario` | `npm start -- lucario` |
| 토오 | `clodsire` | `npm start -- clodsire` |
| 피카츄 | `pikachu` | `npm start -- pikachu` |
| 이상해씨 | `bulbasaur` | `npm start -- bulbasaur` |
| 파이리 | `charmander` | `npm start -- charmander` |
| 꼬부기 | `squirtle` | `npm start -- squirtle` |

## 다운로드

최신 릴리즈는 [Releases](https://github.com/DEV-asdf-516/Pokemon-pets/releases/latest)에서 받을 수 있습니다.

| 플랫폼 | 파일 |
|---|---|
| macOS (Apple Silicon) | `Pokemon-Pet-x.x.x-arm64.dmg` |
| Windows | `Pokemon-Pet-x.x.x-Setup.exe` |
| Linux | `Pokemon-Pet-x.x.x.AppImage` |

## 개발 환경

Node.js 20.9+, npm 필요.

```bash
npm install
npm start
```

개발 모드에서 특정 포켓몬을 바로 소환하려면 `--` 뒤에 펫 ID를 넘기면 됩니다.

```bash
npm start -- pikachu
npm start -- --pikachu
npm start -- lucario
npm start -- clodsire
```

채팅창 타이틀바의 포켓몬 드롭다운에서 다른 포켓몬을 선택하면 설정이 저장되고 앱이 다시 시작됩니다.

이미 앱이 실행 중이면 종료한 뒤 다른 포켓몬으로 다시 실행해야 합니다.

## AI 프로바이더

기본값은 Ollama라서 API 키가 필요 없습니다.

다른 프로바이더로 바꾸려면 프로젝트 루트의 `.env` 파일에 키를 넣고 설정 파일을 수정하세요.

첫 실행 시 `config/setting.json`이 아래 폴더로 복사됩니다. API 키가 필요한 경우(OpenAI / Anthropic / Gemini) `.env` 파일도 같은 폴더에 넣으면 됩니다.

파일: `setting.json` (프로바이더/모델 설정), `.env` (API 키, 선택 사항), `pets/` (수정 가능한 펫 팩)

개발 실행(`npm start`)에서는 Electron의 앱 이름을 기준으로 사용자 데이터 폴더가 `pokemon-pet`으로 생성됩니다. 앱을 패키징하거나 설치한 경우에는 환경에 따라 표시 이름 기반의 폴더를 사용할 수 있습니다.

### macOS

사용자 데이터 폴더: `~/Library/Application Support/pokemon-pet/`

설정 파일을 찾으려면:

```bash
find "$HOME/Library/Application Support" -maxdepth 3 -name setting.json 2>/dev/null | grep -Ei "pokemon|pet"
```

개발용 설정 파일을 Finder에서 열려면:

```bash
open -R "$HOME/Library/Application Support/pokemon-pet/setting.json"
```

### Windows

사용자 데이터 폴더: `%APPDATA%\pokemon-pet\`

PowerShell에서 설정 파일을 찾으려면:

```powershell
Get-ChildItem "$env:APPDATA" -Filter setting.json -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match "pokemon|pet" } |
  Select-Object -ExpandProperty FullName
```

개발용 설정 파일을 열려면:

```powershell
notepad "$env:APPDATA\pokemon-pet\setting.json"
```

### Linux

사용자 데이터 폴더: `~/.config/pokemon-pet/`

설정 파일을 찾으려면:

```bash
find "${XDG_CONFIG_HOME:-$HOME/.config}" -maxdepth 3 -name setting.json 2>/dev/null | grep -Ei "pokemon|pet"
```

개발용 설정 파일을 기본 애플리케이션으로 열려면:

```bash
xdg-open "${XDG_CONFIG_HOME:-$HOME/.config}/pokemon-pet/setting.json"
```

기본 펫 팩은 사용자 `pets/` 폴더에 없을 때만 복사됩니다. 기존 사용자 파일은 덮어쓰지 않으므로 프롬프트, 스프라이트, 동작, 테마를 직접 수정할 수 있습니다.

전체 설정 가이드: [docs/AI_PROVIDERS.ko.md](docs/AI_PROVIDERS.ko.md)

## 새로운 포켓몬 추가하기

새 포켓몬을 추가하는 방법:

[docs/ADDING_POKEMON.ko.md](docs/ADDING_POKEMON.ko.md)

에셋 번들은 한 명령으로 설치하고 검증할 수 있습니다.

```bash
npm run install:pet -- assets/lucario/lucario.bundle.json --force
```

## 아키텍처

런타임 경계와 확장 포인트: [ARCHITECTURE.ko.md](ARCHITECTURE.ko.md)

## 빌드

```bash
npm run dist:mac   # macOS arm64
npm run dist       # 현재 플랫폼
```

## 참고 사항
- 바이브 코딩입니다.
- Claude와 OpenAI 프로바이더는 아직 충분히 테스트하지 못했습니다. 문제가 생기면 이슈로 알려 주세요.

## 면책 조항

포켓몬 및 관련 이름·이미지·사운드의 저작권은 Nintendo / Creatures Inc. / GAME FREAK inc.에 있습니다. 이 프로젝트는 비공식 팬 제작물이며 Nintendo 또는 The Pokémon Company와 일체 관련이 없습니다. 사용된 모든 포켓몬 에셋의 권리는 해당 저작권자에게 있습니다.
