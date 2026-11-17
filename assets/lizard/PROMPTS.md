# 레오파드 게코 이미지 만들기

이 폴더에 아래 이름으로 PNG를 넣으면 게임이 자동으로 사용합니다.
파일이 없으면 기본 SVG 그림이 나오므로, 하나씩 채워 넣어도 됩니다.

## 파일 목록 (총 13장)

| 파일 | 단계 | 기분 |
|---|---|---|
| `egg.png` | 알 | - |
| `hatchling_happy.png` / `_ok` / `_sad` / `_sleep` | 아기 게코 | 행복 / 보통 / 슬픔 / 잠 |
| `juvenile_happy.png` / `_ok` / `_sad` / `_sleep` | 어린 게코 | 〃 |
| `adult_happy.png` / `_ok` / `_sad` / `_sleep` | 어른 게코 | 〃 |

### 동작 그림 (선택, 단계마다 2장)
활동하는 동안 잠깐 보이는 그림입니다. 없으면 기분 그림에 움직임 효과만 들어갑니다.

| 파일 | 언제 |
|---|---|
| `<단계>_eat.png` | 밥 먹을 때 (예: `adult_eat.png`) |
| `<단계>_play.png` | 벌레 잡기 놀이할 때 |

(씻기기가 청소하기로 바뀌어서 `_bath.png`는 더 이상 쓰지 않습니다.)

기분별 그림이 부담되면 `hatchling.png`, `juvenile.png`, `adult.png` 3장만 넣어도 됩니다. (기분 그림이 없으면 단계 그림을 씁니다.)

## 이미지 규격
- 배경 투명 PNG (AI가 투명 배경을 못 만들면 remove.bg 등으로 배경 제거)
- 정사각형, 약 800×800px
- 몸 전체가 보이는 옆모습, **머리는 오른쪽**
- 모든 그림을 같은 화풍으로 (첫 번째 그림을 참고 이미지로 넣고 나머지를 생성하면 일관성이 좋아집니다)

## 공통 스타일 (모든 프롬프트 앞에 붙이기)
```
A cute but anatomically realistic leopard gecko, semi-realistic children's book
digital painting, soft lighting, full body side view facing right, centered,
isolated on a plain white background, no text, no shadow on ground.
```

## 단계별 프롬프트
- **egg**: `A single white leathery leopard gecko egg, slightly oval, a tiny crack on top.`
- **hatchling**: `A baby leopard gecko hatchling: big head, big eyes, small body, bold black and yellow banded stripes, thin tail.`
- **juvenile**: `A young leopard gecko: the banded stripes are breaking into black spots, yellow body, medium-thick tail.`
- **adult**: `An adult leopard gecko: bright yellow body covered in black leopard spots, white belly, plump fat tail.`

## 기분별 추가 문구
- **happy**: `eyes wide open, mouth slightly open like smiling, head raised, tongue just licking its lips.`
- **ok**: `calm, relaxed, eyes open, standing normally.`
- **sad**: `droopy posture, head lowered, eyes half-closed, looking sad.`
- **sleep**: `curled up sleeping, eyes closed, tail wrapped around body.`

## 동작별 추가 문구
- **eat**: `mouth open, about to catch and eat a cricket, leaning forward.`
- **play**: `excited hunting pose, crouched low, tail wiggling, eyes focused, ready to pounce.`
