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
