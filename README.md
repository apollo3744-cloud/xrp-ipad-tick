# iPad XRP 독립형 240T/960T PWA v1

PC의 83/83B/R4와 무관하게 iPad가 Upbit 공개 WebSocket에 직접 연결하는 별도 버전입니다.

포함 기능:
- KRW-XRP 체결 실시간 직접 수신
- 240T / 960T 실시간 진행봉
- EMA 5/10/20/60/120
- 굵은 점선 VWAP
- VWAP 기울기 UP / FLAT / DOWN
- EMA5/VWAP 크로스 기반 BUY/SELL 후보 표시
- READ ONLY / 주문 기능 없음

현재 연구값:
- VWAP 기울기: 최근 3개 240T 봉
- UP > +0.02%, FLAT ±0.02%, DOWN < -0.02%
- EMA5/10/20 수렴폭 <= 0.25%

설치 관련:
- iPad 홈 화면 앱(PWA)으로 설치하려면 HTTPS 웹주소에 이 파일들을 올려야 합니다.
- Safari에서 해당 주소 접속 → 공유 버튼 → 홈 화면에 추가.
- 인터넷 연결이 필요합니다.
- v1은 앱을 완전히 종료하면 과거 수집 봉이 초기화됩니다. 다음 버전에서 IndexedDB 저장/복원 기능을 추가할 수 있습니다.


## v2 화살표 표시
- EMA5/EMA10/EMA20 수렴폭이 0.25% 이하일 때만 화살표 표시
- EMA5가 VWAP을 아래에서 위로 상향 돌파: 초록색 ↑
- EMA5가 VWAP을 위에서 아래로 하향 돌파: 빨간색 ↓
- 240T / 960T 두 차트 모두 표시
- 기존 READ ONLY / NO ORDER 유지


## v3 핵심 수정
- PC R4와 동일한 VWAP20 계산으로 변경
  - Typical Price = (High + Low + Close) / 3
  - 최근 20개 틱봉 기준 거래량 가중 rolling VWAP
- EMA5/10/20 수렴 + EMA5/VWAP 상향/하향 교차 화살표 유지
- iPad 브라우저 localStorage 자동 저장/복원 추가
- READ ONLY / NO ORDER 유지

참고: 이 버전은 기존 앱을 켠 시점부터 모은 데이터의 봉을 저장/복원합니다. PC R4와 완전히 같은 과거 봉 경계까지 맞추려면 별도 과거 체결 프리필 단계가 추가로 필요합니다.
