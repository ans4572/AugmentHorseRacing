# ChatGPT 말 스프라이트 프롬프트

같은 ChatGPT 대화창 안에서 순서대로 보내세요. 1번 그림을 기준으로 나머지가 같은 캐릭터 디자인으로 나옵니다.

## 저장 위치

`client/public/horses/` 폴더에 아래 이름으로 저장 (PNG, 투명 배경):

| 번호 | 파일명 | 털 색 |
|---|---|---|
| 1 | horse1.png | 빨강 #e74c3c |
| 2 | horse2.png | 파랑 #3498db |
| 3 | horse3.png | 초록 #2ecc71 |
| 4 | horse4.png | 주황 #f39c12 |
| 5 | horse5.png | 보라 #9b59b6 |
| 6 | horse6.png | 청록 #17b8a6 |

---

## 1단계 — 기준 말 (1번, 빨강)

```
Create a 2D game sprite: a single cute chibi cartoon race horse, side view, facing RIGHT, in a mid-gallop running pose.

Style: super-deformed proportions — an oversized round head almost as big as its chubby round body, short stubby legs, one big sparkling eye with a white highlight, small pointy ears, fluffy rounded mane and tail, a happy determined expression. Thick dark-brown outlines, flat bright cel-shaded colors with glossy highlights, cheerful comic party-game look like a casual mobile racing game.

Colors: bright crimson red coat (#e74c3c), slightly darker red mane and tail, white blaze down the face and a white muzzle, dark brown rounded hooves. Small brown leather saddle with a plain white saddle cloth (no number, no text).

Output: square 1024x1024 PNG with a fully TRANSPARENT background. Full body visible, centered, nothing cropped. No ground, no shadow, no background, no text, no watermark.
```

## 2단계 — 나머지 5마리 (하나씩 보내기)

```
Perfect. Now make the exact same horse character — same pose, same size, same proportions, same outline style, same saddle — but change the coat to bright blue (#3498db) with a darker blue mane and tail. Keep the white face blaze and muzzle. Transparent background PNG, 1024x1024.
```

위 문장에서 색 부분만 바꿔 4번 더 보내세요:

- 3번: `bright green (#2ecc71) with a darker green mane and tail`
- 4번: `bright orange (#f39c12) with a darker orange mane and tail`
- 5번: `bright purple (#9b59b6) with a darker purple mane and tail`
- 6번: `bright teal (#17b8a6) with a darker teal mane and tail`

---

## 문제가 생기면 보낼 수정 프롬프트

배경이 흰색/체크무늬로 나올 때:

```
The background must be truly transparent (alpha channel), not white and not a checkerboard pattern. Please regenerate with a real transparent background.
```

방향이 왼쪽을 볼 때:

```
Flip it so the horse faces RIGHT (running toward the right side of the image). Keep everything else the same.
```

디자인이 1번과 달라졌을 때:

```
This drifted from the first horse. Match the first horse exactly — same head size, same leg pose, same saddle, same line thickness. Only the coat color should differ.
```

---

## (선택) 달리기 애니메이션 2프레임

더 생동감 있게 하려면, 각 말마다 한 장 더 요청해서 `horse1b.png` ~ `horse6b.png`로 저장:

```
Now make a second animation frame of this same horse: identical in every way, except the legs are gathered under the body (the other half of the gallop cycle) and the body is slightly higher. Same canvas size and position so the two frames line up. Transparent background PNG, 1024x1024.
```
