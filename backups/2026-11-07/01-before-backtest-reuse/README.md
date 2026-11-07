# 알트코인 펀딩 차트

6개 거래소의 가격·펀딩 정산 이력, 4분할 차트, RSI, 즐겨찾기 일괄 백테스트를 제공하는 정적 웹 앱입니다.

- 서비스: https://didie111.github.io/altcoin-funding-chart/
- 계산·자료 범위: [BACKTESTING.md](BACKTESTING.md)
- 2026-11-06 ZIP 이식과 11-07 백업 수정: [IMPORT-20261107.md](IMPORT-20261107.md)
- 전달 문서: [프로젝트_필독_문서.md](프로젝트_필독_문서.md), [AI_인수인계_가이드.md](AI_인수인계_가이드.md)

## 로컬 실행

저장소 루트에서 정적 HTTP 서버를 실행합니다. 예:

```sh
python -m http.server 8000
```

브라우저에서 http://localhost:8000/ 을 엽니다. BingX/MEXC 중계의 배포·출처 설정은 [server/README.md](server/README.md)를 참고하세요. 이 저장소에는 `server/server.js`나 npm 앱 서버가 없습니다.

## 검증

```sh
node --test tests/*.cjs tests/*.mjs
```

`tests/browser-responsive-backtest.html`은 생성 예제 138개로 노트북·PC·휴대폰의 고정 진행 표시와 단일 스크롤을 검사합니다. `tests/browser-backtest-backup.html`은 별도의 예제 IndexedDB로 저장소 이전·정밀 가격·즐겨찾기·결과의 백업 복원을 검사합니다. 예제 가격·성과는 일반 앱에서 사용하지 않습니다.

## 백업과 자료 보관

하단 **★ 일괄 결과 → 데이터 백업**은 즐겨찾기 목록, 최근 3회 일괄 결과와 각 실행 설정, 현재 남아 있는 시장자료 캐시를 `.dat` 파일로 저장합니다. **데이터 복원**은 기존 즐겨찾기에 목록을 합치며 중복을 제거합니다. 파일의 기간·전략은 각 결과에 보존됩니다. 진행 중에는 일시 중지한 뒤 백업합니다.

시장자료 캐시는 최대 32MiB LRU이며 모든 코인의 전체 원본을 영구 저장하는 기능은 아닙니다. 오래된 캐시·자료 없는 구간은 공식 파일/API에서 다시 확인합니다. 최초 장기 조회의 완료 시간이나 적중률은 고정 수치로 보장하지 않습니다.

소스 백업은 `backups/YYYY-MM-DD/NN-설명/`에 보관합니다. 코드 백업과 브라우저의 백테스트 자료 백업은 서로 다른 기능입니다.
