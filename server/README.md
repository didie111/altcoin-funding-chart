# BingX / MEXC 시장 데이터 중계

GitHub Pages에서 BingX와 MEXC를 직접 요청하면 브라우저의 출처 정책 또는 거래소 접근 제한 때문에 공식 응답을 읽지 못할 수 있다. `relay-config.js`에 지정된 서버가 두 거래소의 공개 시장 데이터만 조회한다. 나머지 거래소는 기존 경로를 사용한다.

- 현재값: BingX premiumIndex, MEXC funding_rate
- 정산 이력: BingX fundingRate, MEXC funding_rate/history
- 캔들: BingX swap v3 klines, MEXC contract kline
- 정산 주기: 현재값 응답의 fundingIntervalHours / collectCycle

`market-relay.mjs`는 Sites 서버의 동일 파일을 보관한 사본이다. 서버 소스를 수정할 때는 두 저장소의 파일을 함께 갱신한다. 서버는 `GET /api/market`의 exchange/path와 허용된 매개변수만 받아 공식 URL을 구성한다. 브라우저의 Origin, 쿠키, 인증 정보는 거래소로 전달하지 않는다. 임의 URL, 개인 계정, 주문 API는 지원하지 않는다.

동일 요청을 합치고 성공한 현재값은 최대 3초, 캔들과 이력은 최대 10초 보관한다. 실패한 응답은 이전 성공값으로 대체하지 않는다. `X-Market-Fetched-At`을 차트에 전달해 실제 조회 시각을 표시한다. BingX 요청은 간격을 두고 timestamp를 생성하며, 네트워크 실패일 때만 공식 보조 주소를 이용한다.

BingX 정산 이력은 endTime만 전달할 때 성공 코드와 null 데이터가 반환되는 것을 확인했다. 90일의 startTime/endTime 구간을 함께 전달해 정산 기록을 조회하고, 가장 오래된 기록의 직전 시각으로 구간을 옮겨 과거 이력을 계속 수집한다. 성공 코드의 null 이력은 빈 정산 기록으로 처리한다.

차트 타임프레임은 1m / 3m / 5m / 15m / 30m / 1h / 2h / 4h / 1d이다. MEXC의 3m는 Min1, 2h는 Min60의 실제 OHLCV를 UTC 경계에 맞춰 합성한다. Bitget의 과거 2h도 1H를 합성한다. 원본 봉이 누락된 과거 합성 봉은 만들지 않으며, 페이지 경계의 불완전한 봉은 다음 페이지에서 다시 조회한다.

하단 날짜 이동 버튼 또는 Alt+G로 한국 시간(UTC+9)을 지정한다. 아직 수집하지 않은 구간은 날짜 주변 캔들을 직접 조회하며, 수집 완료 시 현재 화면의 날짜를 유지한다. 전체 캔들 수집에 3,000봉 같은 고정 상한은 없지만 상장 시점과 거래소 API의 실제 보관 범위를 넘을 수는 없다. 가격 캔들과 정산 기록의 제공 범위는 다를 수 있다. 기록 없는 날짜를 최신 날짜나 가짜 값으로 대체하지 않는다.

차트 좌우 이동 시 화면 가장자리와 아직 불러오지 않은 구간의 캔들을 요청한다. 전체 이력 수집 중에도 먼저 수집된 페이지를 사용할 수 있다. 과거 전체 수집을 중지해도 실시간 갱신과 이동 구간 조회는 계속된다. 날짜 이동은 선택한 봉을 중앙에 맞추며, 이력 추가 중에는 시각을 기준으로 화면을 유지한다.

실시간 캔들은 3초, 현재 펀딩비는 10초, 정산 이력은 60초마다 요청한다. 최신 봉은 `update`로 거래량·펀딩비 시간점·RSI·정산 주기와 함께 갱신하며, 뒤늦은 과거 페이지가 현재 봉을 덮어쓰지 않는다. RSI는 재귀 계산 상태를 이어 사용하며, 아직 수집하지 않은 시간 간격은 이어서 계산하지 않는다. 현재 미정산 구간의 주기는 공식 응답 또는 최근 정산 간격을 사용하며, 과거 기록이 없는 구간에는 현재 정책을 소급하지 않는다.

가격축의 현재가 아래에는 각 타임프레임 봉의 남은 시간이 표시되고 시간축 오른쪽에는 한국시간 시계가 표시된다. 이동 버튼은 차트 위에 마우스가 있거나 키보드로 버튼에 접근한 경우 표시된다. RSI 설정의 모습 탭에서 상단·중간·하단 기준선의 표시, 값, 색상, 두께, 선 모양을 각각 변경할 수 있다.

서버 주소: https://altcoin-market-relay.artfulscout128.chatgpt.site

Sites 프로젝트 ID: `appgprj_6ace001c27188191ac657309f271aa40`

Sites의 기존 프로젝트 소스를 열어 수정·배포한다. 새 프로젝트를 다시 만들지 않는다. GitHub 공개 차트에서 사용하는 조회 경로는 익명 접근이 가능해야 한다. Sites 서비스 접근용 토큰이나 소스 저장소 토큰을 `relay-config.js` 또는 브라우저 코드에 넣지 않는다.

검증 명령:

```sh
node --test tests/*.test.cjs tests/*.test.mjs
```

공식 문서:

- https://www.mexc.com/announcements/article/futures-api-access-domain-update-17827791532974
- https://www.mexc.com/api-docs/futures/market-endpoints/get-funding-rate
- https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/base-urls.md
