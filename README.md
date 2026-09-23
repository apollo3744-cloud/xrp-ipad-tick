# iPad XRP 독립형 240T/960T PWA v4

## v4 핵심
- PC R4와 동일한 VWAP20 계산식
  - Typical Price = (High + Low + Close) / 3
  - PV = Typical Price × Volume
  - 최근 20개 틱봉 rolling VWAP = rolling(PV) / rolling(Volume)
- EMA 5/10/20/60/120
- EMA5/10/20 수렴폭 <= 0.25%
- EMA5가 VWAP 상향 교차: 초록 ↑
- EMA5가 VWAP 하향 교차: 빨강 ↓
- VWAP 방향은 완성 240T 최근 3봉 기준
  - UP > +0.02%
  - FLAT ±0.02%
  - DOWN < -0.02%
- READ ONLY / NO ORDER

## v4 추가
- 최초 실행 시 Upbit 최근 체결 REST API로 약 120,000건 자동 프리필 시도
- 목표: 240T 약 500봉 / 960T 약 125봉
- 과거 체결 로딩 진행률 표시
- localStorage 저장/복원
- iPad 잠자기/복귀 시 누락 체결 보충 시도
- 서비스워커 캐시 v4로 갱신

주의:
- 네트워크 또는 브라우저 정책으로 과거 REST 호출이 실패하면 실시간부터 시작합니다.
- PC R4와 VWAP 공식은 동일하지만, iPad와 PC의 틱봉 시작 경계가 다르면 개별 봉은 일부 다를 수 있습니다.
